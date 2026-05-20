/**
 * generate-report-local.mjs — 로컬 AI 보고서 생성 + 업로드 도구
 *
 * 프로덕션 route.ts와 동일한 다단계 구조:
 *   데이터 수집(16+ API) → Wave1 병렬 5 LLM → Wave2 병렬 3 LLM → Critique 1 LLM → 병합
 *
 * 사용법:
 *   node scripts/generate-report-local.mjs [--model=qwen3:8b] [--locale=ko] [--auto-upload]
 *   node scripts/generate-report-local.mjs --upload=latest
 *   node scripts/generate-report-local.mjs --upload=reports/report-YYYY-MM-DD-session-locale.json
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';
import { fetchSeibroShort } from './lib/seibro.mjs';
import { fetchKrxInvestorFlow } from './lib/krx-investor.mjs';
import { fetchOptionsData } from './lib/yahoo-options.mjs';
import { saveReport, saveRecommendations, getEntryFeedbackStats } from './lib/db.mjs';
import { snapshotAllEndpoints } from './lib/snapshot-endpoints.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
const REPORTS_DIR = resolve(ROOT, 'reports');

// ── .env.local 파싱 ────────────────────────────────────────────────────────────
function loadEnv() {
  const env = {};
  try {
    const raw = readFileSync(resolve(ROOT, '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { console.error('.env.local not found'); process.exit(1); }
  return env;
}

const env = loadEnv();
const args = process.argv.slice(2);
const modelArg = args.find(a => a.startsWith('--model='))?.split('=')[1] ?? 'qwen3:8b';
const uploadArg = args.find(a => a.startsWith('--upload='))?.split('=')[1];
const autoUpload = args.includes('--auto-upload');
const localeArg = args.find(a => a.startsWith('--locale='))?.split('=')[1] ?? 'ko';
const SITE = env.NEXT_PUBLIC_SITE_URL?.replace(/\s+/g, '') || 'https://flowvium.net';

// ── 상수 ──────────────────────────────────────────────────────────────────────
const LOCALE_LANG = {
  ko: 'Korean', en: 'English', ja: 'Japanese', 'zh-CN': 'Simplified Chinese', 'zh-TW': 'Traditional Chinese',
  es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese', ru: 'Russian',
  ar: 'Arabic', hi: 'Hindi', id: 'Indonesian', th: 'Thai', tr: 'Turkish', vi: 'Vietnamese',
};
const TARGET_LANG = LOCALE_LANG[localeArg] ?? 'Korean';

const CJK_LOCALES = new Set(['ko', 'ja', 'zh-CN', 'zh-TW', 'zh']);

const CANDIDATE_TICKERS = [
  'NVDA','MSFT','AAPL','META','GOOGL','AMZN','TSLA','KLAC','AMD','JPM','V','UNH','XOM','GS','BAC',
  // AI infra / semicon — ASML·TSM 만성 UNDEF 해결 (보고서 63%·52% 출현인데 후보 누락)
  'TSM','ASML','AVGO','AMAT','LRCX',
  // Recent IPO / high-signal
  'CRWV','APP','ARM','MU','MRVL','SMCI','DDOG','NET','ANET','PLTR',
  // Defense / pharma
  'LMT','RTX','NOC','LLY','MRNA','COIN',
  // ETFs / indices
  'SPY','QQQ','GLD','TLT','USO','IWM','XLE','XLK','XLF','XLV',
  'EWY','EWJ','FXI','VGK','INDA','EWT','EWZ','EWA',
  'BITO','SLV','DBA',
  // KR
  '005930.KS','000660.KS','373220.KS','005380.KS','035420.KS',
  '035720.KS','207940.KS','051910.KS','005490.KS','000270.KS',
];
const KR_NAMES = {
  '005930.KS':'삼성전자','000660.KS':'SK하이닉스','373220.KS':'LG에너지솔루션',
  '005380.KS':'현대차','035420.KS':'NAVER','035720.KS':'카카오',
  '207940.KS':'삼성바이오로직스','051910.KS':'LG화학','005490.KS':'POSCO홀딩스','000270.KS':'기아',
};
const INDEX_TICKERS = new Set([
  '^KS11','^N225','^GSPC','^DJI','^IXIC','KOSPI','NIKKEI','KOSDAQ','^KQ11',
  'KS','KR','JP','CN','EU','US','UK','KOSPI200','KOSPI100','KOSPI50','KOSDAQ150','KRX300',
  'SPX','NDX','RUT','DAX','FTSE','HSI','N225','SENSEX','VIX',
]);
const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
};

// ── 품질 게이트 ────────────────────────────────────────────────────────────────
const GARBAGE_MIN_LEN = { thesis: 25, macroAnalysis: 30, technicalAnalysis: 15, fundamentalAnalysis: 15 };
function garbageMinLen(base) {
  // CJK 문자는 글자당 정보 밀도가 영어의 2-3배 → 45% 임계값 적용
  return CJK_LOCALES.has(localeArg) ? Math.ceil(base * 0.45) : base;
}
function isGarbage(text, minLen = 15) {
  if (!text || text.trim().length === 0) return false;
  const t = text.trim();
  if (t.length < minLen) return true;
  if (/^[^\n+]+(\+[^\n+]+){2,}$/.test(t)) return true;
  if (t.length < 80 && /^[^\n+]{3,}\+[^\n+]{3,}$/.test(t) && !/\d+%|\d+\.\d+|\$\d/.test(t)) return true;
  if (/^[^\n/|→]+([/|→][^\n/|→]+){2,}$/.test(t) && t.length < 80) return true;
  const tokens = t.split(/[\s,+|/·→]+/).filter(w => w.length > 1);
  if (tokens.length >= 4) {
    const freq = new Map();
    for (const tok of tokens) freq.set(tok.toLowerCase(), (freq.get(tok.toLowerCase()) ?? 0) + 1);
    const maxFreq = Math.max(...Array.from(freq.values()));
    if (maxFreq / tokens.length > 0.55) return true;
  }
  return false;
}
// ── Harness: 핵심 결함 자동 교정 (src/lib/strategy-schema.ts 와 동일 규칙) ──
const KR_NAMES_HARNESS = {
  '005930.KS': '삼성전자', '000660.KS': 'SK하이닉스', '373220.KS': 'LG에너지솔루션',
  '005380.KS': '현대차', '035420.KS': 'NAVER', '035720.KS': '카카오',
  '207940.KS': '삼성바이오로직스', '051910.KS': 'LG화학',
  '005490.KS': 'POSCO홀딩스', '000270.KS': '기아',
};
function dedupRationale(s) {
  if (!s || !s.includes(' | ')) return s;
  const parts = s.split(' | ').map(x => x.trim());
  const seen = new Set(); const uniq = [];
  for (const p of parts) {
    const k = p.toLowerCase().replace(/[^\w가-힣]+/g, '').slice(0, 60);
    if (k && !seen.has(k)) { seen.add(k); uniq.push(p); }
  }
  return uniq.join(' | ');
}
// 미국·글로벌 주요 ticker→name 매핑 (strategy-schema.ts US_NAMES 와 동기화).
// SMCI↔SMTC↔SNPS, MU↔MCHP 등 LLM 이 비슷한 이름으로 혼동하는 패턴 차단.
const US_NAMES_HARNESS = {
  NVDA: 'NVIDIA', AMD: 'AMD', INTC: 'Intel',
  MU: 'Micron Technology', MCHP: 'Microchip Technology',
  TSM: 'TSMC', ASML: 'ASML Holding', AMAT: 'Applied Materials',
  LRCX: 'Lam Research', KLAC: 'KLA Corporation', AVGO: 'Broadcom',
  QCOM: 'Qualcomm', ARM: 'ARM Holdings',
  SMCI: 'Super Micro Computer', SMTC: 'Semtech Corporation', SNPS: 'Synopsys',
  ON: 'onsemi', MRVL: 'Marvell Technology',
  AAPL: 'Apple', MSFT: 'Microsoft', GOOGL: 'Alphabet', GOOG: 'Alphabet',
  AMZN: 'Amazon', META: 'Meta Platforms', TSLA: 'Tesla', NFLX: 'Netflix',
  ORCL: 'Oracle', CRM: 'Salesforce', ADBE: 'Adobe', NOW: 'ServiceNow',
  PLTR: 'Palantir',
  JPM: 'JPMorgan Chase', GS: 'Goldman Sachs', BLK: 'BlackRock',
  V: 'Visa', MA: 'Mastercard',
  LMT: 'Lockheed Martin', RTX: 'RTX', NOC: 'Northrop Grumman',
  KTOS: 'Kratos Defense',
  XOM: 'Exxon Mobil', CVX: 'Chevron',
  TDS: 'Telephone and Data Systems',
  IONQ: 'IonQ',
  SPY: 'SPDR S&P 500 ETF', QQQ: 'Invesco QQQ', DELL: 'Dell Technologies',
};

const ACTION_DOWNGRADE_PATTERNS_HARNESS = [
  /매수\s*자제/, /보유\s*권장/, /신규\s*매수\s*자제/, /고점\s*주의/,
  /과매수/, /기초\s*약화/, /조정\s*가능/, /매수\s*대신\s*보유/,
  /watch\b/i, /avoid\s+new\s+buy/i, /trim\b/i, /reduce\s+position/i,
];

// ── Ban list (analyze-recs --export 산출물): 과거 평가에서 stop_loss/avg_pnl 기준 미달
// → action=watch + confidence=low 강제 + critiqueNote 부착.
function loadBanList() {
  try {
    const raw = readFileSync(resolve(ROOT, 'data/ban-list.json'), 'utf8');
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Map();
    return new Map(arr.map(b => [b.ticker.toUpperCase(), b]));
  } catch { return new Map(); }
}
const BAN_LIST_HARNESS = loadBanList();

// ── Entry calibration (analyze-recs --export): ticker 별 not_entered 케이스의
// 시장가 - entry_high median gap(%). 5% 초과면 해당 ticker entry 가 만성적으로
// 시장가에 못 미친다는 신호 → validateEntryZones 에서 더 공격적 clamp 적용.
function loadEntryCalibration() {
  try {
    const raw = readFileSync(resolve(ROOT, 'data/entry-calibration.json'), 'utf8');
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Map();
    return new Map(arr.map(c => [c.ticker.toUpperCase(), c]));
  } catch { return new Map(); }
}
const ENTRY_CALIBRATION = loadEntryCalibration();

function nativeCurrencyForTickerMjs(ticker) {
  const t = (ticker ?? '').toUpperCase();
  if (t.endsWith('.KS') || t.endsWith('.KQ')) return '₩';
  if (t.endsWith('.AS') || t.endsWith('.PA') || t.endsWith('.DE')) return '€';
  return '$';
}

function emptyHarnessAudit() {
  return {
    fixes: {
      krNameMismatch: [], rationaleDedup: [], insiderFilingsType: [],
      sectorAllocSum: null, portfolioAllocSum: null,
      buyLowConfidence: [], stopLossDeep: [], targetBullInverted: [],
      stopLossAboveEntry: [], entryFar50MA: [], companyChangeName: [],
      unrealistic52WRange: [], stopRationaleMismatch: [],
      usNameMismatch: [], targetBullUnrealistic: [],
      actionCritiqueMismatch: [], stopRationaleAligned: [], currencyMismatch: [],
      bannedDowngrade: [],
    },
    schemaErrors: [], appliedAt: new Date().toISOString(), totalFixes: 0,
  };
}
function parseFirstPriceMjs(s) {
  if (!s) return null;
  const m = String(s).replace(/[$₩,\s]/g, '').match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}
function applyLocalHarness(r, livePrices) {
  const audit = emptyHarnessAudit();
  if (!r || !Array.isArray(r.portfolio)) return audit;

  // 1. KR ticker name mismatch
  for (const p of r.portfolio) {
    const expected = KR_NAMES_HARNESS[p.ticker?.toUpperCase()];
    if (expected && p.name !== expected) {
      audit.fixes.krNameMismatch.push(`${p.ticker}:"${p.name}"→"${expected}"`);
      p.name = expected;
    }
    // 2. action=buy + confidence=low → watch
    if (p.action === 'buy' && p.confidence === 'low') {
      audit.fixes.buyLowConfidence.push(`${p.ticker}:buy+low→watch`);
      p.action = 'watch';
    }
    // 3. rationale 중복
    if (p.rationale) {
      const before = p.rationale;
      p.rationale = dedupRationale(p.rationale);
      if (p.rationale !== before) audit.fixes.rationaleDedup.push(p.ticker);
    }
    // 4. stopLoss 거리 검증 (자동 교정 X — 경고만)
    const e = parseFirstPriceMjs(p.entryZone);
    const s = parseFirstPriceMjs(p.stopLoss);
    if (e && s && e > 0 && (e - s) / e > 0.20) {
      audit.fixes.stopLossDeep.push(`${p.ticker}:${((e-s)/e*100).toFixed(1)}%`);
    }
    // 5. targetBull < target 검증 (경고만)
    const t = parseFirstPriceMjs(p.target);
    const tb = parseFirstPriceMjs(p.targetBull);
    if (t && tb && tb < t) {
      audit.fixes.targetBullInverted.push(`${p.ticker}:bull=${tb}<base=${t}`);
    }
  }

  // 6a. stopLoss > entry 자동 교정 — stop 은 정의상 entry 보다 낮아야 함
  // SMCI $32 entry + $120 stop, NVDA $206 entry + $500 stop 등 LLM hallucination 차단.
  // (1) stop >= entry * 1.05 인 경우 stop = entry * 0.93 으로 강제 재계산
  // (2) action=watch 강등 + critiqueNote 부착 — 진입 보류 신호
  for (const p of r.portfolio) {
    const e = parseFirstPriceMjs(p.entryZone);
    const st = parseFirstPriceMjs(p.stopLoss);
    if (!e || !st || e <= 0) continue;
    if (st < e * 1.05) continue; // 정상 (stop < entry)
    const isKR = p.ticker?.endsWith('.KS');
    const sym = isKR ? '₩' : (p.stopLoss?.match(/^[₩$€]/)?.[0] ?? '$');
    const newStop = e * 0.93;
    const fmt = isKR
      ? (n) => `${sym}${Math.round(n).toLocaleString('en-US')}`
      : (n) => `${sym}${n.toFixed(2)}`;
    audit.fixes.stopLossAboveEntry.push(`${p.ticker}:stop=${st} >= entry=${e} → ${fmt(newStop)}`);
    p.stopLoss = fmt(newStop);
    p.action = 'watch';
    p.critiqueNote = (p.critiqueNote ? p.critiqueNote + ' | ' : '') +
      `stopLoss(${fmt(st)}) > entry(${fmt(e)}) hallucination — entry·0.93 으로 재계산, 진입 보류`;
  }

  // 6b. entry vs rationale 50MA 자동 교정 (ASML $1402 50MA + entry $350 케이스)
  // entry/stop/target 을 livePrice (있으면) 또는 50MA 기반으로 재계산 + action=watch 강등.
  // 50MA-only 재계산은 50MA<실가일 때 도달 불가 zone 을 만들어 buy→실진입 불일치 유발 (2026-05-16 ASML 사건).
  for (const p of r.portfolio) {
    // entryPlan 이 있으면 computePricesFromPlan 이 이미 시장가 기반으로 계산했으므로 skip
    if (p.entryPlan) continue;
    const ma50Match = p.rationale?.match(/50MA[^$₩\d]*([$₩])?([\d,]+\.?\d*)/);
    if (!ma50Match) continue;
    const currencySym = ma50Match[1] ?? '$';
    const ma50 = parseFloat(ma50Match[2].replace(/,/g, ''));
    const e = parseFirstPriceMjs(p.entryZone);
    if (!ma50 || !e || ma50 <= 0) continue;
    const ratio = e / ma50;
    if (ratio > 0.5 && ratio < 2.0) continue;

    const fmt = currencySym === '₩'
      ? (n) => `₩${Math.round(n / 100) * 100}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
      : (n) => `$${n.toFixed(2)}`;
    // 기준가: livePrice 우선 (현재가), 없으면 50MA 폴백
    const livePrice = livePrices?.get(p.ticker)?.price ?? null;
    const anchor = livePrice && livePrice > 0 ? livePrice : ma50;
    const anchorLabel = livePrice && livePrice > 0 ? 'livePrice' : '50MA';
    const newLow = anchor * 0.97, newHigh = anchor * 1.00;
    const newStop = anchor * 0.92, newTarget = anchor * 1.15, newBull = anchor * 1.30;

    audit.fixes.entryFar50MA.push(
      `${p.ticker}:entry=${e}→${fmt(newLow)}-${fmt(newHigh)} (was ${ratio.toFixed(2)}x of 50MA=${ma50}, anchor=${anchorLabel})`,
    );
    p.entryZone = `${fmt(newLow)}-${fmt(newHigh)}`;
    p.stopLoss = fmt(newStop);
    p.target = fmt(newTarget);
    p.targetBull = fmt(newBull);
    p.action = 'watch';
    p.critiqueNote = (p.critiqueNote ? p.critiqueNote + ' | ' : '') +
      `가격 hallucination 의심 — ${anchorLabel}(${fmt(anchor)}) 기반 재계산, 진입 전 재검토 필요`;
  }

  // 6d. 52주 ratio > 10x → split/통화/데이터 오류 의심, watch 강등
  // (5x → 10x 완화: SK하이닉스 같은 정상 8.7x 상승 false positive 방지)
  for (const p of r.portfolio) {
    const m52 = p.rationale?.match(/52주[^$₩\d]*[$₩]?([\d,.]+)\s*-\s*[$₩]?([\d,.]+)/);
    if (!m52) continue;
    const lo = parseFloat(m52[1].replace(/,/g, ''));
    const hi = parseFloat(m52[2].replace(/,/g, ''));
    if (lo <= 0 || !isFinite(hi)) continue;
    const ratio = hi / lo;
    if (ratio < 10) continue;
    audit.fixes.unrealistic52WRange.push(`${p.ticker}:${m52[1]}-${m52[2]} (${ratio.toFixed(1)}x)`);
    p.action = 'watch';
    p.critiqueNote = (p.critiqueNote ? p.critiqueNote + ' | ' : '') +
      `52주 범위 비현실(${ratio.toFixed(1)}x) — split/통화/데이터 오류 의심, 진입 보류`;
  }

  // 6e. stopLossRationale 가격 mismatch 검출만 (자동 교정 X — false positive 위험)
  if (Array.isArray(r.stopLossRationale)) {
    for (const sr of r.stopLossRationale) {
      const p = r.portfolio.find(x => x.ticker === sr.ticker);
      if (!p) continue;
      const stopP = parseFirstPriceMjs(p.stopLoss);
      if (!stopP) continue;
      const matches = sr.rationale?.match(/[$₩][\d,.]+/g) || [];
      const vals = matches.map(m => parseFloat(m.replace(/[$₩,]/g, ''))).filter(v => v > 0);
      const inconsistent = vals.find(v => v < stopP * 0.5 || v > stopP * 2);
      if (!inconsistent) continue;
      audit.fixes.stopRationaleMismatch.push(`${sr.ticker}:portfolio=${stopP} vs rationale=${inconsistent} (참고가격, 검증 필요)`);
    }
  }

  // 6c. companyChanges.name KR_NAMES 매핑
  if (Array.isArray(r.companyChanges)) {
    for (const c of r.companyChanges) {
      const expected = KR_NAMES_HARNESS[c.ticker?.toUpperCase()];
      if (expected && c.name !== expected) {
        audit.fixes.companyChangeName.push(`${c.ticker}:"${c.name}"→"${expected}"`);
        c.name = expected;
      }
    }
  }

  // 6f. US ticker → name 화이트리스트 (SMCI/MU/TDS 류 hallucination 차단)
  for (const p of r.portfolio) {
    const expected = US_NAMES_HARNESS[p.ticker?.toUpperCase()];
    if (expected && p.name !== expected) {
      audit.fixes.usNameMismatch.push(`${p.ticker}:portfolio "${p.name}"→"${expected}"`);
      p.name = expected;
    }
  }
  if (Array.isArray(r.companyChanges)) {
    for (const c of r.companyChanges) {
      const expected = US_NAMES_HARNESS[c.ticker?.toUpperCase()];
      if (expected && c.name !== expected) {
        audit.fixes.usNameMismatch.push(`${c.ticker}:companyChanges "${c.name}"→"${expected}"`);
        c.name = expected;
      }
    }
  }

  // 6g. targetBull 합리성 — entry 대비 2x 초과 또는 target 대비 1.6x 초과 시 축소
  for (const p of r.portfolio) {
    if (!p.targetBull) continue;
    const tb = parseFirstPriceMjs(p.targetBull);
    const t = parseFirstPriceMjs(p.target);
    const e = parseFirstPriceMjs(p.entryZone);
    if (tb == null || t == null || e == null || e <= 0) continue;
    const bullVsEntry = tb / e;
    const bullVsTarget = tb / t;
    if (bullVsEntry <= 2.0 && bullVsTarget <= 1.6) continue;
    const sym = (p.targetBull.match(/^[₩$€]/)?.[0]) ?? '$';
    const newBull = t * 1.2;
    const fmt = sym === '₩'
      ? (n) => `₩${Math.round(n).toLocaleString('en-US')}`
      : (n) => `${sym}${n.toFixed(2)}`;
    audit.fixes.targetBullUnrealistic.push(
      `${p.ticker}:targetBull ${p.targetBull}→${fmt(newBull)} (${bullVsEntry.toFixed(1)}x entry)`,
    );
    p.targetBull = fmt(newBull);
    p.critiqueNote = (p.critiqueNote ? p.critiqueNote + ' | ' : '') +
      `targetBull ${bullVsEntry.toFixed(1)}x of entry — 자동 축소`;
  }

  // 6h. action=buy 인데 critique/risk 에 경고 키워드 → watch 강등
  for (const p of r.portfolio) {
    if (p.action !== 'buy') continue;
    const notes = `${p.critiqueNote ?? ''} ${p.riskNote ?? ''}`;
    const matched = ACTION_DOWNGRADE_PATTERNS_HARNESS.find(re => re.test(notes));
    if (!matched) continue;
    audit.fixes.actionCritiqueMismatch.push(`${p.ticker}:buy→watch (note 매칭)`);
    p.action = 'watch';
  }

  // 6i. stopLossRationale "손절선 ~X" → portfolio.stopLoss 값으로 통일
  if (Array.isArray(r.stopLossRationale)) {
    for (const sr of r.stopLossRationale) {
      const p = r.portfolio.find(x => x.ticker === sr.ticker);
      if (!p) continue;
      const stopP = parseFirstPriceMjs(p.stopLoss);
      if (!stopP) continue;
      const m = sr.rationale?.match(/손절선\s*~\s*([$₩€])?([\d,.]+)/);
      if (!m) continue;
      const rationaleStop = parseFloat(m[2].replace(/,/g, ''));
      if (!isFinite(rationaleStop) || rationaleStop === stopP) continue;
      if (Math.abs(rationaleStop - stopP) / stopP < 0.05) continue;
      const sym = m[1] ?? (p.stopLoss.match(/^[₩$€]/)?.[0] ?? '$');
      sr.rationale = sr.rationale.replace(
        /손절선\s*~\s*[$₩€]?[\d,.]+/,
        `손절선 ~${sym}${stopP}`,
      );
      audit.fixes.stopRationaleAligned.push(`${sr.ticker}:${rationaleStop}→${stopP}`);
    }
  }

  // 6j. 통화 일관성 — native 통화와 다른 기호 사용 시 경고만 (자동 교정 X)
  for (const p of r.portfolio) {
    const native = nativeCurrencyForTickerMjs(p.ticker);
    const fields = [['entry', p.entryZone], ['stop', p.stopLoss], ['target', p.target]];
    const mismatches = [];
    for (const [field, val] of fields) {
      if (!val) continue;
      const sym = val.match(/[₩$€]/)?.[0];
      if (sym && sym !== native) mismatches.push(`${field}=${sym}`);
    }
    if (mismatches.length > 0) {
      audit.fixes.currencyMismatch.push(`${p.ticker} (native ${native}): ${mismatches.join(', ')}`);
    }
  }

  // 6k. Ban list 강등 — data/ban-list.json (analyze-recs.mjs --export 산출)
  // 과거 평가에서 2+ stop_loss + 0 hits OR avg_pnl < -10% 인 ticker 는
  // action=watch + confidence=low 로 강등하고 critiqueNote 에 사유 부착.
  for (const p of r.portfolio) {
    const banned = BAN_LIST_HARNESS.get(p.ticker?.toUpperCase());
    if (!banned) continue;
    const wasAction = p.action;
    const wasConf = p.confidence;
    p.action = 'watch';
    p.confidence = 'low';
    p.critiqueNote = (p.critiqueNote ? p.critiqueNote + ' | ' : '') +
      `과거 평가 부진 (${banned.reason}, eval=${banned.evaluated}/hits=${banned.hits}/stops=${banned.stops}/pnl=${banned.avg_pnl}%) — action 강등`;
    audit.fixes.bannedDowngrade.push(`${p.ticker}:${wasAction}/${wasConf}→watch/low (${banned.reason})`);
  }

  // 7. insiderSignals.filings type
  if (Array.isArray(r.insiderSignals)) {
    for (const sig of r.insiderSignals) {
      if (Array.isArray(sig.filings)) {
        const before = JSON.stringify(sig.filings);
        sig.filings = sig.filings[0] ?? 0;
        audit.fixes.insiderFilingsType.push(`${sig.ticker ?? '?'}:array${before}→${sig.filings}`);
      } else if (typeof sig.filings === 'string') {
        const before = sig.filings;
        sig.filings = parseInt(sig.filings, 10) || 0;
        audit.fixes.insiderFilingsType.push(`${sig.ticker ?? '?'}:string"${before}"→${sig.filings}`);
      }
    }
  }

  // 7. sectorAllocation 합산 정규화
  if (Array.isArray(r.sectorAllocation) && r.sectorAllocation.length > 0) {
    const sum = r.sectorAllocation.reduce((a, x) => a + (x.pct ?? 0), 0);
    if (sum > 0 && Math.abs(sum - 100) > 2) {
      const scale = 100 / sum;
      r.sectorAllocation.forEach(x => { x.pct = Math.round((x.pct ?? 0) * scale); });
      const drift = 100 - r.sectorAllocation.reduce((a, x) => a + x.pct, 0);
      if (drift !== 0) r.sectorAllocation[0].pct += drift;
      audit.fixes.sectorAllocSum = { from: sum, to: 100 };
    }
  }

  // 8. portfolio.allocation 합산 정규화
  const pSum = r.portfolio.reduce((a, x) => a + (x.allocation ?? 0), 0);
  if (pSum > 0 && Math.abs(pSum - 100) > 2) {
    const scale = 100 / pSum;
    r.portfolio.forEach(x => { x.allocation = Math.round((x.allocation ?? 0) * scale); });
    const drift = 100 - r.portfolio.reduce((a, x) => a + x.allocation, 0);
    if (drift !== 0) r.portfolio[0].allocation += drift;
    audit.fixes.portfolioAllocSum = { from: pSum, to: 100 };
  }

  audit.totalFixes =
    audit.fixes.krNameMismatch.length +
    audit.fixes.rationaleDedup.length +
    audit.fixes.insiderFilingsType.length +
    (audit.fixes.sectorAllocSum ? 1 : 0) +
    (audit.fixes.portfolioAllocSum ? 1 : 0) +
    audit.fixes.buyLowConfidence.length +
    audit.fixes.stopLossDeep.length +
    audit.fixes.targetBullInverted.length +
    audit.fixes.stopLossAboveEntry.length +
    audit.fixes.entryFar50MA.length +
    audit.fixes.companyChangeName.length +
    audit.fixes.unrealistic52WRange.length +
    audit.fixes.stopRationaleMismatch.length +
    audit.fixes.usNameMismatch.length +
    audit.fixes.targetBullUnrealistic.length +
    audit.fixes.actionCritiqueMismatch.length +
    audit.fixes.stopRationaleAligned.length +
    audit.fixes.currencyMismatch.length +
    audit.fixes.bannedDowngrade.length;

  if (audit.totalFixes > 0) {
    console.log(`\n  [harness] ${audit.totalFixes} 결함 자동 교정/검출:`);
    if (audit.fixes.krNameMismatch.length) console.log(`    - KR name: ${audit.fixes.krNameMismatch.join(', ')}`);
    if (audit.fixes.companyChangeName.length) console.log(`    - companyChanges name: ${audit.fixes.companyChangeName.join(', ')}`);
    if (audit.fixes.rationaleDedup.length) console.log(`    - rationale dup: ${audit.fixes.rationaleDedup.join(', ')}`);
    if (audit.fixes.insiderFilingsType.length) console.log(`    - filings type: ${audit.fixes.insiderFilingsType.join(', ')}`);
    if (audit.fixes.sectorAllocSum) console.log(`    - sectorAlloc sum ${audit.fixes.sectorAllocSum.from}→100`);
    if (audit.fixes.portfolioAllocSum) console.log(`    - portfolio alloc sum ${audit.fixes.portfolioAllocSum.from}→100`);
    if (audit.fixes.buyLowConfidence.length) console.log(`    - buy+low: ${audit.fixes.buyLowConfidence.join(', ')}`);
    if (audit.fixes.stopLossDeep.length) console.warn(`    ⚠️  stopLoss deep: ${audit.fixes.stopLossDeep.join(', ')}`);
    if (audit.fixes.stopLossAboveEntry.length) console.warn(`    ⚠️  stop>=entry: ${audit.fixes.stopLossAboveEntry.join(', ')}`);
    if (audit.fixes.entryFar50MA.length) console.warn(`    🔧 entry≠50MA 자동교정 + watch강등: ${audit.fixes.entryFar50MA.join(', ')}`);
    if (audit.fixes.targetBullInverted.length) console.warn(`    ⚠️  bull < base: ${audit.fixes.targetBullInverted.join(', ')}`);
    if (audit.fixes.unrealistic52WRange.length) console.warn(`    🔧 52주 비현실 → watch강등: ${audit.fixes.unrealistic52WRange.join(', ')}`);
    if (audit.fixes.stopRationaleMismatch.length) console.warn(`    🔧 stop 가격 통일: ${audit.fixes.stopRationaleMismatch.join(', ')}`);
    if (audit.fixes.usNameMismatch.length) console.warn(`    🔧 US name: ${audit.fixes.usNameMismatch.join(', ')}`);
    if (audit.fixes.targetBullUnrealistic.length) console.warn(`    🔧 targetBull 축소: ${audit.fixes.targetBullUnrealistic.join(', ')}`);
    if (audit.fixes.actionCritiqueMismatch.length) console.warn(`    🔧 action 강등: ${audit.fixes.actionCritiqueMismatch.join(', ')}`);
    if (audit.fixes.stopRationaleAligned.length) console.warn(`    🔧 stopRationale 정렬: ${audit.fixes.stopRationaleAligned.join(', ')}`);
    if (audit.fixes.currencyMismatch.length) console.warn(`    ⚠️  통화 불일치: ${audit.fixes.currencyMismatch.join(', ')}`);
    if (audit.fixes.bannedDowngrade.length) console.warn(`    🚫 ban-list 강등: ${audit.fixes.bannedDowngrade.join(', ')}`);
  } else {
    console.log(`  [harness] ✅ 결함 없음 — 깨끗한 출력`);
  }
  return audit;
}

function qualityCheck(report) {
  const issues = [];
  const warnings = [];
  if (isGarbage(report.thesis, garbageMinLen(GARBAGE_MIN_LEN.thesis)))
    issues.push(`thesis GARBAGE: "${report.thesis}"`);
  if (isGarbage(report.macroAnalysis, garbageMinLen(GARBAGE_MIN_LEN.macroAnalysis)))
    issues.push(`macroAnalysis GARBAGE: "${report.macroAnalysis?.slice(0, 60)}"`);
  if (isGarbage(report.technicalAnalysis, garbageMinLen(GARBAGE_MIN_LEN.technicalAnalysis)))
    issues.push(`technicalAnalysis GARBAGE: "${report.technicalAnalysis?.slice(0, 60)}"`);
  if (!report.portfolio?.length) issues.push('portfolio EMPTY');
  if (!report.marketNarrative) issues.push('marketNarrative MISSING');
  if (!report.regionStances || Object.keys(report.regionStances).length === 0) issues.push('regionStances MISSING');
  if (!report.shortSqueeze?.length) issues.push('shortSqueeze MISSING');

  // Ticker duplicate check — catches NVDA + NVIDIA both surviving dedup
  if (Array.isArray(report.portfolio) && report.portfolio.length > 0) {
    const tickersSeen = new Map(); // normalizedKey → original ticker
    for (const p of report.portfolio) {
      const raw = p.ticker ?? '';
      const norm = raw.toUpperCase().replace(/[\s.]/g, '');
      if (tickersSeen.has(norm)) {
        issues.push(`ticker DUPLICATE: "${raw}" ≡ "${tickersSeen.get(norm)}" (alias not resolved)`);
      } else {
        tickersSeen.set(norm, raw);
      }
    }
  }

  // Portfolio count warnings (not gate-failures, but score penalties)
  const portLen = report.portfolio?.length ?? 0;
  if (portLen > 0 && portLen < 5) warnings.push(`portfolio COUNT LOW: ${portLen} (recommend ≥5)`);

  // Cross-ticker catalyst duplication check
  if (Array.isArray(report.portfolio)) {
    const catalystKeys = new Map(); // normalized key → ticker
    for (const p of report.portfolio) {
      for (const c of (p.catalysts ?? [])) {
        if (!c || typeof c !== 'string') continue;
        const key = c.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60);
        if (catalystKeys.has(key)) {
          warnings.push(`cross-ticker catalyst DUPLICATE: "${c.slice(0, 50)}" (${p.ticker} ≡ ${catalystKeys.get(key)})`);
        } else {
          catalystKeys.set(key, p.ticker);
        }
      }
    }
  }

  let score = 0;
  if ((report.thesis?.length ?? 0) >= garbageMinLen(GARBAGE_MIN_LEN.thesis))               score += 15;
  if ((report.macroAnalysis?.length ?? 0) >= garbageMinLen(GARBAGE_MIN_LEN.macroAnalysis))  score += 15;
  if ((report.technicalAnalysis?.length ?? 0) >= garbageMinLen(GARBAGE_MIN_LEN.technicalAnalysis)) score += 10;
  if ((report.fundamentalAnalysis?.length ?? 0) >= garbageMinLen(GARBAGE_MIN_LEN.fundamentalAnalysis)) score += 10;
  if (portLen >= 5)       score += 15;
  else if (portLen >= 2)  score += 8;  // partial credit — 2-4 items
  if ((report.riskEvents?.length ?? 0) >= 1)                                                 score += 5;
  if (Object.keys(report.regionStances ?? {}).length >= 2)                                   score += 5;
  if ((report.shortSqueeze?.length ?? 0) >= 1)                                               score += 5;
  if ((report.insiderSignals?.length ?? 0) >= 1)                                             score += 3;
  if ((report.stopLossRationale?.length ?? 0) >= 1)                                          score += 5;
  if (report.marketNarrative?.why || report.marketNarrative?.story)                          score += 5;
  if ((report.companyChanges?.length ?? 0) >= 1)                                             score += 7;
  return { ok: issues.length === 0, issues, warnings, score };
}

// ── Redis 업로드 ────────────────────────────────────────────────────────────────
async function redisPost(body) {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) { console.error('Upstash env not set'); process.exit(1); }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await res.json();
  return d.result === 'OK';
}
async function redisSet(key, value, exSeconds) {
  const cmd = exSeconds
    ? ['SET', key, JSON.stringify(value), 'EX', String(exSeconds)]
    : ['SET', key, JSON.stringify(value)];
  return redisPost(cmd);
}

function getSession() {
  const kstHour = new Date(Date.now() + 9 * 3600000).getUTCHours();
  if (kstHour >= 7 && kstHour < 16) return 'morning';
  if (kstHour >= 16 && kstHour < 22) return 'afternoon';
  return 'evening';
}

// ── Step 2: 파일 → Redis 업로드 ────────────────────────────────────────────────
async function uploadFromFile(filePath) {
  let resolved = filePath;
  if (filePath === 'latest') {
    if (!existsSync(REPORTS_DIR)) { console.error('reports/ 디렉토리 없음'); process.exit(1); }
    const { statSync } = await import('fs');
    const files = readdirSync(REPORTS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => ({ f, mtime: statSync(resolve(REPORTS_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (!files.length) { console.error('reports/ 에 파일 없음'); process.exit(1); }
    resolved = resolve(REPORTS_DIR, files[0].f);
    console.log(`최신 파일: ${basename(resolved)}`);
  } else {
    resolved = resolve(process.cwd(), filePath);
  }

  let report;
  try {
    report = JSON.parse(readFileSync(resolved, 'utf8'));
  } catch (e) { console.error('파일 읽기 실패:', e.message); process.exit(1); }

  console.log('\n=== 품질 게이트 검사 ===');
  const { ok, issues, warnings, score } = qualityCheck(report);
  console.log(`품질 점수: ${score}/100`);
  if (warnings?.length) {
    console.log('⚠️  경고 (업로드는 허용):');
    for (const w of warnings) console.log('   WARN:', w);
  }
  if (issues.length) {
    console.log('❌ 게이트 오류:');
    for (const i of issues) console.log('   ERROR:', i);
  } else {
    console.log('✅ 품질 검사 통과');
  }
  if (!ok) {
    console.error('\n❌ 품질 게이트 실패 — 업로드 중단됨.');
    console.error('   보고서를 직접 수정한 후 다시 시도.');
    process.exit(1);
  }

  const locale = report.locale ?? localeArg;
  const session = report.session ?? getSession();
  const kstNow = new Date(Date.now() + 9 * 3600000);
  const kstDate = kstNow.toISOString().slice(0, 10);
  const sessionKey = `flowvium:investment-strategy:v8:${kstDate}:${session}:${locale}`;
  // 히스토리용 고유 키 (라이브 API와 동일한 방식 — session TTL 만료와 무관)
  const histReportKey = `flowvium:investment-strategy:hist:report:${report.generatedAt}`;
  const staleKeyStr = `flowvium:investment-strategy:stale:v8:${locale}`;

  console.log(`\n=== Redis 업로드 ===`);
  console.log(`session key : ${sessionKey}`);
  console.log(`hist key    : ${histReportKey}`);
  console.log(`stale   key : ${staleKeyStr}`);

  const [ok1, ok2, ok3] = await Promise.all([
    redisSet(sessionKey, report, 86400),          // 1일 — 최신 세션 조회용
    redisSet(histReportKey, report, 90 * 86400),  // 90일 — 히스토리 탭 조회용
    redisSet(staleKeyStr, report, 7 * 86400),
  ]);

  const HIST_KEY = 'flowvium:investment-strategy:history:arr:v1';
  const histMeta = {
    key: histReportKey,  // 고유 키 → 탭 클릭 시 다른 리포트를 덮어쓰지 않음
    generatedAt: report.generatedAt,
    session,
    kstDate: kstNow.toISOString().slice(0, 16).replace('T', ' '),
    stance: report.stance ?? 'neutral',
    thesis: (report.thesis ?? '').slice(0, 80),
    riskLevel: report.riskLevel ?? 'medium',
    source: report.source,
    locale,
  };
  try {
    const url = env.UPSTASH_REDIS_REST_URL;
    const token = env.UPSTASH_REDIS_REST_TOKEN;
    const getRes = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['GET', HIST_KEY]),
    });
    const getD = await getRes.json();
    let existing = [];
    try { existing = JSON.parse(typeof getD.result === 'string' ? getD.result : '[]'); } catch {}
    if (!Array.isArray(existing)) existing = [];
    const updated = [histMeta, ...existing.filter(e => e.generatedAt !== report.generatedAt)].slice(0, 30);
    await redisSet(HIST_KEY, updated, 90 * 86400);
    console.log('히스토리 업데이트 완료');
  } catch (e) { console.log('히스토리 업데이트 실패 (non-fatal):', e.message); }

  console.log(`\nsession key : ${ok1 ? '✅' : '❌'}`);
  console.log(`hist key    : ${ok2 ? '✅' : '❌'}`);
  console.log(`stale   key : ${ok3 ? '✅' : '❌'}`);
  console.log(`source: ${report.source}`);
  console.log(`quality score: ${score}/100`);
  await verifyUploadSource(locale);
  console.log(`\n✅ 업로드 완료! ${SITE}/${locale}/report 에서 확인`);
}

// ── 업로드 검증 ────────────────────────────────────────────────────────────────
async function verifyUploadSource(locale) {
  const APP_BASE_URL = (env.NEXT_PUBLIC_APP_URL || env.NEXT_PUBLIC_SITE_URL || 'https://flowvium.vercel.app')
    .replace(/\s+/g, '').replace(/\/+$/, '');
  try {
    const res = await fetch(
      `${APP_BASE_URL}/api/investment-strategy?locale=${encodeURIComponent(locale)}`,
      { method: 'GET', headers: { 'Cache-Control': 'no-store' }, signal: AbortSignal.timeout(15000) }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const source = data?.source ?? 'missing';
    if (typeof source === 'string' && source.startsWith('local-')) {
      console.log(`[UPLOAD VERIFY] ✓ Redis key confirmed, source=${source}`);
    } else {
      console.warn(`[UPLOAD VERIFY] ⚠ Source mismatch: expected local-*, got ${source}`);
    }
  } catch (err) {
    console.warn('[UPLOAD VERIFY] ⚠ Could not verify upload: ' + err.message);
  }
}

// ── GROQ 폴백 (로컬 LLM 실패 시 cloud 70B) ─────────────────────────────────
// 무료 tier: llama-3.3-70b-versatile (TPD 한계 있음).
// JSON mode 강제 + 실패 시 null 반환.
async function callGroq(prompt, timeoutMs = 60000, label = '') {
  const key = env.GROQ_API_KEY?.trim();
  if (!key) return null;
  const tag = label ? `[GROQ:${label}]` : '[GROQ]';
  const t0 = Date.now();
  const models = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
  for (const model of models) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.4,
          max_tokens: 2048,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        if (res.status === 429) {
          console.warn(`  ${tag}[${model}] HTTP 429 rate limit — 다음 모델 시도`);
          continue;
        }
        console.warn(`  ${tag}[${model}] HTTP ${res.status}: ${errBody.slice(0, 100)}`);
        continue;
      }
      const d = await res.json();
      const text = d.choices?.[0]?.message?.content ?? '';
      if (!text) { console.warn(`  ${tag}[${model}] empty response`); continue; }
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`  ${tag}[${model}] ${elapsed}s → ${text.length}c`);
      return text;
    } catch (e) {
      console.warn(`  ${tag}[${model}] ${e.message?.slice(0, 80)}`);
    }
  }
  return null;
}

// ── Gemini 폴백 (GROQ 도 실패 시) ──────────────────────────────────────────────
async function callGemini(prompt, timeoutMs = 60000, label = '') {
  const key = env.GEMINI_API_KEY?.trim();
  if (!key) return null;
  const tag = label ? `[Gemini:${label}]` : '[Gemini]';
  const t0 = Date.now();
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 2048, responseMimeType: 'application/json' },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    if (!res.ok) { console.warn(`  ${tag} HTTP ${res.status}`); return null; }
    const d = await res.json();
    const text = d.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    if (!text) return null;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  ${tag} ${elapsed}s → ${text.length}c`);
    return text;
  } catch (e) {
    console.warn(`  ${tag} ${e.message?.slice(0, 80)}`);
    return null;
  }
}

// ── vLLM / TabbyAPI 호출 (OpenAI-호환 endpoint) ───────────────────────────────
// VLLM_URL 환경변수 (예: http://localhost:5000/v1) 가 설정되면 Ollama 보다 우선.
// VLLM_MODEL 로 모델명 명시 가능 (TabbyAPI 의 경우 모델 디렉터리명).
async function callVLLM(prompt, timeoutMs = 360000, label = '') {
  const url = process.env.VLLM_URL?.replace(/\s+/g, '');
  if (!url) return null;
  const tag = label ? `[vLLM:${label}]` : '[vLLM]';
  const t0 = Date.now();
  const model = process.env.VLLM_MODEL || 'default';
  try {
    const res = await fetch(`${url}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.VLLM_API_KEY ? { 'Authorization': `Bearer ${process.env.VLLM_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        max_tokens: 2048,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.warn(`  ${tag} HTTP ${res.status}: ${errBody.slice(0, 120)} — Ollama 폴백`);
      return null;
    }
    const d = await res.json();
    const text = d.choices?.[0]?.message?.content ?? '';
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  ${tag} ${elapsed}s → ${text.length}c | prompt ${prompt.length}c`);
    return text;
  } catch (e) {
    console.warn(`  ${tag} ${e.message?.slice(0, 100)} — Ollama 폴백`);
    return null;
  }
}

// ── Ollama 호출 with cloud fallback ────────────────────────────────────────────
// 우선순위: vLLM/TabbyAPI (VLLM_URL) → Ollama → GROQ 70B → Gemini 2.0 Flash
// 로컬 우선 + 실패/timeout 자동 cloud 폴백 = 항상 결과 반환 보장.
async function callOllama(prompt, model = modelArg, timeoutMs = 360000, label = '') {
  // 1. vLLM/TabbyAPI 우선 (VLLM_URL 설정된 경우만)
  const vllmText = await callVLLM(prompt, timeoutMs, label);
  if (vllmText) return vllmText;

  // 2. Ollama 로컬 (default)
  const t0 = Date.now();
  const tag = label ? `[LLM:${label}]` : '[LLM]';
  const isQwen3 = model.startsWith('qwen3');
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
    format: 'json',
    options: { temperature: 0.4, num_predict: 2048 },
    ...(isQwen3 ? { think: false } : {}),
  };
  let ollamaText = null;
  try {
    const res = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.warn(`  ${tag} HTTP ${res.status}: ${errBody.slice(0, 100)} — cloud 폴백`);
    } else {
      const d = await res.json();
      ollamaText = d.message?.content ?? '';
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      if (ollamaText && ollamaText.length > 50) {
        console.log(`  ${tag} ${elapsed}s → ${ollamaText.length}c | prompt ${prompt.length}c`);
        return ollamaText;
      }
      console.warn(`  ${tag} ${elapsed}s empty/short(${ollamaText?.length ?? 0}c) — cloud 폴백`);
    }
  } catch (e) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.warn(`  ${tag} ${elapsed}s ${e.name}: ${e.message?.slice(0, 80)} — cloud 폴백`);
  }

  // 3. GROQ 70B 폴백 (로컬 실패/timeout 시)
  const groqText = await callGroq(prompt, 60000, label);
  if (groqText) return groqText;

  // 4. Gemini 폴백 (GROQ 도 실패 시)
  const geminiText = await callGemini(prompt, 60000, label);
  if (geminiText) return geminiText;

  // 모든 provider 실패
  console.error(`  ${tag} ALL PROVIDERS FAILED — 빈 문자열 반환 (parser 가 fallback 할 것)`);
  return '';
}

function parseJson(raw, label = '') {
  const tag = label ? `[parse:${label}]` : '[parse]';
  if (!raw) { console.warn(`  ${tag} SKIP — empty input`); return null; }
  try {
    const clean = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const codeBlock = clean.match(/```(?:json)?\s*([\s\S]*?)```/);
    const str = codeBlock ? codeBlock[1] : clean;
    const m = str.match(/\{[\s\S]*\}/);
    if (!m) {
      console.warn(`  ${tag} FAIL — no JSON object found. raw[0:120]: ${clean.slice(0, 120).replace(/\n/g, ' ')}`);
      return null;
    }
    const result = JSON.parse(m[0].replace(/,\s*([}\]])/g, '$1'));
    return result;
  } catch (e) {
    console.warn(`  ${tag} FAIL — ${e.message}. raw[0:120]: ${raw.slice(0, 120).replace(/\n/g, ' ')}`);
    return null;
  }
}

// ── 라이브 가격 수집 ────────────────────────────────────────────────────────────
async function fetchOnePrice(ticker) {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`,
      { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(ticker.endsWith('.KS') ? 8000 : 4000) }
    );
    if (res.ok) {
      const data = await res.json();
      const meta = data?.chart?.result?.[0]?.meta;
      if (meta) {
        const price = meta.regularMarketPrice;
        const prev = meta.previousClose;
        const change1d = prev ? ((price - prev) / prev) * 100 : null;
        return [ticker, {
          price: Math.round(price * 100) / 100,
          change1d: change1d != null ? Math.round(change1d * 10) / 10 : null,
          high52w: meta.fiftyTwoWeekHigh ?? price * 1.3,
          low52w: meta.fiftyTwoWeekLow ?? price * 0.7,
        }];
      }
    }
  } catch { /* ignore */ }
  return [ticker, null];
}

async function getLivePrices() {
  const map = new Map();
  try {
    const fields = 'regularMarketPrice,regularMarketChangePercent,fiftyTwoWeekHigh,fiftyTwoWeekLow';
    const res = await fetch(
      `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(CANDIDATE_TICKERS.join(','))}&fields=${fields}`,
      { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(8000) }
    );
    if (res.ok) {
      const data = await res.json();
      const quotes = data?.quoteResponse?.result ?? [];
      for (const q of quotes) {
        if (q.regularMarketPrice == null) continue;
        map.set(q.symbol, {
          price: Math.round(q.regularMarketPrice * 100) / 100,
          change1d: q.regularMarketChangePercent != null ? Math.round(q.regularMarketChangePercent * 10) / 10 : null,
          high52w: q.fiftyTwoWeekHigh ?? q.regularMarketPrice * 1.3,
          low52w: q.fiftyTwoWeekLow ?? q.regularMarketPrice * 0.7,
        });
      }
    }
  } catch { /* batch failed */ }

  const missing = CANDIDATE_TICKERS.filter(t => !map.has(t));
  if (missing.length > 0) {
    const results = await Promise.all(missing.map(fetchOnePrice));
    for (const [t, lp] of results) { if (lp) map.set(t, lp); }
  }
  return map;
}

function pricesSection(map) {
  if (!map.size) return '';
  return Array.from(map.entries()).map(([t, p]) => {
    const isKR = t.endsWith('.KS');
    const curr = isKR ? '₩' : '$';
    const name = KR_NAMES[t] ? ` (${KR_NAMES[t]})` : '';
    const priceStr = isKR ? Math.round(p.price).toLocaleString() : p.price.toFixed(2);
    return `${t}${name}: ${curr}${priceStr} (1d ${p.change1d != null ? `${p.change1d >= 0 ? '+' : ''}${p.change1d}%` : 'N/A'})`;
  }).join('\n');
}

// ── Technical analysis (OHLCV 기반 실제 지표) ─────────────────────────────────
async function fetchOHLCV(ticker, range = '3mo') {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=${range}`;
    const res = await fetch(url, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const quote = result.indicators?.quote?.[0] ?? {};
    const closes = (quote.close ?? []).filter(c => c != null && c > 0);
    const volumes = (quote.volume ?? []).filter((_, i) => (quote.close ?? [])[i] != null);
    return { closes, volumes };
  } catch { return null; }
}

function computeRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  const start = closes.length - period - 1;
  for (let i = start; i < closes.length - 1; i++) {
    const diff = closes[i + 1] - closes[i];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return Math.round(100 - 100 / (1 + avgGain / avgLoss));
}

function computeSMA(closes, period) {
  if (closes.length < period) return null;
  return closes.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function computeVolRatio(volumes, period = 20) {
  if (volumes.length < period + 2) return null;
  const avg = volumes.slice(-period - 1, -1).reduce((a, b) => a + (b ?? 0), 0) / period;
  const last = volumes[volumes.length - 1];
  if (!avg) return null;
  return Math.round(((last / avg) - 1) * 100);
}


// Multi-Timeframe Trend Detection

function computeEMA(closes, period) {

  if (!closes || closes.length < period) return null;

  const k = 2 / (period + 1);

  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < closes.length; i++) {

    ema = closes[i] * k + ema * (1 - k);

  }

  return ema;

}

async function fetchOHLCVMulti(ticker, interval) {

  try {

    let range, yahoInterval;

    if (interval === '1h') { range = '5d'; yahoInterval = '1h'; }

    else if (interval === '4h') { range = '5d'; yahoInterval = '1h'; }

    else if (interval === '1d') { range = '3mo'; yahoInterval = '1d'; }

    else if (interval === '1wk') { range = '1y'; yahoInterval = '1wk'; }

    else return null;

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=${range}&interval=${yahoInterval}&events=history`;

    const res = await fetch(url, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(8000) });

    if (!res.ok) return null;

    const data = await res.json();

    const result = data?.chart?.result?.[0];

    if (!result) return null;

    const quote = result.indicators?.quote?.[0] ?? {};

    const closes = (quote.close ?? []).filter(c => c != null && c > 0);

    if (interval === '1h') {

      const isKR = ticker.endsWith('.KS');

      if (isKR && closes.length < 5) return null;

      return closes.length >= 3 ? closes : null;

    }

    if (interval === '4h') {

      if (closes.length < 4) return null;

      const resampled = [];

      for (let i = 3; i < closes.length; i += 4) {

        resampled.push(closes[i]);

      }

      return resampled.length >= 2 ? resampled : null;

    }

    return closes.length >= 5 ? closes : null;

  } catch { return null; }

}

function detectTrendDirection(closes) {

  if (!closes || closes.length < 10) return 'neutral';

  const ema9 = computeEMA(closes, 9);

  const ema21 = closes.length >= 21 ? computeEMA(closes, 21) : null;

  const currentPrice = closes[closes.length - 1];

  let bullishSignals = 0;

  let bearishSignals = 0;

  if (ema9 !== null && ema21 !== null) {

    if (ema9 > ema21) bullishSignals++;

    else if (ema9 < ema21) bearishSignals++;

  }

  if (ema21 !== null) {

    if (currentPrice > ema21) bullishSignals++;

    else if (currentPrice < ema21) bearishSignals++;

  }

  if (closes.length >= 5) {

    const last5 = closes.slice(-5);

    const ascending = last5.every((v, i) => i === 0 || v >= last5[i - 1]);

    const descending = last5.every((v, i) => i === 0 || v <= last5[i - 1]);

    if (ascending) bullishSignals++;

    else if (descending) bearishSignals++;

  }

  if (bullishSignals >= 2) return 'up';

  if (bearishSignals >= 2) return 'down';

  return 'neutral';

}

async function analyzeMultiTimeframeTrend(ticker) {

  try {

    const [r1h, r1d, r1wk] = await Promise.allSettled([

      fetchOHLCVMulti(ticker, '1h'),

      fetchOHLCVMulti(ticker, '1d'),

      fetchOHLCVMulti(ticker, '1wk'),

    ]);

    const closes1h = r1h.status === 'fulfilled' ? r1h.value : null;

    const closes1d = r1d.status === 'fulfilled' ? r1d.value : null;

    const closes1wk = r1wk.status === 'fulfilled' ? r1wk.value : null;

    let closes4h = null;

    if (closes1h && closes1h.length >= 4) {

      closes4h = [];

      for (let i = 3; i < closes1h.length; i += 4) {

        closes4h.push(closes1h[i]);

      }

      if (closes4h.length < 2) closes4h = null;

    }

    const tf1h = detectTrendDirection(closes1h);

    const tf4h = detectTrendDirection(closes4h);

    const tf1d = detectTrendDirection(closes1d);

    const tf1w = detectTrendDirection(closes1wk);

    const tfs = [tf1h, tf4h, tf1d, tf1w];

    let bearishCascade = 0;

    for (const tf of tfs) {

      if (tf === 'down') bearishCascade++;

      else break;

    }

    let bullishCascade = 0;

    for (const tf of tfs) {

      if (tf === 'up') bullishCascade++;

      else break;

    }

    const arrowMap = { up: '↑', down: '↓', neutral: '→' };

    const summaryParts = [

      '1H' + arrowMap[tf1h],

      '4H' + arrowMap[tf4h],

      '1D' + arrowMap[tf1d],

      '1W' + arrowMap[tf1w],

    ].join(' ');

    let emoji = '➡️';

    let label = '혼조';

    if (bearishCascade >= 3) { emoji = '📉'; label = `하향 ${bearishCascade}단계 진행`; }

    else if (bullishCascade >= 3) { emoji = '📈'; label = `상향 ${bullishCascade}단계 확인`; }

    const summary = `${emoji} ${summaryParts} | ${label}`;

    return { tf1h, tf4h, tf1d, tf1w, bearishCascade, bullishCascade, summary };

  } catch {

    return { tf1h: 'neutral', tf4h: 'neutral', tf1d: 'neutral', tf1w: 'neutral', bearishCascade: 0, bullishCascade: 0, summary: '➡️ 1H→ 4H→ 1D→ 1W→ | 분석 실패' };

  }

}

/** 포트폴리오 매수 종목들의 실제 기술 지표를 병렬로 계산 */
async function buildTechnicalData(tickers, livePrices) {
  const results = await Promise.allSettled(
    tickers.map(async ticker => {
      const isKR = ticker.endsWith('.KS');
      const ohlcv = await fetchOHLCV(ticker, isKR ? '1y' : '6mo');
      if (!ohlcv || ohlcv.closes.length < 21) return [ticker, null];
      const { closes, volumes } = ohlcv;
      const rsi = computeRSI(closes);
      const sma50 = computeSMA(closes, Math.min(50, closes.length));
      const sma200 = computeSMA(closes, 200);
      const volRatio = computeVolRatio(volumes);
      const actual = livePrices.get(ticker)?.price ?? closes[closes.length - 1];
      const curr = isKR ? '₩' : '$';
      const fmtP = n => isKR ? `${curr}${Math.round(n).toLocaleString()}` : `${curr}${n.toFixed(2)}`;

      const parts = [];

      // MA position — include ACTUAL PRICE so LLM can anchor entry to it
      if (sma200 != null) {
        parts.push(`200MA ${actual > sma200 ? '위' : '아래'}(${fmtP(sma200)})`);
      }
      if (sma50 != null) {
        parts.push(`50MA ${actual > sma50 ? '위' : '아래'}(${fmtP(sma50)})`);
      }
      if (rsi != null) parts.push(`RSI ${rsi}`);
      if (volRatio != null) parts.push(`거래량${volRatio >= 0 ? '+' : ''}${volRatio}%`);

      // 52주 고/저가 — 지지/저항 레벨
      if (closes.length >= 50) {
        const lookback = closes.slice(-252); // ~1년
        const hi52 = Math.max(...lookback);
        const lo52 = Math.min(...lookback);
        parts.push(`52주:${fmtP(lo52)}-${fmtP(hi52)}`);
      }

      // 권장 진입 지지선: fundamental entry anchor
      // Priority: SMA200 > SMA50 > 52주저가+20%
      const primarySupport = sma200 ?? sma50;
      if (primarySupport != null) {
        parts.push(`진입지지선:${fmtP(primarySupport)}`);
      }

      return [ticker, parts.length ? parts.join(', ') : null];
    })
  );
  const map = new Map();
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value?.[1]) map.set(r.value[0], r.value[1]);
  }
  return map;
}


/**
 * 지능형 고점/덤핑 위험 탐지 v2 (포트폴리오 매수 포지션).
 * score >= 8 -> 🔴 HIGH / 4-7 -> 🟠 MED / 2-3 -> ⚠️ LOW
 * Returns: { risks: Map, macroGlobalWarning: string|null }
 */
async function detectPeakDumpRisk(portfolioItems, livePrices, ctxRaw) {
  function parseTargetHigh(str) {
    if (!str) return NaN;
    const c = String(str).replace(/[₩$€,\s]/g, "");
    const p = c.split("-").map(Number).filter(n => !isNaN(n) && n > 0);
    return p.length ? Math.max(...p) : NaN;
  }
  function parseEntryLow(str) {
    if (!str) return NaN;
    const c = String(str).replace(/[₩$€,\s]/g, "");
    const p = c.split("-").map(Number).filter(n => !isNaN(n) && n > 0);
    return p.length ? Math.min(...p) : NaN;
  }
  const ind = ctxRaw?.macro?.indicators ?? [];
  const fg = ctxRaw?.fearGreed ?? ctxRaw?.fear_greed;
  const fgScore = fg?.score ?? fg?.fearGreedScore ?? fg?.us?.score ?? null;
  const hySpread = (() => { const v = ind.find(i => /hy_spread|hy_oas|hyoas/i.test(i.id ?? ""))?.actual; return typeof v === "number" ? v : (typeof v === "string" ? parseFloat(v) : null); })();
  const cpi = (() => { const v = ind.find(i => /^cpi|us_cpi/i.test(i.id ?? ""))?.actual; return typeof v === "number" ? v : (typeof v === "string" ? parseFloat(v) : null); })();
  const gdp = (() => { const v = ind.find(i => /^gdp/i.test(i.id ?? ""))?.actual; return typeof v === "number" ? v : (typeof v === "string" ? parseFloat(v) : null); })();
  let macroWeight = 0; const macroSignals = [];
  if (fgScore != null) {
    if (fgScore > 80) { macroWeight += 4; macroSignals.push(`F&G 극단 탐욕(${Math.round(fgScore)})`); }
    else if (fgScore > 75) { macroWeight += 1; macroSignals.push(`F&G 탐욕(${Math.round(fgScore)})`); }
  }
  if (hySpread != null && hySpread > 400) { macroWeight += 2; macroSignals.push(`HY스프레드 ${Math.round(hySpread)}bps`); }
  if (cpi != null && cpi > 4 && gdp != null && gdp < 0) { macroWeight += 2; macroSignals.push("스태그플레이션 경고"); }
  const macroGlobalWarning = macroWeight >= 3 ? `[거시 위험: ${macroSignals.join(", ")}]` : null;
  const NEG_KEYWORDS = /downgrade|miss|recall|lawsuit|fraud|layoff|cut|warning|probe|investigation|하향|적자|리콜|소송|해고/i;
  const cascadeArr = Array.isArray(ctxRaw?.cascade) ? ctxRaw.cascade : [];
  const newsNegMap = new Map();
  for (const article of cascadeArr) {
    const text = String(article.title ?? "") + " " + String(article.summary ?? "");
    if (!NEG_KEYWORDS.test(text)) continue;
    for (const item of portfolioItems) {
      const base = item.ticker.replace(/\.(KS|KQ)$/i, "").toUpperCase();
      const ns = String(item.name ?? "").toUpperCase().slice(0, 6);
      if (text.toUpperCase().includes(base) || (ns.length > 3 && text.toUpperCase().includes(ns)))
        newsNegMap.set(item.ticker, (newsNegMap.get(item.ticker) ?? 0) + 1);
    }
  }
  const FUND_NEG_KW = /guidance lowered|guidance cut|miss|below estimate|loss widened|가이던스 하향|하향 조정|어닙 미스/i;
  const financialsRaw = ctxRaw?.companyFinancials;
  function getFinancialsText(tk) {
    if (!financialsRaw) return "";
    if (typeof financialsRaw === "string") return financialsRaw;
    if (financialsRaw instanceof Map) return financialsRaw.get(tk) ?? "";
    if (typeof financialsRaw === "object") return String(financialsRaw[tk] ?? "");
    return "";
  }
  const insiderArr = Array.isArray(ctxRaw?.insider) ? ctxRaw.insider : [];
  const risks = new Map();
  const buyItems = portfolioItems.filter(p => p.action === "buy");
  await Promise.allSettled(buyItems.map(async item => {
    const signals = [];
    const pd = livePrices.get(item.ticker);
    const currentPrice = pd?.price;
    if (!currentPrice) return;
    const baseTicker = item.ticker.toUpperCase().replace(/\.(KS|KQ)$/i, "");
    const targetNum = parseTargetHigh(item.target);
    const entryNum  = parseEntryLow(item.entryZone);
    if (!isNaN(targetNum) && targetNum > 0) {
      if (currentPrice >= targetNum) { signals.push({ label: "목표가 초과 → 이익실현 고려", weight: 3 }); }
      else if (!isNaN(entryNum) && entryNum > 0 && targetNum > entryNum) {
        const progress = (currentPrice - entryNum) / (targetNum - entryNum);
        if (progress >= 0.90) signals.push({ label: `목표가 ${Math.round(progress * 100)}% 달성 → 분할매도 검토`, weight: 2 });
        else if (progress >= 0.85) signals.push({ label: `목표가 ${Math.round(progress * 100)}% 달성`, weight: 1 });
      }
    }
    try {
      const isKR = item.ticker.endsWith(".KS");
      const ohlcv = await fetchOHLCV(item.ticker, isKR ? "1y" : "3mo");
      if (ohlcv?.closes?.length >= 15) {
        const rsi = computeRSI(ohlcv.closes);
        if (rsi != null) {
          if (rsi >= 80) signals.push({ label: `RSI ${rsi}(과매수·조정 가능)`, weight: 3 });
          else if (rsi >= 70) signals.push({ label: `RSI ${rsi}(과매수권)`, weight: 2 });
        }
        const volRatio = computeVolRatio(ohlcv.volumes);
        if (volRatio != null && volRatio >= 50) signals.push({ label: `거래량+${volRatio}%(급등후 차익주의)`, weight: 1 });
      }
    } catch {}
    const mtfResult = await analyzeMultiTimeframeTrend(item.ticker);
    if (mtfResult.bearishCascade === 2) signals.push({ label: '단기 하향 전환(1H·4H 하락)', weight: 1 });
    if (mtfResult.bearishCascade === 3) signals.push({ label: '1H→4H→1D 순차 하향 전환', weight: 3 });
    if (mtfResult.bearishCascade === 4) signals.push({ label: '전 타임프레임 하향 전환(추세 붕괴)', weight: 4 });
    if (mtfResult.bullishCascade >= 3) signals.push({ label: '상향 전환 중 → 위험 상쇄', weight: -2 });
    const sells = insiderArr.filter(i => (i.ticker ?? "").toUpperCase().replace(/\.(KS|KQ)$/i, "") === baseTicker && i.direction === "sell");
    if (sells.length >= 5) {
      const tu = sells.reduce((s, i) => s + (i.transactionValueUsd ?? 0), 0);
      signals.push({ label: `내부자 ${sells.length}건 집중매도 $${Math.round(tu / 1000)}K(경영진 이탈 신호)`, weight: 4 });
    } else if (sells.length >= 2) {
      const tu = sells.reduce((s, i) => s + (i.transactionValueUsd ?? 0), 0);
      signals.push({ label: `내부자 ${sells.length}건 매도 $${Math.round(tu / 1000)}K(내부자 차익실현)`, weight: 3 });
    }
    if (fgScore != null && fgScore > 80) {
      signals.push({ label: `F&G ${Math.round(fgScore)}(극단 탐욕·시장 과열)`, weight: 4 });
    } else if (fgScore != null && fgScore > 75) {
      signals.push({ label: `F&G ${Math.round(fgScore)}(탐욕 구간)`, weight: 1 });
    }
    const negNewsCount = newsNegMap.get(item.ticker) ?? 0;
    if (negNewsCount >= 2) signals.push({ label: `부정뉴스 ${negNewsCount}건(하락 촉매 증가)`, weight: 2 });
    else if (negNewsCount === 1) signals.push({ label: "부정뉴스 1건(리스크 모니터)", weight: 1 });
    const finText = getFinancialsText(item.ticker);
    if (finText && FUND_NEG_KW.test(finText)) signals.push({ label: "가이던스 하향/어닝미스(펀더멘탈 악화)", weight: 2 });
    if (hySpread != null && hySpread > 400) signals.push({ label: `HY스프레드 ${Math.round(hySpread)}bps(신용 리스크 확대)`, weight: 2 });

    // ── SEIBRO 공매도 + KRX 투자자별 (한국 주식) ──────────────────────────────
    if (item.ticker.endsWith('.KS') || item.ticker.endsWith('.KQ')) {
      const stockCode = item.ticker.replace(/\.(KS|KQ)$/i, '');
      try {
        const [seibro, flows] = await Promise.allSettled([
          fetchSeibroShort(stockCode),
          fetchKrxInvestorFlow(stockCode, 5),
        ]);
        const seibroData = seibro.status === 'fulfilled' ? seibro.value : null;
        const flowData = flows.status === 'fulfilled' ? flows.value : [];

        if (seibroData?.shortBalRatio != null && seibroData.shortBalRatio > 5) {
          signals.push({ label: `공매도잔고 ${seibroData.shortBalRatio.toFixed(1)}%(하락 베팅 증가)`, weight: 2 });
        }
        if (flowData.length > 0) {
          const instNetTotal = flowData.reduce((s, f) => s + f.instNetBuy, 0);
          const frgnNetTotal = flowData.reduce((s, f) => s + f.frgnNetBuy, 0);
          if (instNetTotal < -1_000_000_000 && frgnNetTotal < -500_000_000) {
            signals.push({ label: `기관+외국인 5일 순매도 ${((instNetTotal + frgnNetTotal) / 1e8).toFixed(0)}억(수급 이탈)`, weight: 3 });
          } else if (instNetTotal + frgnNetTotal < -500_000_000) {
            signals.push({ label: `기관+외국인 5일 순매도 ${((instNetTotal + frgnNetTotal) / 1e8).toFixed(0)}억`, weight: 1 });
          }
        }
      } catch { /* ignore */ }
    }

    // ── Yahoo Options P/C Ratio (미국 주식) ────────────────────────────────────
    if (!item.ticker.endsWith('.KS') && !item.ticker.endsWith('.KQ')) {
      try {
        const opts = await fetchOptionsData(item.ticker);
        if (opts?.putCallRatio != null && opts.putCallRatio > 1.5) {
          signals.push({ label: `P/C비율 ${opts.putCallRatio.toFixed(2)}(풋옵션 과다·하락 헤지 증가)`, weight: 2 });
        } else if (opts?.putCallRatio != null && opts.putCallRatio > 1.2) {
          signals.push({ label: `P/C비율 ${opts.putCallRatio.toFixed(2)}(풋 비중 높음)`, weight: 1 });
        }
      } catch { /* ignore */ }
    }
    const totalWeight = signals.reduce((s, sg) => s + sg.weight, 0);
    if (totalWeight < 2) return;
    const sorted = [...signals].sort((a, b) => b.weight - a.weight);
    let prefix, topN;
    if (totalWeight >= 8) { prefix = "🔴 덤핑 고위험 — 즉각 손절라인 점검"; topN = 3; }
    else if (totalWeight >= 4) { prefix = "🟠 고점 경고 — 분할매도 검토"; topN = 2; }
    else { prefix = "⚠️ 고점 주의 — 신규 매수 자제"; topN = sorted.length; }
    const summary = sorted.slice(0, topN).map(s => s.label).join(", ");
    risks.set(item.ticker, { summary: `${prefix}: ${summary}`, signals: sorted, totalWeight, mtfSummary: mtfResult ? mtfResult.summary : null });
  }));
  return { risks, macroGlobalWarning };
}

/**
 * Hybrid: LLM 분석 기반 entry zone 존중 + 환각만 교정.
 *
 * 1) LLM이 entryZone 을 정상 출력했고 livePrice ±30% 이내 → LLM 값 그대로 유지 (분석 존중)
 * 2) LLM이 entryZone 을 안 출력했거나 ±30% 밖 (환각) → entryPlan fallback 계산
 * 3) entryPlan 도 없으면 → validateEntryZones 가 최종 안전망
 */
function computePricesFromPlan(portfolioItems, livePrices) {
  const extractNums = str => (str ?? '').replace(/[₩$,\s]/g, '').match(/[\d.]+/g)?.map(Number).filter(n => n > 0) ?? [];

  return portfolioItems.map(p => {
    const pd = livePrices.get(p.ticker);
    const isKR = p.ticker.endsWith('.KS');
    const fmt = n => isKR ? `₩${Math.round(n).toLocaleString()}` : `$${n.toFixed(2)}`;
    const actual = pd?.price ?? null;

    // 1) LLM이 entryZone 을 출력했고, livePrice ±30% 이내면 분석 존중
    const zoneNums = extractNums(p.entryZone);
    if (zoneNums.length >= 2 && actual && actual > 0) {
      const hi = Math.max(...zoneNums);
      const lo = Math.min(...zoneNums);
      if (hi > actual * 0.70 && hi < actual * 1.30 && lo > actual * 0.50) {
        return { ...p, _entryAnchor: 'llm-analysis' };
      }
      console.warn(`  ⚠️  ${p.ticker} entry zone 환각: ${p.entryZone} vs actual ${fmt(actual)} — entryPlan fallback`);
    }

    // 2) entryPlan fallback — LLM zone 없거나 환각일 때
    if (!p.entryPlan) return p;
    let base = actual;
    if (!base || base <= 0) {
      const m50 = p.rationale?.match(/50MA[^$₩\d]*[$₩]?([\d,.]+)/);
      const m200 = p.rationale?.match(/200MA[^$₩\d]*[$₩]?([\d,.]+)/);
      base = m50 ? parseFloat(m50[1].replace(/,/g, '')) : m200 ? parseFloat(m200[1].replace(/,/g, '')) : null;
      if (base) console.warn(`  ⚠️  ${p.ticker} livePrice 없음 — rationale 가격(${fmt(base)}) 사용`);
    }
    if (!base || base <= 0) return p;

    const { anchorReason = 'current', discountPct = 0 } = p.entryPlan;
    let anchor = base, anchorLabel = 'current';
    if (anchorReason === '50MA') {
      const m = p.rationale?.match(/50MA[^$₩\d]*[$₩]?([\d,.]+)/);
      if (m) { anchor = parseFloat(m[1].replace(/,/g, '')); anchorLabel = '50MA'; }
    } else if (anchorReason === '200MA') {
      const m = p.rationale?.match(/200MA[^$₩\d]*[$₩]?([\d,.]+)/);
      if (m) { anchor = parseFloat(m[1].replace(/,/g, '')); anchorLabel = '200MA'; }
    } else if (anchorReason === '52w_pullback') {
      const m = p.rationale?.match(/52주[^$₩\d]*[$₩]?[\d,.]+\s*-\s*[$₩]?([\d,.]+)/);
      if (m) { anchor = parseFloat(m[1].replace(/,/g, '')); anchorLabel = '52w_high'; }
    }
    if (!Number.isFinite(anchor) || anchor < base * 0.5 || anchor > base * 1.5) {
      anchor = base; anchorLabel = 'current(fallback)';
    }
    const disc = Math.max(0, Math.min(5, Number(discountPct) || 0)) / 100;
    const entryLow = anchor * (1 - disc - 0.02);
    const entryHigh = anchor * (1 - disc + 0.01);

    return {
      ...p,
      entryZone: `${fmt(entryLow)}-${fmt(entryHigh)}`,
      stopLoss: fmt(entryLow * 0.93),
      target: fmt(entryHigh * 1.15),
      targetBull: fmt(entryHigh * 1.30),
      _entryAnchor: anchorLabel + '(plan-fallback)',
    };
  });
}

/**
 * 환각 안전망: LLM 출력이 실가 대비 50% 이상 벗어나면 교정.
 * 분석 기반 ±30% 범위는 LLM 판단을 존중 (기술적/기본적/구루 분석 결과).
 * momentum clamp, per-ticker calibration 등 기계적 보정은 하지 않음.
 */
function validateEntryZones(portfolioItems, livePrices) {
  return portfolioItems.map(p => {
    const pd = livePrices.get(p.ticker);
    if (!pd) return p;
    const actual = pd.price;
    const isKR = p.ticker.endsWith('.KS');
    const curr = isKR ? '₩' : '$';
    const fmt = n => isKR ? `${curr}${Math.round(n).toLocaleString()}` : `${curr}${n.toFixed(2)}`;
    const extractNums = str => (str ?? '').replace(/[₩$,\s]/g, '').match(/[\d.]+/g)?.map(Number).filter(n => n > 0) ?? [];

    let updated = { ...p };
    const zoneNums = extractNums(p.entryZone);
    const zoneHigh = zoneNums.length > 0 ? Math.max(...zoneNums) : 0;
    // 명백한 환각만 교정: 실가의 50% 미만 (2023 훈련가) 또는 150% 초과
    const isHalluc = zoneNums.length > 0 && (zoneHigh < actual * 0.50 || zoneNums.every(n => n > actual * 1.50));
    // zone 미출력
    const noZone = !zoneNums.length;
    if (noZone || isHalluc) {
      if (isHalluc) console.warn(`  ⚠️  ${p.ticker} entry 환각: ${p.entryZone} vs actual ${fmt(actual)} → 시장가 기준 보정`);
      updated.entryZone = isKR
        ? `${fmt(Math.round(actual * 0.95))}-${fmt(Math.round(actual * 0.99))}`
        : `${fmt(parseFloat((actual * 0.95).toFixed(2)))}-${fmt(parseFloat((actual * 0.99).toFixed(2)))}`;
    }
    const stopNums = extractNums(p.stopLoss);
    const stopHalluc = stopNums.length > 0 && (stopNums[0] < actual * 0.50 || stopNums[0] > actual * 1.50);
    if (!stopNums.length || stopHalluc) {
      if (stopHalluc) console.warn(`  ⚠️  ${p.ticker} stop 환각: ${p.stopLoss} → 보정`);
      updated.stopLoss = fmt(isKR ? Math.round(actual * 0.92) : parseFloat((actual * 0.92).toFixed(2)));
    }
    const targetNums = extractNums(p.target);
    const targetHalluc = targetNums.length > 0 && (targetNums[0] < actual * 0.50 || targetNums[0] > actual * 3.0);
    if (!targetNums.length || targetHalluc) {
      if (targetHalluc) console.warn(`  ⚠️  ${p.ticker} target 환각: ${p.target} → 보정`);
      updated.target = fmt(isKR ? Math.round(actual * 1.15) : parseFloat((actual * 1.15).toFixed(2)));
    }

    // targetBull must always be strictly higher than the (possibly corrected) base target
    if (updated.targetBull) {
      const baseTargetNum = Math.max(...extractNums(updated.target).filter(n => n > 0), 0);
      const bullNums = extractNums(updated.targetBull);
      const bullHigh = bullNums.length > 0 ? Math.max(...bullNums) : 0;
      if (bullHigh > 0 && baseTargetNum > 0 && bullHigh <= baseTargetNum) {
        console.warn(`  ⚠️  ${p.ticker} targetBull=${fmt(bullHigh)} ≤ target=${fmt(baseTargetNum)} → bull 목표가 보정`);
        updated.targetBull = fmt(isKR ? Math.round(baseTargetNum * 1.20) : parseFloat((baseTargetNum * 1.20).toFixed(2)));
      }
    }

    return updated;
  });
}

/**
 * Build a per-ticker signal digest from raw context data.
 * Returns Map<ticker, {insider, squeeze, yoy, margin, tech}>
 */
function buildSignalDigest(ctx, technicalData, financialsText) {
  const digest = new Map();

  // Insider cluster map
  const insiderArr = Array.isArray(ctx.insider) ? ctx.insider : [];
  const clusterMap = new Map();
  for (const i of insiderArr) {
    const t = i.ticker; if (!t) continue;
    const c = clusterMap.get(t) ?? { buys: 0, sells: 0, totalUsd: 0 };
    if (i.direction === 'buy') c.buys++; else c.sells++;
    c.totalUsd += i.transactionValueUsd ?? 0;
    clusterMap.set(t, c);
  }

  // Squeeze scores
  const shortsArr = (() => {
    const sd = ctx.short;
    return Array.isArray(sd) ? sd : (sd?.entries ?? []);
  })();
  const squeezeMap = new Map();
  for (const s of shortsArr) {
    if (s.ticker && typeof s.squeezeScore === 'number') squeezeMap.set(s.ticker, s.squeezeScore);
  }

  // Financials text: "NVDA: Q4 FY2026 $68.1B +73.2% YoY opMgn=64.9%"
  const finMap = new Map();
  for (const part of (financialsText ?? '').split(' | ')) {
    const m = part.match(/^(\S+):\s*(\S+)\s+(\S+)\s+([\+\-]?\d+\.?\d*%)\s+YoY(?:\s+opMgn=([\d.]+)%)?/);
    if (m) finMap.set(m[1], { label: m[2], rev: m[3], yoy: m[4], margin: m[5] ?? null });
  }

  // Combine all tickers
  const allTickers = new Set([
    ...clusterMap.keys(), ...squeezeMap.keys(), ...finMap.keys(), ...technicalData.keys(),
  ]);
  for (const t of allTickers) {
    digest.set(t, {
      insider: clusterMap.get(t) ?? null,
      squeeze: squeezeMap.get(t) ?? null,
      fin: finMap.get(t) ?? null,
      tech: technicalData.get(t) ?? null,
    });
  }
  return digest;
}

/**
 * Post-processing: detect duplicate rationales and replace with unique
 * data-driven descriptions from signalDigest. No LLM call.
 */
function deduplicateRationales(portfolioItems, signalDigest) {
  const rFirst25 = (r) => (r ?? '').replace(/\s+/g, ' ').slice(0, 25);
  const grouped = new Map();
  for (const item of portfolioItems) {
    const key = rFirst25(item.rationale);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }

  let fixedCount = 0;
  for (const [, items] of grouped) {
    if (items.length < 2) continue;
    for (const item of items) {
      const t = item.ticker;
      const sig = signalDigest.get(t);
      const parts = [];
      if (sig?.insider && sig.insider.buys >= 3)
        parts.push(`insider ${sig.insider.buys}건 매수 $${Math.round(sig.insider.totalUsd / 1000)}K`);
      if (sig?.fin?.yoy) parts.push(`매출 ${sig.fin.yoy} YoY(${sig.fin.label})`);
      if (sig?.fin?.margin) parts.push(`영업이익률 ${sig.fin.margin}%`);
      if (sig?.squeeze != null) parts.push(`squeeze ${sig.squeeze}`);
      if (sig?.tech) parts.push(sig.tech);
      if (parts.length) {
        item.rationale = parts.slice(0, 3).join(', ');
        fixedCount++;
      }
    }
  }
  if (fixedCount > 0) console.log(`  [후처리] rationale 중복 ${fixedCount}개 → 고유 신호 교체`);
  return portfolioItems;
}

/**
 * Post-processing: expand thesis if too short by appending key macro numbers.
 * Targets ≥80 chars without LLM. Locale-aware labels (EN vs KO).
 */
function expandThesis(thesis, macroData, ctx, locale = 'ko') {
  if (!thesis || thesis.length >= 80) return thesis;
  const isEn = !['ko', 'ja', 'zh-CN', 'zh-TW', 'zh'].includes(locale);
  const parts = [];
  const ind = ctx.macro?.indicators ?? [];
  const cpi = ind.find(i => i.id === 'cpi' || i.id === 'us_cpi')?.actual;
  const spread = ind.find(i => i.id === 'hy_spread' || i.id === 'hy_oas' || i.id === 'hyoas')?.actual;
  const vix = ind.find(i => i.id === 'vix')?.actual;
  const gdp = ind.find(i => i.id === 'gdp')?.actual;
  if (cpi != null) parts.push(`CPI ${cpi}%`);
  if (gdp != null) parts.push(`GDP ${gdp}%`);
  if (spread != null) parts.push(isEn ? `HY Spread ${spread}%` : `HY스프레드 ${spread}%`);
  if (vix != null) parts.push(`VIX ${typeof vix === 'number' ? vix.toFixed(1) : vix}`);
  if (macroData?.riskLevel) parts.push(isEn ? `Risk ${macroData.riskLevel}` : `리스크 ${macroData.riskLevel}`);
  if (parts.length) {
    const expanded = `${thesis} — ${parts.join(', ')}`;
    if (expanded.length > thesis.length) {
      console.log(`  [후처리] thesis 확장: ${thesis.length}자 → ${expanded.length}자`);
      return expanded;
    }
  }
  return thesis;
}

/**
 * Post-processing: fill missing regionStances and enrich SHORT LLM-generated theses
 * with actual capital flow data (ret4w, ret1w).
 */
function fillMissingRegionStances(regionStances, ctx) {
  const REGIONS = ['us','korea','japan','china','europe','india','taiwan','brazil','australia','global'];
  const existing = regionStances ?? {};

  const countries = ctx.capital?.countryFlow?.countries ?? [];
  const flowMap = new Map(countries.map(c => [c.id ?? c.label?.toLowerCase(), c]));

  const getFlow = (id) => flowMap.get(id) ?? null;
  const flowSignal = (c) => {
    if (!c || typeof c.ret4w !== 'number') return 'neutral';
    return c.ret4w >= 1 ? 'bullish' : c.ret4w <= -1 ? 'bearish' : 'neutral';
  };
  const buildKeyData = (c) => {
    if (!c) return null;
    const parts = [];
    if (c.ret4w != null) parts.push(`4w ${c.ret4w >= 0 ? '+' : ''}${c.ret4w.toFixed(1)}%`);
    if (c.ret1w != null) parts.push(`1w ${c.ret1w >= 0 ? '+' : ''}${c.ret1w.toFixed(1)}%`);
    return parts.join(', ') || null;
  };

  const filled = { ...existing };
  let addedCount = 0;
  let enrichedCount = 0;
  for (const region of REGIONS) {
    const c = getFlow(region);
    const stance = flowSignal(c);
    const kd = buildKeyData(c);
    if (!filled[region]) {
      filled[region] = {
        stance,
        thesis: kd ? `${stance}: ${kd}` : `[data fallback] ${stance}`,
        keyData: kd ?? '4w flow',
      };
      addedCount++;
    } else {
      const entry = filled[region];
      const thesisLen = (entry.thesis ?? '').length;
      if (thesisLen < 30 && kd) {
        entry.thesis = `${entry.thesis} (${kd})`;
        if (!entry.keyData || entry.keyData.length < 5) entry.keyData = kd;
        enrichedCount++;
      }
    }
  }
  if (addedCount > 0) console.log(`  [후처리] regionStances ${addedCount}개 지역 자동 보완`);
  if (enrichedCount > 0) console.log(`  [후처리] regionStances ${enrichedCount}개 짧은 thesis 데이터 보강`);
  return filled;
}

/**
 * Post-processing: fill null revenueYoY in companyChanges from financials data.
 */
function fillCompanyChangesYoY(companyChanges, signalDigest) {
  let filled = 0;
  for (const c of (companyChanges ?? [])) {
    if (c.revenueYoY != null) continue;
    const sig = signalDigest.get(c.ticker);
    if (sig?.fin?.yoy) {
      const parsed = parseFloat(sig.fin.yoy);
      if (!isNaN(parsed)) {
        c.revenueYoY = parsed;
        c.latestQuarter = sig.fin.label;
        filled++;
      }
    }
  }
  if (filled > 0) console.log(`  [후처리] companyChanges revenueYoY ${filled}개 자동 보완`);
  return companyChanges;
}

/**
 * Post-processing: post-earnings 자체 판단.
 * 최근 7일 내 실적발표가 있는 squeeze 후보는:
 *   - 발표 후 OHLCV 기반 누적 수익률 계산
 *   - ≤ -5%: catalyst 소멸 → 제거
 *   - ≥ +5%: momentum 확인 → timing 업데이트
 *   - 중립:  소강 상태 → timing 업데이트
 * 실적 날짜 없어도 timing에 과거 날짜가 명시된 항목은 제거.
 */
async function enrichSqueezePostEarnings(shortSqueeze, rawEarnings, livePrices, locale = 'ko') {
  if (!Array.isArray(shortSqueeze) || shortSqueeze.length === 0) return shortSqueeze;
  const isEn = !['ko', 'ja', 'zh-CN', 'zh-TW', 'zh'].includes(locale);
  const now = new Date();
  const sevenDaysAgo = new Date(now - 7 * 24 * 3600 * 1000);

  // 최근 7일 내 실적발표 맵 ticker → date
  const recentEarningsMap = new Map();
  for (const e of rawEarnings) {
    if (!e.ticker || !e.date) continue;
    const d = new Date(e.date);
    if (!isNaN(d.getTime()) && d >= sevenDaysAgo && d <= now) {
      recentEarningsMap.set(e.ticker, { date: d, epsActual: e.epsActual, epsSurprise: e.epsSurprise });
    }
  }

  const result = [];
  for (const s of shortSqueeze) {
    const ticker = (s.ticker ?? '').toUpperCase();
    const timing = s.timing ?? '';

    // ─ 1) timing에 과거 절대 날짜가 있으면 제거 ─
    const isoM = timing.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (isoM) {
      const d = new Date(Number(isoM[1]), Number(isoM[2]) - 1, Number(isoM[3]));
      d.setHours(0, 0, 0, 0);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      if (d < today) { console.log(`  [후처리] ${ticker} timing 만료일(${isoM[0]}) → 제거`); continue; }
    }
    const krM = timing.match(/(\d{1,2})월\s*(\d{1,2})일/);
    if (krM) {
      const d = new Date(now.getFullYear(), Number(krM[1]) - 1, Number(krM[2]));
      d.setHours(0, 0, 0, 0);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      if (d < today) { console.log(`  [후처리] ${ticker} timing 만료일(${krM[0]}) → 제거`); continue; }
    }

    // ─ 2) OHLCV로 post-earnings 감지 ─
    // 방법 A: rawEarnings에 최근 실적일이 있으면 그날 이후 수익률 사용
    // 방법 B: 최근 5일 중 단일일 >8% 급등락이 있으면 실적 반응으로 간주 (earnings API 미수록 케이스)
    let postReturn = null;
    let earnInfo = recentEarningsMap.get(ticker);
    try {
      const ohlcv = await fetchOHLCV(s.ticker, '5d');
      if (ohlcv?.closes?.length >= 2) {
        const closes = ohlcv.closes;

        if (earnInfo) {
          // 방법 A: 실적일 이후 누적 수익률
          const daysSince = Math.max(1, Math.ceil((now - earnInfo.date) / (24 * 3600 * 1000)));
          const lookback = Math.min(daysSince, closes.length - 1);
          const pre = closes[closes.length - 1 - lookback];
          const cur = closes[closes.length - 1];
          if (pre > 0) postReturn = Math.round((cur / pre - 1) * 1000) / 10;
        } else {
          // 방법 B: 최근 5일 중 단일일 >8% 급등락 감지
          for (let i = 1; i < closes.length; i++) {
            const prev = closes[i - 1], cur = closes[i];
            if (prev > 0) {
              const dayRet = (cur / prev - 1) * 100;
              if (Math.abs(dayRet) >= 5) {
                // 이 날이 사실상 실적일 — 그 이후 수익률 계산
                const pre = closes[i - 1];
                const latest = closes[closes.length - 1];
                postReturn = Math.round((latest / pre - 1) * 1000) / 10;
                earnInfo = { date: new Date(now - (closes.length - 1 - i) * 24 * 3600 * 1000), inferred: true };
                console.log(`  [후처리] ${ticker} 단일일 ${Math.round(dayRet)}% 급등락 감지 → post-earnings 판단`);
                break;
              }
            }
          }
        }
      }
    } catch { /* no ohlcv */ }

    // OHLCV 실패 시 1d change 폴백 (earnInfo 있을 때만)
    if (postReturn == null && earnInfo) {
      const lp = livePrices.get(s.ticker) ?? livePrices.get(ticker);
      postReturn = lp?.change1d ?? null;
    }

    // 실적 이벤트 없으면 그냥 통과
    if (!earnInfo) { result.push(s); continue; }

    const retStr = postReturn != null ? `${postReturn >= 0 ? '+' : ''}${postReturn}%` : null;

    if (postReturn != null && postReturn <= -5) {
      console.log(`  [후처리] ${ticker} 실적 후 ${retStr} → catalyst 소멸, 제거`);
      continue;
    }

    const updated = { ...s };
    if (retStr) {
      if (postReturn >= 5) {
        updated.timing = isEn ? `Post-earnings surge ${retStr}` : `실적 후 ${retStr} 급등, squeeze 지속`;
      } else {
        updated.timing = isEn ? `Post-earnings ${retStr}, consolidating` : `실적 후 ${retStr} 소강, 재진입 대기`;
      }
      console.log(`  [후처리] ${ticker} 실적 후 ${retStr} → timing 업데이트`);
    }
    result.push(updated);
  }

  return result;
}

/**
 * Post-processing: rename "key,Data" → "keyData" typo in regionStances objects.
 */
function normalizeRegionStances(regionStances) {
  if (!regionStances) return regionStances;
  let fixed = 0;
  const result = {};
  for (const [region, entry] of Object.entries(regionStances)) {
    if (!entry || typeof entry !== 'object') { result[region] = entry; continue; }
    const normalized = { ...entry };
    if ('key,Data' in normalized) {
      normalized.keyData = normalized['key,Data'];
      delete normalized['key,Data'];
      fixed++;
    }
    result[region] = normalized;
  }
  if (fixed > 0) console.log(`  [후처리] regionStances "key,Data" 오타 ${fixed}개 수정`);
  return result;
}

/**
 * Post-processing: append signal data to rationales that are under 80 chars.
 * Fills all portfolio items, not just duplicates.
 */
function enrichRationales(portfolioItems, signalDigest, locale = 'ko') {
  const isEn = !['ko', 'ja', 'zh-CN', 'zh-TW', 'zh'].includes(locale);
  let enriched = 0;
  for (const item of portfolioItems) {
    if ((item.rationale ?? '').length >= 80) continue;
    const sig = signalDigest.get(item.ticker);
    if (!sig) continue;
    const parts = [];
    if (sig.insider && sig.insider.buys >= 2) {
      parts.push(isEn
        ? `insider ${sig.insider.buys}x buy $${Math.round(sig.insider.totalUsd / 1000)}K`
        : `내부자 ${sig.insider.buys}건 매수 $${Math.round(sig.insider.totalUsd / 1000)}K`);
    }
    if (sig.fin?.yoy) parts.push(isEn ? `rev ${sig.fin.yoy} YoY` : `매출 ${sig.fin.yoy} YoY`);
    if (sig.fin?.margin) parts.push(isEn ? `op mgn ${sig.fin.margin}%` : `영업이익률 ${sig.fin.margin}%`);
    if (sig.squeeze != null) parts.push(`squeeze ${sig.squeeze}`);
    if (sig.tech) parts.push(sig.tech);
    if (parts.length === 0) continue;
    const append = parts.slice(0, 3).join(', ');
    item.rationale = item.rationale ? `${item.rationale} | ${append}` : append;
    enriched++;
  }
  if (enriched > 0) console.log(`  [후처리] rationale 보강: ${enriched}개`);
  return portfolioItems;
}

/**
 * Post-processing: append specific price/RSI levels to stopLossRationale entries.
 */
function enrichStopLoss(stopLossRationale, livePrices, technicalData, locale = 'ko') {
  const isEn = !['ko', 'ja', 'zh-CN', 'zh-TW', 'zh'].includes(locale);
  let enriched = 0;
  for (const entry of (stopLossRationale ?? [])) {
    if (!entry.ticker || (entry.rationale ?? '').length >= 100) continue;
    const lp = livePrices.get(entry.ticker);
    const tech = technicalData.get(entry.ticker);
    const parts = [];
    if (lp?.price) {
      const stopPrice = (lp.price * 0.93).toFixed(lp.price > 100 ? 2 : 4);
      parts.push(isEn
        ? `cur $${lp.price} → stop ~$${stopPrice} (-7%)`
        : `현재 $${lp.price} → 손절선 ~$${stopPrice} (-7%)`);
    }
    if (tech) parts.push(tech);
    if (parts.length === 0) continue;
    const append = parts.slice(0, 2).join(' / ');
    entry.rationale = entry.rationale ? `${entry.rationale} | ${append}` : append;
    enriched++;
  }
  if (enriched > 0) console.log(`  [후처리] stopLossRationale 구체화: ${enriched}개`);
  return stopLossRationale;
}

/**
 * Post-processing: append key indicator snapshot to macroAnalysis if under 200 chars.
 */
function enrichMacroAnalysis(macroAnalysis, ctxRaw, macroData, locale = 'ko') {
  if (!macroAnalysis || macroAnalysis.length >= 200) return macroAnalysis;
  const isEn = !['ko', 'ja', 'zh-CN', 'zh-TW', 'zh'].includes(locale);
  const ind = ctxRaw.macro?.indicators ?? [];
  const parts = [];
  const fg = ctxRaw.fearGreed ?? ctxRaw.fear_greed;
  const fgScore = fg?.score ?? fg?.fearGreedScore ?? fg?.us?.score;
  const fgLabel = fg?.label ?? fg?.fearGreedLabel ?? fg?.us?.label;
  const cpi = ind.find(i => i.id === 'cpi' || i.id === 'us_cpi')?.actual;
  const fed = ind.find(i => i.id === 'fed_rate' || i.id === 'fomc' || i.id === 'fedfunds')?.actual;
  const hySpread = ind.find(i => i.id === 'hy_spread' || i.id === 'hy_oas' || i.id === 'hyoas')?.actual;
  const vix = ind.find(i => i.id === 'vix')?.actual;
  const riskLevel = macroData?.riskLevel;
  if (isEn) {
    if (fgScore != null) parts.push(`F&G ${fgScore}${fgLabel ? `(${fgLabel})` : ''}`);
    if (cpi != null) parts.push(`CPI ${cpi}%`);
    if (fed != null) parts.push(`Fed ${fed}%`);
    if (hySpread != null) parts.push(`HY ${hySpread}bps`);
    if (vix != null) parts.push(`VIX ${typeof vix === 'number' ? vix.toFixed(1) : vix}`);
    if (riskLevel) parts.push(`risk=${riskLevel}`);
  } else {
    if (fgScore != null) parts.push(`공포탐욕 ${fgScore}${fgLabel ? `(${fgLabel})` : ''}`);
    if (cpi != null) parts.push(`CPI ${cpi}%`);
    if (fed != null) parts.push(`연준금리 ${fed}%`);
    if (hySpread != null) parts.push(`HY ${hySpread}bps`);
    if (vix != null) parts.push(`VIX ${typeof vix === 'number' ? vix.toFixed(1) : vix}`);
    if (riskLevel) parts.push(`리스크=${riskLevel}`);
  }
  if (parts.length === 0) return macroAnalysis;
  const sep = isEn ? ' | Key data: ' : ' | 주요지표: ';
  const expanded = `${macroAnalysis}${sep}${parts.join(', ')}`;
  console.log(`  [후처리] macroAnalysis 보강: ${macroAnalysis.length}자 → ${expanded.length}자`);
  return expanded;
}

// ── API 데이터 수집 ────────────────────────────────────────────────────────────
async function safeFetch(url, timeoutMs = 10000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function gatherContext() {
  const base = SITE;

  // Named fetch with inline per-API logging
  async function namedFetch(name, url, timeoutMs) {
    const t0 = Date.now();
    const result = await safeFetch(url, timeoutMs);
    const ms = Date.now() - t0;
    if (!result) {
      console.warn(`  [API] ❌ ${name} null (${ms}ms) — ${url}`);
    } else {
      // Summarise key field so we can verify the data looks sensible
      let summary = '';
      if (name === 'fearGreed') summary = `us_score=${result?.byCountry?.find(c=>c.id==='us')?.score ?? result?.score ?? '?'}`;
      else if (name === 'fedwatch') summary = `hold=${result?.probHold ?? '?'}% cut=${result?.probCut ?? '?'}%`;
      else if (name === 'macro') summary = `indicators=${result?.indicators?.length ?? '?'}`;
      else if (name === 'insider') summary = `items=${result?.items?.length ?? 0}`;
      else if (name === 'ownershipAlerts') summary = `items=${result?.items?.length ?? result?.length ?? 0}`;
      else if (name === 'newsCascade') summary = `articles=${result?.articles?.length ?? 0}`;
      else if (name === 'shortInterest') summary = `items=${result?.items?.length ?? result?.data?.length ?? '?'}`;
      else if (name === 'nport') summary = `positions=${result?.positions?.length ?? result?.data?.length ?? '?'}`;
      else if (name === 'supplyChainSignals') summary = `signals=${result?.signals?.length ?? 0}`;
      else if (name === 'volatility') summary = `vix=${result?.vix ?? result?.data?.vix ?? '?'}`;
      else if (name === 'capital') summary = `source=${result?.source ?? '?'}`;
      else if (name === 'creditBalance') summary = `entries=${result?.data?.length ?? '?'}`;
      else if (name === 'koreaFlow') summary = `foreignNet=${result?.foreignNet ?? '?'}`;
      else if (name === 'econCal') summary = `events=${result?.events?.length ?? result?.length ?? '?'}`;
      else if (name === 'cot') summary = `tickers=${result?.positions ? Object.keys(result.positions).length : '?'}`;
      else if (name === 'commodity') summary = `items=${result?.curves?.length ?? result?.data?.length ?? '?'}`;
      console.log(`  [API] ✅ ${name} (${ms}ms) ${summary}`);
    }
    return result;
  }

  const [
    capital, fearGreed, fedwatch, macro,
    creditBalance, insider, ownershipAlerts, koreaFlow,
    nport, shortInterest, newsCascade, econCal,
    volatility, cot, commodity, supplyChainSignals,
  ] = await Promise.all([
    namedFetch('capital',           `${base}/api/capital-flows`, 15000),
    namedFetch('fearGreed',         `${base}/api/fear-greed`, 12000),
    namedFetch('fedwatch',          `${base}/api/fedwatch`, 10000),
    namedFetch('macro',             `${base}/api/macro-indicators`, 10000),
    namedFetch('creditBalance',     `${base}/api/credit-balance`, 10000),
    namedFetch('insider',           `${base}/api/insider-trades`, 15000),
    namedFetch('ownershipAlerts',   `${base}/api/ownership-alerts`, 15000),
    namedFetch('koreaFlow',         `${base}/api/korea-flow`, 10000),
    namedFetch('nport',             `${base}/api/nport-holdings`, 15000),
    namedFetch('shortInterest',     `${base}/api/short-interest`, 12000),
    namedFetch('newsCascade',       `${base}/api/news-cascade`, 15000),
    namedFetch('econCal',           `${base}/api/economic-calendar?country=US`, 8000),
    namedFetch('volatility',        `${base}/api/volatility`, 8000),
    namedFetch('cot',               `${base}/api/cot-positions`, 10000),
    namedFetch('commodity',         `${base}/api/commodity-curve`, 10000),
    namedFetch('supplyChainSignals',`${base}/api/supply-chain-signals`, 10000),
  ]);

  // fear-greed returns { byCountry:[{id:'us',score}], byAsset:[...] }
  const fgByCountry = fearGreed?.byCountry ?? [];
  const fgByAsset = fearGreed?.byAsset ?? fearGreed?.assets ?? [];
  return {
    capital,
    fearGreed: fgByCountry.find(c => c.id === 'us') ?? fearGreed,
    fearGreedByCountry: fgByCountry,
    fearGreedAssets: fgByAsset,
    fedWatch: fedwatch,
    macro,
    credit: creditBalance,
    insider: insider?.items ?? [],
    ownership: ownershipAlerts?.items ?? ownershipAlerts ?? [],
    koreaFlow,
    nport,
    short: shortInterest,
    cascade: newsCascade?.articles ?? [],
    econCal,
    volatility,
    cot,
    commodity,
    supplyChainSignals: supplyChainSignals?.signals ?? [],
  };
}

// ── buildCtxSummary: raw context → prompt-ready text strings ─────────────────
function buildCtxSummary(ctx) {
  // Macro
  let macro = '';
  try {
    const m = ctx.macro;
    if (m) {
      const yc = m.yieldCurve;
      const inds = m.indicators ?? [];
      const cpi = inds.find(i => i.id === 'cpi');
      const gdp = inds.find(i => i.id === 'gdp');
      const spread = yc?.spread10y2y;
      const ig = inds.find(i => i.id === 'ig_spread');
      const hy = inds.find(i => i.id === 'hy_spread');
      const parts = [`YieldCurve=${yc?.inverted ? 'inverted' : 'normal'}(${spread != null ? Math.round(spread * 100) : '?'}bp)`];
      if (cpi?.actual != null) parts.push(`CPI=${cpi.actual}%`);
      if (gdp?.actual != null) {
        parts.push(`GDP=${gdp.actual}%`);
      } else if (gdp?.previous != null) {
        const rel = gdp.releaseDate;
        parts.push(`GDP(prev Q4)=${gdp.previous}%${rel ? `→release ${rel}` : '→pending'}`);
      }
      if (ig?.actual != null) parts.push(`IG_OAS=${ig.actual}%`);
      if (hy?.actual != null) parts.push(`HY_OAS=${hy.actual}%`);
      macro = parts.join(' ');
    }
  } catch { /* ignore */ }

  // Sentiment + FedWatch
  let sentiment = '';
  try {
    const fg = ctx.fearGreed;
    if (fg?.score != null) sentiment = `F&G(US)=${Math.round(fg.score)}(${fg.level ?? fg.label ?? ''})`;
    const meetings = ctx.fedWatch?.meetings ?? [];
    if (meetings.length) {
      const next = meetings[0];
      sentiment += ` FOMC ${next.label} cut_prob=${next.probCut25}%`;
    }
  } catch { /* ignore */ }

  // Capital flows
  let flows = '';
  try {
    const cap = ctx.capital;
    const assets = cap?.assets ?? [];
    const withDir = assets.filter(a => typeof a.ret4w === 'number' && typeof a.ret1w === 'number').map(a => {
      const isInflow = (a.ret4w ?? 0) >= 0;
      const signal = isInflow
        ? ((a.ret1w ?? 0) < 0 ? 'reversal↕' : (a.ret1w ?? 0) > (a.ret4w ?? 0) * 0.3 ? 'accel↑' : 'hold→')
        : ((a.ret1w ?? 0) > 0 ? 'reversal↕' : 'hold→');
      return { ...a, signal };
    });
    const topInflows = [...withDir].sort((a, b) => (b.ret4w ?? 0) - (a.ret4w ?? 0)).slice(0, 4)
      .map(a => `${a.label ?? a.ticker}:1w${(a.ret1w ?? 0) >= 0 ? '+' : ''}${(a.ret1w ?? 0).toFixed(1)}%/4w${(a.ret4w ?? 0) >= 0 ? '+' : ''}${(a.ret4w ?? 0).toFixed(1)}%(${a.signal})`);
    if (topInflows.length) flows = `Top inflows: ${topInflows.join(', ')}`;

    const divergent = assets.filter(a =>
      typeof a.ret1w === 'number' && typeof a.ret13w === 'number' &&
      Math.sign(a.ret1w) !== Math.sign(a.ret13w) &&
      Math.abs(a.ret1w) > 1.5 && Math.abs(a.ret13w) > 1.5
    ).slice(0, 3).map(a =>
      `${a.label ?? a.ticker}(1w${(a.ret1w ?? 0) >= 0 ? '+' : ''}${(a.ret1w ?? 0).toFixed(1)}% vs 13w${(a.ret13w ?? 0) >= 0 ? '+' : ''}${(a.ret13w ?? 0).toFixed(1)}%=TREND_REVERSAL)`
    );
    if (divergent.length) flows += ` | TrendReversal: ${divergent.join(', ')}`;

    const rots = cap?.flow?.rotations1w ?? [];
    if (rots.length) {
      flows += ` | Rotation: ${rots.slice(0, 3).map(r => `${r.from}→${r.to}(${(r.magnitude ?? 0).toFixed(1)}%,${r.momentum})`).join(', ')}`;
    }

    const countries = cap?.countryFlow?.countries ?? [];
    const topCtry = countries.filter(c => typeof c.ret4w === 'number').sort((a, b) => (b.ret4w ?? 0) - (a.ret4w ?? 0)).slice(0, 4).map(c => {
      const rev = typeof c.ret1w === 'number' && typeof c.ret13w === 'number' && Math.sign(c.ret1w) !== Math.sign(c.ret13w) ? '↕' : '';
      return `${c.label}:4w${(c.ret4w ?? 0) >= 0 ? '+' : ''}${(c.ret4w ?? 0).toFixed(1)}%${rev}`;
    });
    if (topCtry.length) flows += ` | Countries: ${topCtry.join(', ')}`;
  } catch { /* ignore */ }

  // Institutional: 13F + insider
  let institutional = '';
  try {
    const sigs = ctx.signals ?? [];
    const buys = sigs.filter(s => s.action === 'accumulating' || s.action === 'new_position').slice(0, 5)
      .map(s => `${s.ticker}(${s.institution} ${s.estimatedValue ?? ''})`);
    if (buys.length) institutional = `13F buys: ${buys.join(', ')}`;

    const insiderArr = Array.isArray(ctx.insider) ? ctx.insider : [];
    if (insiderArr.length) {
      const recent = insiderArr.filter(i => i.direction === 'buy').slice(0, 3)
        .map(i => `${i.ticker ?? '?'} ${i.officerTitle ?? 'insider'} $${Math.round((i.transactionValueUsd ?? 0) / 1000)}K`);
      if (recent.length) institutional += ` | Insider buys: ${recent.join(', ')}`;

      const clusterMap = new Map();
      for (const i of insiderArr) {
        const t = i.ticker; if (!t) continue;
        const c = clusterMap.get(t) ?? { buys: 0, sells: 0, totalUsd: 0, dates: [] };
        if (i.direction === 'buy') c.buys++; else c.sells++;
        c.totalUsd += i.transactionValueUsd ?? 0;
        const d = i.transactionDate ?? i.filingDate;
        if (d) c.dates.push(d);
        clusterMap.set(t, c);
      }
      const hot = Array.from(clusterMap.entries())
        .filter(([, c]) => c.buys + c.sells >= 5)
        .sort((a, b) => (b[1].buys + b[1].sells) - (a[1].buys + a[1].sells))
        .slice(0, 3)
        .map(([t, c]) => {
          const sorted = [...c.dates].sort();
          const dr = sorted.length > 1 ? `${sorted[0]}~${sorted[sorted.length - 1]}` : (sorted[0] ?? '');
          return `${t}(${c.buys}buy/${c.sells}sell $${Math.round(c.totalUsd / 1000)}K${dr ? ` ${dr}` : ''})`;
        });
      if (hot.length) institutional += ` | 집중매매감지: ${hot.join(', ')}`;
    }
  } catch { /* ignore */ }

  // COT
  let cot = '';
  try {
    const entries = ctx.cot?.entries ?? [];
    if (entries.length) {
      cot = entries.slice(0, 5).map(e => {
        const wk = e.weeklyChange;
        const wkStr = wk != null ? `(${wk > 0 ? '+' : ''}${Math.round(wk / 1000)}k wk)` : '';
        return `${e.id}:${e.sentiment}${e.netPosition > 0 ? '+' : ''}${Math.round(e.netPosition / 1000)}k${wkStr}`;
      }).join(', ');
    }
  } catch { /* ignore */ }

  // Commodity
  let commodity = '';
  try {
    const curves = ctx.commodity?.curves ?? [];
    if (curves.length) {
      commodity = curves.filter(c => Array.isArray(c.curve) && c.curve.length > 0).map(c => {
        const front = c.curve[0]?.price;
        if (!front) return null;
        const slopeStr = Math.abs(c.slope) > 0.1 ? `${c.slope > 0 ? '+' : ''}${c.slope.toFixed(1)}%` : '';
        const name = c.id === 'oil' ? 'WTI' : 'Gold';
        const unit = c.unit ?? '';
        return `${name}=${front.toFixed(front >= 1000 ? 0 : 2)}${unit.includes('oz') ? '/oz' : '/bbl'}(${c.structure}${slopeStr})`;
      }).filter(Boolean).join(', ');
    }
  } catch { /* ignore */ }

  // Shorts
  let shorts = '';
  try {
    const sd = ctx.short;
    const arr = Array.isArray(sd) ? sd : (sd?.entries ?? []);
    const squeeze = arr.filter(s => (s.squeezeScore ?? 0) >= 40).slice(0, 3)
      .map(s => `${s.ticker}(squeeze=${s.squeezeScore})`);
    if (squeeze.length) shorts = squeeze.join(', ');
  } catch { /* ignore */ }

  // News (cascade)
  let news = '';
  try {
    const cascadeArr = Array.isArray(ctx.cascade) ? ctx.cascade : [];
    const isFedArticle = n => /powell|fomc|fed|ecb|lagarde|boj|monetary|rate cut|rate hike/i.test(String(n.title ?? n.summary));
    // Fed articles first (max 2), then sector/company news — prevents Fed from eating all 6 slots
    const fedArticles = cascadeArr.filter(isFedArticle).slice(0, 2);
    const sectorArticles = cascadeArr.filter(n => !isFedArticle(n));
    const mixed = [...fedArticles, ...sectorArticles].slice(0, 6);
    const topNews = mixed.map(n => {
      const sent = n.sentiment === 'bullish' ? '↑' : n.sentiment === 'bearish' ? '↓' : '·';
      const prefix = isFedArticle(n) ? '[연준]' : '';
      const text = ((n.summary || n.title || '')).slice(0, 70);
      const impacts = (n.cascades ?? [])
        .filter(c => (c.magnitude === 'high' || c.magnitude === 'medium') && c.direction !== 'neutral')
        .slice(0, 3).map(c => `${c.asset}${c.direction === 'positive' ? '↑' : '↓'}`).join(',');
      return impacts ? `${sent}${prefix}${text}(${impacts})` : `${sent}${prefix}${text}`;
    });
    if (topNews.length) news = topNews.join(' | ');
  } catch { /* ignore */ }

  // Korea flows
  let koreaFlow = '';
  try {
    const countries = ctx.capital?.countryFlow?.countries ?? [];
    const korea = countries.find(c => c.id === 'korea');
    if (korea) koreaFlow = `Korea(EWY): 1w=${korea.ret1w?.toFixed(1) ?? '?'}% 4w=${korea.ret4w?.toFixed(1) ?? '?'}%`;
    if (ctx.koreaFlow) {
      const kf = ctx.koreaFlow;
      const net = kf.foreignNet ?? kf.netBuy;
      if (net != null) koreaFlow += ` | Foreign net: ${net > 0 ? '+' : ''}${(net / 1e8).toFixed(1)}억`;
    }
  } catch { /* ignore */ }

  // Asset-class F&G
  let assetFg = '';
  try {
    const assets = ctx.fearGreedAssets ?? [];
    if (assets.length) assetFg = assets.slice(0, 8).map(a => `${a.id}:${Math.round(a.score)}(${a.level})`).join(', ');
  } catch { /* ignore */ }

  // Bollinger Band 경고
  let bbWarnings = '';
  try {
    const capAssets = ctx.capital?.assets ?? [];
    const countryAssets = ctx.capital?.countryFlow?.countries ?? [];
    const warnings = [];
    for (const a of [...capAssets, ...countryAssets]) {
      if (!a.ticker || !a.sparkline?.length) continue;
      const prices = a.sparkline;
      if (prices.length >= 20) {
        const s20 = prices.slice(-20);
        const m20 = s20.reduce((s, v) => s + v, 0) / 20;
        const sd20 = Math.sqrt(s20.reduce((s, v) => s + (v - m20) ** 2, 0) / 20);
        if (prices[prices.length - 1] > m20 + 2 * sd20)
          warnings.push(`${a.ticker}:20d2σ초과(BB${(m20 + 2 * sd20).toFixed(2)},현재${prices[prices.length - 1].toFixed(2)})`);
      }
      if (prices.length >= 4) {
        const s4 = prices.slice(-4);
        const m4 = s4.reduce((s, v) => s + v, 0) / 4;
        const sd4 = Math.sqrt(s4.reduce((s, v) => s + (v - m4) ** 2, 0) / 4);
        const upper4 = m4 + 4 * sd4;
        if (sd4 > 0 && prices[prices.length - 1] >= upper4)
          warnings.push(`⚠️${a.ticker}:4d4σ극단초과→진입금지`);
      }
    }
    if (warnings.length) bbWarnings = warnings.join(', ');
  } catch { /* ignore */ }

  // Credit balance
  let credit = '';
  try {
    const cr = ctx.credit;
    const snap = cr?.globalSnapshot ?? {};
    const total = snap.totalUsd;
    const gdpPct = snap.avgGdpPct;
    const usEntry = cr?.countries?.find(c => c.id === 'us');
    if (total && gdpPct) {
      const usYoy = usEntry?.yoyChangePct;
      credit = `신용잔고: 글로벌 $${(total / 1e9).toFixed(0)}B, GDP대비${gdpPct.toFixed(1)}%${usYoy != null ? `, US YoY${usYoy.toFixed(1)}%` : ''}`;
    }
  } catch { /* ignore */ }

  // N-PORT
  let nport = '';
  try {
    const np = ctx.nport;
    const byTicker = np?.byTicker ?? [];
    const top = byTicker.filter(t => typeof t.totalValue === 'number' && t.totalValue > 0)
      .sort((a, b) => b.totalValue - a.totalValue).slice(0, 4)
      .map(t => `${t.ticker}($${Math.round(t.totalValue / 1e6)}M)`);
    if (top.length) nport = `N-PORT 기관집계: ${top.join(', ')}`;
  } catch { /* ignore */ }

  // Options flow
  let optionsFlow = '';
  try {
    const opts = Array.isArray(ctx.options) ? ctx.options : [];
    const notable = opts.filter(o => o.unusual || (o.premium ?? 0) > 500000).slice(0, 3);
    if (notable.length)
      optionsFlow = `옵션이상: ${notable.map(o => `${o.ticker}${o.side}(${o.type}$${Math.round((o.premium ?? 0) / 1000)}K)`).join(', ')}`;
  } catch { /* ignore */ }

  // Ownership (13D/G)
  let ownership = '';
  try {
    const ow = Array.isArray(ctx.ownership) ? ctx.ownership : [];
    const recent = ow.slice(0, 3).map(o => `${o.ticker}(${o.filerName} ${o.changePct ?? o.pct}%)`);
    if (recent.length) ownership = `13D/G지분변동: ${recent.join(', ')}`;
  } catch { /* ignore */ }

  // Econ calendar
  let econCal = '';
  try {
    const events = ctx.econCal?.events ?? [];
    const high = events.filter(e => e.impact === 'high' || e.impact === 3).slice(0, 4)
      .map(e => `${e.date}:${e.event}`);
    if (high.length) econCal = `고임팩트이벤트: ${high.join(', ')}`;
  } catch { /* ignore */ }

  // VIX context
  let vixCtx = '';
  try {
    const v = ctx.volatility;
    if (v?.vix != null) {
      const parts = [`VIX=${v.vix.toFixed(2)}`];
      if (v.regime) parts.push(`regime=${v.regime}`);
      if (v.regimeLabel) parts.push(`(${v.regimeLabel})`);
      vixCtx = parts.join(' ');
    }
    if (!vixCtx) {
      const vixInd = ctx.macro?.indicators?.find(i => i.id === 'vix');
      if (vixInd?.value != null) vixCtx = `VIX=${vixInd.value}`;
    }
  } catch { /* ignore */ }

  // Supply chain signals → prompt text
  let supplyChain = '';
  try {
    const sigs = Array.isArray(ctx.supplyChainSignals) ? ctx.supplyChainSignals : [];
    const positives = sigs.filter(s => s.direction === 'positive' && s.conviction >= 60).slice(0, 5);
    const negatives = sigs.filter(s => s.direction === 'negative' && s.conviction >= 60).slice(0, 3);
    const lines = [];
    for (const s of positives) {
      const down = s.downstreamBeneficiaries?.length ? ` → downstream: ${s.downstreamBeneficiaries.join(',')}` : '';
      lines.push(`[+${s.conviction}] ${s.ticker} ${s.signalType.toUpperCase()}: ${s.headline.slice(0, 80)}${down}`);
    }
    for (const s of negatives) {
      lines.push(`[-${s.conviction}] ${s.ticker} ${s.signalType.toUpperCase()}: ${s.headline.slice(0, 80)}`);
    }
    if (lines.length) supplyChain = lines.join('\n');
  } catch { /* ignore */ }

  return { macro, sentiment, flows, cot, commodity, institutional, shorts, news, koreaFlow, assetFg, bbWarnings, credit, nport, optionsFlow, ownership, econCal, vixCtx, supplyChain };
}

// ── Cascade signals ────────────────────────────────────────────────────────────
// src/data/cascades.ts 의 cascadePatterns 를 runtime 으로 파싱 (TS UI 와 단일 진실 원천 공유).
let _cascadePatternsCache = null;
function loadCascadePatterns() {
  if (_cascadePatternsCache) return _cascadePatternsCache;
  try {
    const src = readFileSync(resolve(ROOT, 'src/data/cascades.ts'), 'utf8');
    const marker = 'export const cascadePatterns';
    const start = src.indexOf(marker);
    if (start < 0) return (_cascadePatternsCache = []);
    const eq = src.indexOf('= [', start);
    if (eq < 0) return (_cascadePatternsCache = []);
    // 매칭 `];` 찾기 — 문자열 안의 [ ] 는 건너뛴다
    let depth = 0, end = -1;
    let i = eq + 2;
    while (i < src.length) {
      const ch = src[i];
      if (ch === '"' || ch === "'" || ch === '`') {
        const q = ch; i++;
        while (i < src.length && src[i] !== q) {
          if (src[i] === '\\') i++;
          i++;
        }
        i++; continue;
      }
      if (ch === '/' && src[i + 1] === '/') {
        while (i < src.length && src[i] !== '\n') i++;
        continue;
      }
      if (ch === '[') depth++;
      else if (ch === ']') { depth--; if (depth === 0) { end = i; break; } }
      i++;
    }
    if (end < 0) return (_cascadePatternsCache = []);
    const arrSrc = src.slice(eq + 2, end + 1);
    _cascadePatternsCache = vm.runInNewContext(arrSrc, {}, { timeout: 1000 });
    return _cascadePatternsCache;
  } catch (e) {
    console.warn(`  ⚠️  cascade-patterns 파싱 실패: ${e.message}`);
    return (_cascadePatternsCache = []);
  }
}

async function getActiveCascadeSignals(prices) {
  const patterns = loadCascadePatterns();
  if (!patterns.length) return '';

  const lines = [];
  for (const p of patterns) {
    const lp = prices.get(p.leaderTicker);
    const ret = lp?.change1d ?? null;

    // sequence 를 role 그룹별로 정리 (leader / first_follower / mid_cap / late_mover)
    const seq = Array.isArray(p.sequence) ? p.sequence : [];
    const firstFollowers = seq.filter(s => s.role === 'first_follower').map(s => s.ticker);
    const midCaps = seq.filter(s => s.role === 'mid_cap').map(s => s.ticker);
    const lateMovers = seq.filter(s => s.role === 'late_mover').map(s => s.ticker);
    const chain = [
      `${p.leaderTicker}(L)`,
      firstFollowers.length ? `→${firstFollowers.join('/')}` : '',
      midCaps.length ? `→${midCaps.join('/')}` : '',
      lateMovers.length ? `→${lateMovers.join('/')}` : '',
    ].filter(Boolean).join('');

    // 최근 historical occurrence 1건 압축
    const occ = Array.isArray(p.historicalOccurrences) ? p.historicalOccurrences : [];
    const latest = occ.length ? occ[occ.length - 1] : null;
    const sample = latest
      ? ` [최근 ${latest.date}: ${latest.leaderMove} → ${(latest.cascadeResult ?? '').slice(0, 80)}]`
      : '';

    const liveTag = ret != null && Math.abs(ret) >= 3
      ? ` 🔥ACTIVE: ${p.leaderTicker} 1d ${ret >= 0 ? '+' : ''}${ret.toFixed(1)}%`
      : '';

    lines.push(`■ ${p.sectorName}: ${chain}${liveTag}${sample}`);
  }
  return lines.join('\n');
}

async function getSectorSummary() {
  try {
    const d = await safeFetch(`${SITE}/api/sector-pe`, 8000);
    if (!d?.sectors) return '';
    return d.sectors.slice(0, 8).map(e => {
      const ytd = e.ytdReturn != null ? (e.ytdReturn * 100).toFixed(1) : 'N/A';
      return `${e.ticker}(${e.name}) P/E=${e.trailingPE?.toFixed(1) ?? 'N/A'} YTD=${ytd}%`;
    }).join(', ');
  } catch { return ''; }
}

async function getUpcomingEarnings() {
  try {
    // Include past 7 days to capture recently reported earnings (e.g. CRWV Q1)
    const kstNow = Date.now() + 9 * 3600000;
    const from = new Date(kstNow - 7 * 86400000).toISOString().slice(0, 10);
    const to   = new Date(kstNow + 14 * 86400000).toISOString().slice(0, 10);
    const d = await safeFetch(`${SITE}/api/earnings?from=${from}&to=${to}`, 8000);
    const items = (d?.earnings ?? []).slice(0, 12);
    return items.map(e => {
      const surp = e.epsSurprise != null ? ` EPS${e.epsSurprise >= 0 ? '+' : ''}${e.epsSurprise}%` : '';
      return `${e.symbol} ${e.date}${surp}`;
    }).join(', ');
  } catch { return ''; }
}

/** 최근 7일 + 향후 14일 실적 raw 배열 반환 (post-earnings 판단용) */
async function getRawEarnings() {
  try {
    const kstNow = Date.now() + 9 * 3600000;
    const from = new Date(kstNow - 7 * 86400000).toISOString().slice(0, 10);
    const to   = new Date(kstNow + 14 * 86400000).toISOString().slice(0, 10);
    const d = await safeFetch(`${SITE}/api/earnings?from=${from}&to=${to}`, 8000);
    return (d?.earnings ?? []).map(e => ({
      ticker: (e.symbol ?? e.ticker ?? '').toUpperCase(),
      date: e.date,
      epsActual: e.epsActual ?? null,
      epsSurprise: e.epsSurprise ?? null,
    }));
  } catch { return []; }
}

async function getCompanyFinancials(tickers) {
  if (!tickers.length) return '';
  const results = await Promise.allSettled(
    tickers.slice(0, 8).map(async ticker => {
      try {
        const d = await safeFetch(`${SITE}/api/company-financials/${ticker}`, 5000);
        if (!d) return null;
        const q = d.quarterlyRevenue?.[0];
        if (!q) return null;
        const rev = q.revenueUSD >= 1e9 ? `$${(q.revenueUSD / 1e9).toFixed(1)}B` : `$${(q.revenueUSD / 1e6).toFixed(0)}M`;
        const yoy = q.yoyPct != null ? `${q.yoyPct > 0 ? '+' : ''}${q.yoyPct.toFixed(1)}% YoY` : '';
        const margin = d.latestAnnual?.operatingMarginPct != null ? ` opMgn=${d.latestAnnual.operatingMarginPct.toFixed(1)}%` : '';
        return `${ticker}: ${q.label} ${rev} ${yoy}${margin}`;
      } catch { return null; }
    })
  );
  return results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value).join(' | ');
}

// ── 프롬프트 빌더 (investment-prompts.ts 포팅) ─────────────────────────────────
const TODAY = new Date().toISOString().slice(0, 10);
const li = TARGET_LANG ? `\nWrite ALL text in ${TARGET_LANG} except tickers/numbers/JSON keys.\n` : '';

function buildGroundingFacts(livePriceData) {
  const lines = [
    `[FACTS — MANDATORY]`,
    `System date: ${TODAY}`,
    `파월은 2026년 2월 의장 임기 만료. "파월 전 의장" 또는 "파월 이사"로만 표기. 트럼프가 새 의장 임명.`,
    `Ticker policy: S&P500 components, major ETFs, top-100 crypto, country ETFs (EWY/EWJ/EWZ/VGK etc.), Korean stocks (.KS)`,
    `BLOCKED: OTC/pink sheets (.OB/.PK), pure inverse/leveraged ETFs (SQQQ/TQQQ) as primary hold`,
  ];
  if (livePriceData) lines.push('', `[Live Prices]`, livePriceData);
  lines.push('[END FACTS]');
  return lines.join('\n');
}

function getGuruContext() {
  return [
    '[GURU INVESTMENT FRAMEWORKS]',
    'Buffett: ROE>15%+FCF yield>2×bonds+moat → margin of safety entry',
    'Lynch: PEG<1 (P/E÷growth) → undervalued vs growth',
    'Greenblatt: EBIT/EV>10%+ROIC>25% → Magic Formula',
    'Druckenmiller: earnings momentum+liquidity expansion → concentrated position',
    'Graham: Graham Number = √(22.5 × EPS × BVPS) → buy below',
    'RULE: entryRationale MUST include ≥1 non-technical signal when data available.',
    'BAD: "50일선 지지" GOOD: "100일선+ROE18%FCF수익률8%→안전마진" or "린치PEG0.8→성장대비저평가"',
    '[END GURU FRAMEWORKS]',
  ].join('\n');
}

function buildMacroPrompt(ctx, vix, session) {
  const sc = session === 'morning' ? 'Post US-close' : session === 'afternoon' ? 'Post Asia-close' : 'Pre US-open';
  return [
    `You are a macro strategist. Session: ${sc} ${TODAY}.${li}`,
    '',
    `[Macro Indicators] ${ctx.macro || 'No data'}`,
    `[Sentiment + FedWatch] ${ctx.sentiment || 'No data'}`,
    `[VIX] ${vix || 'No data'}`,
    `[Credit Balance] ${ctx.credit || 'No data'}`,
    `[Upcoming High-Impact Events] ${ctx.econCal || 'No data'}`,
    `[COT Positioning] ${ctx.cot || 'No data'}`,
    `[Commodity Curves] ${ctx.commodity || 'No data'}`,
    `[News — 연준발언 우선] ${ctx.news || 'No data'}`,
    '파월은 2026년 의장 임기 만료 후 이사(Governor)로 잔류. "파월 전 의장" 또는 "파월 이사"로 표기.',
    '',
    `Write ALL text values in ${TARGET_LANG}. Respond ONLY in pure JSON, no markdown, no explanation:`,
    `{"macroAnalysis":"[${TARGET_LANG} text, ≤150 chars, include actual CPI/rate/spread numbers]",`,
    `"technicalAnalysis":"[${TARGET_LANG} text, ≤120 chars, VIX + yield curve only, no futures jargon]",`,
    `"fundamentalAnalysis":"[${TARGET_LANG} text, ≤150 chars, earnings surprise + valuation + institutional signal]",`,
    `"thesis":"[${TARGET_LANG} text, 15-50 chars, specific market theme with key catalyst or data point — no generic phrases]",`,
    '"riskLevel":"low|medium|high",',
    `"riskEvents":[{"date":"YYYY-MM-DD","event":"[${TARGET_LANG}]","impact":"high|medium|low","watchFor":"[${TARGET_LANG} ≤60 chars]"}]}`,
    `Include 3-5 riskEvents (BOJ/ECB/Fed/NFP/CPI). Output JSON only, starting with {`,
  ].join('\n');
}

/**
 * 과거 30일 outcome 기반 ticker별 entry feedback — LLM 환각 prevention.
 * "ASML: 13/13 NE, avg entry $1370 vs actual $1497 → entry 9% 올려야 함" 같은 cue.
 */
function getEntryFeedbackBlock() {
  try {
    const stats = getEntryFeedbackStats();
    if (!stats.length) return '';
    // outlier 제거: NE 샘플 < 3 또는 gap > 20% 는 신뢰 불가 → cue 제거
    // "TOO LOW" → "median 통계" 로 톤 약화 (LLM over-correction 방지)
    const lines = stats.map(s => {
      const isKR = (s.ticker ?? '').endsWith('.KS');
      const fmt = n => n == null ? '?' : isKR ? `₩${Math.round(n).toLocaleString()}` : `$${n.toFixed(2)}`;
      const neRate = s.total ? Math.round(s.ne / s.total * 100) : 0;
      let cue = '';
      if (s.avg_ne_entry && s.avg_ne_actual && s.ne >= 3) {
        const gap = parseInt(((s.avg_ne_actual - s.avg_ne_entry) / s.avg_ne_actual * 100).toFixed(0));
        if (gap >= 4 && gap <= 15) cue = ` → past entry median was ${gap}% below actual (consider tighter zone)`;
        // gap > 15 또는 < -15 는 데이터 이상치 → cue 없음 (over-correction 방지)
      }
      const hitInfo = s.hits > 0 ? ` hit=${s.hits}` : '';
      return `  ${(s.ticker ?? '').padEnd(11)} NE=${s.ne}/${s.total} (${neRate}%)${hitInfo}${cue}`;
    });
    return [
      '[PAST PERFORMANCE — last 30d (informational, do NOT over-correct)]',
      ...lines,
      '',
    ].join('\n');
  } catch (e) { console.warn('  ⚠️ entry feedback 생성 실패:', e.message); return ''; }
}

function getRecentTickers() {
  try {
    const dir = resolve(import.meta.dirname ?? '.', '..', 'reports');
    const files = readdirSync(dir).filter(f => f.endsWith('-ko.json')).sort().slice(-3);
    const seen = new Set();
    for (const f of files) {
      const r = JSON.parse(readFileSync(resolve(dir, f), 'utf8'));
      for (const p of r.portfolio ?? []) if (p.ticker) seen.add(p.ticker);
    }
    return [...seen];
  } catch { return []; }
}

function buildPortfolioPrompt(ctx, sectorPe, earnings, priceData) {
  const recentTickers = getRecentTickers();
  return [
    buildGroundingFacts(priceData),
    '',
    `You are a portfolio manager building an investment strategy. Date: ${TODAY}.${li}`,
    '',
    `[Institutional + Insider Signals]`,
    ctx.institutional || 'No data',
    '집중매매감지 = 5건 이상 내부자 신고 = 강한 확신 신호',
    '',
    `[Sector Valuations] ${sectorPe || 'No data'}`,
    `[Bollinger Band 과매수 경고] ${ctx.bbWarnings || 'None'}`,
    `[Short Squeeze Candidates] ${ctx.shorts || 'None'}`,
    `[Unusual Options Flow] ${ctx.optionsFlow || 'None'}`,
    `[13D/G 대량보유 변동] ${ctx.ownership || 'None'}`,
    `[N-PORT 뮤추얼펀드] ${ctx.nport || 'None'}`,
    `[Upcoming Earnings] ${earnings || 'None'}`,
    `[Supply Chain Signals] ${ctx.supplyChain || 'None'}`,
    '',
    getGuruContext(),
    '',
    '** OBJECTIVE: ALPHA GENERATION — Beat the index (S&P 500). **',
    '** Passive ETFs (SPY/QQQ/VTI) and bonds combined ≤ 20% total. **',
    '** Concentrate on HIGH-CONVICTION individual stocks. **',
    '** Minimum 5 individual stocks, each ≥ 10% allocation. **',
    '',
    recentTickers.length ? `[ROTATION — recent 3 reports used: ${recentTickers.join(', ')}]` : '',
    'ROTATION RULE: Include ≥2 tickers NOT in the recent list above. Avoid using the same 6 tickers every session.',
    '',
    'RULES:',
    '1. 6-8 items: PRIMARILY individual stocks — ONLY pick tickers in [Live Prices]',
    '   Rank by signal: (1) insider 집중매수/13D, (2) squeeze score, (3) 13F accumulation, (4) options flow, (5) capital-flow momentum',
    '2. "market" field = us/korea/japan/china/europe/india/taiwan/global',
    '3. entryZone/stopLoss/target: SYNTHESIZE from technical + fundamental + guru analysis.',
    '   ⚠️ CRITICAL: Use the ACTUAL prices from [Live Prices] as your anchor. Do NOT use memorized/training prices.',
    '   TECHNICAL (use [COMPUTED_TECH] 진입지지선/200MA/50MA values):',
    '     - 진입지지선:$X in [COMPUTED_TECH] → center entry zone around that price (±2%)',
    '     - RSI>70 (overbought): entry at 200MA or 8-15% pullback from current [Live Prices] price',
    '     - RSI 50-70 (neutral): entry near 50MA support',
    '     - RSI<50 (oversold): entry near current [Live Prices] price (already discounted)',
    '   FUNDAMENTAL (use [Recent Company Financials]):',
    '     - High P/E growth stock (PEG 1.0-1.5): entry at 10-15% below 52주 고점 (margin of safety)',
    '     - Deep value (P/E < sector avg, PEG < 1): entry near current if fundamentals support',
    '   GURU FRAMEWORK (apply matching guru from context):',
    '     - Lynch/PEG: entry when PEG < 1 → current is entry, target = 20-30% above',
    '     - Druckenmiller/momentum: entry ONLY after MA confirmation, not before',
    '     - Marks/contrarian: entry on fear dips, wider entry zone',
    '     - Buffett/value: entry with 20-30% margin of safety vs intrinsic value',
    '   stopLoss: structural invalidation — BELOW key support (200MA or -8% below entry, whichever is tighter).',
    '   target: earnings/catalyst driven — use [Recent Financials] revenue growth to project.',
    '   ⚠️ SANITY CHECK: Your entryZone MUST be within ±30% of the [Live Prices] value. If it is not, you are hallucinating.',
    '   Also output entryPlan for system fallback: {"anchorReason":"current|50MA|200MA|52w_pullback","discountPct":0-5}',
    '4. rationale 100 chars max with real data signals',
    '5. allocation sum = 100, no single position > 25%',
    '6. action: buy=accumulate now, hold=keep, watch=wait for entry',
    '7. entryRationale ≤80자: cite WHICH support level / indicator anchors the entry zone',
    '8. targetRationale ≤80자: fundamentals-first',
    '9. CRITICAL — UNIQUE rationale per stock: Each ticker MUST have a DIFFERENT rationale',
    '   citing THAT stock\'s specific primary signal. Do NOT copy-paste the same text.',
    '   Examples of different signals: insider filings count, squeeze score, options flow,',
    '   13F accumulation, earnings beat %, PE vs sector, RSI level, 52w position.',
    '',
    '⚠️ ANTI-COPY RULES FOR rationale (same violation type ruins the report):',
    '- Insider Buying in rationale: ONLY if [Institutional + Insider Signals] explicitly lists filings for THAT ticker.',
    '  Write the actual count (e.g. "insider 23건") — never use "insider buying" without a specific number.',
    '  If the ticker is NOT listed in insider signals, do NOT mention insider buying.',
    '- Short Squeeze in rationale: ONLY if [Short Squeeze Candidates] explicitly lists THAT ticker with a score.',
    '  Write the actual squeeze score (e.g. "squeeze 38") — never mention squeeze without the score.',
    '  If the ticker is NOT in squeeze candidates, do NOT mention squeeze at all.',
    '- If you find yourself writing similar insider/squeeze text for 3+ stocks, you are copy-pasting — stop and rewrite using each stock\'s own fundamental data instead.',
    '',
    '',
    '═══════════════════════════════════════════════════════════════',
    '⚠️ LIVE PRICES (as of TODAY — use THESE numbers, NOT your training data):',
    priceData || 'No data',
    '═══════════════════════════════════════════════════════════════',
    getEntryFeedbackBlock(),
    'Your entryZone/stopLoss/target MUST be anchored to the LIVE PRICES above.',
    'Past performance is informational only — do NOT mechanically push entry up. Use technical/fundamental analysis to decide entry zone.',
    'If you write a price that differs >30% from the live price, it is a HALLUCINATION.',
    '',
    `Respond in pure JSON (no markdown). ALL text values MUST be in ${TARGET_LANG}:`,
    '{"stance":"bullish|neutral|bearish",',
    '"portfolio":[{"ticker":"NVDA","name":"NVIDIA","sector":"Technology","market":"us",',
    `"rationale":"[≤100 chars in ${TARGET_LANG}, cite real data signals]","allocation":15,`,
    `"entryZone":"$X-Y","entryRationale":"[≤80 chars in ${TARGET_LANG}, cite support level / guru / margin-of-safety]",`,
    '"entryPlan":{"anchorReason":"50MA","discountPct":2},',
    `"stopLoss":"$Z","target":"$A","targetBull":"$B","targetRationale":"[≤80 chars in ${TARGET_LANG}, fundamentals-first]",`,
    '"confidence":"high","action":"buy"}],',
    `"sectorAllocation":[{"sector":"Technology","pct":25,"stance":"overweight","reason":"[≤40 chars in ${TARGET_LANG}]"}]}`,
    '6-8 portfolio items, 5 sectorAllocation items. Pure JSON only.',
    '⚠️ entryZone MUST be based on [Live Prices] + analysis. entryPlan is a BACKUP — system uses it only if entryZone is hallucinated.',
  ].join('\n');
}

function buildRegionalPrompt(ctx) {
  return [
    `You are a global market strategist. Date: ${TODAY}.${li}`,
    '',
    `[Capital Flows — 1W/4W returns by country/asset]`,
    ctx.flows || 'No data',
    `[Korean Market] ${ctx.koreaFlow || 'No data'}`,
    `[Asset-Class Fear & Greed] ${ctx.assetFg || 'No data'}`,
    '',
    'Provide bullish/neutral/bearish for each country based on flows and F&G.',
    'Respond in pure JSON (no markdown):',
    '{"regionStances":{',
    `"us":{"stance":"bullish","thesis":"[≤40 chars in ${TARGET_LANG}]","keyData":"SPY 1w, F&G score"},`,
    `"korea":{"stance":"neutral","thesis":"...","keyData":"EWY 1w, F&G"},`,
    '"japan":{"stance":"...","thesis":"...","keyData":"..."},',
    '"china":{"stance":"...","thesis":"...","keyData":"..."},',
    '"europe":{"stance":"...","thesis":"...","keyData":"..."},',
    '"india":{"stance":"...","thesis":"...","keyData":"..."},',
    '"taiwan":{"stance":"...","thesis":"...","keyData":"..."},',
    '"brazil":{"stance":"...","thesis":"...","keyData":"..."},',
    '"australia":{"stance":"...","thesis":"...","keyData":"..."},',
    '"global":{"stance":"...","thesis":"...","keyData":"..."}',
    '}}',
    'All 10 regions required. Pure JSON only.',
  ].join('\n');
}

function buildOpportunityPrompt(ctx) {
  return [
    `You are a short squeeze and insider trading specialist. Date: ${TODAY}. Write in ${TARGET_LANG}.`,
    '',
    `[Short Squeeze Candidates] ${ctx.shorts || 'None'}`,
    `[Insider + Institutional Signals] ${ctx.institutional || 'None'}`,
    `[Asset F&G] ${ctx.assetFg || 'No data'}`,
    '',
    `⚠️ filings count MUST match exactly what appears in [집중매매감지] — NEVER copy example numbers.`,
    `Respond in pure JSON. ALL text values in ${TARGET_LANG}:`,
    `{"shortSqueeze":[{"ticker":"[TICKER]","score":0,"timing":"[≤40 chars in ${TARGET_LANG}]","risk":"[≤40 chars in ${TARGET_LANG}]"}],`,
    `"insiderSignals":[{"ticker":"[TICKER]","filings":[EXACT_COUNT_FROM_DATA],"dateRange":"[YYYY-MM-DD~YYYY-MM-DD from data]","significance":"[≤40 chars in ${TARGET_LANG}]","pattern":"[≤30 chars in ${TARGET_LANG}]"}],`,
    `"topOpportunity":"[≤100 chars in ${TARGET_LANG}]"}`,
    'Pure JSON only.',
  ].join('\n');
}

function buildNarrativePrompt(ctx, session, sectorPe, institutional) {
  const sc = session === 'morning' ? '미국장 마감 직후' : session === 'afternoon' ? '아시아장 마감 직후' : '미국장 개장 전';
  return [
    `You are a market narrative writer. Session: ${sc} ${TODAY}. Write in ${TARGET_LANG}.`,
    '',
    `[Capital Flow Story] ${ctx.flows || 'No data'}`,
    `[News Events] ${ctx.news || 'No data'}`,
    `[Supply Chain Signals] ${ctx.supplyChain || 'No data'}`,
    `[Macro Context] ${ctx.macro || 'No data'}`,
    `[Institutional & Insider Signals] ${institutional || 'No data'}`,
    `[Sector Valuations & Returns] ${sectorPe || 'No data'}`,
    `[Short Squeeze & Options Flow] ${ctx.shorts || 'No data'}`,
    '',
    '## Theme extraction rules',
    'From the data above, identify 2-4 specific hot investment themes currently driving markets.',
    'Examples of good themes (name actual sector/tech/industry): "AI 반도체", "광통신", "전력 인프라", "바이오텍", "방산", "에너지", "핀테크", "클라우드".',
    'Do NOT write generic phrases like "테크", "성장주", "위험자산". Must be specific sub-sector or technology.',
    'Derive themes from the actual news/flows/institutional data provided, not from training data.',
    '',
    'Respond in pure JSON:',
    `{"why":"[≤100 chars in ${TARGET_LANG}]","watch":"[≤80 chars in ${TARGET_LANG}]","story":"[≤200 chars in ${TARGET_LANG}]","hotThemes":["specific theme 1","specific theme 2","specific theme 3"],"sessionNote":"[≤60 chars in ${TARGET_LANG}]"}`,
    // [Fix P3] Force 'why' to cite at least one concrete data point (not vague generic text)
    '## why field rules (MANDATORY)',
    '- why MUST cite at least one specific data point: a named metric, percentage, index level, interest rate, or named market event.',
    '- GOOD why: "S&P500 PER 22x 고평가 → 섹터로테이션, 10Y 국채 4.3% 하락 기대로 성장주 매수"',
    '- BAD why: "전환기의 투자 유입 증가" (too vague — no numbers, no named metrics, no events)',
    '- If no specific data point exists in context, write exactly: N/A',
    '- hotThemes: array of 2-4 strings, each ≤15 chars, in ${TARGET_LANG}, specific sector/technology names only.',
    'Pure JSON only.',
  ].join('\n');
}

function buildRiskMgmtPrompt(portfolio, riskLevel, bbWarnings, vix) {
  const positions = (portfolio ?? []).map(p =>
    `${p.ticker}(${p.allocation}%): entry=${p.entryZone} stop=${p.stopLoss} action=${p.action}`
  ).join('\n');
  return [
    `You are a risk manager. Write in ${TARGET_LANG}.`,
    '',
    `[Portfolio Positions]\n${positions}`,
    `[Overall Risk Level] ${riskLevel || 'medium'}`,
    `[BB Overextension] ${bbWarnings || 'None'}`,
    `[VIX] ${vix || 'No data'}`,
    '',
    'Respond in pure JSON:',
    `{"stopLossRationale":[{"ticker":"NVDA","rationale":"[≤60 chars in ${TARGET_LANG}]"}],"hedgingSuggestion":"[≤80 chars in ${TARGET_LANG}]","portfolioRiskNote":"[≤100 chars in ${TARGET_LANG}]"}`,
    'Pure JSON only.',
  ].join('\n');
}

function buildCompanyChangesPrompt(portfolioItems, earnings, institutional, news, financials) {
  const portfolioRef = portfolioItems.map(p => p.ticker).join(', ');
  return [
    `You are a corporate analyst. Date: ${TODAY}. Write keyChange in ${TARGET_LANG}.`,
    '',
    `Portfolio (reference only): ${portfolioRef}`,
    '',
    `[Recent Financials] ${financials || 'No data'}`,
    `[Upcoming/Recent Earnings] ${earnings || 'None'}`,
    `[Institutional Changes] ${institutional || 'None'}`,
    `[News & Events] ${news || 'None'}`,
    '',
    'RULES:',
    '- Select ONLY 5-10 companies with the most NOTABLE recent changes from ALL context data above.',
    '- Include ANY company mentioned in context (NOT limited to portfolio tickers) if it has material news.',
    '- "Notable change" means: earnings beat/miss, guidance revision, institutional large buy/sell, M&A, product launch, regulatory event.',
    '- SKIP companies with no material recent update — do NOT pad with tickers that have no news.',
    '- revenueYoY: use actual number from [Recent Financials]. Use null if missing (NEVER invent).',
    '- keyChange: write a specific, data-driven sentence ≤60 chars — include actual numbers when available.',
    '',
    'Respond in pure JSON:',
    `{"companyChanges":[{"ticker":"[ACTUAL_TICKER]","name":"[Company Name]","revenueYoY":null,"latestQuarter":"[Q# FYYYY]","keyChange":"[${TARGET_LANG}: specific change with data ≤60 chars]","guidance":"raised|maintained|lowered|unknown","sentiment":"positive|neutral|negative"}]}`,
    'Pure JSON only.',
  ].join('\n');
}

function buildStockDetailPrompt(buyStocks, institutional, shorts, earnings, sectorPe, news, technicalData = new Map(), financials = '') {
  const stockList = buyStocks.map(s => {
    const tech = technicalData.get(s.ticker);
    const techStr = tech ? ` [COMPUTED_TECH: ${tech}]` : '';
    return `- ${s.ticker}(${s.name}, ${s.sector}): entry=${s.entryZone}, target=${s.target}, rationale="${s.rationale}"${techStr}`;
  }).join('\n');
  return [
    `You are an equity research analyst. Date: ${TODAY}. Write ALL text in ${TARGET_LANG}.`,
    '',
    `Focus ONLY on these BUY-recommended stocks:\n${stockList}`,
    '',
    `[Institutional & Insider Signals] ${institutional || 'None'}`,
    `[Short Squeeze Candidates] ${shorts || 'None'}`,
    `[Upcoming / Recent Earnings] ${earnings || 'None'}`,
    `[Sector Valuations] ${sectorPe || 'No data'}`,
    `[Recent Company Financials (revenue YoY, operating margin)] ${financials || 'None'}`,
    `[Recent News] ${news || 'None'}`,
    '',
    'For EACH stock, provide:',
    '- catalysts: 2-3 SPECIFIC near-term catalysts with numbers — MUST be company events or fundamental data (earnings beat/guidance raise, product launch, institutional 13F buying count, analyst upgrade, M&A announcement, margin expansion). PROHIBITED: RSI, MA levels, volume %, 52-week range, technical chart patterns — these are NOT catalysts.',
    `- fundamentalBasis: ≤120 chars — use [Recent Company Financials] data; EPS/revenue growth%, operating margin, PE/PEG, institutional`,
    `- technicalBasis: ≤80 chars — MUST use [COMPUTED_TECH] values verbatim if provided; otherwise estimate MA/RSI/volume`,
    '- riskNote: ≤60 chars — single biggest downside risk',
    '',
    '⚠️ ANTI-COPY RULES (violations will corrupt the report):',
    '- NEVER copy example values — every ticker needs UNIQUE catalysts/riskNote drawn from its own context data',
    '- catalysts must cite THIS ticker\'s actual product/event/financial data (NOT generic sector commentary)',
    '- riskNote must name THIS ticker\'s specific risk (NOT a generic industry risk reused across tickers)',
    '- If two tickers end up with identical catalysts or riskNote, you made an error — revise',
    // [Fix P1] Per-ticker catalyst uniqueness: squeeze score and insider data must be ticker-specific
    '- If Short Squeeze is cited as a catalyst, use the ACTUAL squeeze score from [Short Squeeze Candidates] for THAT specific ticker (NOT a shared fallback value). If the ticker is NOT listed there, do NOT mention squeeze at all.',
    '- If Insider Buying is cited as a catalyst, reference the actual insider count or dollar amount from [Institutional & Insider Signals] for THAT ticker only. If no data exists for that ticker, do NOT include Insider Buying as a catalyst.',
    '- Cross-check all tickers before responding: each ticker must have at least 2 catalysts that differ completely from every other ticker. Same catalyst text across tickers is an error.',
    '',
    'Respond in pure JSON (replace ALL placeholders with real data from context):',
    `{"stockDetails":[{"ticker":"[TICKER_1]","catalysts":["[company-specific event+number]","[second event]","[third]"],"fundamentalBasis":"[YoY%, margin%, P/E or PEG]","technicalBasis":"[MA status, RSI, vol]","riskNote":"[TICKER_1-unique risk ≤60 chars]"},{"ticker":"[TICKER_2]","catalysts":["[DIFFERENT event for TICKER_2]","..."],"fundamentalBasis":"...","technicalBasis":"...","riskNote":"[TICKER_2-unique risk]"}]}`,
    'Include ALL buy tickers. Pure JSON only.',
  ].join('\n');
}

function buildCritiquePrompt(portfolio, macroAnalysis, bbWarnings, assetFg) {
  const summary = portfolio.map(p =>
    `${p.ticker}(${p.action}) alloc=${p.allocation}% entry=${p.entryZone} target=${p.target} stop=${p.stopLoss ?? 'none'}: ${p.rationale}`
  ).join('\n');
  return [
    `You are a strict risk manager reviewing a portfolio. Write in ${TARGET_LANG}.`,
    '',
    `[Draft Portfolio]\n${summary}`,
    '',
    `[Macro Context] ${macroAnalysis || 'No data'}`,
    `[Overextension Signals] ${bbWarnings || 'None'}`,
    `[Asset Fear&Greed] ${assetFg || 'No data'}`,
    '',
    'For EACH ticker, assign one verdict and a specific correction:',
    'REVISE: fundamental problem — change action buy→watch/hold (overextended, macro headwind, concentration risk)',
    'WARN: target too optimistic, stop too loose, entry zone off, or allocation too high — adjust numbers',
    'OK: position is well-structured and defensible',
    '',
    'Rules: at least 30% of positions should get WARN or REVISE if any have RSI>70, allocation>20%, or target>20% above entry.',
    'Include specific numbers in corrections (e.g., "target too high, suggest $X", "cut alloc to Y%").',
    '',
    'Respond in pure JSON only:',
    `{"critiques":[{"ticker":"NVDA","verdict":"WARN","correction":"[≤80 chars in ${TARGET_LANG} with specific numbers]"}]}`,
  ].join('\n');
}

function applyCritique(portfolio, critiqueRaw) {
  try {
    const m = critiqueRaw.match(/\{[\s\S]*\}/);
    if (!m) return portfolio;
    const parsed = JSON.parse(m[0]);
    const critiques = parsed.critiques ?? [];
    if (!critiques.length) return portfolio;

    // Log all non-OK verdicts for visibility
    const flagged = critiques.filter(c => c.verdict !== 'OK');
    if (flagged.length > 0) {
      for (const f of flagged) console.log(`    ${f.verdict} ${f.ticker}: ${f.correction}`);
    }

    // When multiple entries exist per ticker, pick highest severity (REVISE > WARN > OK)
    const severity = v => v === 'REVISE' ? 2 : v === 'WARN' ? 1 : 0;
    const bestCritique = new Map();
    for (const c of critiques) {
      if (!c.ticker) continue;
      const ex = bestCritique.get(c.ticker);
      if (!ex || severity(c.verdict) > severity(ex.verdict)) bestCritique.set(c.ticker, c);
    }

    const result = portfolio.map(p => {
      const c = bestCritique.get(p.ticker);
      if (!c || c.verdict === 'OK') return p;
      const corr = c.correction ?? '';
      const updated = { ...p, critiqueNote: corr.slice(0, 80) };

      if (c.verdict === 'REVISE') {
        // Check if correction suggests downgrade to watch/hold
        const shouldWatch = /watch|hold|avoid|wait|진입금지|관망|대기|관찰|보류|철회|매수 취소|취소|overextended|overbought|매도|비중 축소|줄이기|오버확장|집중 매매|조정 및 매도|전환/.test(corr.toLowerCase());
        if (shouldWatch) updated.action = 'watch';
      }

      if (c.verdict === 'WARN') {
        // [Fix P4] Parse allocation target from critique notes
        // Pattern A: arrow pattern e.g. '21%->10%' or '26%=>10%'
        const arrowMatch = corr.match(/(\d+)%\s*[-=]?>+\s*(\d+)%/);
        // Pattern B: Korean/English reduction e.g. 'cut alloc to 10%' or '26%로 조정'
        const cutMatch = corr.match(/(?:cut|reduce|lower|낙|줄|조정).{0,20}?(\d+)%/i);
        const allocTarget = arrowMatch ? parseInt(arrowMatch[2], 10) : cutMatch ? parseInt(cutMatch[1], 10) : null;
        if (allocTarget !== null && allocTarget > 0 && allocTarget < p.allocation) {
          console.log(`    allocation adjusted: ticker=${p.ticker} old=${p.allocation}% new=${allocTarget}%`);
          updated.allocation = allocTarget;
        }
      }

      // Parse target price adjustment from critiqueNote (e.g. "₩270,000으로 조정" or "adjust target to $420")
      // Only apply if critique suggests LOWER target (overbought/overvalued) — don't let critique raise target
      {
        const priceMatch = corr.match(/[₩$]([\d,]+)\s*(?:으로|로)?\s*조정|adjust.*?target.*?[₩$]([\d,]+)/i);
        const rawNum = priceMatch?.[1] ?? priceMatch?.[2];
        if (rawNum) {
          const suggested = parseFloat(rawNum.replace(/,/g, ''));
          const existingNums = (updated.target ?? '').replace(/[₩$,\s]/g, '').match(/[\d.]+/g)?.map(Number).filter(n => n > 0) ?? [];
          const existingTarget = existingNums.length ? Math.max(...existingNums) : 0;
          // Only lower the target, never raise it via critique
          if (suggested > 0 && existingTarget > 0 && suggested < existingTarget) {
            const isKRTicker = (updated.ticker ?? '').endsWith('.KS');
            updated.target = isKRTicker ? `₩${Math.round(suggested).toLocaleString()}` : `$${suggested.toFixed(2)}`;
            console.log(`    target adjusted by critique: ${p.ticker} ${existingTarget} → ${suggested}`);
          }
        }
      }

      return updated;
    });

    // [Fix P4] Re-normalize allocations to sum to 100% after critique adjustments
    const adjTotal = result.reduce((s, p) => s + (p.allocation ?? 0), 0);
    if (adjTotal > 0 && Math.abs(adjTotal - 100) > 1) {
      const normalized = result.map(p => ({ ...p, allocation: Math.round((p.allocation ?? 0) / adjTotal * 100) }));
      const diff = 100 - normalized.reduce((s, p) => s + p.allocation, 0);
      if (diff !== 0 && normalized.length) normalized[0].allocation += diff;
      return normalized;
    }
    return result;
  } catch { return portfolio; }
}

// LLM sometimes writes full company name as ticker (NVIDIA instead of NVDA).
const TICKER_ALIASES = new Map([
  ['NVIDIA', 'NVDA'], ['ALPHABET', 'GOOGL'], ['GOOGLE', 'GOOGL'],
  ['METAPLATFORMS', 'META'], ['AMAZON', 'AMZN'], ['APPLE', 'AAPL'],
  ['MICROSOFT', 'MSFT'], ['TESLA', 'TSLA'], ['SAMSUNG', '005930.KS'],
  ['SAMSUNGELECTRONICS', '005930.KS'], ['SKHYNIX', '000660.KS'],
  ['HYUNDAI', '005380.KS'],
]);

// ── 포트폴리오 후처리 ────────────────────────────────────────────────────────────
function postProcessPortfolio(portfolio) {
  if (!Array.isArray(portfolio)) return [];
  const KR_NUM = /^\d{6}$/;
  let items = portfolio.map(p => {
    let ticker = (p.ticker ?? '').trim();
    if (KR_NUM.test(ticker)) ticker = `${ticker}.KS`;
    // Normalize alias: NVIDIA→NVDA, ALPHABET→GOOGL, etc.
    const aliasKey = ticker.toUpperCase().replace(/[\s.]/g, '');
    ticker = TICKER_ALIASES.get(aliasKey) ?? ticker;
    const action = p.action && ['buy','watch','hold'].includes(p.action) ? p.action : 'buy';
    return { ...p, ticker, action };
  }).filter(p => {
    const k = (p.ticker ?? '').toUpperCase();
    return k && !INDEX_TICKERS.has(k);
  });

  const dedupMap = new Map();
  for (const p of items) {
    const k = p.ticker.toUpperCase();
    const ex = dedupMap.get(k);
    if (!ex || (p.allocation ?? 0) > (ex.allocation ?? 0)) {
      if (ex) console.warn(`  ⚠️  ticker alias dedup: "${ex.ticker}" merged into "${p.ticker}"`);
      dedupMap.set(k, p);
    }
  }
  items = Array.from(dedupMap.values());

  const total = items.reduce((s, p) => s + (p.allocation ?? 0), 0);
  if (total > 0 && Math.abs(total - 100) > 2) {
    items = items.map(p => ({ ...p, allocation: Math.round((p.allocation ?? 0) / total * 100) }));
    const diff = 100 - items.reduce((s, p) => s + p.allocation, 0);
    if (diff !== 0 && items.length) items[0].allocation += diff;
  }
  return items;
}

// Fix 2: cross-ticker catalyst dedup — if the same catalyst text appears for multiple
// tickers (LLM copy-pasted insider/squeeze data), remove it from all but the first.
function dedupCrossTickerCatalysts(items) {
  const usedCatalysts = new Set();
  let removed = 0;
  const result = items.map(p => ({
    ...p,
    catalysts: (p.catalysts ?? []).filter(c => {
      if (!c || typeof c !== 'string') return false;
      const key = c.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60);
      if (usedCatalysts.has(key)) { removed++; return false; }
      usedCatalysts.add(key);
      return true;
    }),
  }));
  if (removed > 0) console.warn(`  ⚠️  cross-ticker catalyst dedup: ${removed}개 중복 제거됨`);
  return result;
}

// ── Step 1: 다단계 Ollama 생성 ─────────────────────────────────────────────────
async function refreshAllData() {
  const cronSecret = env.CRON_SECRET?.trim();
  if (!cronSecret) {
    console.log('  ⚠️  CRON_SECRET 없음 — 데이터 갱신 건너뜀 (캐시 그대로 사용)');
    return;
  }
  console.log('  update-all 호출 중...');
  try {
    const res = await fetch(`${SITE}/api/cron/update-all`, {
      headers: { 'Authorization': `Bearer ${cronSecret}`, 'Cache-Control': 'no-store' },
      signal: AbortSignal.timeout(65000),
    });
    if (res.ok) {
      const d = await res.json();
      const ok = d.results?.filter(r => r.ok).length ?? '?';
      const total = d.results?.length ?? '?';
      console.log(`  ✅ update-all 완료 (${ok}/${total} API 갱신)`);
    } else {
      console.log(`  ⚠️  update-all ${res.status} — 캐시 그대로 사용`);
    }
  } catch (e) {
    console.log(`  ⚠️  update-all 타임아웃/실패 (${e.message}) — 캐시 그대로 사용`);
  }
}

async function generateViaOllama() {
  const session = getSession();
  console.log(`\n=== 로컬 Ollama 보고서 생성 (${modelArg}) ===`);
  console.log(`locale: ${localeArg} (${TARGET_LANG}), session: ${session}, auto-upload: ${autoUpload}`);

  // ── [0/7] 데이터 최신화 ──────────────────────────────────────────────────────
  console.log('\n[0/7] 데이터 최신화 (update-all)...');
  await refreshAllData();

  // ── [1/7] 데이터 수집 ────────────────────────────────────────────────────────
  console.log('\n[1/7] 컨텍스트 데이터 수집 (16개 API 병렬)...');
  const [ctxRaw, livePrices, sectorPe, earnings] = await Promise.all([
    gatherContext(),
    getLivePrices(),
    getSectorSummary(),
    getUpcomingEarnings(),
  ]);
  const ctx = buildCtxSummary(ctxRaw);
  const priceData = pricesSection(livePrices);
  const cascadeStr = await getActiveCascadeSignals(livePrices);
  const cascadeBlock = cascadeStr
    ? `\n[CASCADE PATTERNS — must-consider for portfolio selection]\n` +
      `(L=leader, → 표시는 일반적 전파 순서. 🔥ACTIVE 는 1d ≥3% 임펄스 감지)\n${cascadeStr}`
    : '';
  const ctxWithCascade = {
    ...ctx,
    flows: ctx.flows + cascadeBlock,
    news: ctx.news + cascadeBlock,
  };

  // ── 데이터 수집 요약 ─────────────────────────────────────────────────────────
  const ctxNullCheck = {
    capital: !ctxRaw.capital,
    fearGreed: !ctxRaw.fearGreed,
    fedWatch: !ctxRaw.fedWatch,
    macro: !ctxRaw.macro,
    insider: !(ctxRaw.insider?.length),
    ownership: !(ctxRaw.ownership?.length),
    koreaFlow: !ctxRaw.koreaFlow,
    nport: !ctxRaw.nport,
    shortInterest: !ctxRaw.short,
    cascade: !(ctxRaw.cascade?.length),
    econCal: !ctxRaw.econCal,
    volatility: !ctxRaw.volatility,
    cot: !ctxRaw.cot,
    commodity: !ctxRaw.commodity,
  };
  const nullApis = Object.entries(ctxNullCheck).filter(([, v]) => v).map(([k]) => k);
  if (nullApis.length) console.warn(`  ⚠️  API null (${nullApis.length}개): ${nullApis.join(', ')}`);
  else console.log('  ✅ 모든 API 응답 수신');
  console.log(`  cascade 기사: ${ctxRaw.cascade?.length ?? 0}개, insider: ${ctxRaw.insider?.length ?? 0}건`);
  console.log(`  macro=${ctx.macro.length}c, sentiment=${ctx.sentiment.length}c, flows=${ctx.flows.length}c`);
  console.log(`  news=${ctx.news.length}c (preview: ${ctx.news.slice(0, 100).replace(/\n/g, ' ')})`);
  console.log(`  institutional=${ctx.institutional.length}c, shorts=${ctx.shorts.length}c`);
  console.log(`  prices=${livePrices.size} tickers, sectorPe=${sectorPe.length}c, earnings=${earnings.length}c`);

  // ── [2/7] Wave 1: 5섹션 병렬 ─────────────────────────────────────────────────
  console.log('\n[2/7] Wave1 — 5개 병렬 Ollama 호출 (macro/portfolio/regional/opportunity/narrative)...');
  const wave1Start = Date.now();
  const [macroRaw, portfolioRaw, regionalRaw, opportunityRaw, narrativeRaw] = await Promise.all([
    callOllama(buildMacroPrompt(ctxWithCascade, ctx.vixCtx, session), modelArg, 360000, 'macro'),
    callOllama(buildPortfolioPrompt(ctxWithCascade, sectorPe, earnings, priceData), modelArg, 360000, 'portfolio'),
    callOllama(buildRegionalPrompt(ctxWithCascade), modelArg, 360000, 'regional'),
    callOllama(buildOpportunityPrompt(ctxWithCascade), modelArg, 360000, 'opportunity'),
    callOllama(buildNarrativePrompt(ctxWithCascade, session, sectorPe, ctxWithCascade.institutional), modelArg, 360000, 'narrative'),
  ]);
  console.log(`  Wave1 총 소요: ${((Date.now() - wave1Start) / 1000).toFixed(1)}s`);

  let macroData        = parseJson(macroRaw, 'macro');
  let portfolioData  = parseJson(portfolioRaw, 'portfolio');
  let regionalData     = parseJson(regionalRaw, 'regional');
  const opportunityData = parseJson(opportunityRaw, 'opportunity');
  const narrativeData  = parseJson(narrativeRaw, 'narrative');

  // narrative 결과 로그
  if (narrativeData) {
    const themes = Array.isArray(narrativeData.hotThemes) ? narrativeData.hotThemes.join(', ') : '없음';
    console.log(`  [narrative] why="${(narrativeData.why ?? '').slice(0, 60)}" hotThemes=[${themes}]`);
  }

  // Retry failed wave1 calls once
  const retryNeeded = [];
  if (!macroData)    retryNeeded.push('macro');
  if (!regionalData) retryNeeded.push('regional');
  if (retryNeeded.length > 0) {
    console.log(`  parse failed [${retryNeeded.join(', ')}] — retrying...`);
    const retries = await Promise.all([
      !macroData    ? callOllama(buildMacroPrompt(ctxWithCascade, ctx.vixCtx, session), modelArg, 360000, 'macro-retry')    : Promise.resolve(null),
      !regionalData ? callOllama(buildRegionalPrompt(ctxWithCascade), modelArg, 360000, 'regional-retry')                   : Promise.resolve(null),
    ]);
    if (!macroData    && retries[0]) macroData    = parseJson(retries[0], 'macro-retry');
    if (!regionalData && retries[1]) regionalData = parseJson(retries[1], 'regional-retry');
  }

  console.log(`  macro=${!!macroData}(riskLevel:${macroData?.riskLevel ?? 'N/A'}), portfolio=${!!portfolioData}(${portfolioData?.portfolio?.length ?? 0}개), regional=${!!regionalData}(${Object.keys(regionalData?.regionStances ?? {}).length}지역)`);
  console.log(`  opportunity=${!!opportunityData}(squeeze:${opportunityData?.shortSqueeze?.length ?? 0}), narrative=${!!narrativeData}`);

  // Portfolio retry — 5개 미만이면 재시도 (fatal)
  if ((portfolioData?.portfolio?.length ?? 0) < 5) {
    const gotCount = portfolioData?.portfolio?.length ?? 0;
    console.log(`  portfolio ${gotCount}개 (최소 5 미달) — retrying once...`);
    const portfolioRetry = await callOllama(buildPortfolioPrompt(ctxWithCascade, sectorPe, earnings, priceData), modelArg, 360000, 'portfolio-retry');
    const portfolioRetryData = parseJson(portfolioRetry, 'portfolio-retry');
    if ((portfolioRetryData?.portfolio?.length ?? 0) < 3) {
      console.error('❌ Wave1 포트폴리오 생성 실패 (2회). 종료합니다.');
      process.exit(1);
    }
    portfolioData = portfolioRetryData;
  }

  // ── [3/7] Wave 2: 3섹션 병렬 ─────────────────────────────────────────────────
  console.log('\n[3/7] Wave2 — 리스크/기업변화/종목상세 병렬 호출...');
  // 현재가와 동떨어진 entryZone/stopLoss/target 보정 (LLM 환각 방지)
  const rawPortfolio = portfolioData.portfolio ?? [];
  const postProcessed = postProcessPortfolio(rawPortfolio);
  // Log alias normalization results
  {
    const before = rawPortfolio.map(p => p.ticker ?? '');
    const after  = postProcessed.map(p => p.ticker ?? '');
    const aliased = before.filter((t, i) => t !== after[i]);
    if (aliased.length) console.log(`  [postProcess] alias 정규화: ${aliased.map((t, i) => `${t}→${after[before.indexOf(t)]}`).join(', ')}`);
    const removed = before.filter(t => !after.includes(t) && !aliased.includes(t));
    if (removed.length) console.log(`  [postProcess] 필터 제거 (인덱스/빈값): ${removed.join(', ')}`);
    console.log(`  [postProcess] 포트폴리오: ${rawPortfolio.length}개 → ${postProcessed.length}개`);
  }
  // Two-pass skeleton-fill: LLM 이 entryPlan 만 출력 → 시스템이 livePrice 로 entry/stop/target 계산 (1차 방어선)
  const planComputed = computePricesFromPlan(postProcessed, livePrices);
  {
    const planned = planComputed.filter(p => p._entryAnchor);
    if (planned.length) {
      console.log(`  [computePricesFromPlan] ${planned.length}/${planComputed.length} 종목 plan 적용: ${planned.map(p => `${p.ticker}(${p._entryAnchor})`).join(', ')}`);
    } else {
      console.log(`  [computePricesFromPlan] entryPlan 없음 — 구버전 path (validateEntryZones 만으로 보정)`);
    }
  }
  // _entryAnchor 메타필드 제거 (보고서에 노출 안 함)
  for (const p of planComputed) delete p._entryAnchor;
  const portfolioItems = validateEntryZones(planComputed, livePrices);
  // Log entryZone clamping results
  {
    const clamped = portfolioItems.filter((p, i) => p.entryZone !== postProcessed[i]?.entryZone);
    if (clamped.length) console.log(`  [validateEntryZones] 보정: ${clamped.map(p => `${p.ticker}(${p.entryZone})`).join(', ')}`);
    else console.log(`  [validateEntryZones] 보정 없음 (${portfolioItems.length}개 그대로)`);
  }
  const buyStocks = portfolioItems
    .filter(p => p.action === 'buy')
    .map(p => ({ ticker: p.ticker, name: p.name ?? p.ticker, sector: p.sector ?? '', rationale: p.rationale ?? '', entryZone: p.entryZone ?? '', target: p.target ?? '' }));
  const watchStocksEarly = portfolioItems.filter(p => p.action === 'watch').map(p => p.ticker);
  if (watchStocksEarly.length) console.log(`  [포트폴리오] watch 종목(초기): ${watchStocksEarly.join(', ')}`);
  console.log(`  buy=${buyStocks.length}개: ${buyStocks.map(s => s.ticker).join(', ')}`);

  const portfolioForFinancials = portfolioItems.map(p => p.ticker);
  // 재무 데이터 + OHLCV 기술 지표 병렬 수집
  const [companyFinancials, technicalData] = await Promise.all([
    getCompanyFinancials(portfolioForFinancials),
    buildTechnicalData(buyStocks.map(s => s.ticker), livePrices),
  ]);
  if (technicalData.size > 0) {
    console.log(`  기술지표 계산 완료: ${[...technicalData.entries()].map(([t, v]) => `${t}(${v})`).join(', ')}`);
  }

  // ── 후처리: 신호 digest 빌드 + rationale 중복 제거 ─────────────────────────
  const signalDigest = buildSignalDigest(ctxRaw, technicalData, companyFinancials);
  const portfolioItemsDeduped = deduplicateRationales(portfolioItems, signalDigest);
  // buyStocks도 deduplicated rationale로 갱신
  const buyStocksDeduped = portfolioItemsDeduped
    .filter(p => p.action === 'buy')
    .map(p => ({ ticker: p.ticker, name: p.name ?? p.ticker, sector: p.sector ?? '', rationale: p.rationale ?? '', entryZone: p.entryZone ?? '', target: p.target ?? '' }));

  const wave2Start = Date.now();
  const wave2Calls = [
    callOllama(buildRiskMgmtPrompt(portfolioItemsDeduped, macroData?.riskLevel ?? 'medium', ctx.bbWarnings, ctx.vixCtx), modelArg, 360000, 'risk'),
    callOllama(buildCompanyChangesPrompt(portfolioItemsDeduped, earnings, ctx.institutional, ctx.news, companyFinancials), modelArg, 360000, 'companyChanges'),
  ];
  if (buyStocksDeduped.length > 0) {
    wave2Calls.push(callOllama(buildStockDetailPrompt(buyStocksDeduped, ctx.institutional, ctx.shorts, earnings, sectorPe, ctx.news, technicalData, companyFinancials), modelArg, 360000, 'stockDetail'));
  }

  const [riskRaw, companyChangesRaw, stockDetailRaw] = await Promise.all(wave2Calls);
  console.log(`  Wave2 총 소요: ${((Date.now() - wave2Start) / 1000).toFixed(1)}s`);
  const riskData = parseJson(riskRaw, 'risk');
  const companyChangesData = parseJson(companyChangesRaw, 'companyChanges');

  const stockDetailMap = new Map();
  if (stockDetailRaw) {
    const sd = parseJson(stockDetailRaw, 'stockDetail');
    if (Array.isArray(sd?.stockDetails)) {
      for (const d of sd.stockDetails) {
        if (d.ticker) stockDetailMap.set(d.ticker.toUpperCase(), d);
      }
    }
  }
  console.log(`  stockDetail 파싱: ${stockDetailMap.size}개 종목 (${[...stockDetailMap.keys()].join(', ')})`);
  // ── 후처리: catalysts/riskNote 중복 감지 ──────────────────────────────────────
  if (stockDetailMap.size > 1) {
    const riskNotes = new Map(); const catalystSets = new Map();
    for (const [tk, d] of stockDetailMap) {
      if (d.riskNote) { const key = d.riskNote.trim().toLowerCase(); riskNotes.set(key, (riskNotes.get(key) ?? []).concat(tk)); }
      if (Array.isArray(d.catalysts)) { const key = d.catalysts.join('|').toLowerCase(); catalystSets.set(key, (catalystSets.get(key) ?? []).concat(tk)); }
    }
    for (const [note, tks] of riskNotes) if (tks.length > 1) console.warn(`  ⚠️  riskNote 중복 (${tks.join('+')}): "${note.slice(0,50)}"`);
    for (const [cats, tks] of catalystSets) if (tks.length > 1) console.warn(`  ⚠️  catalysts 중복 (${tks.join('+')}): "${cats.slice(0,60)}"`);
  }
  console.log(`  risk=${!!riskData}, companyChanges=${companyChangesData?.companyChanges?.length ?? 0}개, stockDetail=${stockDetailMap.size}개`);

  // ── [4/7] Critique ──────────────────────────────────────────────────────────
  console.log('\n[4/7] Critique — 포트폴리오 자기비판...');
  let refinedPortfolio = portfolioItemsDeduped;
  try {
    const critiqueRaw = await callOllama(buildCritiquePrompt(
      portfolioItemsDeduped,
      macroData?.macroAnalysis ?? '',
      ctx.bbWarnings,
      ctx.assetFg,
    ), modelArg, 360000, 'critique');
    refinedPortfolio = applyCritique(portfolioItemsDeduped, critiqueRaw);
    // 종목별 critique 결과 상세 로그
    for (const p of refinedPortfolio) {
      const orig = portfolioItemsDeduped.find(o => o.ticker === p.ticker);
      const actionTag = p.action !== orig?.action ? `⚡${orig?.action}→${p.action}` : `=${p.action}`;
      const noteTag = p.critiqueNote ? ` NOTE:"${p.critiqueNote.slice(0, 50)}"` : '';
      console.log(`  [critique] ${p.ticker} ${actionTag}${noteTag}`);
    }
    const actionChanged = refinedPortfolio.filter((p, i) => p.action !== portfolioItemsDeduped[i]?.action).length;
    const flagged = refinedPortfolio.filter(p => p.critiqueNote).length;
    console.log(`  critique 요약: action변경 ${actionChanged}개, WARN/flag ${flagged}개`);
  } catch (e) { console.log(`  critique 실패 (non-fatal): ${e.message}`); }

  // ── [5/7] 병합 ──────────────────────────────────────────────────────────────
  console.log('\n[5/7] 섹션 병합...');
  const mergedPortfolio = refinedPortfolio.map(p => {
    const detail = stockDetailMap.get(p.ticker.toUpperCase());
    if (!detail) return p;
    return {
      ...p,
      catalysts: detail.catalysts?.length ? detail.catalysts : p.catalysts,
      fundamentalBasis: detail.fundamentalBasis || p.fundamentalBasis,
      technicalBasis: detail.technicalBasis || p.technicalBasis,
      riskNote: detail.riskNote || p.riskNote,
    };
  });

  // Log final portfolio before dedup
  console.log(`  [merge] mergedPortfolio: ${mergedPortfolio.length}개 — ${mergedPortfolio.map(p => `${p.ticker}(${p.action})`).join(', ')}`);
  const dedupedPortfolio = dedupCrossTickerCatalysts(mergedPortfolio);
  // Quality pre-flight
  {
    const { ok: qOk, issues: qIssues, warnings: qWarnings, score: qScore } = qualityCheck({ ...{}, portfolio: dedupedPortfolio, regionStances: regionalData?.regionStances ?? {}, shortSqueeze: opportunityData?.shortSqueeze ?? [], marketNarrative: narrativeData ?? {}, thesis: macroData?.thesis ?? '', macroAnalysis: macroData?.macroAnalysis ?? '', technicalAnalysis: macroData?.technicalAnalysis ?? '' });
    console.log(`  [quality pre-flight] score=${qScore}/100, issues=${qIssues.length}, warnings=${qWarnings?.length ?? 0}`);
    for (const w of qWarnings ?? []) console.warn(`    WARN: ${w}`);
    for (const e of qIssues) console.error(`    ERROR: ${e}`);
  }

  const now = new Date().toISOString();
  const finalReport = {
    stance: portfolioData.stance ?? 'neutral',
    thesis: macroData?.thesis ?? portfolioData.stance ?? 'neutral',
    portfolio: dedupedPortfolio,
    sectorAllocation: portfolioData.sectorAllocation ?? [],
    riskEvents: macroData?.riskEvents ?? [],
    macroAnalysis: macroData?.macroAnalysis ?? '',
    technicalAnalysis: macroData?.technicalAnalysis ?? '',
    fundamentalAnalysis: macroData?.fundamentalAnalysis ?? '',
    riskLevel: macroData?.riskLevel ?? 'medium',
    regionStances: regionalData?.regionStances ?? {},
    shortSqueeze: opportunityData?.shortSqueeze ?? [],
    insiderSignals: (opportunityData?.insiderSignals ?? []).filter(s => (s.filings ?? 0) > 0),
    topOpportunity: opportunityData?.topOpportunity ?? '',
    stopLossRationale: riskData?.stopLossRationale ?? [],
    hedgingSuggestion: riskData?.hedgingSuggestion ?? '',
    portfolioRiskNote: riskData?.portfolioRiskNote ?? '',
    marketNarrative: narrativeData ?? {},
    companyChanges: companyChangesData?.companyChanges ?? [],
    // S9: 공급망 변화 모니터링 (supply-chain-signals 데이터 직접 주입 — LLM 없이)
    supplyChainChanges: (ctxRaw.supplyChainSignals ?? [])
      .filter(s => s.conviction >= 45)
      .slice(0, 10)
      .map(s => ({
        ticker: s.ticker,
        direction: s.direction ?? 'neutral',
        headline: s.headline,
        source: s.source,
        conviction: s.conviction,
        downstreamBeneficiaries: s.downstreamBeneficiaries ?? [],
        upstreamRisks: s.upstreamRisks ?? [],
        evidenceUrl: s.evidenceUrl ?? null,
      })),
    generatedAt: now,
    dataAsOf: now,
    source: `local-${modelArg}`,
    locale: localeArg,
    session,
    schemaVersion: 8,
    buildId: 'local',
  };

  // ── 후처리: 품질 향상 파이프라인 ─────────────────────────────────────────────
  console.log('\n[5.5/7] 후처리 품질 향상...');
  finalReport.thesis = expandThesis(finalReport.thesis, macroData, ctxRaw, localeArg);
  finalReport.macroAnalysis = enrichMacroAnalysis(finalReport.macroAnalysis, ctxRaw, macroData, localeArg);
  finalReport.regionStances = fillMissingRegionStances(finalReport.regionStances, ctxRaw);
  finalReport.regionStances = normalizeRegionStances(finalReport.regionStances);
  finalReport.companyChanges = fillCompanyChangesYoY(finalReport.companyChanges, signalDigest);
  finalReport.portfolio = enrichRationales(finalReport.portfolio, signalDigest, localeArg);
  finalReport.stopLossRationale = enrichStopLoss(finalReport.stopLossRationale, livePrices, technicalData, localeArg);

  // 고점 덤핑 징후 탐지 — riskNote에 경고 주입
  const { risks: peakRisksMap, macroGlobalWarning } = await detectPeakDumpRisk(finalReport.portfolio, livePrices, ctxRaw);
  if (peakRisksMap.size > 0 || macroGlobalWarning) {
    if (peakRisksMap.size > 0) {
      const summary = [...peakRisksMap.entries()].map(([t, r]) => `${t}(score:${r.totalWeight})`).join(', ');
      console.log(`  [후처리] 덤핑 징후 탐지: ${summary}`);
    }
    if (macroGlobalWarning) console.log(`  [후처리] 거시 경고: ${macroGlobalWarning}`);
    finalReport.portfolio = finalReport.portfolio.map(p => {
      if (p.action !== 'buy') return p;
      const risk = peakRisksMap.get(p.ticker);
      const warnings = [];
      if (risk) {
        warnings.push(risk.summary);
        // mtfSummary는 riskNote 오염 방지를 위해 별도 필드에 저장
      }
      if (macroGlobalWarning) warnings.push(macroGlobalWarning);
      const updated = { ...p };
      // HIGH peak risk (score≥4, RSI>75) → force watch instead of buy
      if (risk && risk.totalWeight >= 4) {
        const rsiSignal = risk.signals.find(s => /RSI\s*\d+/.test(s.label));
        const rsiVal = rsiSignal ? parseInt(rsiSignal.label.match(/RSI\s*(\d+)/)?.[1] ?? '0', 10) : 0;
        if (rsiVal >= 75) {
          updated.action = 'watch';
          updated.critiqueNote = (updated.critiqueNote ? updated.critiqueNote + ' | ' : '') + `RSI ${rsiVal} 과매수 — 진입 대기`;
          console.log(`  [후처리] ${p.ticker} RSI ${rsiVal} 과매수 → buy→watch 전환`);
        }
      }
      if (!warnings.length) return updated;
      const warning = warnings.join(' | ');
      updated.riskNote = p.riskNote ? `${warning} | ${p.riskNote}` : warning;
      if (risk?.mtfSummary) updated.mtfNote = risk.mtfSummary; // 별도 필드
      return updated;
    });
  }
  const rawEarnings = await getRawEarnings();
  const squeezeBefore = finalReport.shortSqueeze.map(s => s.ticker);
  finalReport.shortSqueeze = await enrichSqueezePostEarnings(finalReport.shortSqueeze, rawEarnings, livePrices, localeArg);
  // topOpportunity가 제거된 ticker를 가리키면 비움
  const removedTickers = squeezeBefore.filter(t => !finalReport.shortSqueeze.find(s => s.ticker === t));
  if (removedTickers.some(t => (finalReport.topOpportunity ?? '').includes(t))) {
    const _isEn = !['ko', 'ja', 'zh-CN', 'zh-TW', 'zh'].includes(localeArg);
    finalReport.topOpportunity = finalReport.shortSqueeze[0]
      ? (_isEn ? `${finalReport.shortSqueeze[0].ticker} squeeze opportunity` : `${finalReport.shortSqueeze[0].ticker} squeeze 기회`)
      : '';
  }

  // ── [6/7] 품질 검사 + 저장 ──────────────────────────────────────────────────
  // 최종 포트폴리오 요약 — watch 종목 이유 포함
  const finalBuy   = finalReport.portfolio.filter(p => p.action === 'buy');
  const finalWatch = finalReport.portfolio.filter(p => p.action === 'watch');
  const finalHold  = finalReport.portfolio.filter(p => !['buy', 'watch'].includes(p.action ?? ''));
  console.log(`\n[포트폴리오 최종]`);
  console.log(`  BUY  (${finalBuy.length}): ${finalBuy.map(p => `${p.ticker}(${p.allocation}%)`).join(', ')}`);
  if (finalWatch.length) {
    console.log(`  WATCH(${finalWatch.length}):`);
    for (const p of finalWatch) {
      const reason = p.critiqueNote ?? p.riskNote ?? '이유 없음';
      console.log(`    - ${p.ticker}(${p.allocation}%) → ${reason.slice(0, 80)}`);
    }
  }
  if (finalHold.length) console.log(`  HOLD (${finalHold.length}): ${finalHold.map(p => p.ticker).join(', ')}`);

  console.log('\n[6/7] 품질 게이트 검사...');
  const { ok, issues, score } = qualityCheck(finalReport);
  // 항목별 체크 상세 출력
  const checks = [
    ['thesis',            !!(finalReport.thesis?.length > 20)],
    ['macroAnalysis',     !!(finalReport.macroAnalysis?.length > 30)],
    ['technicalAnalysis', !!(finalReport.technicalAnalysis?.length > 15)],
    ['portfolio(≥5)',     (finalReport.portfolio?.length ?? 0) >= 5],
    ['regionStances',     Object.keys(finalReport.regionStances ?? {}).length > 0],
    ['shortSqueeze',      (finalReport.shortSqueeze?.length ?? 0) > 0],
    ['insiderSignals',    (finalReport.insiderSignals?.length ?? 0) > 0],
    ['marketNarrative',   !!(finalReport.marketNarrative?.why)],
    ['hotThemes',         Array.isArray(finalReport.marketNarrative?.hotThemes) && finalReport.marketNarrative.hotThemes.length > 0],
    ['companyChanges',    (finalReport.companyChanges?.length ?? 0) > 0],
    ['stopLossRationale', (finalReport.stopLossRationale?.length ?? 0) > 0],
  ];
  for (const [name, pass] of checks) {
    console.log(`  ${pass ? '✅' : '❌'} ${name}`);
  }
  console.log(`  품질 점수: ${score}/100 ${ok ? '✅ 통과' : '❌ 실패'}`);
  if (issues.length) {
    console.log('  ⚠️  추가 문제:');
    for (const i of issues) console.log(`    - ${i}`);
  }

  // ── Harness: 저장 직전 결함 자동 교정 (route.ts schema 와 동일 규칙) ──
  // audit 결과를 finalReport.harnessAudit 에 보존 — 업로드 후 /admin/logs 추적 가능.
  // livePrices 를 전달해 entryFar50MA 가 시장가 기반으로 재계산할 수 있게 함.
  finalReport.harnessAudit = applyLocalHarness(finalReport, livePrices);
  // 2차 클램프: harness 가 zone 을 덮어쓴 경우 다시 시장가 기준으로 보정 (도달 불가 zone 방지).
  finalReport.portfolio = validateEntryZones(finalReport.portfolio, livePrices);

  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
  const kstDate = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const filename = `report-${kstDate}-${session}-${localeArg}.json`;
  const filepath = resolve(REPORTS_DIR, filename);
  writeFileSync(filepath, JSON.stringify(finalReport, null, 2), 'utf8');

  // ── 로컬 SQLite 적재 (data/flowvium.db) — 보고서 + 추천 + 엔드포인트 스냅샷 ──
  // 전향적 추천 평가의 컨텍스트로 사용. 실패해도 보고서 저장 자체는 영향 없음.
  try {
    finalReport.generatedAt = finalReport.generatedAt ?? new Date().toISOString();
    finalReport.session = finalReport.session ?? session;
    finalReport.locale = finalReport.locale ?? localeArg;
    // price_at_gen 적재: portfolio 에 currentPrice 주입 (saveRecommendations 에서 사용)
    for (const p of finalReport.portfolio) {
      if (!p.currentPrice) p.currentPrice = livePrices.get(p.ticker)?.price ?? null;
    }
    const reportId = saveReport(finalReport);
    const recCount = saveRecommendations(finalReport, reportId);
    console.log(`\n[db] 📦 SQLite 적재: report=${reportId} recommendations=${recCount}`);
    console.log(`[db] 엔드포인트 스냅샷 fetch 시작 (${20}개)...`);
    const snapStart = Date.now();
    const snapResults = await snapshotAllEndpoints(reportId);
    const okCount = snapResults.filter(r => r.ok).length;
    console.log(`[db] ✅ 스냅샷 완료: ${okCount}/${snapResults.length} ok, ${Date.now() - snapStart}ms`);
    const failed = snapResults.filter(r => !r.ok).map(r => r.endpoint);
    if (failed.length) console.log(`[db] ⚠️  실패: ${failed.join(', ')}`);
  } catch (dbErr) {
    console.warn(`[db] ⚠️  SQLite 적재 실패: ${String(dbErr).slice(0, 150)}`);
  }

  console.log(`\n=== 저장 완료 ===`);
  console.log(`파일: reports/${filename}`);
  console.log(`stance: ${finalReport.stance}`);
  console.log(`thesis: ${finalReport.thesis}`);
  console.log(`macro: ${finalReport.macroAnalysis?.slice(0, 80)}`);
  console.log(`portfolio: ${finalReport.portfolio?.map(p => `${p.ticker}(${p.allocation}%)`).join(' ')}`);
  console.log(`sections: portfolio=${finalReport.portfolio?.length}, regionStances=${Object.keys(finalReport.regionStances ?? {}).length}, shortSqueeze=${finalReport.shortSqueeze?.length}, companyChanges=${finalReport.companyChanges?.length}`);

  if (!ok) {
    console.log('\n❌ 품질 불합격 — 자동 업로드 건너뜀.');
    console.log(`   파일을 검토 후: node scripts/generate-report-local.mjs --upload=reports/${filename}`);
    return;
  }

  if (autoUpload) {
    console.log('\n--auto-upload 설정됨, 품질 통과 → 업로드 진행...');
    await uploadFromFile(filepath);
  } else {
    console.log('\n✅ 생성 완료. 내용 확인 후 업로드:');
    console.log(`   node scripts/generate-report-local.mjs --upload=reports/${filename}`);
    console.log(`   또는 최신 파일: node scripts/generate-report-local.mjs --upload=latest`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
if (uploadArg) {
  uploadFromFile(uploadArg).catch(console.error);
} else {
  generateViaOllama().catch(console.error);
}
