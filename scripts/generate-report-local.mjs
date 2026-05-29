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
import { saveReport, saveRecommendations, saveSellRecommendations, saveNewsArchive, saveMacroSnapshot, saveDomainArchives, saveFearGreedArchive, getEntryFeedbackStats } from './lib/db.mjs';
import Database from 'better-sqlite3';  // 2026-05-28: F19 getRecentQualityFeedback 의 ESM require fail fix.
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

// data/candidate-tickers.json 동적 로드 (build-candidate-tickers.mjs 생성).
// titan(5) + mega(106) + large(287) + ETF(35) + KR(29) = 462 종목 자동 추출.
// 누락 시 hardcoded fallback 사용.
let CANDIDATE_TICKERS;
try {
  const raw = readFileSync(resolve(ROOT, 'data/candidate-tickers.json'), 'utf8');
  const data = JSON.parse(raw);
  if (Array.isArray(data.tickers) && data.tickers.length > 100) {
    CANDIDATE_TICKERS = data.tickers;
    console.log(`[startup] candidate-tickers.json 로드: ${CANDIDATE_TICKERS.length} 종목 (titan ${data.byBand?.titan ?? '?'} / mega ${data.byBand?.mega ?? '?'} / large ${data.byBand?.large ?? '?'} / ETF ${data.byBand?.etf ?? '?'} / KR ${data.byBand?.kr ?? '?'})`);
  }
} catch { /* fall through to hardcoded */ }
CANDIDATE_TICKERS ??= [
  // Fallback (build-candidate-tickers.mjs 미실행 시)
  // Mag7 + 메가 Tech
  'NVDA','MSFT','AAPL','META','GOOGL','AMZN','TSLA','NFLX','ADBE','CRM',
  // 반도체 / AI infra
  'TSM','ASML','AVGO','AMAT','LRCX','KLAC','AMD','MU','MRVL','QCOM','ARM',
  'SMCI','DELL','ANET','SNPS','CDNS','INTC',
  // SW / Cloud / Security (high momentum)
  'PLTR','SNOW','DDOG','NET','CRWD','PANW','ZS','OKTA','MDB','FTNT',
  // Fintech / Consumer
  'V','MA','COIN','HOOD','SOFI','AFRM','SQ','PYPL',
  // 금융 / 보험
  'JPM','BAC','GS','MS','WFC','C','BLK','SCHW','BRK-B',
  // 헬스케어 (defensive + biotech upside)
  'UNH','LLY','NVO','JNJ','PFE','MRNA','REGN','VRTX','GILD',
  // 산업/방산 (Buffett-style)
  'LMT','RTX','NOC','GE','BA','CAT','DE','HON','UNP',
  // Consumer Disc (Sharpe 5.13 — boost)
  'COST','HD','LOW','MCD','SBUX','NKE','TGT','BKNG',
  // Consumer Staples (defensive)
  'WMT','KO','PEP','PG','MO',
  // Materials (Sharpe 2.79 — boost)
  'FCX','NEM','ALB','LIN','APD','MP',
  // Energy
  'XOM','CVX','COP','EOG','OXY',
  // Utilities (defensive yield)
  'NEE','DUK','SO',
  // Recent IPO / high-signal
  'CRWV','APP',
  // === ETFs / Sector Rotation ===
  // 주요 인덱스
  'SPY','QQQ','VOO','VTI','IWM','DIA',
  // 섹터 ETF (rotation 트리거용)
  'XLK','XLE','XLF','XLV','XLI','XLY','XLP','XLU','XLB','XLRE',
  // 해외 ETF
  'EWY','EWJ','FXI','VGK','INDA','EWT','EWZ','EWA','MCHI','EZA',
  // 자산
  'GLD','SLV','TLT','SHY','USO','UNG','DBA','BITO','VXX',
  // === KR ===
  '005930.KS','000660.KS','373220.KS','005380.KS','035420.KS',
  '035720.KS','207940.KS','051910.KS','005490.KS','000270.KS',
  '003550.KS','068270.KS','105560.KS','028260.KS','012450.KS',
  '009150.KS','032830.KS','015760.KS','006400.KS','017670.KS',
];
const KR_NAMES = {
  '005930.KS':'삼성전자','000660.KS':'SK하이닉스','373220.KS':'LG에너지솔루션',
  '005380.KS':'현대차','035420.KS':'NAVER','035720.KS':'카카오',
  '207940.KS':'삼성바이오로직스','051910.KS':'LG화학','005490.KS':'POSCO홀딩스','000270.KS':'기아',
  '003550.KS':'LG','068270.KS':'셀트리온','105560.KS':'KB금융','028260.KS':'삼성물산',
  '012450.KS':'한화에어로스페이스','009150.KS':'삼성전기','032830.KS':'삼성생명',
  '015760.KS':'한국전력','006400.KS':'삼성SDI','017670.KS':'SK텔레콤',
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
  PLTR: 'Palantir', CRWV: 'CoreWeave', SNOW: 'Snowflake', NET: 'Cloudflare',
  DDOG: 'Datadog', MDB: 'MongoDB', ZS: 'Zscaler', CRWD: 'CrowdStrike',
  PANW: 'Palo Alto Networks', FTNT: 'Fortinet',
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
  // native 통화 기준 + thousand-separator 포맷 통일 (KR: ₩1,805,130 / US: $200.26)
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
      const native = nativeCurrencyForTickerMjs(sr.ticker);
      const isKR = native === '₩';
      const formatted = isKR
        ? `${native}${Math.round(stopP).toLocaleString()}`
        : `${native}${parseFloat(stopP.toFixed(2))}`;
      sr.rationale = sr.rationale.replace(
        /손절선\s*~\s*[$₩€]?[\d,.]+/,
        `손절선 ~${formatted}`,
      );
      audit.fixes.stopRationaleAligned.push(`${sr.ticker}:${rationaleStop}→${stopP}`);
    }
  }

  // 6j. 통화 일관성 — native 통화와 다른 기호 사용 OR 단위 누락 시 자동 교정
  for (const p of r.portfolio) {
    const native = nativeCurrencyForTickerMjs(p.ticker);
    const isKR = native === '₩';
    const fmt = n => isKR ? `${native}${Math.round(n).toLocaleString()}` : `${native}${parseFloat(n.toFixed(2))}`;
    const fields = [['entryZone', 'entry'], ['stopLoss', 'stop'], ['target', 'target'], ['targetBull', 'targetBull']];
    const mismatches = [];
    for (const [key, label] of fields) {
      const val = p[key];
      if (!val) continue;
      const sym = String(val).match(/[₩$€]/)?.[0];
      // 1) 다른 기호 사용 → 자동 교정 ($ → ₩ for KR)
      if (sym && sym !== native) {
        mismatches.push(`${label}=${sym}→${native}`);
        p[key] = String(val).replace(/[₩$€]/g, native);
      }
      // 2) 단위 누락 (KR ticker 인데 ₩ 없음) → 자동 추가
      else if (!sym && isKR) {
        mismatches.push(`${label}=naked→${native}`);
        // 숫자만 있는 zone: "115000-120000" → "₩115,000-₩120,000"
        p[key] = String(val).replace(/(\d[\d,]*\.?\d*)/g, (_, n) => fmt(parseFloat(n.replace(/,/g, ''))));
      }
    }
    if (mismatches.length > 0) {
      audit.fixes.currencyMismatch.push(`${p.ticker} (native ${native}): ${mismatches.join(', ')}`);
    }
  }

  // 6j-2. stopLossRationale 텍스트의 통화 기호 + "현재 ~X" 가격 교정 (2026-05-24 사건)
  // 사건: KR 종목인데 rationale 에 "현재 $292500 → 손절선 ~$272025.00" 표시 — $ 잘못 사용 +
  // portfolio.stopLoss(₩272,025) 와 rationale 의 "현재" 숫자 mismatch. 6e 는 마킹만, 6i 는
  // "손절선 ~" 만 고침 → "현재 ~" 와 통화 기호 잔존.
  // portfolio 에 없는 orphan stopLossRationale 도 통화 기호 정규화 대상 (005930/000660 사건).
  if (Array.isArray(r.stopLossRationale)) {
    for (const sr of r.stopLossRationale) {
      if (!sr.rationale) continue;
      const native = nativeCurrencyForTickerMjs(sr.ticker);
      const isKR = native === '₩';
      const fmt = n => isKR ? `${native}${Math.round(n).toLocaleString()}` : `${native}${parseFloat(n.toFixed(2))}`;
      let modified = false;
      const before = sr.rationale;
      // (a) 잘못된 통화 기호: KR ticker 인데 $X (200MA/50MA 안의 ₩ 표기는 그대로 유지 —
      //     그 안은 이미 native 기호 ₩ 사용중). 따라서 단순히 "$digit" 패턴만 잡아서 교체.
      if (isKR) {
        const swapped = sr.rationale.replace(/\$(\d)/g, `${native}$1`);
        if (swapped !== sr.rationale) {
          modified = true;
          sr.rationale = swapped;
        }
      }
      // (b) "현재 ~X" 가격을 livePrices 기반으로 재계산 (있을 때만)
      const lp = livePrices?.get(sr.ticker)?.price;
      if (lp && lp > 0) {
        const rxCurrent = /현재\s*[$₩€]?\s*([\d,.]+)/;
        const cm = sr.rationale.match(rxCurrent);
        if (cm) {
          const oldVal = parseFloat(cm[1].replace(/,/g, ''));
          // livePrice 와 50% 이상 차이날 때만 교정 (LLM 이 split-adjusted 가격을 가져왔을 수도 있음)
          if (isFinite(oldVal) && (oldVal < lp * 0.5 || oldVal > lp * 2)) {
            sr.rationale = sr.rationale.replace(rxCurrent, `현재 ${fmt(lp)}`);
            modified = true;
          }
        }
      }
      if (modified) {
        audit.fixes.currencyMismatch.push(`${sr.ticker} stopLossRationale: ${before.slice(0, 60)}... → 통화/현재가 교정`);
      }
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
  if (portLen > 0 && portLen < 12) warnings.push(`portfolio COUNT LOW: ${portLen} (target=12: US 6 + KR 6)`);
  if (portLen >= 6) {
    const krLen = report.portfolio.filter(p => p.ticker?.endsWith('.KS') || p.ticker?.endsWith('.KQ')).length;
    const usLen = portLen - krLen;
    if (usLen < 6) warnings.push(`portfolio US COUNT LOW: ${usLen}/6`);
    if (krLen < 6) warnings.push(`portfolio KR COUNT LOW: ${krLen}/6`);
  }

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
  // Windows Task Scheduler triggers: 06:50 (morning) / 15:50 (afternoon) / 21:20 (evening).
  // 2026-05-29: 시작 시간 10분 전 buffer + sleep until target 으로 정시 발간 보장.
  const kstHour = new Date(Date.now() + 9 * 3600000).getUTCHours();
  if (kstHour >= 6 && kstHour < 15) return 'morning';
  if (kstHour >= 15 && kstHour < 20) return 'afternoon';
  return 'evening';
}

/**
 * 2026-05-29: 세션별 시장 focus — 한국 시간대 + 글로벌 장 일정 매칭.
 *   morning  06:50 KST → US 장 마감 직후 (전일 22:00 UTC) → US-focused
 *   afternoon 15:50 KST → KR 장 마감 직후 (15:30 KST) → KR-focused
 *   evening  21:20 KST → US 장 시작 직후 (= 09:35 EST) → US-premarket + 글로벌
 *
 * 보고서에 sessionFocus 메타 + prompt 에 inject — LLM 이 해당 시장 종목 비중 강화.
 */
function getSessionFocus(session) {
  switch (session) {
    case 'morning':
      return {
        primary: 'us',
        secondary: ['global'],
        label: 'US 장 마감 직후 (전일 close)',
        marketWeight: { us: 60, kr: 20, global: 20 },
      };
    case 'afternoon':
      return {
        primary: 'kr',
        secondary: ['japan', 'china'],
        label: 'KR 장 마감 직후 + 아시아',
        marketWeight: { kr: 50, us: 25, asia: 25 },
      };
    case 'evening':
      return {
        primary: 'us',
        secondary: ['premarket', 'global'],
        label: 'US 장 시작 직후 (premarket → open)',
        marketWeight: { us: 70, global: 20, kr: 10 },
      };
    default:
      return { primary: 'global', secondary: [], label: '글로벌', marketWeight: {} };
  }
}

/**
 * 2026-05-29: 정시 발간 — 보고서 완료 후 target 시간까지 sleep.
 *   morning  → 07:00 KST
 *   afternoon → 16:00 KST
 *   evening  → 21:30 KST
 */
function getPublishTarget(session) {
  const kstNow = new Date(Date.now() + 9 * 3600000);
  const target = new Date(kstNow);
  if (session === 'morning')        { target.setUTCHours(7, 0, 0, 0); }
  else if (session === 'afternoon') { target.setUTCHours(16, 0, 0, 0); }
  else                              { target.setUTCHours(21, 30, 0, 0); }
  // target 이 이미 지났으면 (보고서가 늦게 끝나서) wait 안 함
  const waitMs = target.getTime() - kstNow.getTime();
  return { target, waitMs };
}

async function sleepUntilPublishTarget(session) {
  const { target, waitMs } = getPublishTarget(session);
  if (waitMs <= 0) {
    console.log(`  [정시 발간] target ${target.toISOString().slice(11,16)} KST 이미 지남 — 즉시 발간`);
    return;
  }
  // 2026-05-29: trigger 시간 20분 전 → 최대 20분 sleep 허용 (이전 15분 cutoff 확장)
  if (waitMs > 25 * 60 * 1000) {
    console.log(`  [정시 발간] target ${target.toISOString().slice(11,16)} KST 까지 25분+ — sleep 생략 (수동 실행 등)`);
    return;
  }
  const sec = Math.round(waitMs / 1000);
  console.log(`  [정시 발간] target ${target.toISOString().slice(11,16)} KST 까지 ${sec}s wait...`);
  await new Promise(r => setTimeout(r, waitMs));
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

// Stooq batch — Yahoo v7 quote 401 차단 후 대체 (2026-05-22).
// US: ticker.us / KR: ticker.kr (005930.KS → 005930.kr)
async function fetchStooqBatch(tickers) {
  const stooqs = tickers.map(t => t.endsWith('.KS') ? t.slice(0, -3) + '.kr' : t.replace(/\./g, '-').toLowerCase() + '.us');
  const out = new Map();
  // Stooq batch: 50 ticker per request (URL 길이 한도)
  for (let i = 0; i < stooqs.length; i += 50) {
    const chunk = stooqs.slice(i, i + 50);
    const origChunk = tickers.slice(i, i + 50);
    try {
      const url = `https://stooq.com/q/l/?s=${chunk.join('+')}&f=sd2t2ohlcv&h&e=csv`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000), cache: 'no-store' });
      if (!res.ok) continue;
      const text = await res.text();
      const lines = text.trim().split('\n').slice(1); // skip header
      for (let j = 0; j < lines.length && j < chunk.length; j++) {
        const cols = lines[j].split(',');
        const close = parseFloat(cols[6]);
        const open = parseFloat(cols[3]);
        if (!close || close <= 0) continue;
        const change1d = open ? Math.round(((close - open) / open) * 1000) / 10 : null;
        out.set(origChunk[j], { price: Math.round(close * 100) / 100, change1d, high52w: close * 1.3, low52w: close * 0.7 });
      }
    } catch { /* chunk failed */ }
  }
  return out;
}

async function getLivePrices() {
  const map = new Map();
  // 1) Stooq batch — US/EU 종목 (Yahoo v7 401 차단됨). KR/일부는 N/D
  // 2026-05-29: KOSDAQ (.KQ) 도 KR fetch path 로 처리 — Yahoo v8 chart 가 양쪽 지원.
  const usTickers = CANDIDATE_TICKERS.filter(t => !t.endsWith('.KS') && !t.endsWith('.KQ'));
  const krTickers = CANDIDATE_TICKERS.filter(t => t.endsWith('.KS') || t.endsWith('.KQ'));
  const stooqMap = await fetchStooqBatch(usTickers);
  for (const [t, v] of stooqMap) map.set(t, v);

  // 2) KR ticker — Yahoo v8 chart 개별 (~29개, 동시 8개)
  const krBatch = async (slice) => {
    const results = await Promise.all(slice.map(fetchOnePrice));
    for (const [t, lp] of results) { if (lp) map.set(t, lp); }
  };
  for (let i = 0; i < krTickers.length; i += 8) {
    await krBatch(krTickers.slice(i, i + 8));
  }

  // 3) Stooq 누락 US ticker (N/D) — Yahoo v8 개별 fallback (50개 한도)
  const missingUs = usTickers.filter(t => !map.has(t));
  if (missingUs.length > 0 && missingUs.length < 100) {
    const results = await Promise.all(missingUs.slice(0, 50).map(fetchOnePrice));
    for (const [t, lp] of results) { if (lp) map.set(t, lp); }
  }
  const coverage = map.size / CANDIDATE_TICKERS.length;
  console.log(`  [livePrices] ${map.size}/${CANDIDATE_TICKERS.length} 종목 확보 (${(coverage*100).toFixed(1)}%, Stooq US: ${stooqMap.size}, Yahoo v8 KR+fallback: ${map.size - stooqMap.size})`);

  // 🚨 Fail-loud guard: 가격 source 50% 미만이면 환각 보고서 방지를 위해 abort
  // (Yahoo v7 차단 같은 silent failure 시 보고서 생성 중단)
  const MIN_COVERAGE = 0.50;
  if (coverage < MIN_COVERAGE) {
    console.error(`\n❌ FATAL: livePrices coverage ${(coverage*100).toFixed(1)}% < ${MIN_COVERAGE*100}% — 환각 위험. 보고서 생성 중단.`);
    console.error(`   외부 데이터 source 점검 필요: Stooq batch / Yahoo v8 chart`);
    console.error(`   진단: node scripts/audit-data-sources.mjs`);
    process.exit(2);
  }
  if (coverage < 0.85) {
    console.warn(`  ⚠️  WARN: coverage ${(coverage*100).toFixed(1)}% < 85% — degraded. 추후 source 점검 필요.`);
  }
  return map;
}

function pricesSection(map) {
  if (!map.size) return '';
  return Array.from(map.entries()).map(([t, p]) => {
    const isKR = t.endsWith('.KS') || t.endsWith('.KQ');
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
 * 강제 rotation — 최근 5개 보고서 ticker와 5개+ 겹치면 boost-list에서 신규 ticker 강제 추가.
 * "맨날 같은 종목" 문제 해결 (NVDA/TSM/ASML/000660 가 100% 반복되는 현상).
 */
function enforceRotation(portfolio, livePrices) {
  try {
    const dir = resolve(import.meta.dirname ?? '.', '..', 'reports');
    const files = readdirSync(dir).filter(f => f.endsWith('-ko.json')).sort().slice(-5);
    const recentTickers = new Set();
    for (const f of files) {
      try {
        const r = JSON.parse(readFileSync(resolve(dir, f), 'utf8'));
        for (const p of r.portfolio ?? []) if (p.ticker) recentTickers.add(p.ticker);
      } catch { /* skip */ }
    }
    const currentTickers = new Set(portfolio.map(p => p.ticker));
    const overlap = [...currentTickers].filter(t => recentTickers.has(t)).length;
    if (overlap < 5) return portfolio; // 충분히 새로움

    // boost-list 중 portfolio 에 없는 ticker
    let boostList = [];
    try {
      const raw = readFileSync(resolve(ROOT, 'data/boost-list.json'), 'utf8');
      boostList = JSON.parse(raw).filter(b => livePrices.has(b.ticker) && !currentTickers.has(b.ticker));
    } catch { /* skip */ }

    // 2026-05-27: boost-list 만으로는 다양성 부족 (4 ticker 모두 메가). recent X 인 메가캡
    // 제외 후 CANDIDATE_TICKERS 의 mid-cap pool 에서 random sample.
    // 2026-05-27 수정: random pool 을 boost-list 앞에 prepend — replaceCount=3 이라
    // 처음 3개가 우선 사용됨. boost 메가가 다양성 효과 0 인 문제 해결.
    try {
      const tickerMeta = JSON.parse(readFileSync(resolve(ROOT, 'data/candidate-tickers.json'), 'utf8'));
      // mid/large 중심으로 다양성 — mega/titan/etf 제외 (이미 메가 편향).
      const capOf = (t) => tickerMeta.meta?.[t]?.cap ?? 'unknown';
      const pool = (tickerMeta.tickers ?? []).filter(t =>
        livePrices.has(t) &&
        !currentTickers.has(t) &&
        !recentTickers.has(t) &&
        !boostList.some(b => b.ticker === t) &&
        ['mid', 'large'].includes(capOf(t))
      );
      // 무작위 셔플 후 2개 sampling
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      const sampled = pool.slice(0, 2);
      const sectorOf = Object.fromEntries(Object.entries(tickerMeta.meta ?? {}).map(([t, m]) => [t, m.sector]));
      const poolEntries = sampled.map(t => ({
        ticker: t,
        reason: `BOOST: candidate pool random sample (sector=${sectorOf[t] ?? 'Unknown'})`,
        evaluated: 0, hits: 0, stops: 0, avg_pnl: 0,
        _fromPool: true,
      }));
      // prepend — random pool 이 boost 메가 앞에서 먼저 inject
      boostList = [...poolEntries, ...boostList];
    } catch { /* skip */ }

    if (!boostList.length) return portfolio;

    // 가장 약한 종목 1-2개를 boost-list 종목으로 교체
    // 약한 종목 = action=watch + 최근 5보고서 모두 출현 + allocation 작음
    const candidates = portfolio
      .map((p, idx) => ({ p, idx, recentCount: [...recentTickers].filter(t => t === p.ticker).length, watch: p.action === 'watch' }))
      .filter(c => recentTickers.has(c.p.ticker))
      .sort((a, b) => (b.watch ? 1 : 0) - (a.watch ? 1 : 0) || (a.p.allocation ?? 0) - (b.p.allocation ?? 0));
    if (!candidates.length) return portfolio;

    // 2026-05-27: replaceCount 2 → 3 (다양성 우선). random pool 2 + boost 1 strict.
    const replaceCount = Math.min(3, boostList.length, candidates.length);
    const updated = [...portfolio];
    for (let i = 0; i < replaceCount; i++) {
      const oldP = candidates[i].p;
      const boost = boostList[i];
      const pd = livePrices.get(boost.ticker);
      if (!pd?.price) continue;
      const isKR = boost.ticker.endsWith('.KS');
      const fmt = n => isKR ? `₩${Math.round(n).toLocaleString()}` : `$${n.toFixed(2)}`;
      const actual = pd.price;
      console.warn(`  🔄 rotation: ${oldP.ticker} → ${boost.ticker} (boost-list, avg_pnl ${boost.avg_pnl}%)`);
      // boost.reason 이 이미 "BOOST:" prefix 를 포함 — 이중 prefix 방지
      const boostReason = String(boost.reason ?? '').replace(/^\s*BOOST:\s*/i, '').trim();
      // 2026-05-28: catalysts/fundamentalBasis/technicalBasis/riskNote 누락 사건 fix.
      // LLM 추천 종목은 이 필드들 채움 — rotation 신규 종목도 동등 정보 노출.
      const isFromPool = boost._fromPool === true;
      const sectorTag = isFromPool && boost.reason?.match(/sector=([^)]+)\)/)?.[1] || 'Unknown';
      const baseRationale = isFromPool
        ? `${boost.ticker} — ${sectorTag} 섹터 분산 (메가 편향 회피)`
        : `BOOST: ${boostReason || boost.reason}`;
      // 2026-05-29: catalysts 의 cross-ticker duplicate WARN 해결 — ticker/sector/price
      // 변수 포함하여 entry 별 unique. rationaleDedup 가 catch 안 함.
      const baseCatalysts = isFromPool
        ? [
            `${boost.ticker} (${sectorTag}) — Tech 비편향 sector 신규 노출`,
            `시장가 ${fmt(actual)} 기준 mid/large-cap rotation pool 무작위 선택`,
          ]
        : [
            `${boost.ticker} 과거 ${boost.evaluated}건 평가, 평균 +${boost.avg_pnl}% (boost-list)`,
            `${boost.hits ?? 0}건 target hit / ${boost.stops ?? 0}건 stop`,
          ];
      updated[candidates[i].idx] = {
        ticker: boost.ticker,
        name: boost.ticker,
        sector: isFromPool ? (sectorTag.charAt(0).toUpperCase() + sectorTag.slice(1)) : 'Technology',
        market: isKR ? 'korea' : 'us',
        rationale: baseRationale,
        allocation: oldP.allocation ?? 10,
        entryZone: `${fmt(actual * 0.98)}-${fmt(actual * 1.01)}`,
        entryRationale: isFromPool ? `시장가 -1% 진입 (rotation 신규)` : `boost-list — 과거 ${boost.evaluated}건 평가, 평균 +${boost.avg_pnl}%`,
        stopLoss: fmt(actual * 0.93),
        target: fmt(actual * 1.10),
        targetBull: fmt(actual * 1.20),
        targetRationale: isFromPool ? '시장가 +10% 보수적 target' : '과거 성과 기반 보수적 target',
        confidence: 'medium',
        action: 'buy',
        catalysts: baseCatalysts,
        fundamentalBasis: isFromPool
          ? `Sector=${sectorTag}, 시장가 ${fmt(actual)} (cap rotation 후보)`
          : `과거 성과 기반: ${boost.evaluated}건 평가, ${boost.hits ?? 0} hits`,
        technicalBasis: `시장가 ${fmt(actual)} 기준 -3% stop / +10% target`,
        riskNote: isFromPool
          ? `Rotation 신규 — 추가 검증 후 진입 권장 (catalysts 자동 생성)`
          : `boost-list 기반 — 과거 데이터 의존, 미래 보장 X`,
      };
    }
    return updated;
  } catch (e) { console.warn('  ⚠️ enforceRotation 실패:', e.message); return portfolio; }
}

/**
 * 구루 분할 매매 시스템 — Lynch ladder entry + Klarman ladder exit + Druckenmiller trailing.
 * LLM이 entryZone + target 만 정하고, 시스템이 3단계 ladder 자동 생성.
 * "위에서 물리는" 위험 방지: 30/40/30 분할 진입 + 33/33/34 분할 매도.
 */
function buildLadders(portfolioItems, livePrices) {
  return portfolioItems.map(p => {
    const pd = livePrices.get(p.ticker);
    if (!pd?.price) return p;
    const actual = pd.price;
    const isKR = p.ticker.endsWith('.KS');
    const fmt = n => isKR ? `₩${Math.round(n).toLocaleString()}` : `$${n.toFixed(2)}`;
    const extract = s => (s ?? '').replace(/[₩$,\s]/g, '').match(/[\d.]+/g)?.map(Number).filter(n => n > 0) ?? [];

    const zoneNums = extract(p.entryZone);
    const targetNums = extract(p.target);
    if (zoneNums.length < 1 || targetNums.length < 1) return p;
    const entryMid = (Math.min(...zoneNums) + Math.max(...zoneNums)) / 2;
    const targetVal = Math.max(...targetNums);

    // Entry ladder — Lynch/Druckenmiller 3단계 (시장가 기준 분할)
    // tier1: 시장가 (즉시 진입 30%) / tier2: -3% 풀백 (40%) / tier3: -7% 깊은 풀백 (30%)
    const entryLadder = [
      { price: fmt(actual * 0.995), weight: 30, label: '즉시 진입 (모멘텀 확인)' },
      { price: fmt(actual * 0.97),  weight: 40, label: '-3% 풀백 시 추가' },
      { price: fmt(actual * 0.93),  weight: 30, label: '-7% 깊은 풀백 시 마지막' },
    ];

    // Exit ladder — Klarman 3단계 분할 매도 + trailing stop
    const gain = (targetVal - entryMid) / entryMid;
    const exit1 = entryMid * (1 + gain * 0.35);  // 35% 도달 시 1/3
    const exit2 = entryMid * (1 + gain * 0.70);  // 70% 도달 시 1/3
    const exit3 = targetVal;                       // 100% target 마지막 1/3
    const exitLadder = [
      { price: fmt(exit1), weight: 33, action: '1/3 정리 → stop을 entry로 이동 (breakeven lock)' },
      { price: fmt(exit2), weight: 33, action: '1/3 정리 → stop을 +3%로 이동' },
      { price: fmt(exit3), weight: 34, action: '마지막 1/3 + trailing stop (-5%)' },
    ];

    return { ...p, entryLadder, exitLadder };
  });
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
    // 2026-05-27: ENTRY_CALIBRATION 활용 — analyze-recs --export 로 산출된 ticker별
    // 만성 NE gap (entry vs actual). gap > 5% 이면 50MA/200MA anchor 무시하고 시장가 사용
    // (만성 NE 의 근본 원인은 entry 가 시장가에 못 미침. MSFT/NVDA/TSM/ASML/MU 11회+ NE 케이스).
    const calib = ENTRY_CALIBRATION?.get?.(p.ticker?.toUpperCase());
    if (calib && typeof calib.medianGap === 'number' && calib.medianGap > 5 && anchor < base * 0.98) {
      console.log(`  [entry-calib] ${p.ticker}: medianGap ${calib.medianGap.toFixed(1)}% > 5% — anchor ${anchorLabel}(${fmt(anchor)}) → current(${fmt(base)})`);
      anchor = base;
      anchorLabel = `current(calib-NE-${calib.medianGap.toFixed(1)}%)`;
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
 * regionStances stance-data 정합성 검증 (2026-05-25 신설).
 *
 * 사건: india "4w -2.4%, 1w +0.8%" 인데 stance="bullish" thesis="경제 성장 기대".
 * 4주 수익률 음수인데 강세 단언은 데이터-thesis 모순.
 *
 * 룰:
 *   4w ≤ -2%  →  stance="bullish" 면 "neutral" 강등 (thesis 에 (...) 데이터 유지)
 *   4w ≥ +5%  →  stance="bearish" 면 "neutral" 승격
 *   (4w 만 우선 — 1w 노이즈 가능, monthly 트렌드가 stance 결정에 더 적절)
 */
function reconcileRegionStanceWithData(regionStances) {
  if (!regionStances) return regionStances;
  let adjusted = 0;
  const out = {};
  for (const [region, entry] of Object.entries(regionStances)) {
    if (!entry || typeof entry !== 'object') { out[region] = entry; continue; }
    const fixed = { ...entry };
    const m = fixed.thesis?.match(/\(\s*4w\s*([+-]?\d+\.?\d*)\s*%/i);
    if (m) {
      const w4 = parseFloat(m[1]);
      if (isFinite(w4)) {
        if (w4 <= -2 && fixed.stance === 'bullish') {
          fixed.stance = 'neutral';
          fixed.thesis = `${fixed.thesis ?? ''} | 데이터-stance 보정 (4w ${w4}%)`.trim();
          adjusted++;
          console.log(`  [후처리] regionStances ${region}: bullish→neutral (4w ${w4}% 음수)`);
        } else if (w4 >= 5 && fixed.stance === 'bearish') {
          fixed.stance = 'neutral';
          fixed.thesis = `${fixed.thesis ?? ''} | 데이터-stance 보정 (4w ${w4}%)`.trim();
          adjusted++;
          console.log(`  [후처리] regionStances ${region}: bearish→neutral (4w ${w4}% 양수)`);
        }
      }
    }
    out[region] = fixed;
  }
  if (adjusted > 0) console.log(`  [후처리] regionStances 정합성 보정: ${adjusted}건`);
  return out;
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
    // 정치 인물 임명/잔류 같은 사실은 [News] 에 명시된 경우만 인용 (prompt 단언 금지)
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
    '',
    '⚠️ FACT-CHECK RULES (2차 검증):',
    '- thesis/macroAnalysis 에 [Macro Indicators] + [News] 에 명시된 사실만 사용.',
    '- 특정 인물 임명/잔류/사임 (예: Powell, Bessent) 같은 정치 인물 발언 금지 — 입력에 없으면 추측 X.',
    '- "파월 잔류", "트럼프 정책" 같은 정치 이벤트는 [News] 에 명시된 경우만 인용.',
    '- 추측/일반화 (예: "AI 인프라 확장") 보다 구체 수치 (예: "CPI 3.78%, NVDA Q1 +73%") 우선.',
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

/**
 * 2026-05-29: 매도 outcome + grid search 결과 → buy prompt 에 inject (Karpathy 양방향).
 *   - 매도 룰 type 별 적중률 (tune-sell-rules.mjs 결과)
 *   - target_near / stop_near grid search 최적 임계값
 *   → buy 측에서 target/stop 거리 설정 시 참고.
 */
function getSellLearningBlock() {
  try {
    const spec = JSON.parse(readFileSync(resolve(ROOT, 'data/sell-rules-tuned.json'), 'utf8'));
    if (!spec.gridSearch && (!spec.outcomeStats || Object.keys(spec.outcomeStats).length === 0)) return '';
    const lines = ['[SELL OUTCOME LEARNING — Karpathy cross-feedback to buy strategy]'];
    if (spec.gridSearch?.best) {
      const tn = spec.gridSearch.best.target_near;
      const sn = spec.gridSearch.best.stop_near;
      lines.push(`  Grid-tuned: target_near=${tn} (price/target ≥ ${tn} → sell signal), stop_near=${sn}`);
      lines.push(`  → BUY 측 권장: target 설정 시 +${Math.round((1 / tn - 1) * 100)}% 여유 두면 target_near 매도 신호 사전 잡힘`);
    }
    if (spec.outcomeStats) {
      const top = Object.entries(spec.outcomeStats)
        .filter(([, r]) => r.evaluated >= 3)
        .sort(([, a], [, b]) => (b.precisionPct ?? 0) - (a.precisionPct ?? 0))
        .slice(0, 3);
      if (top.length) {
        lines.push(`  적중률 top 룰: ${top.map(([k, r]) => `${k}(${r.precisionPct}%, n=${r.evaluated})`).join(' | ')}`);
      }
    }
    lines.push('');
    return lines.join('\n');
  } catch { return ''; }
}

function getRecentTickers() {
  try {
    const dir = resolve(import.meta.dirname ?? '.', '..', 'reports');
    // 2026-05-27: 종목 다양성 확보 — 최근 3 → 10 보고서 (5일치). 630 candidate 중 5.1%
    // 만 추천에 사용되던 문제 (메가 10종목 무한 반복) 완화.
    const files = readdirSync(dir).filter(f => f.endsWith('-ko.json')).sort().slice(-10);
    const seen = new Set();
    for (const f of files) {
      const r = JSON.parse(readFileSync(resolve(dir, f), 'utf8'));
      for (const p of r.portfolio ?? []) if (p.ticker) seen.add(p.ticker);
    }
    return [...seen];
  } catch { return []; }
}

/**
 * 2026-05-27 SkillOpt feedback loop: 최근 보고서의 quality_score 추세 + 부족 영역 추출.
 * generate-report-local 매 실행 시 prompt 의 [Quality Feedback] 섹션으로 주입 →
 * LLM 이 과거 약점 인지하여 자체 개선.
 */
function getRecentQualityFeedback() {
  try {
    // 2026-05-28: ESM .mjs 에서 require 미정의 — top-level import 로 변경.
    const db = new Database(resolve(ROOT, 'data/flowvium.db'), { readonly: true });
    const rows = db.prepare(`
      SELECT generated_at, quality_score, session, full_json
      FROM reports
      WHERE quality_score IS NOT NULL
      ORDER BY generated_at DESC LIMIT 5
    `).all();
    db.close();
    if (!rows.length) return '';
    const avg = rows.reduce((s, r) => s + r.quality_score, 0) / rows.length;
    // 가장 자주 누락된 quality check 항목 분석 (recent 5)
    const missingCounts = {};
    for (const r of rows) {
      try {
        const d = JSON.parse(r.full_json);
        if (!d.thesis || d.thesis.length <= 20) missingCounts.thesis = (missingCounts.thesis ?? 0) + 1;
        if (!d.macroAnalysis || d.macroAnalysis.length <= 30) missingCounts.macroAnalysis = (missingCounts.macroAnalysis ?? 0) + 1;
        if (!d.technicalAnalysis || d.technicalAnalysis.length <= 15) missingCounts.technicalAnalysis = (missingCounts.technicalAnalysis ?? 0) + 1;
        if ((d.portfolio?.length ?? 0) < 12) missingCounts.portfolioSize = (missingCounts.portfolioSize ?? 0) + 1;
        if ((d.shortSqueeze?.length ?? 0) === 0) missingCounts.shortSqueeze = (missingCounts.shortSqueeze ?? 0) + 1;
        if ((d.insiderSignals?.length ?? 0) === 0) missingCounts.insiderSignals = (missingCounts.insiderSignals ?? 0) + 1;
        if ((d.companyChanges?.length ?? 0) === 0) missingCounts.companyChanges = (missingCounts.companyChanges ?? 0) + 1;
      } catch { /* skip */ }
    }
    const weak = Object.entries(missingCounts).filter(([, c]) => c >= 2).map(([k, c]) => `${k}(${c}/5)`).join(', ');
    const lastScore = rows[0].quality_score;
    const trend = lastScore < avg - 5 ? '하락' : lastScore > avg + 5 ? '상승' : '유지';
    return `[Quality Feedback — 최근 5보고서 평균 ${avg.toFixed(0)}/100, 직전 ${lastScore}, 추세 ${trend}]\n` +
      (weak ? `약점: ${weak} (이 영역 강화 필요)\n` : '강점 유지 중 — 모든 영역 정상\n');
  } catch (e) {
    console.warn('  ⚠️ getRecentQualityFeedback 실패:', e.message);
    return '';
  }
}

/**
 * 2026-05-29: 이전 portfolio 성과 피드백 — DB 의 최근 recommendation_outcomes 집계.
 * "지난 5건 추천 중 hit 2건 / NE 2건 / stop 1건. 만성 NE: MSFT 11회" 형식으로
 * LLM 에게 직접 노출 → 자가 학습 강화 (SkillOpt 의 outcome-aware skill update).
 *
 * 보고서 자체에도 portfolioOutcomes 필드로 추가 — 사용자 가시.
 */
function getPortfolioFeedback() {
  try {
    const db = new Database(resolve(ROOT, 'data/flowvium.db'), { readonly: true });
    // 최근 30일 buy 추천 중 outcome 측정된 entry
    const rows = db.prepare(`
      SELECT r.ticker, o.outcome, o.pnl_pct
      FROM recommendation_outcomes o
      JOIN recommendations r ON r.id = o.recommendation_id
      WHERE r.action = 'buy'
        AND r.generated_at >= date('now', '-30 days')
      ORDER BY o.evaluated_at DESC LIMIT 30
    `).all();
    // 만성 NE/stop ticker
    const chronicNE = db.prepare(`
      SELECT r.ticker, COUNT(*) cnt
      FROM recommendation_outcomes o
      JOIN recommendations r ON r.id = o.recommendation_id
      WHERE r.action = 'buy' AND o.outcome = 'not_entered'
      GROUP BY r.ticker HAVING cnt >= 5 ORDER BY cnt DESC LIMIT 5
    `).all();
    db.close();
    if (!rows.length) return { feedback: '', summary: null };

    const counts = { hit_target: 0, stop_loss: 0, not_entered: 0, still_holding: 0, unknown: 0 };
    const tickerPnl = {};
    for (const r of rows) {
      counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
      if (r.pnl_pct != null) {
        if (!tickerPnl[r.ticker]) tickerPnl[r.ticker] = { sum: 0, n: 0 };
        tickerPnl[r.ticker].sum += r.pnl_pct;
        tickerPnl[r.ticker].n++;
      }
    }
    const total = rows.length;
    const hitRate = ((counts.hit_target / total) * 100).toFixed(0);
    const neRate = ((counts.not_entered / total) * 100).toFixed(0);
    // 2026-05-29: hero card 용 통계 — top/bottom 3, 평균 PnL, alpha
    const evaluatedRows = rows.filter(r => r.pnl_pct != null);
    const avgPnl = evaluatedRows.length
      ? Math.round((evaluatedRows.reduce((a, r) => a + r.pnl_pct, 0) / evaluatedRows.length) * 10) / 10
      : null;
    const tickerAvg = Object.entries(tickerPnl).map(([t, v]) => ({ ticker: t, avg: Math.round((v.sum / v.n) * 10) / 10, n: v.n }));
    tickerAvg.sort((a, b) => b.avg - a.avg);
    const top3 = tickerAvg.slice(0, 3);
    const bottom3 = tickerAvg.slice(-3).reverse();
    // SPY alpha (recommendation_outcomes.spy_return 대비)
    const dbA = new Database(resolve(ROOT, 'data/flowvium.db'), { readonly: true });
    const alphaRow = dbA.prepare(`
      SELECT ROUND(AVG(o.pnl_pct - o.spy_return), 1) alpha,
             SUM(CASE WHEN o.pnl_pct > o.spy_return THEN 1 ELSE 0 END) beat,
             COUNT(*) n
      FROM recommendation_outcomes o JOIN recommendations r ON r.id = o.recommendation_id
      WHERE r.action='buy' AND r.generated_at >= date('now','-30 days') AND o.spy_return IS NOT NULL
    `).get();
    dbA.close();
    const text =
      `[Portfolio Feedback — 최근 30일 ${total}건 buy 추천 평가]\n` +
      `hit ${counts.hit_target} (${hitRate}%) / stop ${counts.stop_loss} / NE ${counts.not_entered} (${neRate}%) / holding ${counts.still_holding}\n` +
      `평균 PnL ${avgPnl ?? '-'}% / SPY alpha ${alphaRow?.alpha ?? '-'}% / beat ${alphaRow?.beat ?? 0}/${alphaRow?.n ?? 0}\n` +
      (chronicNE.length ? `만성 NE 회피 (entry zone 시장가 위 자제): ${chronicNE.map(c => `${c.ticker}(${c.cnt}회)`).join(', ')}\n` : '');
    const summary = {
      total, ...counts,
      hitRate: parseFloat(hitRate),
      neRate: parseFloat(neRate),
      avgPnl,
      spyAlpha: alphaRow?.alpha ?? null,
      beatSpy: alphaRow?.beat ?? 0,
      beatSpyTotal: alphaRow?.n ?? 0,
      top3, bottom3,
      chronicNE: chronicNE.map(c => ({ ticker: c.ticker, neCount: c.cnt })),
    };
    return { feedback: text, summary };
  } catch (e) {
    console.warn('  ⚠️ getPortfolioFeedback 실패:', e.message);
    return { feedback: '', summary: null };
  }
}

/**
 * 2026-05-29: 매도 후보 추출 + Karpathy pathway (closed loop).
 * 룰 score / 임계값 = data/sell-rules-tuned.json (tune-sell-rules.mjs 가 주 1회 자동 조정).
 * 하드코딩 X — JSON 변경하면 즉시 반영. 룰 outcome 학습 → 임계값 자가 조정.
 */
function loadSellRules() {
  try {
    return JSON.parse(readFileSync(resolve(ROOT, 'data/sell-rules-tuned.json'), 'utf8'));
  } catch (e) {
    console.warn(`  ⚠️ sell-rules-tuned.json 로드 실패: ${e.message} — sell 룰 비활성`);
    return null;
  }
}

function evaluateSellRule(rule, ctx) {
  const c = rule.condition;
  switch (c.type) {
    // ── 가격 ──────────────────────────────────────────────────────────────────
    case 'stopBreach':
      if (ctx.stop && ctx.price < ctx.stop * (c.ratio_lt ?? 1.0)) {
        return `stop 하향 돌파 (${ctx.price.toFixed(2)} < ${ctx.stop})`;
      }
      break;
    case 'stopProximity':
      if (ctx.stop && ctx.price / ctx.stop <= (c.ratio_lte ?? 1.05) && ctx.price >= ctx.stop) {
        return `stop 근접 (${(((ctx.price / ctx.stop) - 1) * 100).toFixed(1)}% 위)`;
      }
      break;
    case 'targetProximity':
      if (ctx.target && ctx.price / ctx.target >= (c.ratio_gte ?? 0.9)) {
        return `target ${((ctx.price / ctx.target) * 100).toFixed(0)}% 도달`;
      }
      break;
    case 'heldWithPnl':
      if (ctx.heldDays >= (c.min_days ?? 14) && ctx.pnl != null) {
        if (c.pnl_gte != null && ctx.pnl >= c.pnl_gte) return `보유 ${Math.round(ctx.heldDays)}일 +${ctx.pnl.toFixed(1)}% 익절`;
        if (c.pnl_lte != null && ctx.pnl <= c.pnl_lte) return `보유 ${Math.round(ctx.heldDays)}일 ${ctx.pnl.toFixed(1)}% 손절`;
      }
      break;
    case 'heldOnly':
      if (ctx.heldDays >= (c.min_days ?? 14)) return `보유 ${Math.round(ctx.heldDays)}일 회전`;
      break;
    // ── 기술적 ────────────────────────────────────────────────────────────────
    case 'deadCross':
      if (ctx.sma50 && ctx.sma200 && ctx.sma50 < ctx.sma200) {
        return `50MA(${ctx.sma50.toFixed(2)}) < 200MA(${ctx.sma200.toFixed(2)}) dead cross`;
      }
      break;
    case 'ma200Breach':
      if (ctx.sma200 && ctx.price < ctx.sma200) {
        return `현재 ${ctx.price.toFixed(2)} < 200MA ${ctx.sma200.toFixed(2)}`;
      }
      break;
    case 'rsiOverbought':
      if (ctx.rsi != null && ctx.rsi >= (c.rsi_gte ?? 75)) return `RSI ${ctx.rsi} 과매수`;
      break;
    case 'volumeDrop':
      if (ctx.volPct != null && ctx.change1d != null &&
          ctx.volPct <= (c.vol_pct_lte ?? -30) && ctx.change1d <= (c.price_drop_pct_lte ?? -3)) {
        return `volume ${ctx.volPct}% & 1d ${ctx.change1d}% distribution`;
      }
      break;
    // ── 기본적 ────────────────────────────────────────────────────────────────
    case 'opMarginDecline':
      if (ctx.opMarginDecline != null && ctx.opMarginDecline >= (c.decline_pp_gte ?? 2)) {
        return `op margin YoY -${ctx.opMarginDecline.toFixed(1)}%p 악화`;
      }
      break;
    case 'peVsSector':
      if (ctx.peRatio && ctx.sectorPe && ctx.peRatio / ctx.sectorPe >= 1 + (c.premium_pct_gte ?? 30) / 100) {
        return `P/E ${ctx.peRatio.toFixed(1)} vs sector ${ctx.sectorPe.toFixed(1)} 고평가`;
      }
      break;
    // ── 구루 ──────────────────────────────────────────────────────────────────
    case 'lynchPeg':
      if (ctx.peg != null && ctx.peg >= (c.peg_gte ?? 2)) return `Lynch PEG ${ctx.peg.toFixed(1)} 성장대비 고평가`;
      break;
    // ── 거시 ──────────────────────────────────────────────────────────────────
    case 'macroRisk':
      if (ctx.macroRiskLevel === (c.risk_level ?? 'high')) return `macro risk=${ctx.macroRiskLevel} (defensive 회전)`;
      break;
    case 'vixSpike':
      if (ctx.vix != null && ctx.vix >= (c.vix_gte ?? 25)) return `VIX ${ctx.vix.toFixed(1)} 변동성 급등`;
      break;
    case 'fgExtreme':
      if (ctx.fgScore != null && ctx.fgScore <= (c.fg_lte ?? 20)) return `F&G ${ctx.fgScore} extreme fear`;
      break;
    // ── 미시 (sector / region / news) ────────────────────────────────────────
    case 'sectorStance':
      if (ctx.sectorStance === (c.stance ?? 'underweight')) return `sector ${ctx.sector ?? ''} stance=${ctx.sectorStance}`;
      break;
    case 'regionStance':
      if (ctx.regionStance === (c.stance ?? 'bearish')) return `region ${ctx.market ?? ''} stance=${ctx.regionStance}`;
      break;
    case 'newsNegative':
      if (ctx.newsNegRatio != null && ctx.newsNegRatio >= (c.neg_ratio_gte ?? 0.6) &&
          ctx.newsArticleCount >= (c.min_articles ?? 3)) {
        return `최근 7d news ${(ctx.newsNegRatio * 100).toFixed(0)}% 부정 (${ctx.newsArticleCount}건)`;
      }
      break;
  }
  return null;
}

/**
 * 매도 후보 ticker 별 기술/기본 데이터 fetch (Yahoo OHLCV + company-financials/dart).
 * 후보가 12개 이하라 비용 작음.
 */
async function fetchSellSignals(tickers) {
  const out = new Map();
  if (!tickers.length) return out;
  await Promise.all(tickers.slice(0, 24).map(async ticker => {
    const sig = { rsi: null, sma50: null, sma200: null, volPct: null, opMarginDecline: null, peRatio: null, peg: null };
    try {
      const oh = await fetchOHLCV(ticker, '1y');
      if (oh?.closes?.length) {
        sig.rsi = computeRSI(oh.closes);
        sig.sma50 = computeSMA(oh.closes, 50);
        sig.sma200 = computeSMA(oh.closes, 200);
        if (oh.volumes?.length) sig.volPct = computeVolRatio(oh.volumes);
      }
    } catch { /* skip */ }
    try {
      const isKR = ticker.endsWith('.KS') || ticker.endsWith('.KQ');
      const url = isKR
        ? `${SITE}/api/company-kr/${ticker.replace(/\.(KS|KQ)$/, '')}`
        : `${SITE}/api/company-financials/${ticker}`;
      const d = await safeFetch(url, 5000);
      if (d) {
        // US: latestAnnual.operatingMarginPct + previousAnnual 비교
        const cur = d.latestAnnual?.operatingMarginPct;
        const prev = d.annuals?.[1]?.operatingMarginPct;
        if (cur != null && prev != null) sig.opMarginDecline = prev - cur;
        sig.peRatio = d.peRatio ?? null;
        // PEG = P/E / growth rate
        const growth = d.revenueYoYPct ?? d.quarterlyRevenue?.[0]?.yoyPct;
        if (sig.peRatio && growth && growth > 0) sig.peg = sig.peRatio / growth;
      }
    } catch { /* skip */ }
    out.set(ticker, sig);
  }));
  return out;
}

/**
 * 매수 룰 로드 + 매수 후보 평가 함수.
 * 4-stage scoring:
 *   Stage 1 (light): macro/sector/region/insider/squeeze/news/boost-list — 0초 비용
 *   Stage 2 (OHLCV): top 100 score 후보의 RSI/MA/volume fetch
 *   Stage 3 (financials): top 50 의 company-financials fetch → ROE/PE/PEG/Buffett moat
 *   Stage 4: top 30 → buildPortfolioPrompt 에 inject (LLM 이 최종 12 선택)
 */
function loadBuyRules() {
  try {
    return JSON.parse(readFileSync(resolve(ROOT, 'data/buy-rules-tuned.json'), 'utf8'));
  } catch (e) {
    console.warn(`  ⚠️ buy-rules-tuned.json 로드 실패: ${e.message}`);
    return null;
  }
}

function evaluateBuyRule(rule, ctx) {
  const c = rule.condition;
  switch (c.type) {
    // 기술
    case 'rsiOversold':
      if (ctx.rsi != null && ctx.rsi <= (c.rsi_lte ?? 35)) return `RSI ${ctx.rsi} 과매도`;
      break;
    case 'goldenCross':
      if (ctx.sma50 && ctx.sma200 && ctx.sma50 > ctx.sma200) return `50MA > 200MA golden cross`;
      break;
    case 'ma200Reclaim':
      if (ctx.sma200 && ctx.price > ctx.sma200 &&
          (ctx.price - ctx.sma200) / ctx.sma200 * 100 <= (c.above_pct_lte ?? 5)) {
        return `200MA reclaim (${(((ctx.price / ctx.sma200) - 1) * 100).toFixed(1)}% 위)`;
      }
      break;
    case 'volumeSurge':
      if (ctx.volPct != null && ctx.change1d != null &&
          ctx.volPct >= (c.vol_pct_gte ?? 50) && ctx.change1d >= (c.price_up_gte ?? 2)) {
        return `volume +${ctx.volPct}% & 1d +${ctx.change1d}% accumulation`;
      }
      break;
    // 기본
    case 'roeAbove':
      if (ctx.roe != null && ctx.roe >= (c.roe_pct_gte ?? 15)) return `ROE ${ctx.roe.toFixed(1)}%`;
      break;
    case 'opMarginExpand':
      if (ctx.opMarginExpand != null && ctx.opMarginExpand >= (c.expand_pp_gte ?? 2)) {
        return `op margin YoY +${ctx.opMarginExpand.toFixed(1)}%p`;
      }
      break;
    case 'peBelowSector':
      if (ctx.peRatio && ctx.sectorPe && ctx.peRatio / ctx.sectorPe <= 1 - (c.discount_pct_gte ?? 20) / 100) {
        return `P/E ${ctx.peRatio.toFixed(1)} vs sector ${ctx.sectorPe.toFixed(1)} 저평가`;
      }
      break;
    case 'revenueYoY':
      if (ctx.revenueGrowth != null && ctx.revenueGrowth >= (c.growth_pct_gte ?? 15)) {
        return `revenue YoY +${ctx.revenueGrowth.toFixed(1)}%`;
      }
      break;
    // 구루
    case 'lynchPeg':
      if (ctx.peg != null && ctx.peg > 0 && ctx.peg <= (c.peg_lte ?? 1.0)) {
        return `Lynch PEG ${ctx.peg.toFixed(2)} 성장대비 저평가`;
      }
      break;
    case 'buffettMoat':
      if (ctx.roe != null && ctx.opMargin != null &&
          ctx.roe >= (c.roe_pct_gte ?? 15) && ctx.opMargin >= (c.op_margin_pct_gte ?? 20)) {
        return `Buffett moat (ROE ${ctx.roe.toFixed(0)}% + opMgn ${ctx.opMargin.toFixed(0)}%)`;
      }
      break;
    case 'greenblattMagic':
      if (ctx.earningsYield != null && ctx.roic != null &&
          ctx.earningsYield >= (c.earnings_yield_gte ?? 10) && ctx.roic >= (c.roic_pct_gte ?? 25)) {
        return `Greenblatt magic (EY ${ctx.earningsYield.toFixed(1)}% + ROIC ${ctx.roic.toFixed(0)}%)`;
      }
      break;
    case 'grahamValue':
      if (ctx.peRatio && ctx.pbRatio &&
          ctx.peRatio <= (c.pe_lte ?? 15) && ctx.pbRatio <= (c.pb_lte ?? 1.5)) {
        return `Graham deep value (P/E ${ctx.peRatio.toFixed(1)} P/B ${ctx.pbRatio.toFixed(2)})`;
      }
      break;
    // 거시
    case 'macroRisk':
      if (ctx.macroRiskLevel === (c.risk_level ?? 'low')) return `macro risk=${ctx.macroRiskLevel} (risk-on)`;
      break;
    case 'vixLow':
      if (ctx.vix != null && ctx.vix <= (c.vix_lte ?? 14)) return `VIX ${ctx.vix.toFixed(1)} 안정`;
      break;
    case 'fgRecovery':
      if (ctx.fgScore != null && ctx.fgScore >= (c.fg_gte ?? 25) && ctx.fgScore <= (c.fg_lte ?? 50)) {
        return `F&G ${ctx.fgScore} 회복기`;
      }
      break;
    // 미시
    case 'sectorStance':
      if (ctx.sectorStance === (c.stance ?? 'overweight')) return `sector overweight`;
      break;
    case 'regionStance':
      if (ctx.regionStance === (c.stance ?? 'bullish')) return `region bullish`;
      break;
    case 'newsPositive':
      if (ctx.newsPosRatio != null && ctx.newsPosRatio >= (c.pos_ratio_gte ?? 0.6) &&
          ctx.newsArticleCount >= (c.min_articles ?? 3)) {
        return `news +${(ctx.newsPosRatio * 100).toFixed(0)}% (${ctx.newsArticleCount}건)`;
      }
      break;
    case 'insiderBuy':
      if (ctx.insiderFilings != null && ctx.insiderFilings >= (c.filings_gte ?? 3)) {
        return `insider ${ctx.insiderFilings}건 매수`;
      }
      break;
    case 'squeezeScore':
      if (ctx.squeezeScore != null && ctx.squeezeScore >= (c.score_gte ?? 50)) {
        return `squeeze ${ctx.squeezeScore}`;
      }
      break;
    case 'cascadeUpstream':
      if (ctx.cascadeUpstream === true) return `cascade upstream beneficiary`;
      break;
    case 'boostList':
      if (ctx.boostListMember === true) return `boost-list (과거 avg_pnl ≥ 5%)`;
      break;
    case 'banList':
      if (ctx.banListMember === true) return `BAN: 2+ stops/0 hits`;
      break;
  }
  return null;
}

/**
 * Stage 2: top N 후보의 OHLCV fetch — RSI / 50MA / 200MA / volume.
 */
async function fetchBuyTechSignals(tickers) {
  const out = new Map();
  await Promise.all(tickers.slice(0, 100).map(async ticker => {
    const sig = { rsi: null, sma50: null, sma200: null, volPct: null };
    try {
      const oh = await fetchOHLCV(ticker, '1y');
      if (oh?.closes?.length) {
        sig.rsi = computeRSI(oh.closes);
        sig.sma50 = computeSMA(oh.closes, 50);
        sig.sma200 = computeSMA(oh.closes, 200);
        if (oh.volumes?.length) sig.volPct = computeVolRatio(oh.volumes);
      }
    } catch { /* skip */ }
    out.set(ticker, sig);
  }));
  return out;
}

/**
 * Stage 3: top N 후보의 company-financials fetch — ROE / PE / PEG / op margin.
 */
async function fetchBuyFundSignals(tickers) {
  const out = new Map();
  await Promise.all(tickers.slice(0, 50).map(async ticker => {
    const sig = {};
    try {
      const isKR = ticker.endsWith('.KS') || ticker.endsWith('.KQ');
      const url = isKR
        ? `${SITE}/api/company-kr/${ticker.replace(/\.(KS|KQ)$/, '')}`
        : `${SITE}/api/company-financials/${ticker}`;
      const d = await safeFetch(url, 5000);
      if (d) {
        const cur = d.latestAnnual?.operatingMarginPct;
        const prev = d.annuals?.[1]?.operatingMarginPct;
        if (cur != null && prev != null) sig.opMarginExpand = cur - prev;
        sig.opMargin = cur;
        sig.roe = d.latestAnnual?.roePct ?? null;
        sig.peRatio = d.peRatio ?? null;
        sig.pbRatio = d.pbRatio ?? null;
        sig.revenueGrowth = d.revenueYoYPct ?? d.quarterlyRevenue?.[0]?.yoyPct ?? null;
        if (sig.peRatio && sig.revenueGrowth && sig.revenueGrowth > 0) sig.peg = sig.peRatio / sig.revenueGrowth;
        // Greenblatt: EBIT / EV (earnings yield)
        sig.earningsYield = d.earningsYield ?? null;
        sig.roic = d.roic ?? null;
      }
    } catch { /* skip */ }
    out.set(ticker, sig);
  }));
  return out;
}

async function buildBuyCandidates(livePrices, macroCtx = {}, topN = 30) {
  const ruleSpec = loadBuyRules();
  if (!ruleSpec?.rules?.length) return [];

  // ban-list / boost-list 로드
  const banList = new Set();
  const boostList = new Set();
  try {
    const bl = JSON.parse(readFileSync(resolve(ROOT, 'data/ban-list.json'), 'utf8'));
    for (const t of (Array.isArray(bl) ? bl : bl.tickers ?? [])) banList.add(typeof t === 'string' ? t : t.ticker);
  } catch { /* skip */ }
  try {
    const bl = JSON.parse(readFileSync(resolve(ROOT, 'data/boost-list.json'), 'utf8'));
    for (const t of (Array.isArray(bl) ? bl : [])) boostList.add(t.ticker ?? t);
  } catch { /* skip */ }

  // 메타데이터 (sector / market) 로드
  const tickerMeta = (() => {
    try { return JSON.parse(readFileSync(resolve(ROOT, 'data/candidate-tickers.json'), 'utf8')); }
    catch { return { meta: {} }; }
  })();

  // ── Stage 1 (light): 모든 livePrices ticker 에 대해 macro/sector/region/insider/squeeze/news/boost ──
  const allTickers = [...livePrices.keys()];
  console.log(`  [buy-cand Stage 1] ${allTickers.length} ticker 가벼운 score 계산...`);
  const stage1Scored = [];
  for (const ticker of allTickers) {
    if (banList.has(ticker)) continue;
    const pd = livePrices.get(ticker);
    if (!pd?.price) continue;
    const isKR = ticker.endsWith('.KS') || ticker.endsWith('.KQ');
    const meta = tickerMeta.meta?.[ticker] ?? {};
    const sectorKey = String(meta.sector ?? '').toLowerCase();
    const ctx = {
      ticker, price: pd.price, change1d: pd.change1d, sector: meta.sector,
      market: isKR ? 'kr' : 'us',
      macroRiskLevel: macroCtx.riskLevel,
      vix: macroCtx.vix,
      fgScore: macroCtx.fgScore,
      sectorStance: macroCtx.sectorStanceMap?.get(sectorKey),
      regionStance: macroCtx.regionStanceMap?.get(isKR ? 'kr' : 'us'),
      newsPosRatio: macroCtx.newsSentimentMap?.get(ticker)?.posRatio ?? null,
      newsArticleCount: macroCtx.newsSentimentMap?.get(ticker)?.count ?? 0,
      insiderFilings: macroCtx.insiderMap?.get(ticker) ?? 0,
      squeezeScore: macroCtx.squeezeMap?.get(ticker) ?? null,
      cascadeUpstream: macroCtx.cascadeUpstreamSet?.has(ticker) ?? false,
      boostListMember: boostList.has(ticker),
      banListMember: banList.has(ticker),
    };
    let cumScore = 0;
    const reasons = [];
    for (const rule of ruleSpec.rules) {
      // 가벼운 룰만 stage 1 — 기술/기본/구루 제외 (필요 데이터 없음)
      if (['technical', 'fundamental', 'guru'].includes(rule.category)) continue;
      const r = evaluateBuyRule(rule, ctx);
      if (r) { cumScore += rule.score; reasons.push({ ruleId: rule.id, score: rule.score, reason: r }); }
    }
    if (cumScore <= -50) continue; // ban
    if (cumScore > 0) stage1Scored.push({ ticker, sector: meta.sector ?? 'Unknown', market: isKR ? 'kr' : 'us', stage1Score: cumScore, reasons, price: pd.price });
  }
  stage1Scored.sort((a, b) => b.stage1Score - a.stage1Score);
  const stage2Cands = stage1Scored.slice(0, 100); // top 100 → Stage 2

  // ── Stage 2 (OHLCV): top 100 의 기술 시그널 ──
  console.log(`  [buy-cand Stage 2] top ${stage2Cands.length} OHLCV fetch...`);
  const techSignals = await fetchBuyTechSignals(stage2Cands.map(c => c.ticker));
  for (const c of stage2Cands) {
    const sig = techSignals.get(c.ticker) ?? {};
    const ctx = { ...c, ...sig, sma50: sig.sma50, sma200: sig.sma200, rsi: sig.rsi, volPct: sig.volPct };
    for (const rule of ruleSpec.rules) {
      if (rule.category !== 'technical') continue;
      const r = evaluateBuyRule(rule, ctx);
      if (r) { c.stage1Score += rule.score; c.reasons.push({ ruleId: rule.id, score: rule.score, reason: r }); }
    }
  }
  stage2Cands.sort((a, b) => b.stage1Score - a.stage1Score);
  const stage3Cands = stage2Cands.slice(0, 50);

  // ── Stage 3 (financials): top 50 의 기본/구루 시그널 ──
  console.log(`  [buy-cand Stage 3] top ${stage3Cands.length} company-financials fetch...`);
  const fundSignals = await fetchBuyFundSignals(stage3Cands.map(c => c.ticker));
  const sectorPeMap = macroCtx.sectorPeMap ?? new Map();
  for (const c of stage3Cands) {
    const sig = fundSignals.get(c.ticker) ?? {};
    const sectorKey = String(c.sector ?? '').toLowerCase();
    const ctx = { ...c, ...sig, sectorPe: sectorPeMap.get(sectorKey) ?? null };
    for (const rule of ruleSpec.rules) {
      if (!['fundamental', 'guru'].includes(rule.category)) continue;
      const r = evaluateBuyRule(rule, ctx);
      if (r) { c.stage1Score += rule.score; c.reasons.push({ ruleId: rule.id, score: rule.score, reason: r }); }
    }
  }
  stage3Cands.sort((a, b) => b.stage1Score - a.stage1Score);
  const finalCands = stage3Cands.slice(0, topN);
  console.log(`  [buy-cand 최종] top ${finalCands.length}: ${finalCands.slice(0, 8).map(c => `${c.ticker}(${c.stage1Score})`).join(' ')}...`);
  return finalCands;
}

async function buildSellCandidates(livePrices, excludeTickers = new Set(), macroCtx = {}) {
  const ruleSpec = loadSellRules();
  if (!ruleSpec?.rules?.length) return { us: [], kr: [], total: 0 };
  // 1단계: DB 에서 후보 추출 (still_holding + recent 30d buy)
  // 2단계: 후보 ticker 의 시그널 fetch (RSI/MA/op margin/PE)
  // 3단계: 룰 매칭 + score
  try {
    const db = new Database(resolve(ROOT, 'data/flowvium.db'), { readonly: true });
    // still_holding 또는 최근 30일 buy 추천 — ticker 별 가장 최근 entry 만
    const rows = db.prepare(`
      SELECT r.ticker, r.market, r.sector, r.target, r.stop_loss,
             r.price_at_gen, r.generated_at, r.name, r.action, r.currency,
             o.outcome, o.pnl_pct, o.evaluated_at
      FROM recommendations r
      LEFT JOIN recommendation_outcomes o ON r.id = o.recommendation_id
      WHERE r.action = 'buy'
        AND r.generated_at >= date('now', '-30 days')
        AND (o.outcome IS NULL OR o.outcome IN ('still_holding', 'not_entered', 'unknown'))
      ORDER BY r.generated_at DESC
    `).all();
    db.close();

    // ticker 별 최신 1건만 (중복 제거)
    const byTicker = new Map();
    for (const r of rows) {
      if (!byTicker.has(r.ticker)) byTicker.set(r.ticker, r);
    }

    // 후보 ticker 의 multi-factor 시그널 fetch (RSI/MA/op margin/PE)
    const candTickers = [...byTicker.keys()].filter(t => livePrices.has(t) && !excludeTickers.has(t));
    macroCtx.signals = await fetchSellSignals(candTickers);

    const candidates = [];
    const now = Date.now();
    for (const [ticker, r] of byTicker) {
      if (excludeTickers.has(ticker)) continue; // 이번 cycle 새 추천에 있음
      const pd = livePrices.get(ticker);
      if (!pd?.price) continue;
      const isKR = ticker.endsWith('.KS') || ticker.endsWith('.KQ');
      const price = pd.price;
      const target = r.target;
      const stop = r.stop_loss;
      const heldDays = (now - new Date(r.generated_at).getTime()) / 86400000;
      const pnl = r.pnl_pct ?? (r.price_at_gen ? ((price - r.price_at_gen) / r.price_at_gen) * 100 : null);

      const sig = macroCtx.signals?.get(ticker) ?? {};
      const sectorKey = (r.sector ?? '').toLowerCase();
      const evalCtx = {
        price, stop, target, heldDays, pnl, sector: r.sector,
        change1d: pd.change1d ?? null,
        // 기술
        rsi: sig.rsi, sma50: sig.sma50, sma200: sig.sma200, volPct: sig.volPct,
        // 기본
        opMarginDecline: sig.opMarginDecline, peRatio: sig.peRatio, peg: sig.peg,
        sectorPe: macroCtx.sectorPeMap?.get(sectorKey) ?? null,
        // 거시
        macroRiskLevel: macroCtx.riskLevel ?? null,
        vix: macroCtx.vix ?? null,
        fgScore: macroCtx.fgScore ?? null,
        // 미시 — sector / region stance
        sectorStance: macroCtx.sectorStanceMap?.get(sectorKey) ?? null,
        market: isKR ? 'kr' : 'us',
        regionStance: macroCtx.regionStanceMap?.get(isKR ? 'kr' : 'us') ?? null,
        // 뉴스 sentiment
        newsNegRatio: macroCtx.newsSentimentMap?.get(ticker)?.negRatio ?? null,
        newsArticleCount: macroCtx.newsSentimentMap?.get(ticker)?.count ?? 0,
      };
      let matchedRule = null, reason = null;
      // 룰 순서 = JSON 순서. 첫 매칭 룰 채택 (priority = JSON 순서).
      for (const rule of ruleSpec.rules) {
        const result = evaluateSellRule(rule, evalCtx);
        if (result) { matchedRule = rule; reason = result; break; }
      }
      if (!matchedRule) continue;

      const fmt = n => isKR ? `₩${Math.round(n).toLocaleString()}` : `$${n.toFixed(2)}`;
      candidates.push({
        ticker, name: r.name ?? ticker, sector: r.sector ?? 'Unknown',
        market: isKR ? 'kr' : 'us',
        score: matchedRule.score,
        ruleId: matchedRule.id,
        urgency: matchedRule.urgency,
        reason,
        currentPrice: fmt(price),
        entryPrice: r.price_at_gen ? fmt(r.price_at_gen) : null,
        target: target ? fmt(target) : null,
        stopLoss: stop ? fmt(stop) : null,
        pnlPct: pnl != null ? Math.round(pnl * 10) / 10 : null,
        heldDays: Math.round(heldDays),
        outcome: r.outcome ?? 'open',
      });
    }
    // 각 후보에 Exit Ladder (Klarman 부분 매도) 자동 생성
    for (const c of candidates) buildExitLadder(c);
    // score desc, then pnl desc
    candidates.sort((a, b) => b.score - a.score || (b.pnlPct ?? 0) - (a.pnlPct ?? 0));
    const us = candidates.filter(c => c.market === 'us').slice(0, 6);
    const kr = candidates.filter(c => c.market === 'kr').slice(0, 6);
    return { us, kr, total: us.length + kr.length };
  } catch (e) {
    console.warn('  ⚠️ buildSellCandidates 실패:', e.message);
    return { us: [], kr: [], total: 0 };
  }
}

/**
 * Exit Ladder — 룰 type 별 부분 매도 패턴 자동 생성. Klarman ladder exit + Druckenmiller trailing.
 *   stop_breach / 200ma_breach / dead_cross    → 즉시 전량 (100%)
 *   stop_near                                  → 50% 즉시 + 50% rebound 시
 *   target_near / rsi_overbought / lynch_peg   → 1/3 즉시 / 1/3 +5% / 1/3 trailing
 *   margin_decline / pe_expansion              → 50% 즉시 + 50% 다음 보고서까지 모니터링
 *   rotation_profit                            → 1/3 즉시 / 1/3 stop=entry / 1/3 trailing -5%
 *   rotation_loss                              → 전량 즉시 (손절)
 *   rotation_neutral / sector_underweight /    → 1/3 즉시 / 2/3 다음 cycle 재평가
 *     region_bearish / news_negative /
 *     vix_spike / fg_extreme / volume_dry      → 1/3 즉시 / 2/3 모니터링
 * 결과: c.sellLadder = [{ pct: 33, price: '$X', label: '즉시', action: 'reduce' }, ...]
 */
function buildExitLadder(c) {
  const price = parsePrice(c.currentPrice);
  if (!price || !isFinite(price)) { c.sellLadder = []; return; }
  const isKR = c.market === 'kr';
  const fmt = n => isKR ? `₩${Math.round(n).toLocaleString()}` : `$${n.toFixed(2)}`;

  const liquidateAll = [{ pct: 100, price: fmt(price), label: '즉시 전량', action: 'liquidate' }];
  const half_now_half_rebound = [
    { pct: 50, price: fmt(price), label: '즉시 50% 정리', action: 'reduce' },
    { pct: 50, price: fmt(price * 1.03), label: '+3% rebound 시 잔량', action: 'reduce' },
  ];
  const third_immediate_third_5pct_third_trail = [
    { pct: 33, price: fmt(price), label: '즉시 1/3 (익절 시작)', action: 'reduce' },
    { pct: 33, price: fmt(price * 1.05), label: '+5% 도달 시 1/3', action: 'reduce' },
    { pct: 34, price: fmt(price * 0.95), label: 'trailing -5% 또는 보유 지속', action: 'trail' },
  ];
  const rotation_profit_ladder = [
    { pct: 33, price: fmt(price), label: '즉시 1/3 정리', action: 'reduce' },
    { pct: 33, price: fmt(parsePrice(c.entryPrice) ?? price * 0.95), label: 'stop을 entry로 이동 (breakeven lock)', action: 'move_stop' },
    { pct: 34, price: fmt(price * 0.95), label: 'trailing -5% 유지', action: 'trail' },
  ];
  const third_now_two_third_monitor = [
    { pct: 33, price: fmt(price), label: '즉시 1/3 정리', action: 'reduce' },
    { pct: 67, price: fmt(price), label: '2/3 다음 cycle 재평가', action: 'monitor' },
  ];

  switch (c.ruleId) {
    case 'price_stop_breach':
    case 'tech_200ma_breach':
    case 'tech_dead_cross':
    case 'rotation_loss':
      c.sellLadder = liquidateAll; break;
    case 'price_stop_near':
    case 'fund_margin_decline':
    case 'fund_pe_expansion':
      c.sellLadder = half_now_half_rebound; break;
    case 'price_target_near':
    case 'tech_rsi_overbought':
    case 'guru_lynch_overvalued':
      c.sellLadder = third_immediate_third_5pct_third_trail; break;
    case 'rotation_profit':
      c.sellLadder = rotation_profit_ladder; break;
    default:
      c.sellLadder = third_now_two_third_monitor; break;
  }
}

function parsePrice(s) {
  if (s == null) return null;
  if (typeof s === 'number') return s;
  const m = String(s).replace(/[$₩€,\s]/g, '').match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

/** 매도 후보 → LLM rationale prompt (짧은 한 줄 reason + 회전 제안). */
function buildSellRationalePrompt(sellCands) {
  const items = [...sellCands.us, ...sellCands.kr].map(c =>
    `- ${c.ticker} (${c.market}, ${c.sector}, 보유 ${c.heldDays}일, ${c.pnlPct != null ? (c.pnlPct >= 0 ? '+' : '') + c.pnlPct + '%' : 'pnl미상'}): score=${c.score}, ${c.reason}. current=${c.currentPrice} entry=${c.entryPrice ?? 'N/A'} target=${c.target ?? 'N/A'} stop=${c.stopLoss ?? 'N/A'}`
  ).join('\n');
  return [
    `You are a portfolio manager generating SELL recommendations in ${TARGET_LANG}.${li}`,
    '',
    'These are past BUY picks that NOW meet sell criteria:',
    items,
    '',
    'For each ticker, write a sell rationale (≤80 chars) explaining WHY now is the sell moment.',
    'sellType = "stop_breach" | "stop_near" | "target_near" | "rotation_profit" | "rotation_loss" | "rotation_neutral".',
    '',
    'Respond pure JSON:',
    '{"sellRecommendations":[{"ticker":"NVDA","sellType":"target_near","rationale":"[≤80 chars]","urgency":"high|medium|low"}]}',
    'urgency: high=stop breach/imminent, medium=target proximity or rotation profit, low=time-based rotation.',
    'Pure JSON only. NO markdown.',
  ].join('\n');
}

function buildPortfolioPrompt(ctx, sectorPe, earnings, priceData, buyCandidates = []) {
  const recentTickers = getRecentTickers();
  const qualityFeedback = getRecentQualityFeedback();
  const { feedback: portfolioFeedback } = getPortfolioFeedback();
  if (portfolioFeedback) {
    console.log('  [F22/Portfolio Feedback] prompt 에 outcome 통계 inject ✓');
    console.log('    ' + portfolioFeedback.split('\n').slice(0, 2).join(' | '));
  }
  // 2026-05-29 F24: 세션별 시장 focus inject — 해당 시장 종목 비중 강화
  const session = getSession();
  const focus = getSessionFocus(session);
  const focusBlock = `[Session Focus] ${session.toUpperCase()} (${focus.label})\n` +
    `Primary 시장: ${focus.primary} | 보조: ${focus.secondary.join('/')}\n` +
    `목표 비중: ${Object.entries(focus.marketWeight).map(([k,v])=>`${k.toUpperCase()} ${v}%`).join(' / ')}\n` +
    `→ 이 세션은 위 primary 시장 종목을 우선 추천 (해당 시장 ≥${focus.marketWeight[focus.primary] ?? 50}%).`;
  // 2026-05-29: Karpathy pathway 작동 검증 — prompt inject 여부 stdout 로 표시.
  if (qualityFeedback) {
    console.log('  [F19/SkillOpt] prompt 에 Quality Feedback inject ✓');
    console.log('    ' + qualityFeedback.split('\n').slice(0, 2).join(' | '));
  } else {
    console.log('  [F19/SkillOpt] ⚠️  qualityFeedback 빈 문자열 — DB 비어있거나 import 실패');
  }
  return [
    buildGroundingFacts(priceData),
    '',
    qualityFeedback,  // 2026-05-27 SkillOpt: 자체 quality 추세 + 약점 인지
    portfolioFeedback,  // 2026-05-29 F22: 이전 portfolio outcome 통계 자가 학습
    focusBlock,  // 2026-05-29 F24: 세션별 시장 focus (morning=US / afternoon=KR / evening=US-pre)
    qualityFeedback ? '' : null,
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
    '** Sector ETF rotation 권장 (sector-tilt 알파): VIX>20 → XLP/XLU/XLV (defensive) / VIX<14 → XLK/XLY (cyclical) **',
    '** Sector ETF (XLK/XLE/XLF/XLV/XLI/XLY/XLP/XLU/XLB/XLRE) 1-2개 포함 권장 (sector rotation, 10-15% each) **',
    '** Passive 인덱스 ETF (SPY/QQQ/VTI) + bonds ≤ 20% total **',
    '** 🎯 EXACTLY 12 stocks REQUIRED: 6 US-market (NYSE/NASDAQ) + 6 KR-market (.KS/.KQ). Session 무관 균등 보장. **',
    '** Each stock 5-12% allocation (sum=100). KR ticker 부족 시 [Live Prices] 의 KOSPI 200 / KOSDAQ 150 large-cap 활용. **',
    '** ⚠️ Tech 합계 ≤ 50% allocation (Tech 집중 회피, sector Sharpe: Consumer Disc 5.13 > Materials 2.79 > Tech 2.17) **',
    '** ⚠️ KR ticker (.KS) — 통화 ₩ (원화) 강제. $ 단위 절대 금지. 한국명: 005490=POSCO홀딩스, 005380=현대차, 035420=NAVER, 000660=SK하이닉스, 051910=LG화학, 005930=삼성전자 **',
    '',
    recentTickers.length ? `[ROTATION — last 10 reports used these tickers (AVOID): ${recentTickers.join(', ')}]` : '',
    '** 🔄 ROTATION RULE (강제 — 종목 다양성):',
    '   - ≥ 3 종목은 위 recent list 에 없는 NEW ticker (반복 메가캡 회피).',
    '   - [Live Prices] 의 mid-cap / large-cap pool 활용 — Healthcare (LLY/UNH/NVO/REGN/PFE), ',
    '     Financials (JPM/V/MA/GS/BLK), Defense (LMT/RTX/NOC/KTOS), Energy (XOM/CVX/SLB/ALB),',
    '     Industrials (CAT/HON/UNP/DE/GE/ETN), Consumer (COST/HD/SBUX/MCD/NKE) 등 600+ candidate 활용.',
    '   - 630 종목 중 매번 같은 10 종목만 추천하면 ALPHA 0 — diversification 필수.',
    ' **',
    '',
    'RULES:',
    '1. EXACTLY 12 items: 6 US + 6 KR (KR ticker MUST end with .KS or .KQ). ONLY pick tickers in [Live Prices].',
    '   US 6개 < 6 또는 KR 6개 < 6 이면 보고서 reject. Sector ETF 는 US 6 안에 포함 가능 (.KS/.KQ 제외).',
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
    '   ⚠️ KR tickers (.KS) — morning session 은 KST 장 미개장. Live Prices = 전일 종가.',
    '   한국 종목은 entry zone 을 더 넓게 (시장가 ±5%) 잡거나 action=watch 로 권장.',
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
    getSellLearningBlock(),
    // 2026-05-29: Stage 1+2+3 룰 score 결과 — LLM 이 final 12 선택할 때 참고
    buyCandidates.length ? [
      '[BUY CANDIDATES — 1,200+ ticker 4-stage scoring 결과 top 30]',
      '(score = cumulative sum of 23 rules: tech/fund/구루/macro/micro/selflearn)',
      ...buyCandidates.slice(0, 30).map((c, i) =>
        `  ${(i + 1).toString().padStart(2)}. ${c.ticker.padEnd(11)} score=${c.stage1Score} (${c.market}/${c.sector}) — ${c.reasons.slice(0, 3).map(r => r.ruleId).join(', ')}`
      ),
      'GUIDANCE: 위 score 는 정량 룰 결과. LLM 은 이 candidate pool 안에서 최종 12개 선택 — score 높은 것 우선.',
      'KR 6개 / US 6개 균등 강제는 score 와 무관하게 적용. KR candidate 가 6 미만이면 score 낮아도 추가.',
      '',
    ].join('\n') : '',
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
    'EXACTLY 12 portfolio items (US 6 + KR 6), 5 sectorAllocation items. Pure JSON only.',
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

  // 2026-05-29: 매수 후보 4-stage scoring (Wave 1 portfolio LLM 호출 직전)
  // macro/sector/region 데이터는 ctxRaw 에서 추출. 매도와 동일 macroCtx 재사용.
  console.log('\n[1.5/7] 매수 후보 4-stage scoring (1,200+ ticker)...');
  const buyMacroCtx = {
    riskLevel: null, // Wave 1 macroData 가 아직 없음 — fg/vix 만 활용
    vix: ctxRaw?.volatility?.score ?? ctxRaw?.vix?.score ?? null,
    fgScore: ctxRaw?.fearGreed?.score ?? ctxRaw?.fear_greed?.score ?? null,
    sectorPeMap: new Map((sectorPe ?? []).map(s => [String(s.sector ?? '').toLowerCase(), s.peAvg ?? s.peRatio])),
    sectorStanceMap: new Map(), // Wave1 후 채워질 데이터 — Stage 1 에는 빈 Map
    regionStanceMap: new Map(),
    newsSentimentMap: (() => {
      const m = new Map();
      for (const a of (ctxRaw?.news?.articles ?? [])) {
        for (const t of (a.tickers ?? [])) {
          if (!m.has(t)) m.set(t, { pos: 0, neg: 0, count: 0 });
          const s = m.get(t); s.count++;
          if (a.sentiment === 'positive' || a.sentiment === 'bullish') s.pos++;
          else if (a.sentiment === 'negative' || a.sentiment === 'bearish') s.neg++;
        }
      }
      for (const [, v] of m) {
        v.posRatio = v.count ? v.pos / v.count : 0;
        v.negRatio = v.count ? v.neg / v.count : 0;
      }
      return m;
    })(),
    insiderMap: new Map((ctxRaw?.insider ?? []).map(i => [i.ticker, i.filings ?? i.count ?? 1])),
    squeezeMap: new Map((ctxRaw?.shorts ?? ctxRaw?.shortSqueeze ?? []).map(s => [s.ticker, s.score ?? s.squeezeScore])),
    cascadeUpstreamSet: new Set((ctxRaw?.cascade ?? []).flatMap(c => (c.downstreamBeneficiaries ?? []).map(d => d.ticker ?? d))),
  };
  const buyCandidates = await buildBuyCandidates(livePrices, buyMacroCtx, 30);

  // ── [2/7] Wave 1: 5섹션 병렬 ─────────────────────────────────────────────────
  console.log('\n[2/7] Wave1 — 5개 병렬 Ollama 호출 (macro/portfolio/regional/opportunity/narrative)...');
  const wave1Start = Date.now();
  const [macroRaw, portfolioRaw, regionalRaw, opportunityRaw, narrativeRaw] = await Promise.all([
    callOllama(buildMacroPrompt(ctxWithCascade, ctx.vixCtx, session), modelArg, 360000, 'macro'),
    callOllama(buildPortfolioPrompt(ctxWithCascade, sectorPe, earnings, priceData, buyCandidates), modelArg, 360000, 'portfolio'),
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

  // Portfolio US 6 + KR 6 강제 — 2 retry → 부족 시 candidate pool padding
  const countByMarket = (arr) => {
    const items = arr ?? [];
    const kr = items.filter(p => p.ticker?.endsWith('.KS') || p.ticker?.endsWith('.KQ')).length;
    const us = items.length - kr;
    return { us, kr, total: items.length };
  };
  const pickBetter = (a, b) => {
    const ca = countByMarket(a?.portfolio), cb = countByMarket(b?.portfolio);
    const scoreA = Math.min(ca.us, 6) + Math.min(ca.kr, 6);
    const scoreB = Math.min(cb.us, 6) + Math.min(cb.kr, 6);
    return scoreB > scoreA ? b : a;
  };
  let portfolioCounts = countByMarket(portfolioData?.portfolio);
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (portfolioCounts.us >= 6 && portfolioCounts.kr >= 6) break;
    console.log(`  portfolio US ${portfolioCounts.us}/6 + KR ${portfolioCounts.kr}/6 — retry ${attempt}/2 ...`);
    const portfolioRetry = await callOllama(buildPortfolioPrompt(ctxWithCascade, sectorPe, earnings, priceData, buyCandidates), modelArg, 360000, `portfolio-retry-${attempt}`);
    const portfolioRetryData = parseJson(portfolioRetry, `portfolio-retry-${attempt}`);
    portfolioData = pickBetter(portfolioData, portfolioRetryData);
    portfolioCounts = countByMarket(portfolioData?.portfolio);
    console.log(`  retry ${attempt} 결과 (best so far): US ${portfolioCounts.us} + KR ${portfolioCounts.kr} = ${portfolioCounts.total}`);
  }
  if (portfolioCounts.total < 6) {
    console.error('❌ Wave1 포트폴리오 생성 실패 (3회, total < 6). 종료합니다.');
    process.exit(1);
  }
  // candidate pool 에서 부족분 자동 padding (US/KR 별도)
  if (portfolioCounts.us < 6 || portfolioCounts.kr < 6) {
    try {
      const tickerMeta = JSON.parse(readFileSync(resolve(ROOT, 'data/candidate-tickers.json'), 'utf8'));
      const existing = new Set((portfolioData.portfolio ?? []).map(p => p.ticker));
      const isKR = (t) => t.endsWith('.KS') || t.endsWith('.KQ');
      const pad = (need, krFilter) => {
        const pool = (tickerMeta.tickers ?? []).filter(t =>
          livePrices.has(t) && !existing.has(t) && (krFilter ? isKR(t) : !isKR(t))
        );
        // 시총 우선: titan/mega/large 먼저, mid/kr 그 다음
        const rank = (t) => ({ titan: 0, mega: 1, large: 2, mid: 3, kr: 2, etf: 4 }[tickerMeta.meta?.[t]?.cap] ?? 5);
        pool.sort((a, b) => rank(a) - rank(b));
        const picks = pool.slice(0, need);
        const padded = picks.map(t => {
          const pd = livePrices.get(t);
          const isK = isKR(t);
          const fmt = n => isK ? `₩${Math.round(n).toLocaleString()}` : `$${n.toFixed(2)}`;
          const meta = tickerMeta.meta?.[t] ?? {};
          const actual = pd?.price ?? 100;
          existing.add(t);
          return {
            ticker: t, name: meta.name ?? t, sector: meta.sector ?? 'Unknown',
            market: isK ? 'korea' : 'us',
            rationale: `${t} — ${meta.sector ?? '섹터'} 분산 (US/KR 균형 자동 보충)`,
            allocation: 8,
            entryZone: `${fmt(actual * 0.98)}-${fmt(actual * 1.01)}`,
            entryRationale: `시장가 -1% 진입 (auto-pad)`,
            stopLoss: fmt(actual * 0.93),
            target: fmt(actual * 1.10),
            targetBull: fmt(actual * 1.20),
            targetRationale: '시장가 +10% 보수적 target',
            confidence: 'medium',
            action: 'buy',
            catalysts: [`${t} cap=${meta.cap ?? '?'} candidate pool top-rank pick`, `시장가 ${fmt(actual)} 기준 ±10% band`],
            fundamentalBasis: `Sector=${meta.sector ?? '?'}, 시장가 ${fmt(actual)}`,
            technicalBasis: `시장가 ${fmt(actual)} 기준 -7% stop / +10% target`,
            riskNote: `Auto-pad — 추가 검증 후 진입 권장`,
          };
        });
        return padded;
      };
      const usNeed = Math.max(0, 6 - portfolioCounts.us);
      const krNeed = Math.max(0, 6 - portfolioCounts.kr);
      const addUs = usNeed > 0 ? pad(usNeed, false) : [];
      const addKr = krNeed > 0 ? pad(krNeed, true) : [];
      portfolioData.portfolio = [...(portfolioData.portfolio ?? []), ...addUs, ...addKr];
      const after = countByMarket(portfolioData.portfolio);
      console.log(`  ➕ auto-pad: +US ${addUs.length} +KR ${addKr.length} → US ${after.us} + KR ${after.kr} = ${after.total}`);
    } catch (e) {
      console.warn(`  ⚠️ auto-pad 실패: ${e.message}`);
    }
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

  // 2026-05-29: 매도 후보 — multi-factor (가격/tech/fund/구루/macro/micro) + Karpathy outcome 학습.
  const excludeForSell = new Set(portfolioItemsDeduped.map(p => p.ticker));
  const sectorPeMap = new Map((sectorPe ?? []).map(s => [String(s.sector ?? '').toLowerCase(), s.peAvg ?? s.peRatio]));
  const sectorStanceMap = new Map((portfolioData?.sectorAllocation ?? []).map(s => [String(s.sector ?? '').toLowerCase(), s.stance]));
  const regionStanceMap = new Map(Object.entries(regionalData?.regionStances ?? {}).map(([k, v]) => [k === 'korea' ? 'kr' : k, v?.stance]));
  // 뉴스 sentiment ticker 별 집계
  const newsSentimentMap = new Map();
  for (const a of (ctx.news?.articles ?? ctxRaw?.news?.articles ?? [])) {
    for (const t of (a.tickers ?? [])) {
      if (!newsSentimentMap.has(t)) newsSentimentMap.set(t, { neg: 0, count: 0 });
      const s = newsSentimentMap.get(t);
      s.count++;
      if (a.sentiment === 'negative' || a.sentiment === 'bearish') s.neg++;
    }
  }
  for (const [t, v] of newsSentimentMap) v.negRatio = v.count ? v.neg / v.count : 0;
  const macroCtx = {
    riskLevel: macroData?.riskLevel ?? null,
    vix: ctxRaw?.volatility?.score ?? ctxRaw?.vix?.score ?? null,
    fgScore: ctxRaw?.fearGreed?.score ?? ctxRaw?.fear_greed?.score ?? null,
    sectorPeMap, sectorStanceMap, regionStanceMap, newsSentimentMap,
  };
  const sellCands = await buildSellCandidates(livePrices, excludeForSell, macroCtx);
  console.log(`  매도 후보: US ${sellCands.us.length} + KR ${sellCands.kr.length} = ${sellCands.total} (multi-factor)`);

  const wave2Start = Date.now();
  const wave2Calls = [
    callOllama(buildRiskMgmtPrompt(portfolioItemsDeduped, macroData?.riskLevel ?? 'medium', ctx.bbWarnings, ctx.vixCtx), modelArg, 360000, 'risk'),
    callOllama(buildCompanyChangesPrompt(portfolioItemsDeduped, earnings, ctx.institutional, ctx.news, companyFinancials), modelArg, 360000, 'companyChanges'),
  ];
  if (buyStocksDeduped.length > 0) {
    wave2Calls.push(callOllama(buildStockDetailPrompt(buyStocksDeduped, ctx.institutional, ctx.shorts, earnings, sectorPe, ctx.news, technicalData, companyFinancials), modelArg, 360000, 'stockDetail'));
  } else {
    wave2Calls.push(Promise.resolve(null));
  }
  // 매도 후보가 있을 때만 LLM rationale 생성
  if (sellCands.total > 0) {
    wave2Calls.push(callOllama(buildSellRationalePrompt(sellCands), modelArg, 240000, 'sellRationale'));
  } else {
    wave2Calls.push(Promise.resolve(null));
  }

  const [riskRaw, companyChangesRaw, stockDetailRaw, sellRationaleRaw] = await Promise.all(wave2Calls);
  console.log(`  Wave2 총 소요: ${((Date.now() - wave2Start) / 1000).toFixed(1)}s`);
  const riskData = parseJson(riskRaw, 'risk');
  const companyChangesData = parseJson(companyChangesRaw, 'companyChanges');

  // 매도 rationale 머지
  if (sellRationaleRaw) {
    const sd = parseJson(sellRationaleRaw, 'sellRationale');
    const recMap = new Map();
    if (Array.isArray(sd?.sellRecommendations)) {
      for (const r of sd.sellRecommendations) {
        if (r.ticker) recMap.set(r.ticker.toUpperCase(), r);
      }
    }
    // sellType / urgency = sell-rules-tuned.json 의 ruleId / urgency 사용 (하드코딩 X)
    for (const c of [...sellCands.us, ...sellCands.kr]) {
      const llm = recMap.get(c.ticker.toUpperCase());
      c.rationale = llm?.rationale ?? c.reason;
      c.sellType = llm?.sellType ?? c.ruleId; // LLM 이 override 안 하면 룰 ID 그대로
      // urgency 는 룰에서 정의된 값 사용 (LLM override 허용)
      if (llm?.urgency) c.urgency = llm.urgency;
    }
    console.log(`  매도 rationale: LLM 매핑 ${recMap.size}개 / 룰 폴백 ${sellCands.total - recMap.size}개`);
  } else {
    for (const c of [...sellCands.us, ...sellCands.kr]) {
      c.rationale = c.reason;
      c.sellType = c.ruleId;
      // urgency 는 buildSellCandidates 에서 이미 룰 메타로 설정됨
    }
  }

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

  // 2026-05-29 F23: ticker별 fact-check 재호출 — 환각 차단 (큰 prompt 한 번 → 작은 prompt × N)
  // 각 종목 별도 LLM 호출 (작은 prompt) 로 catalysts/fundamentalBasis 검증.
  // 결과 정답 가까운 small-prompt 응답으로 기존 값 교체. cross-ticker swap 차단.
  console.log(`\n  [F23/fact-check] ticker별 fact-check 재호출 시작 (${mergedPortfolio.length}개 병렬)...`);
  try {
    const factCheckResults = await Promise.all(mergedPortfolio.map(async p => {
      const lp = livePrices.get(p.ticker)?.price;
      const sigDigest = signalDigest.get(p.ticker);
      const isKR = p.ticker?.endsWith('.KS') || p.ticker?.endsWith('.KQ');
      const ccy = isKR ? '₩' : '$';
      const factPrompt = [
        `Generate ONLY catalysts (2 short items in ${TARGET_LANG}) and fundamentalBasis (1 short line) for ticker ${p.ticker}.`,
        '',
        `Ticker: ${p.ticker}${p.name && p.name !== p.ticker ? ' (' + p.name + ')' : ''}`,
        `Live price: ${ccy}${lp ?? 'N/A'}`,
        `Sector: ${p.sector ?? 'N/A'}`,
        sigDigest?.insider ? `Insider signals: ${sigDigest.insider}` : '',
        sigDigest?.squeeze ? `Squeeze score: ${sigDigest.squeeze}` : '',
        sigDigest?.yoy ? `Last quarter YoY: ${sigDigest.yoy} (revenue) / margin ${sigDigest.margin ?? 'N/A'}` : '',
        '',
        '⚠️ RULES:',
        '- Catalysts MUST be specific to this ticker — NOT generic sector talk.',
        '- Each catalyst ≤ 60 chars. Cite actual signal (insider count / squeeze score / revenue % YoY).',
        '- fundamentalBasis ≤ 80 chars — Revenue/margin/PE values from above signals only.',
        '- NO speculation about future quarters. NO cross-ticker bleed (other ticker numbers).',
        `- ALL text in ${TARGET_LANG}. NO English fallback.`,
        '',
        'Pure JSON only:',
        '{"catalysts":["item1","item2"],"fundamentalBasis":"text"}',
      ].filter(Boolean).join('\n');
      try {
        const resp = await callOllama(factPrompt, modelArg, 60000, `fact-check:${p.ticker}`);
        const m = resp?.match(/\{[\s\S]*\}/);
        if (!m) return null;
        const parsed = JSON.parse(m[0]);
        if (Array.isArray(parsed.catalysts) && parsed.catalysts.length >= 1 && typeof parsed.fundamentalBasis === 'string') {
          return { ticker: p.ticker, catalysts: parsed.catalysts.slice(0, 3), fundamentalBasis: parsed.fundamentalBasis.slice(0, 120) };
        }
        return null;
      } catch { return null; }
    }));
    let replaced = 0;
    for (let i = 0; i < mergedPortfolio.length; i++) {
      const fc = factCheckResults[i];
      if (!fc) continue;
      // 기존 catalysts/fundamentalBasis 와 다르면 fact-check 값으로 교체
      const oldCat = JSON.stringify(mergedPortfolio[i].catalysts ?? []);
      const newCat = JSON.stringify(fc.catalysts);
      if (oldCat !== newCat) {
        mergedPortfolio[i].catalysts = fc.catalysts;
        replaced++;
      }
      if (mergedPortfolio[i].fundamentalBasis !== fc.fundamentalBasis) {
        mergedPortfolio[i].fundamentalBasis = fc.fundamentalBasis;
      }
    }
    console.log(`  [F23/fact-check] ${replaced}/${mergedPortfolio.length} 종목 catalysts/fundamentalBasis 재생성 적용`);
  } catch (e) {
    console.warn('  [F23/fact-check] 실패 (기존 값 유지):', e.message);
  }

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
    // 2026-05-29: date 필드 추가 (사용자가 "언제 알게 됐는지" 인지 가능).
    // signalType 도 노출 — supply_risk / supply_expansion / demand_shift 등 분류.
    supplyChainChanges: (ctxRaw.supplyChainSignals ?? [])
      .filter(s => s.conviction >= 45)
      .slice(0, 10)
      .map(s => ({
        ticker: s.ticker,
        direction: s.direction ?? 'neutral',
        headline: s.headline,
        source: s.source,
        date: s.date ?? null,
        signalType: s.signalType ?? null,
        conviction: s.conviction,
        downstreamBeneficiaries: s.downstreamBeneficiaries ?? [],
        upstreamRisks: s.upstreamRisks ?? [],
        evidenceUrl: s.evidenceUrl ?? null,
      })),
    // 2026-05-29 F22: 이전 portfolio outcome 통계 — 사용자 가시 (ReportPage 표시 예정)
    portfolioOutcomes: getPortfolioFeedback().summary,
    // 2026-05-29 F24: 세션별 시장 focus — morning=US/afternoon=KR/evening=US-premarket
    sessionFocus: getSessionFocus(session),
    // 2026-05-29 F25: portfolio market 별 분리 — 미국장 / 한국장 그룹 (ReportPage 별도 섹션)
    portfolioByMarket: {
      us: dedupedPortfolio.filter(p => !p.ticker?.endsWith('.KS') && !p.ticker?.endsWith('.KQ')),
      kr: dedupedPortfolio.filter(p => p.ticker?.endsWith('.KS') || p.ticker?.endsWith('.KQ')),
    },
    // 2026-05-29: 매도 추천 — 과거 buy 추천 중 stop 근접/돌파, target 근접, 보유 14일+ 회전 후보
    sellRecommendations: {
      us: sellCands.us,
      kr: sellCands.kr,
      total: sellCands.total,
    },
    // 2026-05-29: 매수 candidate scoring 메타 — LLM 12 선택 외 score top 30 보존
    buyCandidateScoring: {
      method: '4-stage (light → OHLCV → financials → LLM)',
      ruleCount: 23,
      top30: buyCandidates.slice(0, 30).map(c => ({
        ticker: c.ticker, sector: c.sector, market: c.market,
        score: c.stage1Score, reasons: c.reasons.slice(0, 4).map(r => r.ruleId),
      })),
    },
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

  // Fact-check guard: 정치 인물/임명 환각 패턴 자동 제거 (2026-05-23 신설)
  // 입력 데이터에 없는 단언 (예: "Powell 잔류", "Trump 정책") 을 LLM 이 생성 시 제거
  const HALLUCINATION_PATTERNS = [
    /파월\s*이사\s*잔류[^,—]*/g,
    /파월\s*전\s*의장[^,—]*/g,
    /Powell\s+(?:remains?|stays?|retains?)[^,.]*/gi,
    /트럼프\s*(?:정책|관세)\s*우려[^,—]*/g,
    /Trump\s+(?:tariff|policy)\s+concerns?[^,.]*/gi,
    /BoJ\s+intervention[^,.]*/gi,
  ];
  const removeHalluc = (text) => {
    if (!text) return text;
    let cleaned = text;
    for (const re of HALLUCINATION_PATTERNS) {
      cleaned = cleaned.replace(re, '').replace(/\s*,\s*,/g, ',').replace(/^\s*,\s*/, '').replace(/\s*—\s*/, ' — ').trim();
    }
    return cleaned;
  };
  if (finalReport.thesis) finalReport.thesis = removeHalluc(finalReport.thesis);
  if (finalReport.macroAnalysis) finalReport.macroAnalysis = removeHalluc(finalReport.macroAnalysis);

  // 미래 분기 + 매출 절대값 hallucination sweep (2026-05-24 사건)
  // LLM 이 "Q1 FY2027 revenue $81.6B +85.2% YoY" 같이 미공시 미래 분기 매출을 추측 →
  // 분기 식별자 (FY2027+) 와 절대 매출 ($X.XB 또는 X억 달러) 함께 있으면 catalyst entry 제거.
  // YoY% 만 있는 catalyst 는 유지 (검증된 macro context 활용 가능).
  // 2026-05-25 강화: 한국어 단위 표현 (816억 달러 = $81.6B) 도 함께 처리.
  const FUTURE_QUARTER_RX = /Q[1-4]\s*FY\s*202[7-9]/i;
  // 한국어 패턴 확장 (2026-05-25): "X억 달러" / "X억 달성" / "매출 X억"
  const REVENUE_ABS_RX = /\$\d+\.?\d*\s*B|\d+\s*억\s*(?:달러|달성)|(?:매출|revenue)\s*\d+\s*억/i;
  // 메가캡 분기 매출 상한 ($B) — LLM 이 절대값 hallucination 한 경우 검출용.
  // 출처: 2025 실적 기준 ±20% margin. 2026-05-25 추가: TSM/ASML/TSMC (semicap).
  const MEGA_CAP_QUARTERLY_REV_CAP = {
    NVDA: 50, MSFT: 80, AAPL: 140, AMZN: 180, GOOGL: 105, GOOG: 105, META: 55,
    TSLA: 35, ORCL: 18, AVGO: 18, CRM: 12, ADBE: 7, NFLX: 12,
    TSM: 30, TSMC: 30, ASML: 10, AMAT: 8, LRCX: 6, KLAC: 4, MU: 10, INTC: 18,
    '005930.KS': 70, '000660.KS': 22, '005380.KS': 35, '051910.KS': 15,
    '005490.KS': 25, '035420.KS': 2, '035720.KS': 2, // 2026-05-26: NAVER/Kakao cap 5→2 (실제 ~$1.5B)
  };
  // 절대 매출 값 추출 — 영어 ($X.XB) + 한국어 (X억 달러 / X억 달성 / 매출 X억) 통합
  const extractRevenueB = (text) => {
    const m1 = text.match(/\$(\d+\.?\d*)\s*B/i);
    if (m1) return parseFloat(m1[1]);
    const m2 = text.match(/(\d+(?:\.\d+)?)\s*억\s*(?:달러|달성)/i);
    if (m2) return parseFloat(m2[1]) / 10; // 억 → B (100M → 0.1B)
    const m3 = text.match(/(?:매출|revenue)\s*(\d+(?:\.\d+)?)\s*억/i);
    if (m3) return parseFloat(m3[1]) / 10;
    return null;
  };
  const futureQuarterStripped = [];
  if (Array.isArray(finalReport.portfolio)) {
    for (const p of finalReport.portfolio) {
      if (!Array.isArray(p.catalysts)) continue;
      const before = p.catalysts.length;
      p.catalysts = p.catalysts.filter(c => {
        if (typeof c !== 'string') return true;
        // (a) 미래 분기 + 절대 매출 조합
        if (FUTURE_QUARTER_RX.test(c) && REVENUE_ABS_RX.test(c)) return false;
        // (b) 메가캡 분기 매출 cap 초과 (영어 $X.XB + 한국어 X억 달러 동시 검사)
        const cap = MEGA_CAP_QUARTERLY_REV_CAP[p.ticker?.toUpperCase()];
        if (cap) {
          const rev = extractRevenueB(c);
          if (rev != null && rev > cap) return false;
        }
        return true;
      });
      if (p.catalysts.length < before) {
        futureQuarterStripped.push(`${p.ticker}: catalysts ${before}→${p.catalysts.length}`);
      }
      // fundamentalBasis 도 같은 검사 — 통째로 strip 보다는 매출 segment 만 잘라냄
      if (typeof p.fundamentalBasis === 'string' && FUTURE_QUARTER_RX.test(p.fundamentalBasis) && REVENUE_ABS_RX.test(p.fundamentalBasis)) {
        const before = p.fundamentalBasis;
        p.fundamentalBasis = p.fundamentalBasis
          .replace(/[^,;|]*Q[1-4]\s*FY\s*202[7-9][^,;|]*/gi, '')
          .replace(/[,;\s]+,/g, ',')
          .replace(/^[,;\s]+|[,;\s]+$/g, '');
        if (p.fundamentalBasis !== before) {
          futureQuarterStripped.push(`${p.ticker}: fundamentalBasis 미래분기 strip`);
        }
      }
      // 2026-05-26: fundamentalBasis 의 매출 절대값 cap 검사 추가
      // TSM 'Q1 FY2026 매출 $92.3B (+69.2%)' 같은 cap 초과 케이스. catalysts 와 동일 룰.
      const fbCap = MEGA_CAP_QUARTERLY_REV_CAP[p.ticker?.toUpperCase()];
      if (fbCap && typeof p.fundamentalBasis === 'string') {
        const rev = extractRevenueB(p.fundamentalBasis);
        if (rev != null && (rev > fbCap || rev < fbCap * 0.5)) {
          const before = p.fundamentalBasis;
          // "Q1 FY2026 매출 $92.3B (+69.2%)" / "Revenue +85.2%" 모두 strip,
          // opMgn / P/E 등 ticker 고유 멀티플은 유지
          p.fundamentalBasis = p.fundamentalBasis
            .replace(/(?:Q[1-4]\s*FY\s*\d{4}\s*)?(?:매출|revenue)\s*(?:\$\d+\.?\d*\s*B|\d+\s*억\s*(?:달러|달성)?)(?:\s*\(\s*\+?-?\d+\.?\d*\s*%\s*\))?\s*,?\s*/gi, '')
            .replace(/[,;\s]+,/g, ',')
            .replace(/^[,;\s]+|[,;\s]+$/g, '');
          if (p.fundamentalBasis !== before) {
            futureQuarterStripped.push(`${p.ticker}: fundamentalBasis 매출 ${rev}B cap ${fbCap}B 범위 밖 strip`);
          }
        }
      }
    }
  }
  // companyChanges 도 같이 — keyChange 안의 매출 절대값 (영어/한국어) + 미래 분기 strip,
  // 그리고 revenueYoY 필드 swap/cap 검증.
  // 2026-05-25 사건: LLM 이 매출 절대값을 revenueYoY 필드에 넣고 (예: NVDA revenueYoY=81.6)
  // 실제 YoY% 를 keyChange 텍스트에 박는 field-swap hallucination. 메가캡 quarterly cap 으로 검출.
  if (Array.isArray(finalReport.companyChanges)) {
    for (const c of finalReport.companyChanges) {
      // (a) 미래 분기 + 매출 절대값 segment strip (영어 + 한국어 변형)
      if (typeof c.keyChange === 'string' && FUTURE_QUARTER_RX.test(c.keyChange) && REVENUE_ABS_RX.test(c.keyChange)) {
        const before = c.keyChange;
        c.keyChange = c.keyChange
          .replace(/Q[1-4]\s*FY\s*202[7-9][^,;]*(?:\$\d+\.?\d*\s*B|\d+\s*억\s*(?:달러|달성)|(?:매출|revenue)\s*\d+\s*억)[^,;]*/gi, '')
          .replace(/[,;\s]+,/g, ',')
          .replace(/^[,;\s]+|[,;\s]+$/g, '');
        if (c.keyChange !== before) {
          futureQuarterStripped.push(`${c.ticker}: keyChange 미래분기 strip`);
        }
      }
      // (b) keyChange 의 매출 절대값이 메가캡 cap 초과 시 그 segment strip
      const cap = MEGA_CAP_QUARTERLY_REV_CAP[c.ticker?.toUpperCase()];
      if (cap && typeof c.keyChange === 'string') {
        const rev = extractRevenueB(c.keyChange);
        if (rev != null && rev > cap) {
          const before = c.keyChange;
          c.keyChange = c.keyChange
            .replace(/(?:매출|revenue)\s*(?:\$\d+\.?\d*\s*B|\d+\s*억\s*(?:달러|달성)?)\s*,?\s*/gi, '')
            .replace(/[,;\s]+,/g, ',')
            .replace(/^[,;\s]+|[,;\s]+$/g, '');
          if (c.keyChange !== before) {
            futureQuarterStripped.push(`${c.ticker}: keyChange 매출 ${rev}B>cap ${cap}B strip`);
          }
        }
      }
      // (c) revenueYoY field swap 검출 — LLM이 매출 절대값을 revenueYoY 에 넣음
      // 메가캡 cap 정의된 ticker 만: revenueYoY 가 cap 보다 큰 숫자면 매출값 오기입 의심 → null
      if (cap && typeof c.revenueYoY === 'number' && c.revenueYoY > cap * 0.5) {
        // cap 의 50% 이상이면 매출값일 가능성 — 정상 YoY% 는 보통 -50~+50%
        futureQuarterStripped.push(`${c.ticker}: revenueYoY=${c.revenueYoY} (cap=${cap}B 의 ${(c.revenueYoY/cap*100).toFixed(0)}% — field swap 의심)→null`);
        c.revenueYoY = null;
      } else if (typeof c.revenueYoY === 'number' && c.revenueYoY > 100) {
        // cap 미정의 ticker: 100% 컷오프 (SK하이닉스 198% 같은 실제 가능성 있어 컷오프 보수적)
        futureQuarterStripped.push(`${c.ticker}: revenueYoY ${c.revenueYoY}%→null (> 100% 비현실)`);
        c.revenueYoY = null;
      }
    }
  }
  if (futureQuarterStripped.length) {
    console.log(`  [후처리] 미래 분기/매출 hallucination strip: ${futureQuarterStripped.length}건`);
    for (const s of futureQuarterStripped) console.log(`    - ${s}`);
  }

  // F10: Cross-ticker 매출 swap 검출 (2026-05-26 사건)
  // 사건 1: portfolio[TSM].fundamentalBasis = "Revenue +69.2%" + portfolio[005930.KS] = "Revenue +69.2%"
  // 사건 2: portfolio[TSM].fundamentalBasis = "Q1 FY2026 매출 $92.3B (+69.2%)" 같은 한국어 + 괄호 % 형식
  // 동일 % 가 2+ ticker 에 나타나면 LLM 이 한 종목 fundamental 을 다른 ticker 에 swap.
  // 패턴 확장: 영어 "Revenue +X%" + 한국어 "매출 ... (+X%)" + 단순 "(+X%)" 괄호.
  if (Array.isArray(finalReport.portfolio)) {
    const revByPercent = new Map(); // pct → [ticker...]
    const extractRevPct = (text) => {
      // (1) "Revenue +X%" / "매출 +X%"
      let m = text.match(/(?:Revenue|매출)\s*\+?(\d+\.?\d*)\s*%/i);
      if (m) return parseFloat(m[1]);
      // (2) "(+X%)" 괄호 안의 % (매출 다음에 오는 패턴)
      m = text.match(/(?:매출|revenue)[^,;|]*\(\s*\+?(\d+\.?\d*)\s*%\s*\)/i);
      if (m) return parseFloat(m[1]);
      return null;
    };
    for (const p of finalReport.portfolio) {
      if (typeof p.fundamentalBasis !== 'string') continue;
      const pct = extractRevPct(p.fundamentalBasis);
      if (pct == null || !isFinite(pct) || pct < 5) continue;
      if (!revByPercent.has(pct)) revByPercent.set(pct, []);
      revByPercent.get(pct).push(p.ticker);
    }
    const swapStripped = [];
    for (const [pct, tickers] of revByPercent) {
      if (tickers.length < 2) continue;
      for (const t of tickers) {
        const p = finalReport.portfolio.find(x => x.ticker === t);
        if (!p) continue;
        const before = p.fundamentalBasis;
        // 매출 segment + (+X%) 괄호까지 strip. opMgn/PE 는 유지.
        p.fundamentalBasis = p.fundamentalBasis
          .replace(/(?:Q[1-4]\s*FY\s*\d{4}\s*)?(?:Revenue|매출)\s*(?:\$\d+\.?\d*\s*B|\d+\s*억\s*(?:달러|달성)?)?\s*\(?\s*\+?\d+\.?\d*\s*%\s*\)?\s*,?\s*/i, '')
          .replace(/^[,;\s]+|[,;\s]+$/g, '')
          .replace(/,\s*,/g, ',');
        if (p.fundamentalBasis !== before) {
          swapStripped.push(`${t}: ${pct}% (${tickers.length}종목 공유 — cross-swap 의심)`);
        }
      }
    }
    if (swapStripped.length > 0) {
      console.log(`  [후처리] cross-ticker 매출 swap 검출 strip: ${swapStripped.length}건`);
      for (const s of swapStripped) console.log(`    - ${s}`);
    }
  }

  // F11: companyChanges hallucinated ticker 제거 (2026-05-26 사건)
  // 사건: ISPC/AZRS 같은 존재하지 않는 ticker 가 companyChanges 에 나타남.
  // 보수적 룰: ticker 가 (a) CANDIDATE_TICKERS / (b) US_NAMES/KR_NAMES 화이트리스트 /
  //   (c) portfolio.ticker / (d) insiderSignals.ticker / (e) shortSqueeze.ticker /
  //   (f) supplyChainChanges.ticker 중 한 곳이라도 등장하면 유지. 모두 등장 안 하면 제거
  //   (sub-cap 진짜 ticker 의 false positive 회피).
  if (Array.isArray(finalReport.companyChanges)) {
    const relevantTickers = new Set();
    for (const t of CANDIDATE_TICKERS) relevantTickers.add(String(t).toUpperCase());
    for (const t of Object.keys(US_NAMES_HARNESS)) relevantTickers.add(t.toUpperCase());
    for (const t of Object.keys(KR_NAMES_HARNESS)) relevantTickers.add(t.toUpperCase());
    for (const p of finalReport.portfolio ?? []) if (p.ticker) relevantTickers.add(p.ticker.toUpperCase());
    for (const s of finalReport.insiderSignals ?? []) if (s.ticker) relevantTickers.add(s.ticker.toUpperCase());
    for (const s of finalReport.shortSqueeze ?? []) if (s.ticker) relevantTickers.add(s.ticker.toUpperCase());
    for (const s of finalReport.supplyChainChanges ?? []) if (s.ticker) relevantTickers.add(s.ticker.toUpperCase());

    const before = finalReport.companyChanges.length;
    const removed = [];
    finalReport.companyChanges = finalReport.companyChanges.filter(c => {
      const t = c.ticker?.toUpperCase();
      if (!t) return false;
      if (relevantTickers.has(t)) return true;
      removed.push(`${c.ticker} (${c.name ?? '?'})`);
      return false;
    });
    if (removed.length > 0) {
      console.log(`  [후처리] companyChanges hallucinated ticker 제거: ${before}→${finalReport.companyChanges.length} (${removed.length}건)`);
      for (const r of removed) console.log(`    - ${r}`);
    }
  }

  // fundamentalAnalysis self-consistency 검증 (2026-05-25 사건)
  // 사건: NVDA catalysts/fundamentalBasis "85.2%" vs fundamentalAnalysis "73% 증가" 자체 모순.
  // ticker별 YoY% 를 catalysts/fundamentalBasis/companyChanges 에서 추출하여
  // fundamentalAnalysis 안의 단언과 5pp 이상 다르면 강제 치환.
  // companyChanges 가 가장 우선 (revenueYoY 필드 swap 검사 후 정합성 확인됨).
  if (typeof finalReport.fundamentalAnalysis === 'string' && Array.isArray(finalReport.portfolio)) {
    let fa = finalReport.fundamentalAnalysis;
    const before = fa;
    const aligned = [];
    // 다양한 패턴으로 ticker별 YoY% 추출 (우선순위 순)
    const YOY_PATTERNS = [
      /(?:Revenue|매출)\s*\+?(\d+\.?\d*)\s*%/i,      // "Revenue +85.2%" / "매출 85.2%"
      /\+?(\d+\.?\d*)\s*%\s*(?:YoY|증가|상승)/i,      // "+85.2% YoY" / "85.2% 증가"
      /revenue\s*growth\s*\+?(\d+\.?\d*)\s*%/i,      // "revenue growth 85.2%"
      /전년\s*대비\s*(\d+\.?\d*)\s*%/i,              // "전년 대비 85.2%"
    ];
    const extractYoY = (text) => {
      if (!text) return null;
      for (const rx of YOY_PATTERNS) {
        const m = text.match(rx);
        if (m) return parseFloat(m[1]);
      }
      return null;
    };
    for (const p of finalReport.portfolio) {
      const t = p.ticker;
      if (!t) continue;
      // 1) catalysts join 에서 추출
      const catText = (Array.isArray(p.catalysts) ? p.catalysts : []).join(' | ');
      // 2) fundamentalBasis 에서 추출
      const fbText = p.fundamentalBasis ?? '';
      // 3) companyChanges 의 같은 ticker keyChange 에서 추출
      const cc = (Array.isArray(finalReport.companyChanges) ? finalReport.companyChanges : [])
        .find(c => c.ticker === t);
      const ccText = cc?.keyChange ?? '';
      const ccRevYoY = (typeof cc?.revenueYoY === 'number') ? cc.revenueYoY : null;
      const catYoY = ccRevYoY ?? extractYoY(ccText) ?? extractYoY(fbText) ?? extractYoY(catText);
      if (catYoY == null) continue;
      // fundamentalAnalysis 안에서 ticker % 패턴 매치 — 2가지 형식:
      //   (A) "TICKER ... X% (증가/초과/상승/growth/YoY)" — explicit suffix
      //   (B) "TICKER ... +X%" — '+' prefix (suffix 없는 단순 형식, 2026-05-26 NVDA "+73%" 케이스)
      const tickerEscaped = t.replace(/[.]/g, '\\.');
      const rxA = new RegExp(`(${tickerEscaped}[^,;.|]*?)(\\d+\\.?\\d*)(\\s*%\\s*(?:증가|초과|상승|상회|growth|YoY))`, 'gi');
      const rxB = new RegExp(`(${tickerEscaped}[^,;.|]*?\\+)(\\d+\\.?\\d*)(\\s*%(?!\\s*(?:증가|초과|상승|상회|growth|YoY)))`, 'gi');
      for (const rx of [rxA, rxB]) {
        fa = fa.replace(rx, (match, prefix, val, suffix) => {
          const v = parseFloat(val);
          if (!isFinite(v) || Math.abs(v - catYoY) < 5) return match;
          aligned.push(`${t}: ${val}% → ${catYoY}% (catalysts/companyChanges 일치)`);
          return `${prefix}${catYoY}${suffix}`;
        });
      }
    }
    if (fa !== before) {
      finalReport.fundamentalAnalysis = fa;
      console.log(`  [후처리] fundamentalAnalysis self-consistency 보정: ${aligned.length}건`);
      for (const a of aligned) console.log(`    - ${a}`);
    }
  }

  // F8: fundamentalAnalysis 안의 매출 절대값 hallucination strip (2026-05-25 사건)
  // 사건: "NVDA Q1 매출 43억 달러, 기관 신규 매수" — NVDA $4.3B 는 분기 cap (50B) 의 1/10.
  // F7 은 %만 매칭 → 절대값 우회. ticker별 매출 절대값이 cap 의 50%↓ 또는 200%↑ 일 때
  // 비현실 의심 → segment strip.
  if (typeof finalReport.fundamentalAnalysis === 'string') {
    let fa = finalReport.fundamentalAnalysis;
    const before = fa;
    const stripped = [];
    for (const ticker of Object.keys(MEGA_CAP_QUARTERLY_REV_CAP)) {
      const cap = MEGA_CAP_QUARTERLY_REV_CAP[ticker];
      const tickerEscaped = ticker.replace(/[.]/g, '\\.');
      // "TICKER ... 매출 X억 달러" 또는 "TICKER ... revenue $X.XB" 형태
      const rx = new RegExp(`(${tickerEscaped}[^,;.|]*?(?:매출|revenue)\\s*)(\\$\\d+\\.?\\d*\\s*B|\\d+\\s*억(?:\\s*(?:달러|달성))?)([^,;.|]*)`, 'gi');
      fa = fa.replace(rx, (match, prefix, val, suffix) => {
        const rev = extractRevenueB(val);
        if (rev == null) return match;
        // cap 의 50% 미만 또는 200% 초과면 hallucination 의심
        if (rev < cap * 0.5 || rev > cap * 2) {
          stripped.push(`${ticker}: 매출 ${rev}B (cap ${cap}B 범위 밖) strip`);
          // 매출 segment 만 잘라냄, ticker prefix 유지
          return `${prefix.replace(/\s*(?:매출|revenue)\s*$/i, '')}${suffix}`;
        }
        return match;
      });
    }
    if (fa !== before) {
      finalReport.fundamentalAnalysis = fa;
      console.log(`  [후처리] fundamentalAnalysis 매출 절대값 strip: ${stripped.length}건`);
      for (const s of stripped) console.log(`    - ${s}`);
    }
  }

  // Macro fact-check: macroAnalysis 안의 "연준금리 X%" 가 FRED 실값과 0.5%+ 차이 시 강제 치환
  // (2026-05-24 사건: LLM 이 "연준금리 3.625%" hallucination — 실제 5.25-5.50%)
  if (finalReport.macroAnalysis && ctxRaw?.macro?.indicators) {
    const fedActual = ctxRaw.macro.indicators.find(i =>
      i.id === 'fed_rate' || i.id === 'fomc' || i.id === 'fedfunds'
    )?.actual;
    if (typeof fedActual === 'number') {
      const rx = /(연준금리|Fed(?:eral)?\s*(?:Funds\s*)?Rate|연방준비)\s*[:은]?\s*(\d+\.?\d*)\s*%/gi;
      const before = finalReport.macroAnalysis;
      finalReport.macroAnalysis = finalReport.macroAnalysis.replace(rx, (match, label, val) => {
        const v = parseFloat(val);
        if (!isFinite(v) || Math.abs(v - fedActual) < 0.5) return match;
        return `${label} ${fedActual}%`;
      });
      if (finalReport.macroAnalysis !== before) {
        console.log(`  [후처리] macroAnalysis 연준금리 강제 치환 → ${fedActual}%`);
      }
    }
  }

  finalReport.thesis = expandThesis(finalReport.thesis, macroData, ctxRaw, localeArg);
  finalReport.macroAnalysis = enrichMacroAnalysis(finalReport.macroAnalysis, ctxRaw, macroData, localeArg);
  finalReport.regionStances = fillMissingRegionStances(finalReport.regionStances, ctxRaw);
  finalReport.regionStances = normalizeRegionStances(finalReport.regionStances);
  finalReport.regionStances = reconcileRegionStanceWithData(finalReport.regionStances);
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
  // 2026-05-27: SkillOpt 패턴 — quality_score DB persistence (Codex F#3).
  // 매 보고서 score 가 reports.quality_score 컬럼에 적재 → 다음 보고서 prompt 의
  // [Quality Feedback] 섹션에서 활용 (getRecentQualityScores → buildPortfolioPrompt).
  finalReport.qualityScore = score;
  // 항목별 체크 상세 출력
  const checks = [
    ['thesis',            !!(finalReport.thesis?.length > 20)],
    ['macroAnalysis',     !!(finalReport.macroAnalysis?.length > 30)],
    ['technicalAnalysis', !!(finalReport.technicalAnalysis?.length > 15)],
    ['portfolio(≥10)',    (finalReport.portfolio?.length ?? 0) >= 10],
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
  // 강제 rotation — 최근 5보고서와 5+ 종목 겹치면 boost-list 종목으로 교체
  finalReport.portfolio = enforceRotation(finalReport.portfolio, livePrices);
  // 구루 분할 매매 ladder 자동 생성 (entry 30/40/30 + exit 33/33/34 + trailing)
  finalReport.portfolio = buildLadders(finalReport.portfolio, livePrices);

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
    // 2026-05-29: 매도 추천 적재 — Karpathy pathway 의 source. tune-sell-rules 가 outcome 평가.
    let sellCount = 0;
    try {
      const sellList = [...(finalReport.sellRecommendations?.us ?? []), ...(finalReport.sellRecommendations?.kr ?? [])];
      sellCount = saveSellRecommendations(reportId, finalReport.generatedAt, sellList);
      console.log(`[db] 📤 매도 추천 적재: ${sellCount}건`);
    } catch (e) {
      console.warn(`[db] ⚠️ 매도 추천 적재 실패: ${String(e).slice(0, 100)}`);
    }
    // 2026-05-29: 뉴스 + macro 시점 스냅샷 적재 (30년 누적 검색 가능)
    let newsCount = 0;
    try {
      newsCount = saveNewsArchive({
        reportId,
        locale: localeArg,
        newsArticles: ctxRaw?.newsCascade?.articles ?? ctxRaw?.news ?? [],
        supplyChainChanges: finalReport.supplyChainChanges ?? [],
        companyChanges: finalReport.companyChanges ?? [],
      });
      saveMacroSnapshot({
        reportId,
        capturedAt: finalReport.generatedAt,
        ctxRaw,
        macroData,
      });
      // 2026-05-29: 숏스퀴즈/실적/insider 시점별 아카이브 (검색 + 추세)
      saveDomainArchives({
        reportId,
        capturedAt: finalReport.generatedAt,
        shortSqueeze: finalReport.shortSqueeze ?? [],
        companyChanges: finalReport.companyChanges ?? [],
        insiderSignals: finalReport.insiderSignals ?? [],
      });
      // 2026-05-29: F&G 10국가 + asset flow 시점별 아카이브
      saveFearGreedArchive({
        reportId,
        capturedAt: finalReport.generatedAt,
        fgResponse: ctxRaw?.fearGreed ?? ctxRaw?.fear_greed,
        capitalFlowsResponse: ctxRaw?.capital ?? ctxRaw?.capitalFlows,
      });
    } catch (e) {
      console.warn(`[db] ⚠️ news/macro 적재 실패: ${String(e).slice(0, 100)}`);
    }
    console.log(`\n[db] 📦 SQLite 적재: report=${reportId} recommendations=${recCount} news=${newsCount}`);
    // 2026-05-29: portfolio ticker 별 company-financials 도 함께 스냅샷
    const portfolioTickers = (finalReport.portfolio ?? []).map(p => p.ticker).filter(Boolean);
    console.log(`[db] 엔드포인트 스냅샷 fetch 시작 (24 + ${portfolioTickers.length} ticker별 실적)...`);
    const snapStart = Date.now();
    const snapResults = await snapshotAllEndpoints(reportId, { portfolioTickers });
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
    // 2026-05-29: 정시 발간 — target 시간까지 sleep 후 업로드
    await sleepUntilPublishTarget(session);
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
