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
import { saveReport, saveRecommendations, saveSellRecommendations, saveBuyCandidates, saveNewsArchive, saveMacroSnapshot, saveDomainArchives, saveFearGreedArchive, getEntryFeedbackStats, getRecentHallucinationsForPromptInject, getPreviousFearGreedScore } from './lib/db.mjs';
import Database from 'better-sqlite3';  // 2026-05-28: F19 getRecentQualityFeedback 의 ESM require fail fix.
import { snapshotAllEndpoints } from './lib/snapshot-endpoints.mjs';
import { SECTOR_FORBID, mismatchedIndustryTerm } from './verify-report.mjs';  // 2026-05-31: sector-keyword strip 단일 source of truth

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
// 2026-05-30: meta map (ticker → {name, sector, cap, market}) — LLM 환각 sector/name 강제 override 용
//   원인: SK하이닉스 sector="Construction", NAVER sector="Energy" 같은 LLM 환각 직접 노출
let CANDIDATE_META = {};
try {
  const raw = readFileSync(resolve(ROOT, 'data/candidate-tickers.json'), 'utf8');
  const data = JSON.parse(raw);
  if (Array.isArray(data.tickers) && data.tickers.length > 100) {
    CANDIDATE_TICKERS = data.tickers;
    CANDIDATE_META = data.meta ?? {};
    console.log(`[startup] candidate-tickers.json 로드: ${CANDIDATE_TICKERS.length} 종목 (titan ${data.byBand?.titan ?? '?'} / mega ${data.byBand?.mega ?? '?'} / large ${data.byBand?.large ?? '?'} / ETF ${data.byBand?.etf ?? '?'} / KR ${data.byBand?.kr ?? '?'}), meta=${Object.keys(CANDIDATE_META).length}`);
  }
} catch { /* fall through to hardcoded */ }

// 2026-06-03 CPRT→"Cypress Semiconductor" 환각 사건: portfolio name 검증을 ~60개 하드코딩
//   US_NAMES_HARNESS 로만 해서 CPRT(Copart) 같은 비-테크 종목 이름 환각이 통과했음.
//   build-company-names.mjs 가 companies-batch*.ts(~499 실제 프로필명)를 JSON 으로 추출 → 권위 소스.
let COMPANY_NAMES_JSON = {};
try {
  COMPANY_NAMES_JSON = JSON.parse(readFileSync(resolve(ROOT, 'data/company-names.json'), 'utf8'));
  console.log(`[startup] company-names.json 로드: ${Object.keys(COMPANY_NAMES_JSON).length} 실제 회사명 (name 환각 override 권위 소스)`);
} catch { /* build-company-names.mjs 미실행 — US_NAMES_HARNESS 만 사용 */ }

// 2026-06-07: 주력 매출상품/사업개요 (사용자 "뭐로 매출 내는 기업인지 모르겠다 — 보고서에 적어줘").
//   build-company-business.mjs 가 companies-batch products[](name+revenueShare)+description 추출.
//   LLM 생성(환각위험) 아닌 큐레이션 권위 소스. 보고서 portfolio 에 businessSummary 로 주입.
let COMPANY_BUSINESS_JSON = {};
try {
  COMPANY_BUSINESS_JSON = JSON.parse(readFileSync(resolve(ROOT, 'data/company-business.json'), 'utf8'));
  console.log(`[startup] company-business.json 로드: ${Object.keys(COMPANY_BUSINESS_JSON).length} 사업/주력제품`);
} catch { /* build-company-business.mjs 미실행 */ }

// 2026-06-14: company-profiles.json (Yahoo assetProfile summary/sector/industry, build-company-profiles.mjs +
//   enrich-sectors.mjs 수집). KR 포함 700+. company-business 미커버 종목의 사업 grounding 소스 —
//   프롬프트 BUY CANDIDATES 블록에 한줄 주입해 LLM 환각(HPSP="차량") 차단 + businessSummary fallback.
let COMPANY_PROFILES_JSON = {};
try {
  COMPANY_PROFILES_JSON = JSON.parse(readFileSync(resolve(ROOT, 'data/company-profiles.json'), 'utf8'));
  console.log(`[startup] company-profiles.json 로드: ${Object.keys(COMPANY_PROFILES_JSON).length} 사업개요/업종`);
} catch { /* build-company-profiles.mjs 미실행 */ }
/** ticker(suffix 포함/제거 모두) → 사업 한줄(grounding). company-business products 우선, 없으면 profiles summary 1문장. */
function businessOneLiner(ticker) {
  const key = String(ticker || '').replace(/\.(KS|KQ)$/, '');
  const b = COMPANY_BUSINESS_JSON[ticker] || COMPANY_BUSINESS_JSON[key];
  if (b?.products) return String(b.products).slice(0, 100);
  if (b?.desc) return String(b.desc).slice(0, 100);
  const p = COMPANY_PROFILES_JSON[ticker] || COMPANY_PROFILES_JSON[key];
  // 약어 마침표("Co.")로 문장 분리하면 사업 핵심("semiconductor equipment")이 잘려 grounding 무용 →
  //   문장분리 대신 100자 truncate (앞부분에 업종/제품 키워드가 충분히 들어옴).
  if (p?.summary) return String(p.summary).slice(0, 100);
  if (p?.industry) return String(p.industry).slice(0, 60);
  return '';
}

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
  // 2026-06-14 (ChatGPT D1 차용): →/|/ 체인이라도 실수치(%·소수·$)를 담으면 substance 있는 thesis →
  //   garbage 아님 (예 "AI 인프라 MSFT→NVDA→AMAT→LRCX — CPI 4.17%…" 오탐으로 발간 차단되던 건).
  if (/^[^\n/|→]+([/|→][^\n/|→]+){2,}$/.test(t) && t.length < 80 && !/\d+%|\d+\.\d+|\$\d/.test(t)) return true;
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

// 권위 name 맵: 2026-06-06 순서 flip — company-names.json(SEC 904, build:names 생성)이 *최종 권위*.
//   US_NAMES_HARNESS(레거시 ~60 큐레이션)는 company-names.json 에 *없는* ticker 만 gap-fill.
//   종전 harness override 라 TSM='TSMC' 가 SEC full name 을 덮어 verify-report(company-names.json 정답)와
//   이중 권위 충돌(name-gate→TSMC vs verify→full name). company-names.json 우선으로 단일 권위 통일.
const US_NAME_LOOKUP = { ...US_NAMES_HARNESS, ...COMPANY_NAMES_JSON };

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
    const isKR = /\.(KS|KQ)$/.test(p.ticker ?? '');  // 2026-06-13: .KQ(KOSDAQ) 포함 — ₩.00 데시멀 버그 fix
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

  // 6f. US ticker → name 권위 맵 (company-names.json 499 + 큐레이션) — CPRT/SMCI/MU 류 환각 차단
  for (const p of r.portfolio) {
    const expected = US_NAME_LOOKUP[p.ticker?.toUpperCase()];
    if (expected && p.name !== expected) {
      audit.fixes.usNameMismatch.push(`${p.ticker}:portfolio "${p.name}"→"${expected}"`);
      p.name = expected;
    }
  }
  if (Array.isArray(r.companyChanges)) {
    for (const c of r.companyChanges) {
      const expected = US_NAME_LOOKUP[c.ticker?.toUpperCase()];
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
  // 2026-06-13: shortSqueeze 는 외부 데이터(공매도/스퀴즈) 소스 의존 — 일시 down 시 빈 섹션이 *완벽한*
  //   리포트(포트폴리오·verdict·계약상세 정상, verify 0결함)를 hard-fail 시켜 더 나쁜 옛 리포트가
  //   라이브 잔존하던 사건 fix. 핵심(thesis/portfolio/narrative/regionStances) 아니므로 warning 으로
  //   강등 — 점수 페널티는 받되 발간 차단은 안 함. 소스 복구 시 자동 재출현.
  if (!report.shortSqueeze?.length) warnings.push('shortSqueeze MISSING (외부 소스 일시 down — 비차단)');

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
  // Windows Task Scheduler triggers (KST): 06:40 morning / 11:40 noon / 15:40 afternoon /
  //   21:10 evening / 23:40 midnight. 트리거는 target 발간시각보다 ~20분 일찍 → 생성 후 정시 sleep.
  // 2026-06-04: 낮 12시(noon) + 새벽 12시(midnight) 슬롯 추가 (사용자 요청). data/report-sessions.json 참조.
  const kstHour = new Date(Date.now() + 9 * 3600000).getUTCHours();
  if (kstHour >= 6 && kstHour < 11) return 'morning';
  if (kstHour >= 11 && kstHour < 15) return 'noon';
  if (kstHour >= 15 && kstHour < 20) return 'afternoon';
  if (kstHour >= 20 && kstHour < 23) return 'evening';
  return 'midnight'; // 23 ~ 익일 06 (23:40 트리거)
}

/**
 * 2026-05-29: 세션별 시장 focus — 한국 시간대 + 글로벌 장 일정 매칭.
 *   morning  06:50 KST → US 장 마감 직후 (전일 22:00 UTC) → US-focused
 *   afternoon 15:50 KST → KR 장 마감 직후 (15:30 KST) → KR-focused
 *   evening  21:20 KST → US 장 시작 직후 (= 09:35 EST) → US-premarket + 글로벌
 *
 * 보고서에 sessionFocus 메타 + prompt 에 inject — LLM 이 해당 시장 종목 비중 강화.
 */
// 2026-06-05 (b) 세션 가중 context: 8B 가 세션 핵심 신호에 attention 집중하도록 dataPriority 추가.
//   US 세션 = US SEC 신호(13F/Form4/13D-G/N-PORT/options) 우선, KR 세션 = KR 수급/공시/공급망 우선.
//   모델 교체 없이(VRAM 무관) 프롬프트 attention 만 재가중 — 즉시 품질↑, 안전한 변경.
const US_PRIORITY = [
  'Institutional + Insider Signals (US 13F 누적 + Form4 집중매수)',
  '13D/G 대량보유 변동 (액티비스트/대주주)',
  'Unusual Options Flow (스마트머니 방향성)',
  'Short Squeeze Candidates (숏 커버 촉매)',
  'N-PORT 뮤추얼펀드 보유 변화',
];
const KR_PRIORITY = [
  'Korea Flow — 기관·외국인 수급 (당일 순매수 방향)',
  'KR 내부자/공시 신호 + 공급망 변화 (Supply Chain Signals)',
  'Sector Valuations (KR 업종 밸류에이션)',
  'Institutional 신호 (글로벌 13F — KR ADR/대형주 한정)',
];
function getSessionFocus(session) {
  switch (session) {
    case 'morning':
      return {
        primary: 'us',
        secondary: ['global'],
        label: 'US 장 마감 직후 (전일 close)',
        marketWeight: { us: 60, kr: 20, global: 20 },
        dataPriority: US_PRIORITY,
      };
    case 'afternoon':
      return {
        primary: 'kr',
        secondary: ['japan', 'china'],
        label: 'KR 장 마감 직후 + 아시아',
        marketWeight: { kr: 50, us: 25, asia: 25 },
        dataPriority: KR_PRIORITY,
      };
    case 'evening':
      return {
        primary: 'us',
        secondary: ['premarket', 'global'],
        label: 'US 장 시작 직후 (premarket → open)',
        marketWeight: { us: 70, global: 20, kr: 10 },
        dataPriority: US_PRIORITY,
      };
    case 'noon':
      // 12:00 KST = 03:00 UTC → KR 장중 + 아시아 활발, US 마감.
      return {
        primary: 'kr',
        secondary: ['china', 'japan'],
        label: 'KR 장중 + 아시아 (점심)',
        marketWeight: { kr: 50, asia: 30, us: 20 },
        dataPriority: KR_PRIORITY,
      };
    case 'midnight':
      // 00:00 KST = 15:00 UTC → US 장중(오전), 글로벌. KR 마감.
      return {
        primary: 'us',
        secondary: ['global'],
        label: 'US 장중 (자정)',
        marketWeight: { us: 65, global: 20, kr: 15 },
        dataPriority: US_PRIORITY,
      };
    default:
      return { primary: 'global', secondary: [], label: '글로벌', marketWeight: {}, dataPriority: [...US_PRIORITY, ...KR_PRIORITY] };
  }
}

/**
 * 2026-05-29: 정시 발간 — 보고서 완료 후 target 시간까지 sleep.
 *   morning  → 07:00 KST
 *   afternoon → 16:00 KST
 *   evening  → 21:30 KST
 */
function getPublishTarget(session) {
  // 발간 target (KST): morning 07:00 / noon 12:00 / afternoon 16:00 / evening 21:30 / midnight 00:00.
  const kstNow = new Date(Date.now() + 9 * 3600000);
  const target = new Date(kstNow);
  if (session === 'morning')        { target.setUTCHours(7, 0, 0, 0); }
  else if (session === 'noon')      { target.setUTCHours(12, 0, 0, 0); }
  else if (session === 'afternoon') { target.setUTCHours(16, 0, 0, 0); }
  else if (session === 'evening')   { target.setUTCHours(21, 30, 0, 0); }
  else if (session === 'midnight')  {
    // 00:00 KST 발간. 2026-06-06 off-by-one fix: 기존 `target<=now → +1` 은 호출 시점 의존 —
    //   23:40 트리거(전날 저녁)에 계산하면 +1=발간일(정답)이지만, gen 이 자정 넘겨 끝나
    //   (00:xx~02:xx) getReportKstDate 가 재호출되면 또 +1 → 발간일+1 (06-07 오라벨).
    //   → KST 시각으로 분기: 22~23시(발간 전날 저녁) 만 +1, 0~6시(이미 발간일 당일)는 그대로.
    //   두 호출 시점(트리거 전·gen 후) 모두 동일 발간일 산출 → 결정론적.
    target.setUTCHours(0, 0, 0, 0);
    if (kstNow.getUTCHours() >= 22) target.setUTCDate(target.getUTCDate() + 1);
  }
  else                              { target.setUTCHours(21, 30, 0, 0); }
  // target 이 이미 지났으면 (보고서가 늦게 끝나서) wait 안 함
  const waitMs = target.getTime() - kstNow.getTime();
  return { target, waitMs };
}

// 보고서 KST 날짜 = 발간 target 날짜. midnight(23:40 생성→익일 00:00 발간)은 익일 날짜를 써야
//   파일명/Redis 키가 웹 읽기(00:00~ midnight 조회)와 일치하고 SESSION_RANK 시간순 정렬도 맞다.
function getReportKstDate(session) {
  return getPublishTarget(session).target.toISOString().slice(0, 10);
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
  const kstDate = getReportKstDate(session);  // midnight 은 발간일(익일) — 웹 읽기 키와 정합
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
  // 2026-06-12: 기본값 vercel.app(사망 배포) → localhost — 자가호스팅 후 매 발간 404 로
  //   업로드 검증이 죽어 있었음 (검증 프로브 자체가 stale 인프라를 가리키던 사각지대).
  const APP_BASE_URL = (env.NEXT_PUBLIC_APP_URL || env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000')
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
async function callOllama(prompt, model = modelArg, timeoutMs = 360000, label = '', schema = null) {
  // 1. vLLM/TabbyAPI 우선 (VLLM_URL 설정된 경우만)
  const vllmText = await callVLLM(prompt, timeoutMs, label);
  if (vllmText) return vllmText;

  // 2. Ollama 로컬 (default)
  const t0 = Date.now();
  const tag = label ? `[LLM:${label}]` : '[LLM]';
  const isQwen3 = model.startsWith('qwen3');
  // 2026-05-29: label 별 num_predict 차등. portfolio 12 종목 한글 rationale 포함 시 5K+ token 필요.
  // 기본 2048 → portfolio 8192, stockDetail/macro/regional 4096.
  const numPredict = /portfolio/i.test(label) ? 8192
    : /(stockDetail|macro|narrative|regional|sellRationale)/i.test(label) ? 4096
    : 2048;
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
    // 2026-06-06: JSON Schema structured output (ChatGPT D1) — schema 주면 Ollama 가 그 구조로 강제.
    //   stockDetail 등 ID-only 출력에 사용 → cross-ticker bleed/형식 환각 차단. 미지정 시 기존 json.
    format: schema ?? 'json',
    options: { temperature: 0.4, num_predict: numPredict },
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
        console.log(`  ${tag} ${elapsed}s → ${ollamaText.length}c | prompt ${prompt.length}c | np=${numPredict}`);
        // 2026-05-29: portfolio / 대형 응답은 디버그 raw 파일 보존 (parse 실패 분석용)
        if (/portfolio|stockDetail/i.test(label)) {
          try {
            const fs = await import('node:fs');
            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            fs.writeFileSync(`logs/llm-raw-${label}-${ts}.txt`, ollamaText);
          } catch {}
        }
        return ollamaText;
      }
      console.warn(`  ${tag} ${elapsed}s empty/short(${ollamaText?.length ?? 0}c) — cloud 폴백`);
    }
  } catch (e) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.warn(`  ${tag} ${elapsed}s ${e.name}: ${e.message?.slice(0, 80)} — cloud 폴백`);
  }

  // 2026-06-13: Ollama-only 모드 (사용자 선택) — 클라우드 키 revoked 상태에서 GROQ(60s)+Gemini(60s)
  //   폴백 = 120s 순낭비 + 로그 spam. 플래그 ON 시 즉시 빈 문자열(parser fallback). 키 복구 시 해제.
  if (env.LLM_LOCAL_ONLY?.trim() === '1') {
    console.error(`  ${tag} 로컬 실패 + LLM_LOCAL_ONLY — 클라우드 폴백 skip, 빈 문자열 반환`);
    return '';
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
  const clean = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const codeBlock = clean.match(/```(?:json)?\s*([\s\S]*?)```/);
  const str = codeBlock ? codeBlock[1] : clean;
  const m = str.match(/\{[\s\S]*\}/);
  if (!m) {
    console.warn(`  ${tag} FAIL — no JSON object found. raw[0:120]: ${clean.slice(0, 120).replace(/\n/g, ' ')}`);
    return null;
  }
  // 1차: 표준 parse
  try {
    return JSON.parse(m[0].replace(/,\s*([}\]])/g, '$1'));
  } catch (e1) {
    // 2차: truncated repair — num_predict 토큰 제한으로 마지막 객체가 잘렸을 때 복구
    // 전략: portfolio 같은 array 가 잘렸으면 마지막 incomplete element 잘라내고 array+object 닫음
    try {
      const repaired = repairTruncatedJson(m[0]);
      if (repaired) {
        const parsed = JSON.parse(repaired);
        console.warn(`  ${tag} REPAIRED — truncated JSON 복구 (orig err: ${e1.message.slice(0, 60)})`);
        return parsed;
      }
    } catch (e2) {
      // repair 도 실패 → 원본 에러 보고
    }
    console.warn(`  ${tag} FAIL — ${e1.message}. raw[0:120]: ${raw.slice(0, 120).replace(/\n/g, ' ')}`);
    return null;
  }
}

/**
 * 토큰 제한으로 잘린 JSON 복구. 마지막 미완성 element 잘라내고 array+object 닫음.
 * 예: '{"stance":"x","portfolio":[{"a":1},{"b":' → '{"stance":"x","portfolio":[{"a":1}]}'
 *
 * 알고리즘:
 * 1) root object 안 array 의 마지막으로 완전히 닫힌 element 위치 찾기
 *    (root depth=1 → array depth=2 → element depth=3 → 다시 2 로 돌아온 i)
 * 2) 그 i+1 까지만 잘라내고 open 인 [, { 모두 close
 */
function repairTruncatedJson(str) {
  let depth = 0, inStr = false, esc = false;
  let lastElemEnd = -1;        // element 가 닫혀서 depth=2 가 된 i
  let lastRootClose = -1;      // root object 가 닫혀서 depth=0 가 된 i
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 2) lastElemEnd = i;     // array 안 element 닫힘
      if (depth === 0) lastRootClose = i;   // root object 완전 닫힘 → 표준 parse 통과했을 것
    }
  }
  if (lastRootClose >= 0) return str.slice(0, lastRootClose + 1);
  if (lastElemEnd >= 0) {
    let candidate = str.slice(0, lastElemEnd + 1).replace(/,\s*$/, '');
    let openObj = 0, openArr = 0, s = false, e = false;
    for (const c of candidate) {
      if (e) { e = false; continue; }
      if (c === '\\') { e = true; continue; }
      if (c === '"') { s = !s; continue; }
      if (s) continue;
      if (c === '{') openObj++; else if (c === '}') openObj--;
      else if (c === '[') openArr++; else if (c === ']') openArr--;
    }
    while (openArr > 0) { candidate += ']'; openArr--; }
    while (openObj > 0) { candidate += '}'; openObj--; }
    return candidate;
  }
  return null;
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
        // 2026-05-31: Yahoo meta.fiftyTwoWeekLow 가 액면분할 전 가격일 때 ratio 비정상 (예: 005930.KS 5.7x).
        //   chart events.splits 가 없으면 ratio > 3x 시 시장가 기반 합리적 범위로 fallback.
        let high52w = meta.fiftyTwoWeekHigh ?? price * 1.3;
        let low52w = meta.fiftyTwoWeekLow ?? price * 0.7;
        if (high52w > 0 && low52w > 0 && high52w / low52w > 3) {
          // 액면분할 또는 단위 mismatch 의심 → 시장가 기준 ±30% 추정.
          high52w = price * 1.3;
          low52w = price * 0.7;
        }
        return [ticker, {
          price: Math.round(price * 100) / 100,
          change1d: change1d != null ? Math.round(change1d * 10) / 10 : null,
          high52w,
          low52w,
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

// 2026-06-06: Yahoo v7 quote batch (crumb 인증) — Stooq batch CSV 가 JS/PoW 봇챌린지로 영구 차단됨
//   (NVDA NaN → 보고서 abort 사건). Yahoo v7 401 은 crumb 로 우회. 1요청 ~50심볼 배치 + 실 52w 동반.
let _yCrumb = null;
async function getYahooCrumb() {
  if (_yCrumb) return _yCrumb;
  const UA = { 'User-Agent': 'Mozilla/5.0' };
  const r = await fetch('https://fc.yahoo.com', { headers: UA, signal: AbortSignal.timeout(8000) });
  const cookie = (r.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
  const cr = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { ...UA, Cookie: cookie }, signal: AbortSignal.timeout(8000) });
  _yCrumb = { crumb: await cr.text(), cookie };
  return _yCrumb;
}
async function fetchYahooQuoteBatch(tickers) {
  const out = new Map();
  if (!tickers.length) return out;
  let cr; try { cr = await getYahooCrumb(); } catch { return out; }
  if (!cr.crumb || cr.crumb.length > 30) return out; // crumb 실패 시 빈 맵 (fallback 가 처리)
  const UA = { 'User-Agent': 'Mozilla/5.0', Cookie: cr.cookie };
  for (let i = 0; i < tickers.length; i += 50) {
    const chunk = tickers.slice(i, i + 50);
    const symMap = new Map(chunk.map(t => [t.replace(/\./g, '-'), t])); // BRK.B → BRK-B, 역매핑
    try {
      const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${[...symMap.keys()].map(encodeURIComponent).join(',')}&crumb=${encodeURIComponent(cr.crumb)}`;
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12000) });
      if (!r.ok) continue;
      const j = await r.json();
      for (const q of j?.quoteResponse?.result ?? []) {
        const price = q.regularMarketPrice;
        if (!price || !isFinite(price)) continue;
        const orig = symMap.get(q.symbol) ?? q.symbol;
        out.set(orig, {
          price: Math.round(price * 100) / 100,
          change1d: q.regularMarketChangePercent != null ? Math.round(q.regularMarketChangePercent * 10) / 10 : null,
          high52w: q.fiftyTwoWeekHigh ?? price * 1.3,   // 실 52w (Stooq 는 close*1.3 가짜였음)
          low52w: q.fiftyTwoWeekLow ?? price * 0.7,
        });
      }
    } catch { /* chunk failed */ }
  }
  return out;
}

async function getLivePrices() {
  const map = new Map();
  // 1) US 종목 — Yahoo v7 quote 배치(crumb). 2026-06-06: Stooq 봇차단 → Yahoo 로 전환.
  const usTickers = CANDIDATE_TICKERS.filter(t => !t.endsWith('.KS') && !t.endsWith('.KQ'));
  const krTickers = CANDIDATE_TICKERS.filter(t => t.endsWith('.KS') || t.endsWith('.KQ'));
  let usMap = await fetchYahooQuoteBatch(usTickers);
  if (usMap.size < usTickers.length * 0.5) {
    // Yahoo v7 실패/부분 → Stooq 잔존분 시도(봇차단이면 빈맵), 둘 다 합산
    const stooqMap = await fetchStooqBatch(usTickers);
    for (const [t, v] of stooqMap) if (!usMap.has(t)) usMap.set(t, v);
  }
  for (const [t, v] of usMap) map.set(t, v);

  // 2) KR ticker — Yahoo v8 chart 개별 (~29개, 동시 8개)
  const krBatch = async (slice) => {
    const results = await Promise.all(slice.map(fetchOnePrice));
    for (const [t, lp] of results) { if (lp) map.set(t, lp); }
  };
  for (let i = 0; i < krTickers.length; i += 8) {
    await krBatch(krTickers.slice(i, i + 8));
  }

  // 3) 누락 US ticker — Yahoo v8 개별 fallback (가드 완화: Stooq 전면 차단 대비)
  const missingUs = usTickers.filter(t => !map.has(t));
  if (missingUs.length > 0) {
    for (let i = 0; i < Math.min(missingUs.length, 100); i += 8) {
      const results = await Promise.all(missingUs.slice(i, i + 8).map(fetchOnePrice));
      for (const [t, lp] of results) { if (lp) map.set(t, lp); }
    }
  }
  const coverage = map.size / CANDIDATE_TICKERS.length;
  console.log(`  [livePrices] ${map.size}/${CANDIDATE_TICKERS.length} 종목 확보 (${(coverage*100).toFixed(1)}%, Yahoo v7 US: ${usMap.size}, KR+fallback: ${map.size - usMap.size})`);

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

      const isKR = /\.(KS|KQ)$/.test(ticker);

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
      const isKR = /\.(KS|KQ)$/.test(ticker);
      const ohlcv = await fetchOHLCV(ticker, isKR ? '1y' : '6mo');
      if (!ohlcv || ohlcv.closes.length < 21) return [ticker, null];
      // 2026-06-05 FIX: 진짜 split 은 *하루 사이 불연속*(2:1 분할 = 하루 0.5x). 기존 전체 range>3x 는
      //   변동성 큰 정상 종목(삼전 1년 6.3x, 일간 점프 1.14x)을 오판 reject → KR 기술데이터 null →
      //   RSI/MA/지지선 환각(삼전 "RSI 45 $202.92" 사건). 일간 점프 >1.8x 로 실제 split 만 감지.
      let maxJump = 1;
      for (let i = 1; i < ohlcv.closes.length; i++) {
        const a = ohlcv.closes[i], b = ohlcv.closes[i - 1];
        if (a > 0 && b > 0) { const rr = a / b; if (rr > maxJump) maxJump = rr; if (1 / rr > maxJump) maxJump = 1 / rr; }
      }
      if (maxJump > 1.8) {
        console.warn(`  [ohlcv-split] ${ticker} 일간 점프 ${maxJump.toFixed(1)}x — 실제 split/unit mismatch, skip`);
        return [ticker, null];
      }
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
async function enforceRotation(portfolio, livePrices) {
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

    // 2026-06-12: rotation 투입 사전 매도룰 심사 (TSLA 오전매수→정오매도 whipsaw 사건).
    //   boost/pool 후보가 매도룰 강신호(데드크로스·200MA 이탈·마진악화 등 score≥7) 보유 시
    //   투입 자체를 거부 — 경합심사가 rotation 前에 실행되는 순서 구멍의 원천 봉합.
    try {
      const vetoRulesR = (loadSellRules()?.rules ?? []).filter((r) => ['fundamental', 'technical', 'guru'].includes(r.category));
      const sigR = await fetchSellSignals(boostList.map((b) => b.ticker));
      boostList = boostList.filter((b) => {
        const sig = sigR.get(b.ticker) ?? {};
        const exCtx = {
          price: livePrices.get(b.ticker)?.price ?? null,
          rsi: sig.rsi, sma50: sig.sma50, sma200: sig.sma200, volPct: sig.volPct,
          opMarginDecline: sig.opMarginDecline, peRatio: sig.peRatio, peg: sig.peg, revenueYoY: sig.revenueYoY,
          sectorPe: null, macroRiskLevel: null,
        };
        const hits = vetoRulesR.map((r) => ({ r, reason: evaluateSellRule(r, exCtx) })).filter((x) => x.reason);
        const total = hits.reduce((s, x) => s + (x.r.score ?? 0), 0);
        if (total >= 7) {
          console.warn(`  [rotation-veto] ${b.ticker} 투입 거부 (매도 score ${total}≥7: ${hits.map((x) => x.r.id).join(',')})`);
          return false;
        }
        return true;
      });
      if (!boostList.length) return portfolio;
    } catch (e) { console.warn(`  [rotation-veto] 심사 skip: ${String(e?.message).slice(0, 60)}`); }

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
      // 2026-06-06: boost/pool 종목 설명을 평이하게 (사용자 "이게 무슨 말이야" — boost-list 전문용어 +
      //   catalysts↔fundamentalBasis 중복). boost = 과거 추천 트랙레코드 우수로 재선정, pool = 섹터 분산 신규.
      const winPct = boost.evaluated ? Math.round((boost.hits ?? 0) / boost.evaluated * 100) : null;
      const baseRationale = isFromPool
        ? `${sectorTag} 섹터 분산 신규 편입 (메가캡 편향 회피)`
        : `과거 추천 성과 우수로 재선정 — 최근 ${boost.evaluated}회 추천 중 ${boost.hits ?? 0}회 목표 도달·${boost.stops ?? 0}회 손절, 평균 +${boost.avg_pnl}%`;
      // 2026-05-29: catalysts 는 ticker/sector/price 포함해 entry 별 unique (cross-ticker dup WARN 회피).
      const baseCatalysts = isFromPool
        ? [
            `${sectorTag} 섹터 노출 확대 — 포트폴리오 분산`,
            `시장가 ${fmt(actual)} 신규 편입 (추가 검증 후 진입 권장)`,
          ]
        : [
            `과거 추천 트랙레코드: ${boost.evaluated}회 중 ${boost.hits ?? 0}회 목표 도달${winPct != null ? `(승률 ${winPct}%)` : ''}`,
            `손절 ${boost.stops ?? 0}회 · 평균 수익 +${boost.avg_pnl}% — 검증된 추천 이력`,
          ];
      updated[candidates[i].idx] = {
        ticker: boost.ticker,
        name: boost.ticker,
        // 2026-05-31: meta canonical sector 직접 사용 (이전 charAt(0).toUpperCase() → "Pharma-biotech"
        //   환각, postProcessPortfolio 이후 실행돼 meta override 못 받음). 없으면 lowercase fallback.
        sector: CANDIDATE_META[boost.ticker]?.sector ?? (isFromPool ? sectorTag.toLowerCase() : 'technology'),
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
        // fundamentalBasis: boost 는 트랙레코드가 catalysts 에 이미 있어 중복 금지 → 종목페이지 안내.
        fundamentalBasis: isFromPool
          ? `${sectorTag} 섹터 분산 목적 신규 — 펀더멘털 상세는 종목 페이지 참조`
          : `재추천 종목 — 펀더멘털 상세는 종목 페이지 참조 (과거 추천 트랙레코드 기반 선정)`,
        technicalBasis: `진입 ${fmt(actual)} · 손절 -7% · 1차 목표 +10%`,
        riskNote: isFromPool
          ? `신규 편입 — 펀더멘털 추가 검증 후 진입 권장`
          : `과거 성과 의존 — 펀더멘털 변화 시 재평가 필요(미래 수익 보장 아님)`,
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
    const isKR = /\.(KS|KQ)$/.test(p.ticker);
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
    const isKR = /\.(KS|KQ)$/.test(p.ticker);
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
    // 2026-05-29: 양쪽 환각 catch — anchor 가 base 보다 위쪽으로 5% 초과 이탈할 때도 calibrate.
    //   NVDA 사건: LLM anchor $350 vs base $214 (+63%) 일 때 기존 코드는 catch 못함.
    const calib = ENTRY_CALIBRATION?.get?.(p.ticker?.toUpperCase());
    const anchorOff = Math.abs(anchor / base - 1) * 100;
    if (calib && typeof calib.medianGap === 'number' && calib.medianGap > 5 && anchorOff > 5) {
      console.log(`  [entry-calib] ${p.ticker}: medianGap ${calib.medianGap.toFixed(1)}% > 5% — anchor ${anchorLabel}(${fmt(anchor)}) gap=${anchorOff.toFixed(0)}% → current(${fmt(base)})`);
      anchor = base;
      anchorLabel = `current(calib-NE-${calib.medianGap.toFixed(1)}%)`;
    }
    // 2026-05-30: anchor 가 current(fallback) 인 경우 disc 를 max 2% 로 cap.
    //   원인: LLM 이 200MA/50MA 보내도 rationale 에 값 없으면 anchor=current.
    //   disc 5% 그대로 적용하면 zone = current*0.93-0.96 = -4~-7% gap → NE 위험 (5/30 morning TSM/TSLA/005930 case).
    //   진짜 50MA/200MA anchor 일 때만 LLM disc 존중.
    const isAnchorFallback = anchorLabel === 'current' || anchorLabel?.startsWith('current(');
    const discCap = isAnchorFallback ? 2 : 5;
    const disc = Math.max(0, Math.min(discCap, Number(discountPct) || 0)) / 100;
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
    const isKR = /\.(KS|KQ)$/.test(p.ticker);
    const curr = isKR ? '₩' : '$';
    const fmt = n => isKR ? `${curr}${Math.round(n).toLocaleString()}` : `${curr}${n.toFixed(2)}`;
    const extractNums = str => (str ?? '').replace(/[₩$,\s]/g, '').match(/[\d.]+/g)?.map(Number).filter(n => n > 0) ?? [];

    let updated = { ...p };
    const zoneNums = extractNums(p.entryZone);
    const zoneLow = zoneNums.length > 0 ? Math.min(...zoneNums) : 0;
    const zoneHigh = zoneNums.length > 0 ? Math.max(...zoneNums) : 0;
    // 2026-05-29: 환각 cutoff 강화 — 시장가 대비 ±15% 이상 이탈 시 환각으로 판정.
    //   기존 1.50/0.50 은 LLM 의 +60% 환각 (NVDA $350 vs actual $214) 도 통과시켜서 NE 확정 양산.
    //   현재가가 zone 의 -15% 아래도 LLM 이 너무 비싸게 잡은 환각.
    const isHalluc = zoneNums.length > 0 && (
      zoneHigh < actual * 0.85 ||             // zone 이 시장가 -15% 아래 → 너무 싸게 잡음
      zoneNums.every(n => n > actual * 1.15)  // zone 모두 시장가 +15% 위 → 너무 비싸게 잡음 (NE 확정)
    );
    // zone 미출력
    const noZone = !zoneNums.length;
    if (noZone || isHalluc) {
      if (isHalluc) console.warn(`  ⚠️  ${p.ticker} entry 환각: ${p.entryZone} vs actual ${fmt(actual)} (gap ${((zoneLow/actual - 1)*100).toFixed(0)}~${((zoneHigh/actual - 1)*100).toFixed(0)}%) → 시장가 기준 보정`);
      updated.entryZone = isKR
        ? `${fmt(Math.round(actual * 0.97))}-${fmt(Math.round(actual * 1.01))}`
        : `${fmt(parseFloat((actual * 0.97).toFixed(2)))}-${fmt(parseFloat((actual * 1.01).toFixed(2)))}`;
    }
    const stopNums = extractNums(p.stopLoss);
    const stopHalluc = stopNums.length > 0 && (stopNums[0] < actual * 0.70 || stopNums[0] > actual * 1.05);
    if (!stopNums.length || stopHalluc) {
      if (stopHalluc) console.warn(`  ⚠️  ${p.ticker} stop 환각: ${p.stopLoss} → 보정`);
      updated.stopLoss = fmt(isKR ? Math.round(actual * 0.92) : parseFloat((actual * 0.92).toFixed(2)));
    }
    const targetNums = extractNums(p.target);
    const targetHalluc = targetNums.length > 0 && (targetNums[0] < actual * 1.02 || targetNums[0] > actual * 2.0);
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

  // Financials text: "NVDA: Q1 FY2027 $81.6B +85.2% YoY opMgn=60.4% ROE=76.3% PE=44.6"
  //   2026-06-05: 라벨이 "Q1 FY2027"(멀티워드)면 기존 (\S+)\s+(\S+) 가 깨져 US fin 이 silent null 이었음
  //   → 라벨 non-greedy + revenue($X.XB) 앵커 + opMgn 은 후행 ROE/PE/netMgn 사이에서도 검색.
  const finMap = new Map();
  for (const part of (financialsText ?? '').split(' | ')) {
    const m = part.match(/^(\S+):\s*(.+?)\s+(\$[\d.]+[BM])\s+([\+\-]?\d+\.?\d*%)\s+YoY(?:.*?opMgn=([\d.]+)%)?(?:.*?ROE=([\d.]+)%)?(?:.*?PE=([\d.]+))?/);
    if (m) finMap.set(m[1], { label: m[2], rev: m[3], yoy: m[4], margin: m[5] ?? null, roe: m[6] ?? null, pe: m[7] ?? null });
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
        // 2026-06-12: OHLCV 무결성 가드 (KLAC "+1150.1% 급등" 사건 — Yahoo 시계열에 분할이벤트 없는
        //   11배 점프 오염틱). 인접 종가 비율 1.8x 초과 = 데이터 오류 → 이 ticker 의 timing 갱신 skip.
        //   (52w/MA 경로의 split 가드와 동일 원리 — 이 경로만 누락돼 있던 산재 불변식)
        let corrupt = false;
        for (let i = 1; i < closes.length; i++) {
          if (closes[i - 1] > 0 && (closes[i] / closes[i - 1] > 1.8 || closes[i] / closes[i - 1] < 0.55)) { corrupt = true; break; }
        }
        if (corrupt) {
          console.warn(`  [후처리] ${ticker} OHLCV 인접비율 이상(분할/오염틱 의심) → post-earnings 계산 skip`);
          result.push(s); continue;
        }

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

    // 비현실 수익률 상한 — |60%| 초과는 데이터 오류로 간주 (밈주 극단도 ~40%대)
    if (postReturn != null && Math.abs(postReturn) > 60) {
      console.warn(`  [후처리] ${ticker} post-earnings ${postReturn}% 비현실 → 데이터 오류로 폐기`);
      postReturn = null;
    }
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
 * 2026-06-06: 거시 급락 조기경보 composite (사용자 "급락 데이터로 예측 힘들었나").
 *   신용/변동성/금리커브/심리/FX/고용 선행지표를 결정론적 score 화 → LLM riskLevel 보완.
 *   "endpoint alive ≠ 위험 감지" 처럼 데이터는 있는데 composite 가 없던 사각지대 해소.
 */
function computeMacroEarlyWarning(ctxRaw, fx = {}, extras = {}) {
  const ind = ctxRaw?.macro?.indicators ?? [];
  const get = (ids) => ind.find(i => ids.includes(i.id));
  let score = 0; const drivers = [];
  const add = (pts, msg) => { score += pts; drivers.push(msg); };
  // 1. 신용 스프레드 — 확대(전분기 대비) 또는 절대 고위험
  const hy = get(['hy_spread', 'hy_oas']);
  if (hy?.actual != null) {
    if (hy.previous != null && hy.actual > hy.previous + 0.5) add(20, `HY신용 스프레드 확대 ${hy.previous}→${hy.actual}%`);
    if (hy.actual >= 5) add(20, `HY스프레드 ${hy.actual}% 절대고위험`);
    else if (hy.actual >= 4) add(10, `HY스프레드 ${hy.actual}% 경계`);
  }
  const ig = get(['ig_spread', 'ig_oas']);
  if (ig?.actual != null && ig.previous != null && ig.actual > ig.previous + 0.2) add(10, `IG신용 확대 ${ig.previous}→${ig.actual}%`);
  // 2. VIX — 2026-06-12 fix: /api/volatility 응답 필드는 `.vix` (이전 `.score` 는 존재하지 않는
  //   필드 → 6/5 VIX +40% 급등에도 항상 null로 침묵. .score 가 있었어도 0-100 합성점수라 오스케일).
  const vix = get(['vix'])?.actual ?? ctxRaw?.volatility?.vix;
  if (vix != null) { if (vix >= 30) add(25, `VIX ${vix} 패닉`); else if (vix >= 25) add(15, `VIX ${vix} 급등`); else if (vix >= 20) add(8, `VIX ${vix} 경계`); }
  // 2c. VIX 기간구조 + VVIX (2026-06-12 신설) — 스냅샷 백테스트: 6/5 폭락은 쇼크형이라 선행 못함
  //   (6/5 장전까지 contango), 단 6/6~6/11 역전 지속 = "스트레스 진행 중" 확인 신호로 유효.
  const vol = ctxRaw?.volatility;
  if (vol?.vxst != null && vol?.vix != null && vol.vxst > vol.vix) {
    add(12, `VIX 기간구조 역전(VXST ${(+vol.vxst).toFixed(1)}>VIX ${(+vol.vix).toFixed(1)}) — 단기 스트레스 지속`);
  } else if (vol?.regime === 'backwardation') {
    add(12, `VIX 선물 백워데이션 — 스트레스 구간`);
  }
  if (vol?.vvix != null && vol.vvix >= 110) add(8, `VVIX ${Math.round(vol.vvix)} — 변동성의 변동성 고조`);
  // 2b. 지수 모멘텀 (2026-06-12 신설) — capital-flows 주식군 1주 수익률. 6/5~6/10 급락(-4~-12%)에
  //   가격 기반 입력이 전무해 score 0 이던 결함. 폭락 "예측"은 불가해도 "진행 감지"는 필수.
  const eqAssets = (ctxRaw?.capital?.assets ?? []).filter(a => ['us-stocks', 'us-tech', 'em-stocks', 'eu-stocks'].includes(a.id) && typeof a.ret1w === 'number');
  if (eqAssets.length) {
    const worst = eqAssets.reduce((m, a) => (a.ret1w < m.ret1w ? a : m));
    if (worst.ret1w <= -7) add(25, `${worst.label ?? worst.id} 1주 ${worst.ret1w}% 폭락`);
    else if (worst.ret1w <= -4) add(15, `${worst.label ?? worst.id} 1주 ${worst.ret1w}% 급락`);
    else if (worst.ret1w <= -2.5) add(8, `${worst.label ?? worst.id} 1주 ${worst.ret1w}% 하락`);
  }
  // 3. 금리커브 역전 (10-2)
  const y10 = get(['us10y', 'yield_10y', 'dgs10'])?.actual, y2 = get(['us2y', 'yield_2y', 'dgs2'])?.actual;
  if (y10 != null && y2 != null) { const sp = y10 - y2; if (sp < 0) add(18, `장단기금리 역전 ${sp.toFixed(2)}%p`); else if (sp < 0.2) add(8, `금리커브 평탄 ${sp.toFixed(2)}%p`); }
  // 4. 심리 극단 (탐욕 반전 / 공포 capitulation)
  const fgScore = (ctxRaw?.fearGreed ?? ctxRaw?.fear_greed)?.score ?? (ctxRaw?.fearGreed?.us?.score);
  if (fgScore != null) {
    if (fgScore >= 80) add(15, `F&G ${fgScore} 극단탐욕(반전위험)`); else if (fgScore <= 20) add(10, `F&G ${fgScore} 극단공포`);
    // 4b. F&G 급랭 (2026-06-12 신설) — 절대 임계(≤20)만으론 42→27 급랭(4일)을 못 봄. 변화 속도 반영.
    const prev = extras.prevFgScore;
    if (typeof prev === 'number' && prev - fgScore >= 15) add(12, `F&G 급랭 ${prev}→${fgScore} (심리 이탈 가속)`);
  }
  // 5. FX 스트레스 (원화/DXY 급변)
  if (fx.usdkrwChg != null && Math.abs(fx.usdkrwChg) >= 2) add(15, `USD/KRW ${fx.usdkrwChg > 0 ? '+' : ''}${fx.usdkrwChg}% 급변(자본유출 압력)`);
  // 6. 고용 둔화 (jobless claims 상승 surprise) + PMI 위축
  const jc = get(['jobless_claims', 'initial_claims']);
  if (jc?.actual != null && jc.previous != null && jc.actual > jc.previous && jc.surprise === 'miss') add(10, `신규실업수당 증가 ${jc.previous}→${jc.actual}K`);
  const pmi = get(['ism_pmi', 'ism_manufacturing']);
  if (pmi?.actual != null && pmi.actual < 48) add(10, `ISM PMI ${pmi.actual} 위축`);
  score = Math.min(100, score);
  const level = score >= 70 ? 'severe' : score >= 45 ? 'high' : score >= 25 ? 'elevated' : 'low';
  return { score, level, drivers, asOf: new Date().toISOString() };
}

// 2026-06-12: 반등관찰(상승 신호) — 사용자 "위험신호나 상승신호 예측". 결정론 3조건 중 2+ 면 'watch':
//   ① 심리 공포(F&G≤30) ② 최근 급락 흔적(주식군 1주 ≤-4%) ③ VIX 기간구조 정상화(VXST<VIX 인데
//   VIX 는 아직 ≥18 = 스트레스 피크아웃 진행). 매수 단정 아님 — 과매도 반등 "관찰" 신호.
//   (6/9 KOSPI +8.2% 류 반등의 사후 백테스트는 6/7~6/11 머신다운으로 스냅샷 부재 — 보수적 watch 만)
function computeReboundWatch(ctxRaw) {
  const drivers = [];
  const fg = (ctxRaw?.fearGreed ?? ctxRaw?.fear_greed)?.score ?? null;
  if (fg != null && fg <= 30) drivers.push(`F&G ${fg} 공포 구간`);
  const eq = (ctxRaw?.capital?.assets ?? []).filter(a => ['us-stocks', 'us-tech', 'em-stocks', 'eu-stocks'].includes(a.id) && typeof a.ret1w === 'number');
  if (eq.length) {
    const worst = eq.reduce((m, a) => (a.ret1w < m.ret1w ? a : m));
    if (worst.ret1w <= -4) drivers.push(`${worst.label ?? worst.id} 1주 ${worst.ret1w}% 과매도권`);
  }
  const vol = ctxRaw?.volatility;
  if (vol?.vxst != null && vol?.vix != null && vol.vxst < vol.vix && vol.vix >= 18) {
    drivers.push(`VIX 기간구조 정상화(VXST<VIX, VIX ${(+vol.vix).toFixed(1)}) — 스트레스 피크아웃 가능`);
  }
  return { level: drivers.length >= 2 ? 'watch' : 'none', drivers, asOf: new Date().toISOString() };
}

// ── 2026-06-12: 종합 판정 엔진 (사용자 "하락 전조·상승 전조·공포 매수·구루 방식·과거 유사상황
//    다 고려해서 관망/매수/중립 결정") — 전부 결정론(LLM 무관). ─────────────────────────────
//
// [1] 과거 유사국면: ^GSPC+^VIX 전체 히스토리(1990~)를 매 발간 라이브 fetch, 현재 지문
//     (VIX·고점대비 낙폭·20일 수익률)과 유사한 과거 시점을 찾아 그 후 1/3/6개월 실측 수익률 산출.
//     하드코딩 사례표 금지(기억 기반 수치 = 환각 위험) — 데이터에서 직접 계산.
async function computeHistoricalAnalog(ctxRaw) {
  const hist = async (sym) => {
    // range=max 는 일봉 무시하고 월봉 반환 (스모크 실측 168개) — period1/period2 명시 필수.
    const p1 = Math.floor(Date.UTC(1990, 0, 1) / 1000), p2 = Math.floor(Date.now() / 1000);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=${p1}&period2=${p2}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const r = (await res.json())?.chart?.result?.[0];
    if (!r?.timestamp) return null;
    const closes = r.indicators?.quote?.[0]?.close ?? [];
    const out = [];
    for (let i = 0; i < r.timestamp.length; i++) {
      if (closes[i] != null && closes[i] > 0) out.push({ d: new Date(r.timestamp[i] * 1000).toISOString().slice(0, 10), c: closes[i] });
    }
    return out;
  };
  try {
    // 2026-06-14 다요인 확장(사용자 "거시·미시 다 조합"): 가격/변동성 3지문 → 거시 추가(10Y 금리·
    //   수익률곡선 기울기·금리 3개월 모멘텀). ^TNX(10Y)/^IRX(13주)는 Yahoo 장기 이력(1990↑) 보유 →
    //   과거 국면 매칭에 사용 가능. (신용스프레드·F&G 는 장기 이력 부재 → 현재상태 overlay 로만 활용.)
    const [spx, vix, kospi, tnx, irx] = await Promise.all([hist('^GSPC'), hist('^VIX'), hist('^KS11'), hist('^TNX').catch(() => null), hist('^IRX').catch(() => null)]);
    if (!spx?.length || !vix?.length) return null;
    const tnxByDate = new Map((tnx ?? []).map(p => [p.d, p.c]));
    const irxByDate = new Map((irx ?? []).map(p => [p.d, p.c]));
    const haveMacro = tnxByDate.size > 500 && irxByDate.size > 500;
    // 2026-06-13: KR 차원 — breadth 블록 뒤에서 계산(med/curMonth 의존). US 와 동일 깊이(추세+계절성+
    //   유사국면+breadth) 부여 — 사용자 "us랑 kr 왤케 달라? kr 부실". 전부 동적(라이브 Yahoo).
    let kr = null;
    const vixByDate = new Map(vix.map(p => [p.d, p.c]));
    // 시계열 지표: 고점대비 낙폭(252d trailing) + 20일 수익률 + (거시) 10Y 금리·수익률곡선 기울기, VIX 정렬
    const rows = [];
    for (let i = 252; i < spx.length; i++) {
      const v = vixByDate.get(spx[i].d);
      if (v == null) continue;
      let hi = 0; for (let j = i - 252; j <= i; j++) if (spx[j].c > hi) hi = spx[j].c;
      const ty = tnxByDate.get(spx[i].d);            // 10Y 금리 (%)
      const bill = irxByDate.get(spx[i].d);          // 13주 T-bill (%)
      rows.push({
        i, d: spx[i].d, c: spx[i].c, vix: v,
        dd: (spx[i].c / hi - 1) * 100,
        r20: i >= 20 ? (spx[i].c / spx[i - 20].c - 1) * 100 : 0,
        ty: ty != null ? ty : null,
        slope: (ty != null && bill != null) ? (ty - bill) : null,  // 10Y−13wk (수익률곡선 기울기; 음수=역전)
      });
    }
    if (rows.length < 500) return null;
    // 금리 3개월(≈63행) 모멘텀 — 같은 rows 배열에서 lookback
    for (let k = 0; k < rows.length; k++) {
      const prev = rows[k - 63];
      rows[k].tyChg3m = (rows[k].ty != null && prev?.ty != null) ? +(rows[k].ty - prev.ty).toFixed(2) : null;
    }
    const now = rows[rows.length - 1];
    // 현재값은 라이브 우선 (Yahoo 마지막 봉이 전일일 수 있음)
    const liveVix = ctxRaw?.volatility?.vix;
    const fp = {
      vix: liveVix != null ? +liveVix : now.vix, dd: now.dd, r20: now.r20,
      ty: now.ty, slope: now.slope, tyChg3m: now.tyChg3m,
    };
    // ── 다요인 가중 거리 매칭 (hard AND-게이트 → 정규화 가중 유클리드). 거시값 결측 행은 해당 차원 skip.
    //   scale=대략적 표준편차, weight=차원 중요도(가격/변동성 우위, 거시 보조). 임계는 적응형(매칭 8건 목표).
    const DIMS = haveMacro
      ? [['vix', 7, 1.0], ['dd', 6, 1.0], ['r20', 5, 0.9], ['ty', 1.5, 0.7], ['slope', 1.0, 0.7], ['tyChg3m', 1.0, 0.6]]
      : [['vix', 7, 1.0], ['dd', 6, 1.0], ['r20', 5, 0.9]];
    const distOf = (r) => {
      let sumSq = 0, wSq = 0;
      for (const [key, scale, w] of DIMS) {
        if (fp[key] == null || r[key] == null) continue;          // 결측 차원 제외(가중 정규화로 보정)
        const z = ((r[key] - fp[key]) / scale) * w;
        sumSq += z * z; wSq += w * w;
      }
      return wSq > 0 ? Math.sqrt(sumSq / wSq) : Infinity;           // 차원수 무관 비교 위해 weight 정규화
    };
    const buildEpisodes = (thresh) => {
      const eps = []; let lastIdx = -9999;
      for (const r of rows) {
        if (r.i >= rows[rows.length - 1].i - 126) break;          // 최근 6개월 제외(forward 미완성)
        if (r.i - lastIdx < 21) continue;                         // 같은 국면 중복 제거(에피소드화)
        if (distOf(r) > thresh) continue;
        const at = (k) => { const f = spx[r.i + k]; return f ? (f.c / r.c - 1) * 100 : null; };
        const f1 = at(21), f3 = at(63), f6 = at(126);
        if (f3 == null) continue;
        eps.push({ date: r.d, dist: +distOf(r).toFixed(2), fwd1m: f1 != null ? +f1.toFixed(1) : null, fwd3m: +f3.toFixed(1), fwd6m: f6 != null ? +f6.toFixed(1) : null });
        lastIdx = r.i;
      }
      return eps;
    };
    // 적응형 임계: 좁게 시작해 8건 미만이면 단계적 완화 (과적합 방지 + 항상 표본 확보)
    let episodes = [], usedThresh = null;
    for (const th of [0.6, 0.85, 1.1, 1.4]) { episodes = buildEpisodes(th); usedThresh = th; if (episodes.length >= 8) break; }
    episodes.sort((a, b) => a.dist - b.dist);                      // 가까운 국면 우선
    const med = (arr) => { const s = arr.filter(x => x != null).sort((a, b) => a - b); return s.length ? +s[Math.floor(s.length / 2)].toFixed(1) : null; };
    // 2026-06-12 보강(사용자 승인 tier-1): ① 지수 추세 — SPX 200일선 위/아래 (공포매수도 장기추세
    //   위에서 성공률 높음) ② 계절성 — 현재 월의 역사적 1개월 forward 중앙값 (실측, 하드코딩 금지)
    //   ③ 시장 폭 프록시 — RSP(동일가중) vs SPX 20일 상대수익. 좁은 주도(음수) = 취약 신호.
    const last = spx[spx.length - 1];
    let sma200 = null;
    if (spx.length >= 200) { let s = 0; for (let j = spx.length - 200; j < spx.length; j++) s += spx[j].c; sma200 = s / 200; }
    const trend = sma200 ? { above200: last.c > sma200, distPct: +((last.c / sma200 - 1) * 100).toFixed(1) } : null;
    const curMonth = new Date().getUTCMonth();
    const seasonFwd = [];
    for (let i = 0; i + 21 < spx.length; i += 5) {
      if (new Date(spx[i].d).getUTCMonth() === curMonth) seasonFwd.push((spx[i + 21].c / spx[i].c - 1) * 100);
    }
    const seasonality = seasonFwd.length >= 30 ? { month: curMonth + 1, med1m: med(seasonFwd), n: seasonFwd.length } : null;
    let breadth = null;
    try {
      const rsp = await hist('RSP');
      if (rsp?.length > 21) {
        const r20rsp = (rsp[rsp.length - 1].c / rsp[rsp.length - 21].c - 1) * 100;
        const r20spx = (spx[spx.length - 1].c / spx[spx.length - 21].c - 1) * 100;
        breadth = { divergencePp: +(r20rsp - r20spx).toFixed(1) };  // 음수 = 소수 대형주 주도(취약)
      }
    } catch { /* breadth 미산출 — non-fatal */ }
    // ── KR 차원: US 와 동일 깊이 (추세 + 계절성 + 유사국면 + breadth), 전부 동적 ───────────────
    if (kospi?.length > 260) {
      const lastK = kospi[kospi.length - 1];
      let hiK = 0; for (let j = kospi.length - 253; j < kospi.length; j++) if (kospi[j].c > hiK) hiK = kospi[j].c;
      let sK = 0; for (let j = kospi.length - 200; j < kospi.length; j++) sK += kospi[j].c;
      const smaK = sK / 200;
      // KR 계절성 — KOSPI 현재 월 1개월 forward 중앙값 (US seasonality 와 동일 알고리즘, 실측)
      const ksSeasonFwd = [];
      for (let i = 0; i + 21 < kospi.length; i += 5) {
        if (new Date(kospi[i].d).getUTCMonth() === curMonth) ksSeasonFwd.push((kospi[i + 21].c / kospi[i].c - 1) * 100);
      }
      // KR 과거 유사국면 — KOSPI 낙폭(252d)+20일 지문 → 3개월 forward 중앙값·상승확률.
      //   KR 은 VIX 등가 라이브 인덱스 부재 → 낙폭+모멘텀 2지문으로 매칭(US 는 VIX 포함 3지문).
      const ksRows = [];
      for (let i = 252; i < kospi.length; i++) {
        let hi = 0; for (let j = i - 252; j <= i; j++) if (kospi[j].c > hi) hi = kospi[j].c;
        ksRows.push({ i, dd: (kospi[i].c / hi - 1) * 100, r20: i >= 20 ? (kospi[i].c / kospi[i - 20].c - 1) * 100 : 0 });
      }
      const ksNow = ksRows[ksRows.length - 1];
      const ksEp = [];
      let lk = -9999;
      for (const r of ksRows) {
        if (r.i >= ksRows[ksRows.length - 1].i - 126) break;
        if (r.i - lk < 21) continue;
        if (Math.abs(r.dd - ksNow.dd) > 4 || Math.abs(r.r20 - ksNow.r20) > 5) continue;
        const f = kospi[r.i + 63];
        if (!f) continue;
        ksEp.push((f.c / kospi[r.i].c - 1) * 100);
        lk = r.i;
      }
      // KR breadth — KOSDAQ(^KQ11) vs KOSPI 20일 상대수익 (소형주 참여도; 양수=광범위 참여).
      let krBreadth = null;
      try {
        const kq = await hist('^KQ11');
        if (kq?.length > 21) {
          const r20kq = (kq[kq.length - 1].c / kq[kq.length - 21].c - 1) * 100;
          const r20ks = (lastK.c / kospi[kospi.length - 21].c - 1) * 100;
          krBreadth = { divergencePp: +(r20kq - r20ks).toFixed(1) };  // 양수 = KOSDAQ(소형주) 주도, 광범위
        }
      } catch { /* non-fatal */ }
      kr = {
        dd: +((lastK.c / hiK - 1) * 100).toFixed(1),
        r20: +((lastK.c / kospi[kospi.length - 21].c - 1) * 100).toFixed(1),
        above200: lastK.c > smaK,
        distPct: +((lastK.c / smaK - 1) * 100).toFixed(1),
        seasonality: ksSeasonFwd.length >= 30 ? { month: curMonth + 1, med1m: med(ksSeasonFwd), n: ksSeasonFwd.length } : null,
        analog: ksEp.length >= 5 ? { matches: ksEp.length, med3m: med(ksEp), posRate3m: Math.round(ksEp.filter(x => x > 0).length / ksEp.length * 100) } : null,
        breadth: krBreadth,
      };
    }
    // 거시 현재상태 overlay — 과거 장기이력 부재(신용스프레드·F&G)는 매칭 차원 아님, 현재 국면 해석용.
    //   computeMacroEarlyWarning 과 동일 ctxRaw 소스. UI/판정이 "지금 거시가 우호/적대인가" 표시.
    const macroContext = {
      ty10: fp.ty != null ? +fp.ty.toFixed(2) : null,              // 10Y 금리 (매칭 차원)
      curveSlopePp: fp.slope != null ? +fp.slope.toFixed(2) : null, // 수익률곡선 기울기 (매칭 차원, 음수=역전)
      rate3moChgPp: fp.tyChg3m != null ? fp.tyChg3m : null,         // 금리 3개월 변화 (매칭 차원)
      fearGreed: (ctxRaw?.fearGreed ?? ctxRaw?.fear_greed)?.score ?? null,  // 현재 overlay (미스 시 null)
      creditSpread: ctxRaw?.credit?.hyOasPct ?? ctxRaw?.creditSpread ?? null, // 현재 overlay
    };
    const base = {
      fingerprint: {
        vix: +fp.vix.toFixed(1), drawdownPct: +fp.dd.toFixed(1), ret20d: +fp.r20.toFixed(1),
        ...(fp.ty != null ? { ty10: +fp.ty.toFixed(2) } : {}),
        ...(fp.slope != null ? { curveSlopePp: +fp.slope.toFixed(2) } : {}),
        ...(fp.tyChg3m != null ? { rate3moChgPp: fp.tyChg3m } : {}),
      },
      factorsUsed: DIMS.map(d => d[0]),                            // 매칭에 쓴 차원 (거시 포함 여부 투명화)
      matchTightness: usedThresh,                                  // 적응형 임계 (작을수록 정밀 매칭)
      macroContext, trend, seasonality, breadth, kr,
      source: haveMacro
        ? 'yahoo-^GSPC/^VIX/^TNX/^IRX/RSP/^KS11/^KQ11-1990~ (다요인 가중매칭)'
        : 'yahoo-^GSPC/^VIX/RSP/^KS11/^KQ11-1990~ (금리 결측→3지문)',
    };
    if (!episodes.length) return { matches: 0, ...base };
    return {
      matches: episodes.length,
      med1m: med(episodes.map(e => e.fwd1m)),
      med3m: med(episodes.map(e => e.fwd3m)),
      med6m: med(episodes.map(e => e.fwd6m)),
      posRate3m: Math.round(episodes.filter(e => e.fwd3m > 0).length / episodes.length * 100),
      recent: episodes.slice(0, 5),                                // 가장 가까운 유사사례 5건 (거리순, 날짜·실측)
      ...base,
    };
  } catch (e) { console.warn(`  [analog] 과거 유사국면 계산 실패: ${String(e?.message).slice(0, 60)}`); return null; }
}

// [2] 공포 매수 신호 (구루 원칙의 결정론화): F&G 공포 + 낙폭 + VIX 급등 조합 = 역발상 매수 구간.
function computeFearBuy(ctxRaw, analog) {
  const fg = (ctxRaw?.fearGreed ?? ctxRaw?.fear_greed)?.score ?? null;
  const vix = ctxRaw?.volatility?.vix != null ? +ctxRaw.volatility.vix : null;
  const dd = analog?.fingerprint?.drawdownPct ?? null;
  let score = 0; const drivers = []; const gurus = [];
  if (fg != null && fg <= 25) { score += fg <= 10 ? 3 : 2; drivers.push(`F&G ${fg} ${fg <= 10 ? '극단' : ''}공포`); }
  if (dd != null && dd <= -5) { score += dd <= -10 ? 2 : 1; drivers.push(`S&P 고점대비 ${dd.toFixed(1)}% 낙폭`); }
  if (vix != null && vix >= 25) { score += vix >= 35 ? 2 : 1; drivers.push(`VIX ${vix} 급등(프리미엄 과대)`); }
  if (score >= 3) {
    gurus.push('버핏: 남들이 두려워할 때 탐욕스럽게', '템플턴: 비관 극대점이 최적 매수점');
    if (vix != null && vix >= 35) gurus.push('하워드 막스: 사이클 극단에서 역발상');
  }
  return { score, active: score >= 3, drivers, gurus };
}

// [3] 종합 판정: 하락전조(earlyWarning) vs 상승전조(reboundWatch) vs 공포매수 vs 과거 유사국면
//     → 매수 확대 / 분할 매수 / 중립(매수 준비) / 중립 / 관망 / 방어. 사용자 "수익 내는 방향으로
//     더 노력" — 근거가 받쳐주면 중립 디폴트 대신 기회 쪽으로 기우는 룰셋.
function computeMarketVerdict(earlyWarning, reboundWatch, fearBuy, analog, ctxRaw) {
  const fg = (ctxRaw?.fearGreed ?? ctxRaw?.fear_greed)?.score ?? null;
  const reasons = [];
  // 2026-06-13: 사용자 "US, KR 분리" — 각 근거에 region 태그(global/us/kr). reasonRegions 는
  //   reasons 와 1:1 평행 배열(문자열 미변경 → 번역/probe 무영향). ReportPage 가 region 별 그룹 렌더.
  const regions = [];
  const add = (text, region) => { reasons.push(text); regions.push(region); };
  const analogLine = analog?.matches
    ? `과거 유사국면 ${analog.matches}회(1990~, VIX ${analog.fingerprint.vix}·낙폭 ${analog.fingerprint.drawdownPct}% 지문): 3개월 후 중앙값 ${analog.med3m > 0 ? '+' : ''}${analog.med3m}% · 상승확률 ${analog.posRate3m}%`
    : null;
  let verdict;
  if (earlyWarning.level === 'severe') {
    verdict = 'defensive';
    add(`하락 전조 심각(경보 ${earlyWarning.score}): ${earlyWarning.drivers.slice(0, 3).join(' · ')}`, 'global');
  } else if (earlyWarning.level === 'high') {
    verdict = 'wait';
    add(`하락 전조 고조(경보 ${earlyWarning.score}) — 신규 진입 보류`, 'global');
  } else if (fearBuy.score >= 4) {
    verdict = 'buy_dip';
    add(`공포 매수 구간: ${fearBuy.drivers.join(' · ')}`, 'global');
    for (const g of fearBuy.gurus.slice(0, 2)) add(g, 'global');
  } else if (fearBuy.active && reboundWatch.level === 'watch') {
    verdict = 'accumulate';
    add(`공포 신호(${fearBuy.drivers.join('·')}) + 반등 관찰(${reboundWatch.drivers.length}조건) 동시 충족 — 분할 매수`, 'global');
  } else if (reboundWatch.level === 'watch' && analog?.matches >= 5 && analog.med3m >= 4 && analog.posRate3m >= 65) {
    verdict = 'accumulate';
    add(`상승 전조 관찰(${reboundWatch.drivers.slice(0, 2).join(' · ')}) + 과거 유사국면 우호적`, 'global');
  } else if (earlyWarning.level === 'elevated') {
    verdict = 'wait';
    add(`경보 상승 구간(${earlyWarning.score}) — ${earlyWarning.drivers.slice(0, 2).join(' · ')}`, 'global');
  } else if (analog?.matches >= 5 && analog.med3m >= 4 && fg != null && fg <= 50) {
    verdict = 'neutral_ready';
    add(`심리 비과열(F&G ${fg}) + 과거 유사국면 3개월 기대 양호 — 조정 시 매수 준비`, 'global');
  } else if (analog?.matches >= 5 && analog.med3m <= -2) {
    verdict = 'wait';
    add(`과거 유사국면의 3개월 기대수익 음수 — 보수적 접근`, 'global');
  } else {
    verdict = 'neutral';
    add('하락·상승 전조 모두 뚜렷하지 않음 — 기존 포지션 유지', 'global');
  }
  // 2026-06-12 tier-1 보정(사용자 승인): 지수 추세·시장 폭·안전자산 동시이동으로 한 단계 가감.
  const downgrade = { buy_dip: 'accumulate', accumulate: 'neutral_ready', neutral_ready: 'neutral' };
  if (analog?.trend && !analog.trend.above200 && (verdict === 'buy_dip' || verdict === 'accumulate')) {
    verdict = downgrade[verdict];
    add(`S&P500 200일선 아래(${analog.trend.distPct}%) — 장기 추세 미회복, 매수 강도 한 단계 하향`, 'us');
  } else if (analog?.trend?.above200 && (verdict === 'buy_dip' || verdict === 'accumulate')) {
    add(`S&P500 200일선 위(+${analog.trend.distPct}%) — 장기 추세 유효 (공포매수 성공률 우호 조건)`, 'us');
  }
  if (analog?.breadth?.divergencePp != null) {
    if (analog.breadth.divergencePp <= -1.5) {
      add(`시장 폭 취약: 동일가중(RSP)이 시총가중 대비 20일 ${analog.breadth.divergencePp}%p 열위 — 소수 대형주 주도`, 'us');
      if (verdict === 'neutral_ready') verdict = 'neutral';
    } else if (analog.breadth.divergencePp >= 1.5) {
      add(`시장 폭 양호: 동일가중이 +${analog.breadth.divergencePp}%p 우위 — 광범위 참여`, 'us');
    }
  }
  {
    const assets = ctxRaw?.capital?.assets ?? [];
    const aw = (id) => { const a = assets.find(x => x.id === id); return typeof a?.ret1w === 'number' ? a.ret1w : null; };
    const gold = aw('gold'), tlt = aw('us-bonds-lt');
    const eqW = assets.filter(a => ['us-stocks', 'us-tech', 'em-stocks', 'eu-stocks'].includes(a.id) && typeof a.ret1w === 'number');
    const eqWorst = eqW.length ? Math.min(...eqW.map(a => a.ret1w)) : null;
    if (gold != null && tlt != null && eqWorst != null && gold >= 1 && tlt >= 0.5 && eqWorst <= -1) {
      add(`안전자산 동시 유입(금 +${gold}% · 장기채 +${tlt}% · 주식 ${eqWorst}%) — risk-off 진행 중`, 'global');
      if (verdict in downgrade) verdict = downgrade[verdict];
    }
  }
  if (analog?.seasonality) add(`S&P500 계절성(${analog.seasonality.month}월, 1990~ ${analog.seasonality.n}표본): 1개월 forward 중앙값 ${analog.seasonality.med1m > 0 ? '+' : ''}${analog.seasonality.med1m}%`, 'us');
  if (analogLine) add(analogLine, 'us');
  // 2026-06-13: KR 종합 판단 *별도 박스* (사용자 "아예 다른 박스로, 종합판단도 따로"). KR 신호 +
  //   글로벌 거시 게이트로 독립 stance 산출 — US 판정과 분리. krVerdict.reasons 는 자체 배열.
  const krVerdict = computeKrVerdict(analog?.kr, earlyWarning);
  // 검증체계(2026-06-13): region 누락/desync 자동 포착 — add() 우회 reasons.push() 직접 시 길이 어긋남
  //   → flat fallback 으로 회귀 silent. 여기서 warn. (US 박스 내부 global/us 서브그룹용)
  if (reasons.length !== regions.length) console.warn(`  [verdict] ⚠️ reasons(${reasons.length})≠reasonRegions(${regions.length}) — add() 우회 의심`);
  const badRegion = regions.find(r => !['global', 'us'].includes(r));
  if (badRegion) console.warn(`  [verdict] ⚠️ 미지정 region '${badRegion}' — KR 은 krVerdict 로 분리됨, main 은 global/us 만`);
  return { verdict, reasons, reasonRegions: regions, krVerdict, fearBuy: { score: fearBuy.score, active: fearBuy.active }, analog, asOf: new Date().toISOString(), source: 'deterministic' };
}

// 2026-06-13: KR 독립 종합 판단 (별도 박스). KOSPI 추세/breadth/계절성/유사국면 + 글로벌 거시 게이트.
//   US 와 동일 tier(defensive/wait/neutral/neutral_ready/accumulate/buy_dip), 전부 동적 KOSPI/KOSDAQ 실측.
function computeKrVerdict(k, earlyWarning) {
  if (!k) return null;
  const reasons = [];
  let verdict;
  if (earlyWarning.level === 'severe') { verdict = 'defensive'; reasons.push('글로벌 하락 전조 심각 — KR 포함 방어적 포지션'); }
  else if (earlyWarning.level === 'high') { verdict = 'wait'; reasons.push('글로벌 경보 고조 — KR 신규 진입 보류'); }
  else if (k.r20 >= 12) { verdict = 'neutral'; reasons.push(`KR 단기 과열(20일 +${k.r20}%) — 분할·보수적, 추격 자제`); }
  else if (k.dd <= -8 && earlyWarning.level === 'low') { verdict = 'accumulate'; reasons.push(`KR 낙폭 과대(고점대비 ${k.dd}%) + 경보 낮음 — 분할 매수 관찰`); }
  else if (k.analog?.matches >= 5 && k.analog.med3m >= 3 && k.analog.posRate3m >= 60 && k.above200) { verdict = 'neutral_ready'; reasons.push(`KR 유사국면 우호(3개월 +${k.analog.med3m}%, 상승확률 ${k.analog.posRate3m}%) + 200일선 위 — 조정 시 매수 준비`); }
  else if (k.analog?.matches >= 5 && k.analog.med3m <= -2) { verdict = 'wait'; reasons.push('KR 과거 유사국면 3개월 기대 음수 — 보수적 접근'); }
  else { verdict = 'neutral'; reasons.push('KR 뚜렷한 전조 없음 — 기존 포지션 유지'); }
  // 근거 디테일 (US 박스와 동일 깊이)
  reasons.push(`KOSPI 추세: 200일선 ${k.above200 ? '위' : '아래'}(${k.distPct > 0 ? '+' : ''}${k.distPct}%) · 고점대비 ${k.dd}% · 20일 ${k.r20 > 0 ? '+' : ''}${k.r20}%`);
  if (k.breadth?.divergencePp != null) {
    if (k.breadth.divergencePp >= 1.5) reasons.push(`KR 시장 폭 양호: KOSDAQ이 KOSPI 대비 20일 +${k.breadth.divergencePp}%p 우위 — 광범위 참여`);
    else if (k.breadth.divergencePp <= -1.5) reasons.push(`KR 시장 폭 취약: KOSDAQ이 KOSPI 대비 20일 ${k.breadth.divergencePp}%p 열위 — 대형주 편중`);
  }
  if (k.analog?.matches >= 5) reasons.push(`KR 과거 유사국면 ${k.analog.matches}회(KOSPI 낙폭 ${k.dd}%·20일 ${k.r20 > 0 ? '+' : ''}${k.r20}% 지문): 3개월 후 중앙값 ${k.analog.med3m > 0 ? '+' : ''}${k.analog.med3m}% · 상승확률 ${k.analog.posRate3m}%`);
  if (k.seasonality) reasons.push(`KOSPI 계절성(${k.seasonality.month}월, ${k.seasonality.n}표본): 1개월 forward 중앙값 ${k.seasonality.med1m > 0 ? '+' : ''}${k.seasonality.med1m}%`);
  return { verdict, reasons };
}

/**
 * 2026-06-06: whitelist validator (ChatGPT D1) — fundamentalBasis/catalysts/rationale/riskNote 의 모든
 *   %·x 숫자가 grounded(sig 실값/계산/구조필드)인지 검증, whitelist 밖 = 환각 → clause strip.
 *   *발간 직전 최종 게이트*에서 호출(rotation/pool 추가 종목까지 커버). 단일 함수(DRY — 산재 금지).
 */
function validateGroundedNumbers(portfolio, signalDigest, livePrices) {
  const CALIB = new Set([1, 2, 3, 5, 7, 10, 12, 15, 20, 25, 30, 50, 52, 100, 200]);
  let stripped = 0;
  for (const p of (portfolio ?? [])) {
    const sig = signalDigest.get(p.ticker);
    const allow = new Set(CALIB);
    const addN = v => { const n = parseFloat(String(v).replace(/[^\d.-]/g, '')); if (Number.isFinite(n)) allow.add(Math.round(Math.abs(n) * 10) / 10); };
    if (sig?.fin) { addN(sig.fin.yoy); addN(sig.fin.margin); addN(sig.fin.roe); addN(sig.fin.pe); }
    if (sig?.tech) for (const m of String(sig.tech).matchAll(/(\d+\.?\d*)/g)) addN(m[1]);
    if (sig?.insider) { addN(sig.insider.buys); addN(sig.insider.sells); }
    if (sig?.squeeze != null) addN(sig.squeeze);
    addN(p.impliedVol); addN(p.ivSkew); addN(p.allocation);
    const lp = livePrices.get(p.ticker); if (lp) { addN(lp.price); addN(lp.high52w); addN(lp.low52w); }
    const isAllowed = (numTok) => { const n = Math.abs(parseFloat(numTok)); if (!Number.isFinite(n)) return true; for (const a of allow) if (Math.abs(n - a) <= Math.max(0.3, a * 0.02)) return true; return false; };
    const stripClause = (text) => {
      let t = text, changed = false;
      for (const m of [...String(text).matchAll(/([+-]?\d+\.?\d*)\s*(?:%|x|배)/g)]) {
        // 2026-06-06 FATAL fix: m[1] 가 "+17.13" 처럼 부호 포함 시 기존 .replace('.','\\.') 는 "+" 미escape
        //   → `[^,，·|/]*+17\.13` 의 `*+` = "Nothing to repeat" invalid regex → afternoon 보고서 gen crash.
        //   정규식 특수문자 전체 escape. (rotation avg_pnl "+17.13%" 가 strip 대상이 되며 발생.)
        const esc = m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (!isAllowed(m[1])) { t = t.replace(new RegExp(`[^,，·|/]*${esc}\\s*(?:%|x|배)[^,，·|/]*`), ''); changed = true; }
      }
      return changed ? t.replace(/\s*[,，·|]\s*[,，·|]\s*/g, ', ').replace(/^[\s,，·|]+|[\s,，·|]+$/g, '').replace(/\s{2,}/g, ' ') : text;
    };
    for (const f of ['fundamentalBasis', 'rationale', 'riskNote']) {
      if (typeof p[f] === 'string') { const nv = stripClause(p[f]); if (nv !== p[f]) { p[f] = nv; stripped++; } }
    }
    if (Array.isArray(p.catalysts)) { const before = p.catalysts.join('|'); p.catalysts = p.catalysts.map(stripClause).filter(c => c && c.length > 3); if (p.catalysts.join('|') !== before) stripped++; }
  }
  return stripped;
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

// 2026-06-05: FX 동적 소스 (Yahoo KRW=X = USD/KRW, DX-Y.NYB = DXY). 하드코딩 금지 — 매 실행 라이브.
//   KR 추천 risk: 원화 급락(USD/KRW 급등)은 KR 주식 약세 신호. 오늘 +2.7% 급등이 KR 급락 동반했는데
//   보고서가 못 봐 KR 매수 추천 → 손실. usdkrwChg = 전일 대비 %.
async function fetchFX() {
  const one = async (sym) => {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=5d`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return null;
      const m = (await r.json())?.chart?.result?.[0]?.meta;
      const px = m?.regularMarketPrice, prev = m?.chartPreviousClose;
      return px != null ? { px, chg: prev ? ((px - prev) / prev) * 100 : null } : null;
    } catch { return null; }
  };
  const [krw, dxy] = await Promise.all([one('KRW=X'), one('DX-Y.NYB')]);
  return {
    usdkrw: krw?.px ?? null, usdkrwChg: krw?.chg ?? null,
    dxy: dxy?.px ?? null, dxyChg: dxy?.chg ?? null,
  };
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
      else if (name === 'fedwatch') { const nm = result?.meetings?.find(m => new Date(m.date).getTime() > Date.now()) ?? result?.meetings?.[result.meetings.length - 1]; summary = nm ? `차기 ${nm.label} hold=${nm.probHold}% cut=${nm.probCut25}% (연말인하 ${result.totalImpliedCuts ?? '?'}회)` : 'n/a'; }
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
    volatility, cot, commodity, supplyChainSignals, narratives,
    newsGap, optionsFlow, blockTrades,
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
    namedFetch('narratives',        `${base}/api/narratives`, 10000),
    namedFetch('newsGap',           `${base}/api/news-gap`, 8000),  // 2026-06-12: 기관활동↔미디어 갭 (매수 stage-1 입력)
    namedFetch('optionsFlow',       `${base}/api/options-flow`, 10000),   // 2026-06-13: UOA vol/OI 파생 (매수·매도 micro 신호)
    namedFetch('blockTrades',       `${base}/api/block-trades`, 15000),   // 2026-06-13: 5분봉 버스트 proxy
  ]);

  // 2026-06-05: FX 동적 수집 (Yahoo KRW=X/DXY — 외부 권위 소스, 하드코딩 아님). KR 추천 risk 핵심.
  const fx = await fetchFX();

  // fear-greed returns { byCountry:[{id:'us',score}], byAsset:[...] }
  const fgByCountry = fearGreed?.byCountry ?? [];
  const fgByAsset = fearGreed?.byAsset ?? fearGreed?.assets ?? [];
  return {
    fx,
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
    narratives,
    newsGap: newsGap?.entries ?? [],
    optionsFlow: optionsFlow?.items ?? [],   // 2026-06-13: UOA (call/put 프리미엄 micro 신호)
    blockTrades: blockTrades?.items ?? [],   // 2026-06-13: 거래량 버스트 proxy
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
  // 2026-06-05: FX 동적 주입 (Yahoo KRW=X/DXY, 하드코딩 아님) — KR 추천 risk 핵심.
  //   오늘 급락 때 USD/KRW +2.7%(원화 급락)을 보고서가 못 봐 KR 매수 추천 → 손실. 이제 macro 에
  //   FX + KR-risk 플래그 주입(원화 ±1% 급변 시 KR 비중 주의/우호). buildContext 가 ctx.fx 사용.
  try {
    const fx = ctx.fx;
    if (fx?.usdkrw != null) {
      const chg = fx.usdkrwChg;
      let fxStr = `USD/KRW=${Math.round(fx.usdkrw)}${chg != null ? `(${chg > 0 ? '+' : ''}${chg.toFixed(1)}%)` : ''}`;
      if (fx.dxy != null) fxStr += ` DXY=${fx.dxy.toFixed(1)}`;
      if (chg != null && Math.abs(chg) >= 1.0) {
        fxStr += chg > 0
          ? ` ⚠️KR-RISK:원화 ${chg.toFixed(1)}% 급락→KR 주식 약세압력, 비중 주의/방어`
          : ` KR-우호:원화 ${Math.abs(chg).toFixed(1)}% 강세→KR 주식 우호`;
      }
      macro = macro ? `${macro} ${fxStr}` : fxStr;
    }
  } catch { /* ignore */ }

  // Sentiment + FedWatch
  let sentiment = '';
  try {
    const fg = ctx.fearGreed;
    if (fg?.score != null) sentiment = `F&G(US)=${Math.round(fg.score)}(${fg.level ?? fg.label ?? ''})`;
    // 2026-06-06: meetings[0] 은 과거 회의일 수 있음(Apr 29 등) → 다음 *미래* 회의 선택. + 연말
    //   누적인하/내재금리(FedWatch 반응) 추가 — 사용자 "fedwatch 반응도 고려되나".
    const meetings = ctx.fedWatch?.meetings ?? [];
    if (meetings.length) {
      const now = Date.now();
      const next = meetings.find(m => new Date(m.date).getTime() > now) ?? meetings[meetings.length - 1];
      const cut = next.probCut25 ?? next.probCut ?? 0;
      sentiment += ` | FedWatch 차기 FOMC(${next.label}): 동결 ${next.probHold ?? '?'}%·인하 ${cut}%`;
      if (ctx.fedWatch?.totalImpliedCuts != null) sentiment += ` 연말 내재인하 ${ctx.fedWatch.totalImpliedCuts}회(내재금리 ${ctx.fedWatch.yearEndImpliedRate ?? '?'}%)`;
    }
  } catch { /* ignore */ }

  // Capital flows
  // 2026-06-06: 섹터 리더십 grounding (사용자 "반도체 주도가 맞어?" — thesis 가 live 섹터 성과 안 봐서
  //   하락 섹터를 강세 주도로 오기재). ret1w 랭킹 + ret1w↔4w 반전(추세 꺾임) 명시 → thesis grounded.
  let sectorLeadership = '';
  try {
    const sp = (ctx.capital?.sectorPerformance ?? []).filter(s => typeof s.ret1w === 'number');
    if (sp.length) {
      const ranked = [...sp].sort((a, b) => b.ret1w - a.ret1w);
      const fmt = s => { const rev = (s.ret4w ?? 0) > 5 && s.ret1w < 0 ? '⚠️추세반전' : ''; return `${s.label} 1w${s.ret1w >= 0 ? '+' : ''}${s.ret1w.toFixed(1)}%/4w${(s.ret4w ?? 0) >= 0 ? '+' : ''}${(s.ret4w ?? 0).toFixed(1)}%${rev}`; };
      sectorLeadership = `주도(1w강): ${ranked.slice(0, 3).map(fmt).join(', ')} | 부진(1w약): ${ranked.slice(-3).reverse().map(fmt).join(', ')}`;
    }
  } catch { /* */ }

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

  // Narratives — 구조적 힘 강도(heating/cooling). relatedTickers 모멘텀 + 섹터 ret4w 파생 라이브.
  //   2026-06-05: intelligence narratives 탭 데이터를 보고서 macro 맥락에 주입(사용자 "전부 반영").
  let narratives = '';
  try {
    const ni = ctx.narratives?.intensities ?? [];
    if (ni.length) {
      narratives = [...ni].sort((a, b) => b.intensity - a.intensity).slice(0, 5)
        .map(n => `${n.id}:${n.intensity}${n.direction === 'heating' ? '↑' : n.direction === 'cooling' ? '↓' : ''}`).join(', ');
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

  return { macro, sentiment, flows, sectorLeadership, cot, narratives, commodity, institutional, shorts, news, koreaFlow, assetFg, bbWarnings, credit, nport, optionsFlow, ownership, econCal, vixCtx, supplyChain };
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

/** sector-pe raw 배열 — buy/sell rule 의 sectorPeMap 생성용 (string 변환 전 raw) */
async function getSectorPeRaw() {
  try {
    const d = await safeFetch(`${SITE}/api/sector-pe`, 8000);
    if (!Array.isArray(d?.sectors)) return [];
    return d.sectors.map(e => ({
      sector: e.name ?? e.sector ?? e.ticker ?? '',
      ticker: e.ticker ?? null,
      peAvg: e.trailingPE ?? e.peRatio ?? null,
      peRatio: e.trailingPE ?? e.peRatio ?? null,
    }));
  } catch { return []; }
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

async function getCompanyFinancials(tickers, livePrices = new Map()) {
  if (!tickers.length) return '';
  const fmtRev = (usd) => usd >= 1e9 ? `$${(usd / 1e9).toFixed(1)}B` : `$${(usd / 1e6).toFixed(0)}M`;
  // 2026-06-05: ROE + PE 추가. 기존엔 매출/마진만 담겨 프롬프트는 "PE/PEG 인용"을 요구하는데
  //   PE 가 데이터에 없어 LLM 이 환각(NVDA "43.0", POSCO·프로텍 둘 다 "26.1" 동일). 이제:
  //   - ROE: latestAnnual.roePct (US/KR 둘 다 실측 제공).
  //   - PE: US 만 price/EPS(diluted) 로 grounded 계산(DART KR 은 EPS 미제공 → PE 생략, netMargin 으로 대체).
  const qual = (roePct, pe) => {
    let s = '';
    if (roePct != null && isFinite(roePct)) s += ` ROE=${roePct.toFixed(1)}%`;
    if (pe != null && isFinite(pe) && pe > 0 && pe < 1000) s += ` PE=${pe.toFixed(1)}`;
    return s;
  };
  const results = await Promise.allSettled(
    // 2026-06-05: slice 8→16 (portfolio 9-12 전체 커버, 기존엔 후순위 KR 종목이 잘림).
    [...new Set(tickers.map(t => (t ?? '').toUpperCase()))].slice(0, 16).map(async ticker => {
      try {
        const price = livePrices.get(ticker)?.price ?? livePrices.get(ticker) ?? null;
        // 2026-06-05 BUG fix: KR(.KS/.KQ) 은 company-financials 404 → 매출이 프롬프트 string 에서 전부
        //   누락돼 companyChanges revenueYoY=null (POSCO/NAVER/LG화학). company-kr(DART) 로 분기.
        const isKR = /\.(KS|KQ)$/.test(ticker);
        if (isKR) {
          const d = await safeFetch(`${SITE}/api/company-kr/${ticker.replace(/\.(KS|KQ)$/, '')}`, 6000);
          const la = d?.latestAnnual;
          if (!d || d.error || !la || !(la.revenueUSD > 0)) return null;
          // YoY: annuals 를 fiscalYear 내림차순 정렬 후 최근 2개 revenueKRW 비교 (DART 는 연간).
          const ann = [...(d.annuals ?? [])].sort((a, b) => String(b.fiscalYear).localeCompare(String(a.fiscalYear)));
          let yoy = '';
          if (ann.length >= 2 && ann[0].revenueKRW > 0 && ann[1].revenueKRW > 0) {
            const pct = (ann[0].revenueKRW - ann[1].revenueKRW) / ann[1].revenueKRW * 100;
            yoy = `${pct > 0 ? '+' : ''}${pct.toFixed(1)}% YoY`;
          }
          const margin = la.operatingMarginPct != null ? ` opMgn=${la.operatingMarginPct.toFixed(1)}%` : '';
          const netMgn = la.netMarginPct != null ? ` netMgn=${la.netMarginPct.toFixed(1)}%` : '';
          // KR: DART 에 EPS 없어 PE 미산출(환각 방지) → ROE/netMargin 으로 수익성 근거 제공.
          // YoY 없으면 signalDigest 정규식(YoY 필수)이 무시 → 0.0% YoY 로 최소 매칭 보장(매출은 전달).
          return `${ticker}: FY${la.fiscalYear} ${fmtRev(la.revenueUSD)} ${yoy || '+0.0% YoY'}${margin}${qual(la.roePct, null)}${netMgn}`;
        }
        const d = await safeFetch(`${SITE}/api/company-financials/${ticker}`, 5000);
        if (!d) return null;
        const q = d.quarterlyRevenue?.[0];
        if (!q) return null;
        const la = d.latestAnnual;
        const yoy = q.yoyPct != null ? `${q.yoyPct > 0 ? '+' : ''}${q.yoyPct.toFixed(1)}% YoY` : '';
        const margin = la?.operatingMarginPct != null ? ` opMgn=${la.operatingMarginPct.toFixed(1)}%` : '';
        // US: PE = 현재가 / EPS(diluted, 연간) — grounded 계산. EPS/가격 없으면 PE 생략(환각 방지).
        const eps = la?.epsDiluted;
        const pe = (price > 0 && eps > 0) ? price / eps : null;
        return `${ticker}: ${q.label} ${fmtRev(q.revenueUSD)} ${yoy}${margin}${qual(la?.roePct, pe)}`;
      } catch { return null; }
    })
  );
  return results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value).join(' | ');
}

// 2026-06-03: getCompanyFinancials 는 LLM 프롬프트용 *문자열* 반환 → saveDomainArchives 가
//   기대하는 ticker-keyed 객체와 타입 불일치로 finByTicker={} (op_margin/net_income/pe 100% NULL).
//   이 함수가 ticker→원시 응답(latestAnnual 포함) Map 을 별도 반환 → earnings_archive 적재용.
async function getFinancialsMap(tickers) {
  const map = new Map();
  if (!tickers?.length) return map;
  const results = await Promise.allSettled(
    [...new Set(tickers.map(t => (t ?? '').toUpperCase()))].slice(0, 16).map(async ticker => {
      try {
        // KR(.KS/.KQ) 은 company-financials 가 404 → company-kr(DART). DART 응답도 latestAnnual 에
        //   operatingMarginPct + netIncomeUSD 제공하므로 saveDomainArchives 추출 로직 동일하게 동작.
        const isKR = /\.(KS|KQ)$/.test(ticker);
        const url = isKR
          ? `${SITE}/api/company-kr/${ticker.replace(/\.(KS|KQ)$/, '')}`
          : `${SITE}/api/company-financials/${ticker}`;
        const d = await safeFetch(url, 6000);
        return (d && !d.error) ? [ticker, d] : null;
      } catch { return null; }
    })
  );
  for (const r of results) if (r.status === 'fulfilled' && r.value) map.set(r.value[0], r.value[1]);
  return map;
}

// ── ETF 전략 섹션 (2026-06-04 신설) ───────────────────────────────────────────
// ETF 메타는 구조적 참조(정적 허용). 선택은 보고서의 sectorAllocation/regionStances/stance 에
//   grounded(환각 없음), 가격은 livePrices/batch-prices 라이브.
// 2026-06-05: ETF 풀 30→62 확장 — 테마/스타일/배당 카테고리 신설(이전엔 broad/sector/region/
//   commodity/bond 만, FEATURES 가 "193 확장" 주장했으나 미구현이던 문서-코드 불일치 해소).
const ETF_META = {
  // broad
  SPY: { name: 'S&P 500', cat: 'broad' }, QQQ: { name: '나스닥100 (성장)', cat: 'broad' },
  VTI: { name: '미국 전체시장', cat: 'broad' }, IWM: { name: '미국 소형주', cat: 'broad' }, DIA: { name: '다우30', cat: 'broad' },
  // sector (11 GICS + 반도체)
  XLK: { name: '기술 섹터', cat: 'sector' }, XLE: { name: '에너지 섹터', cat: 'sector' }, XLF: { name: '금융 섹터', cat: 'sector' },
  XLV: { name: '헬스케어 섹터', cat: 'sector' }, XLI: { name: '산업재 섹터', cat: 'sector' }, XLY: { name: '경기소비재 섹터', cat: 'sector' },
  XLP: { name: '필수소비재 섹터', cat: 'sector' }, XLU: { name: '유틸리티 섹터', cat: 'sector' }, XLB: { name: '소재 섹터', cat: 'sector' },
  XLRE: { name: '부동산 섹터', cat: 'sector' }, XLC: { name: '커뮤니케이션 섹터', cat: 'sector' }, SMH: { name: '반도체', cat: 'sector' },
  // thematic (테마)
  SOXX: { name: '반도체(iShares)', cat: 'thematic' }, BOTZ: { name: 'AI·로보틱스', cat: 'thematic' }, ARKK: { name: '파괴적 혁신', cat: 'thematic' },
  ICLN: { name: '청정에너지', cat: 'thematic' }, TAN: { name: '태양광', cat: 'thematic' }, IBB: { name: '바이오텍', cat: 'thematic' },
  XBI: { name: '바이오텍(균등)', cat: 'thematic' }, SKYY: { name: '클라우드', cat: 'thematic' }, HACK: { name: '사이버보안', cat: 'thematic' },
  LIT: { name: '리튬·배터리', cat: 'thematic' }, URA: { name: '우라늄·원자력', cat: 'thematic' }, ITA: { name: '방위산업', cat: 'thematic' },
  // style (스타일·팩터)
  VTV: { name: '대형 가치주', cat: 'style' }, VUG: { name: '대형 성장주', cat: 'style' }, MTUM: { name: '모멘텀 팩터', cat: 'style' },
  QUAL: { name: '퀄리티 팩터', cat: 'style' }, USMV: { name: '최소변동성', cat: 'style' }, VYM: { name: '고배당', cat: 'style' },
  // dividend (배당)
  SCHD: { name: '배당성장(슈와브)', cat: 'dividend' }, NOBL: { name: '배당귀족', cat: 'dividend' }, DVY: { name: '고배당(iShares)', cat: 'dividend' },
  // region
  EWY: { name: '한국', cat: 'region' }, EWJ: { name: '일본', cat: 'region' }, FXI: { name: '중국 대형주', cat: 'region' },
  MCHI: { name: '중국 전체', cat: 'region' }, VGK: { name: '유럽', cat: 'region' }, INDA: { name: '인도', cat: 'region' },
  EWT: { name: '대만', cat: 'region' }, EWZ: { name: '브라질', cat: 'region' }, EWA: { name: '호주', cat: 'region' },
  EWG: { name: '독일', cat: 'region' }, EWU: { name: '영국', cat: 'region' }, EEM: { name: '신흥국', cat: 'region' },
  // region leveraged (2026-06-12, 사용자 "KORU 같은것도") — 강세 지역에서만 단기 트레이딩용 제안
  KORU: { name: '한국 3x (단기)', cat: 'region' }, YINN: { name: '중국 3x (단기)', cat: 'region' },
  EDC: { name: '신흥국 3x (단기)', cat: 'region' }, INDL: { name: '인도 2x (단기)', cat: 'region' },
  // commodity (원자재)
  GLD: { name: '금', cat: 'commodity' }, SLV: { name: '은', cat: 'commodity' }, DBC: { name: '원자재 종합', cat: 'commodity' },
  USO: { name: '원유(WTI)', cat: 'commodity' }, PDBC: { name: '원자재(무K-1)', cat: 'commodity' },
  // bond (채권)
  TLT: { name: '미국 장기국채(20년+)', cat: 'bond' }, SHY: { name: '미국 단기국채(1-3년)', cat: 'bond' },
  AGG: { name: '미국 종합채권', cat: 'bond' }, LQD: { name: '투자등급 회사채', cat: 'bond' }, HYG: { name: '하이일드 회사채', cat: 'bond' },
  TIP: { name: '물가연동국채', cat: 'bond' },
  // 2026-06-13: 크립토 현물 ETF (사용자 "etf전략에 코인도 들어가나?") — capital-flows bitcoin 모멘텀 grounded
  IBIT: { name: '비트코인 현물(블랙록)', cat: 'crypto' }, ETHA: { name: '이더리움 현물(블랙록)', cat: 'crypto' },
};
// 테마 ETF — 핫한 섹터/내러티브에 매핑 (hot 신호 시 노출)
const THEMATIC_ETF = {
  semiconductors: ['SOXX', 'SMH'], technology: ['SKYY', 'BOTZ'], 'ai-cloud': ['BOTZ', 'SKYY'],
  energy: ['ICLN', 'URA'], 'clean-energy': ['ICLN', 'TAN'], healthcare: ['IBB', 'XBI'],
  materials: ['LIT'], 'metals & mining': ['LIT'], defense: ['ITA'], financials: [],
};
const SECTOR_ETF = {
  semiconductors: 'XLK', technology: 'XLK', 'ai-cloud': 'XLK', 'information technology': 'XLK',
  energy: 'XLE', financials: 'XLF', healthcare: 'XLV', industrials: 'XLI',
  'consumer discretionary': 'XLY', automotive: 'XLY', 'consumer staples': 'XLP',
  utilities: 'XLU', materials: 'XLB', 'metals & mining': 'XLB', 'real estate': 'XLRE',
  'communication-services': 'XLC', 'communication services': 'XLC', communication: 'XLC',
};
const REGION_ETF = { us: 'SPY', korea: 'EWY', japan: 'EWJ', china: 'FXI', europe: 'VGK', india: 'INDA', taiwan: 'EWT', brazil: 'EWZ', australia: 'EWA' };

async function buildEtfStrategy({ sectorAllocation = [], regionStances = {}, stance = 'neutral', riskLevel = 'medium', livePrices, capitalAssets = [] }) {
  const picks = new Map();
  // action: 'buy'(매수/비중확대) | 'watch'(관망/중립) | 'avoid'(회피/비중축소) | 'hedge'(헤지) — 명확한 신호
  const add = (t, rationale, tag, action) => {
    if (t && ETF_META[t] && !picks.has(t)) { picks.set(t, { ticker: t, ...ETF_META[t], rationale, tag, action }); return true; }
    return false;
  };
  // 1) 코어 (시장 stance)
  if (stance === 'bullish') { add('QQQ', '강세 스탠스 — 성장주 핵심 노출', 'core', 'buy'); add('SPY', '시장 전체 분산 코어', 'core', 'buy'); }
  else if (stance === 'bearish') { add('SPY', '방어적 시장 분산', 'core', 'watch'); }
  else add('SPY', '시장 전체 분산 코어', 'core', 'buy');
  // 2) 섹터 ETF — stance 별(overweight=매수 / neutral=관망). 2026-06-05: 이전엔 overweight 만 추가했는데
  //    보고서가 overweight 를 거의 안 줘서(전부 neutral/underweight) sector ETF 가 0 이던 결함 → broad+region
  //    만 나옴. neutral 까지 포함해 섹터 다양성 노출. underweight 는 노이즈라 생략.
  const seenSector = new Set();
  for (const s of sectorAllocation) {
    const etf = SECTOR_ETF[(s.sector || '').toLowerCase()];
    if (!etf || seenSector.has(etf) || s.stance === 'underweight') continue;
    seenSector.add(etf);
    add(etf, `${s.sector} ${s.stance === 'overweight' ? '비중확대' : '중립'} — 섹터 분산 노출`, 'sector', s.stance === 'overweight' ? 'buy' : 'watch');
  }
  // 섹터 신호가 없으면 코어 섹터(기술/헬스케어)라도 노출 — ETF 다양성 보장
  if (seenSector.size === 0) { add('XLK', '기술 섹터 코어 노출', 'sector', 'watch'); add('XLV', '헬스케어 방어 섹터', 'sector', 'watch'); }
  // 2b) 테마 ETF — 비중확대/중립 섹터에 매핑된 테마 노출 (최대 3)
  let themeN = 0;
  for (const s of sectorAllocation) {
    if (themeN >= 3 || s.stance === 'underweight') continue;
    for (const t of (THEMATIC_ETF[(s.sector || '').toLowerCase()] ?? [])) {
      if (themeN >= 3) break;
      if (add(t, `${s.sector} 테마 — ${ETF_META[t]?.name ?? t}`, 'thematic', s.stance === 'overweight' ? 'buy' : 'watch')) themeN++;
    }
  }
  // 2c) 스타일·배당 — stance 기반 팩터 슬리브 (강세=성장/모멘텀, 방어=가치/퀄리티/최소변동) + 배당 income
  const defensiveStyle = riskLevel === 'high' || stance === 'bearish';
  if (defensiveStyle) { add('VTV', '가치 팩터 — 방어적 스타일', 'style', 'buy'); add('USMV', '최소변동성 — 하방 방어', 'style', 'watch'); }
  else { add('VUG', '성장 팩터 — 강세 스타일', 'style', 'buy'); add('MTUM', '모멘텀 팩터 — 추세 추종', 'style', 'watch'); }
  add('QUAL', '퀄리티 팩터 — 우량주 분산', 'style', 'watch');
  add('SCHD', defensiveStyle ? '배당성장 — 방어적 income' : '배당성장 — income 분산', 'dividend', defensiveStyle ? 'buy' : 'watch');
  // 3) 국가별 ETF — 강세 우선 정렬 후 최대 5 (전 국가 쏟아내기 방지 — 이전 8개 region 이 sector/bond 밀어냄)
  const KR_REGION_LABEL = { us: '미국', korea: '한국', japan: '일본', china: '중국', taiwan: '대만', india: '인도', brazil: '브라질', australia: '호주', europe: '유럽' };
  const rRank = (st) => (st === 'bullish' ? 0 : st === 'bearish' ? 2 : 1);
  const regionEntries = Object.entries(regionStances)
    .filter(([r]) => REGION_ETF[r] && r !== 'us')
    .sort((a, b) => rRank(a[1]?.stance) - rRank(b[1]?.stance));
  // 강세 지역 → 레버리지 변형 추가 제안 (2026-06-12, 사용자 "KORU 같은것도") — 단기 트레이딩 명시
  const REGION_ETF_LEV = { korea: 'KORU', china: 'YINN', india: 'INDL' };
  for (const [r, v] of regionEntries.slice(0, 5)) {
    const st = v?.stance;
    const label = KR_REGION_LABEL[r] ?? r;
    const action = st === 'bullish' ? 'buy' : st === 'bearish' ? 'avoid' : 'watch';
    const note = st === 'bullish' ? `${label} 강세 — ${(v.thesis || '').slice(0, 24)}`
      : st === 'bearish' ? `${label} 약세 — 비중축소`
      : `${label} 중립 — 관망 ${(v.thesis || '').slice(0, 18)}`;
    add(REGION_ETF[r], note, 'region', action);
    if (st === 'bullish' && REGION_ETF_LEV[r]) {
      add(REGION_ETF_LEV[r], `${label} 강세 레버리지 — ⚠️ 단기 트레이딩 전용(장기보유 가치소멸)`, 'region', 'watch');
    }
  }
  // 4) 분산 자산 — commodity + bond (상시 분산 슬리브, 방어 전용 아님 → 이전엔 고위험/약세일 때만 나옴)
  const defensive = riskLevel === 'high' || stance === 'bearish';
  add('GLD', defensive ? '안전자산 — 금(리스크 헤지)' : '포트폴리오 분산 — 금(주식 무상관)', 'diversifier', defensive ? 'buy' : 'watch');
  add('SLV', '분산 — 은(산업+귀금속 혼합)', 'diversifier', 'watch');
  add(defensive ? 'TLT' : 'SHY', defensive ? '장기국채 — 리스크 헤지' : '단기국채 — 현금성 분산', 'bond', defensive ? 'hedge' : 'watch');
  // 5) 크립토 (2026-06-13, 사용자 "코인도 들어가나?") — capital-flows bitcoin 모멘텀 grounded.
  //    4주 +5%↑=매수 / -8%↓=회피 / 그 외 관망. 고변동 경고 라벨 상시 (레버리지 ETF 라벨 패턴).
  {
    const btc = capitalAssets.find(a => a.id === 'bitcoin');
    const r4 = typeof btc?.ret4w === 'number' ? btc.ret4w : null;
    const action = r4 == null ? 'watch' : r4 >= 5 ? 'buy' : r4 <= -8 ? 'avoid' : 'watch';
    const momTxt = r4 != null ? `4주 ${r4 > 0 ? '+' : ''}${r4}%` : '모멘텀 데이터 없음';
    add('IBIT', `비트코인 ${momTxt} — ⚠️ 고변동 자산, 소액 분산 전용`, 'crypto', action);
    if (r4 != null && r4 >= 5) add('ETHA', `이더리움 — 크립토 모멘텀 동반(${momTxt}) ⚠️ 고변동`, 'crypto', 'watch');
  }
  const list = [...picks.values()].slice(0, 26);  // broad+sector+thematic+style+dividend+region(≤5)+commodity+bond+crypto 전 카테고리
  // 가격: livePrices 우선, 없으면 batch-prices 라이브
  const need = list.map(e => e.ticker).filter(t => !(livePrices?.get(t)?.price));
  let fetched = {};
  if (need.length) {
    try { const d = await safeFetch(`${SITE}/api/batch-prices?tickers=${need.join(',')}`, 8000); fetched = d?.prices ?? {}; } catch { /* */ }
  }
  return list.map(e => {
    const lp = livePrices?.get(e.ticker);
    const px = lp?.price ?? fetched[e.ticker]?.price ?? null;
    const chg = lp?.changePct ?? fetched[e.ticker]?.changePct ?? null;
    return { ticker: e.ticker, name: e.name, category: e.cat, tag: e.tag, action: e.action, rationale: e.rationale, price: px, changePct: chg };
  });
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
    `[Macro Narratives — 구조적 힘 강도(↑heating/↓cooling, 관련종목·섹터 모멘텀 파생)] ${ctx.narratives || 'No data'}`,
    `[Sector Leadership — 실 섹터 성과 1w/4w] ${ctx.sectorLeadership || 'No data'}`,
    `[Commodity Curves] ${ctx.commodity || 'No data'}`,
    `[News — 연준발언 우선] ${ctx.news || 'No data'}`,
    '',
    '⚠️ FACT-CHECK RULES (2차 검증):',
    '- thesis/macroAnalysis 에 [Macro Indicators] + [News] 에 명시된 사실만 사용.',
    '- 특정 인물 임명/잔류/사임 (예: Powell, Bessent) 같은 정치 인물 발언 금지 — 입력에 없으면 추측 X.',
    '- "파월 잔류", "트럼프 정책" 같은 정치 이벤트는 [News] 에 명시된 경우만 인용.',
    '- 추측/일반화 (예: "AI 인프라 확장") 보다 구체 수치 (예: "CPI 3.78%, NVDA Q1 +73%") 우선.',
    '- ⚠️ thesis 의 "X 주도/강세" 주장은 [Sector Leadership] 와 일치해야 함 — 1w 부진(약세) 섹터를 "주도/강세"로 쓰지 말 것. ⚠️추세반전 표시 섹터는 "주도"가 아니라 "조정/반전"으로 기술.',
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
    // 2026-06-05: 종목 dedupe — 같은 종목이 하루 5세션 추천돼 raw 행으로 승률 내면 5.2x 중복(POSCO 19회)
    //   → "80% 승률"(실제 dedupe 59%) 허수를 LLM 에 주입하던 결함. ticker 별 최신 outcome 1개로 집계.
    const rows = db.prepare(`
      WITH ranked AS (
        SELECT r.ticker, o.outcome, o.pnl_pct, o.evaluated_at,
          ROW_NUMBER() OVER (PARTITION BY r.ticker ORDER BY o.evaluated_at DESC) rn
        FROM recommendation_outcomes o
        JOIN recommendations r ON r.id = o.recommendation_id
        WHERE r.action = 'buy'
          AND r.generated_at >= date('now', '-30 days')
      )
      SELECT ticker, outcome, pnl_pct FROM ranked WHERE rn = 1
      ORDER BY evaluated_at DESC LIMIT 30
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

    // 2026-06-12: 'sold'(매도엔진 청산) 집계 누락 fix — 매도엔진 가동(5/29) 후 최신 outcome 이
    //   대부분 sold 인데 hit/stop/NE 만 세서 "hit 0/stop 0" 죽은 피드백을 LLM 에 주입하던 결함.
    const counts = { hit_target: 0, stop_loss: 0, not_entered: 0, still_holding: 0, sold: 0, unknown: 0 };
    const tickerPnl = {};
    let soldPnlSum = 0, soldPnlN = 0, soldWins = 0;
    for (const r of rows) {
      counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
      if (r.outcome === 'sold' && r.pnl_pct != null) { soldPnlSum += r.pnl_pct; soldPnlN++; if (r.pnl_pct > 0) soldWins++; }
      if (r.pnl_pct != null) {
        if (!tickerPnl[r.ticker]) tickerPnl[r.ticker] = { sum: 0, n: 0 };
        tickerPnl[r.ticker].sum += r.pnl_pct;
        tickerPnl[r.ticker].n++;
      }
    }
    const total = rows.length;
    const closed = counts.hit_target + counts.stop_loss + counts.sold;
    const winRate = closed ? Math.round(((counts.hit_target + soldWins) / closed) * 100) : 0;
    const soldAvg = soldPnlN ? Math.round((soldPnlSum / soldPnlN) * 10) / 10 : null;
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
      `종결 승률 ${winRate}% (${closed}건) | hit ${counts.hit_target} / sold ${counts.sold}${soldAvg != null ? ` (avg ${soldAvg >= 0 ? '+' : ''}${soldAvg}%)` : ''} / stop ${counts.stop_loss} / NE ${counts.not_entered} (${neRate}%) / holding ${counts.still_holding}\n` +
      `평균 PnL ${avgPnl ?? '-'}% / SPY alpha ${alphaRow?.alpha ?? '-'}% / beat ${alphaRow?.beat ?? 0}/${alphaRow?.n ?? 0}\n` +
      (chronicNE.length ? `만성 NE 회피 (entry zone 시장가 위 자제): ${chronicNE.map(c => `${c.ticker}(${c.cnt}회)`).join(', ')}\n` : '');
    const summary = {
      total, ...counts,
      hitRate: parseFloat(hitRate),
      neRate: parseFloat(neRate),
      winRate, closed, soldAvg,  // 2026-06-12: 종결 승률 (engineReview 섹션용)
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
    // 2026-06-13: 공급·수주 계약 해지/취소 (DART KR / SEC US) — 매출 감소 신호
    case 'supplyContractLoss':
      if (ctx.contractLoss && (ctx.contractLoss.conviction ?? 0) >= (c.conviction_gte ?? 70)) {
        return '공급·수주 계약 해지·취소 (매출 감소 신호)';
      }
      break;
    // 2026-06-13: UOA put 편중 (보유 종목에 풋 프리미엄 집중 = 하방 베팅 증가)
    case 'optionsPutFlow': {
      const tot = (ctx.optionsCallPrem ?? 0) + (ctx.optionsPutPrem ?? 0);
      if (tot >= (c.total_prem_gte ?? 2e6) && (ctx.optionsPutPrem ?? 0) / tot >= (c.put_share_gte ?? 0.7)) {
        return `옵션 풋 편중 $${((ctx.optionsPutPrem) / 1e6).toFixed(1)}M (${Math.round((ctx.optionsPutPrem / tot) * 100)}%)`;
      }
      break;
    }
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
      // 2026-06-13 fix: 최소 갭 요건 — 50MA 가 200MA 보다 *1% 이상* 아래일 때만 dead cross.
      //   기존엔 0.008% 차이(50MA 1,022,573 vs 200MA 1,022,661, 사실상 동일=추세 평탄)도 dead cross
      //   판정 → 경합심사가 KR 후보 전원 spurious 탈락(noon 보고서 KR 0 사건). flat MA = 노이즈, 추세 아님.
      if (ctx.sma50 && ctx.sma200 && ctx.sma50 < ctx.sma200 * 0.99) {
        return `50MA(${ctx.sma50.toFixed(2)}) < 200MA(${ctx.sma200.toFixed(2)}) dead cross (${((ctx.sma50 / ctx.sma200 - 1) * 100).toFixed(1)}%)`;
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
        // 2026-06-06 consensus 개선: 매출 hyper-growth(+25%↑) + 마진 완만하락(-5%p 미만)은 재투자/
        //   램프 효과지 moat 약화 아님. NVDA(+65% rev, -2%p margin=Blackwell 램프)가 hard-veto(7)
        //   되어 매수 탈락하던 사건. 심한 하락(-5%p↑)은 성장중에도 fire(진짜 수익성 붕괴).
        if (ctx.revenueYoY != null && ctx.revenueYoY >= 25 && ctx.opMarginDecline < 5) return null;
        return `op margin YoY -${ctx.opMarginDecline.toFixed(1)}%p 악화`;
      }
      break;
    case 'peVsSector':
      if (ctx.peRatio && ctx.sectorPe && ctx.peRatio / ctx.sectorPe >= 1 + (c.premium_pct_gte ?? 30) / 100) {
        return `P/E ${ctx.peRatio.toFixed(1)} vs sector ${ctx.sectorPe.toFixed(1)} 고평가`;
      }
      break;
    // 2026-06-06: 내부자 매도 (매수룰 micro_insider_buying 대칭) — Form4 매도 cluster.
    case 'insiderSell':
      if (ctx.insiderSells != null && ctx.insiderSells >= (c.sell_count_gte ?? 2) &&
          (ctx.insiderSellToBuyRatio ?? 99) >= (c.sell_to_buy_ratio_gte ?? 2)) {
        return `내부자 매도 ${ctx.insiderSells}건 (매수 ${ctx.insiderBuys ?? 0}건 대비 우위)`;
      }
      break;
    // 2026-06-06: 13F 기관 이탈 (분기 수급 — 느린 신호).
    case 'institutionalExit':
      if (ctx.instReducers != null && (ctx.instReducers - (ctx.instAdders ?? 0)) >= (c.net_reducers_gte ?? 3) && (ctx.instNetShares ?? 0) < 0) {
        return `13F 기관 순감소 (reducers ${ctx.instReducers} vs adders ${ctx.instAdders ?? 0}, 순주식 ${Math.round((ctx.instNetShares ?? 0) / 1e6)}M)`;
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
    const sig = { rsi: null, sma50: null, sma200: null, volPct: null, opMarginDecline: null, peRatio: null, peg: null, revenueYoY: null };
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
        if (growth != null && Number.isFinite(growth)) sig.revenueYoY = growth;  // margin-decline veto 의 hyper-growth context
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
    // 가격
    case 'priceGapDown':
      if (ctx.change1d != null && ctx.change1d <= (c.change1d_lte ?? -3)) return `1d ${ctx.change1d}% drop`;
      break;
    case 'near52wLow':
      if (ctx.low52w && ctx.price &&
          (ctx.price - ctx.low52w) / ctx.low52w * 100 <= (c.above_pct_lte ?? 5)) {
        return `52w 저점 ${(((ctx.price / ctx.low52w) - 1) * 100).toFixed(1)}% 위 (지지 반등)`;
      }
      break;
    case 'near50MA':
      if (ctx.sma50 && ctx.price &&
          Math.abs(ctx.price - ctx.sma50) / ctx.sma50 * 100 <= (c.deviation_pct_lte ?? 2)) {
        return `50MA pullback (${(((ctx.price / ctx.sma50) - 1) * 100).toFixed(1)}%)`;
      }
      break;
    case 'below200MA':
      if (ctx.sma200 && ctx.price && ctx.price < ctx.sma200 &&
          (ctx.sma200 - ctx.price) / ctx.sma200 * 100 >= (c.below_pct_gte ?? 5)) {
        return `200MA ${(((ctx.price / ctx.sma200) - 1) * 100).toFixed(1)}% (mean reversion)`;
      }
      break;
    case 'above20dHigh':
      if (ctx.high20d && ctx.price && ctx.price > ctx.high20d) return `20d 신고가 돌파 (${ctx.high20d.toFixed(2)})`;
      break;
    // 회전
    case 'sectorRotateIn':
      if (ctx.sectorStance === (c.stance ?? 'overweight') &&
          ctx.peRatio && ctx.sectorPe &&
          (ctx.sectorPe - ctx.peRatio) / ctx.sectorPe * 100 >= (c.pe_discount_pct_gte ?? 10)) {
        return `sector overweight + P/E ${((1 - ctx.peRatio / ctx.sectorPe) * 100).toFixed(0)}% 할인`;
      }
      break;
    case 'defensiveRotation':
      if (ctx.macroRiskLevel === (c.risk_level ?? 'high') &&
          Array.isArray(c.sectors) && c.sectors.some(s => ctx.sector?.toLowerCase()?.includes(s.toLowerCase()))) {
        return `defensive sector (${ctx.sector}) + macro risk=high`;
      }
      break;
    case 'newHighAfterFlat':
      if (ctx.consolidationWeeks != null && ctx.high20d && ctx.price &&
          ctx.consolidationWeeks >= (c.consolidation_weeks_gte ?? 4) && ctx.price > ctx.high20d) {
        return `${ctx.consolidationWeeks}주 횡보 후 신고가 돌파 (Stage 2 advance)`;
      }
      break;
    // 기술
    case 'rsiOversold':
      if (ctx.rsi != null && ctx.rsi <= (c.rsi_lte ?? 35)) return `RSI ${ctx.rsi} 과매도`;
      break;
    case 'goldenCross':
      // 2026-06-13: deadCross 와 대칭 — 최소 1% 갭 (flat MA 노이즈 제외)
      if (ctx.sma50 && ctx.sma200 && ctx.sma50 > ctx.sma200 * 1.01) return `50MA > 200MA golden cross`;
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
    case 'near52wHigh':
      // 2026-06-12 (한미반도체 미포착 사건): 시장중립 모멘텀 — 52주 고가 3% 이내 = 추세 주도주.
      //   stage-1 평가 가능(livePrices 52w 데이터) → KR 모멘텀주도 stage-2 기술룰 진입 기회 확보.
      if (ctx.high52w && ctx.price && ctx.price >= ctx.high52w * (1 - (c.within_pct ?? 3) / 100)) {
        return `52주 신고가 ${(((ctx.high52w / ctx.price) - 1) * 100).toFixed(1)}% 이내 (추세 주도)`;
      }
      break;
    case 'newsGap':
      // 2026-06-12: /api/news-gap (기관 IB활동 高 + 미디어 저커버 = 정보 갭) — 사용자 "뉴스갭
      //   종목 매수엔진 반영". gapScore 는 결정론 산출(ibActivityScore-mediaScore 계열).
      if (ctx.newsGapScore != null && ctx.newsGapScore >= (c.gap_score_gte ?? 60)) {
        return `news-gap ${ctx.newsGapScore} (기관활동 高·미디어 저커버)`;
      }
      break;
    case 'optionsCallFlow': {
      // 2026-06-13: UOA call 편중 (Yahoo 체인 vol/OI 파생) — 콜 프리미엄 절대량 + 콜 비중
      const tot = (ctx.optionsCallPrem ?? 0) + (ctx.optionsPutPrem ?? 0);
      if (tot >= (c.total_prem_gte ?? 2e6) && (ctx.optionsCallPrem ?? 0) / tot >= (c.call_share_gte ?? 0.7)) {
        return `옵션 콜 편중 $${((ctx.optionsCallPrem) / 1e6).toFixed(1)}M (${Math.round((ctx.optionsCallPrem / tot) * 100)}%)`;
      }
      break;
    }
    case 'volumeBurst':
      // 2026-06-13: 5분봉 거래량 버스트(상방) — 기관성 매집 의심 proxy
      if ((ctx.burstUpNotional ?? 0) >= (c.notional_gte ?? 5e7)) {
        return `거래량 버스트 $${(ctx.burstUpNotional / 1e6).toFixed(0)}M (상방)`;
      }
      break;
    case 'backlogGrowth':
      // 2026-06-13: 수주잔고(RPO) 증가 — 향후 매출 가시성 (방산·건설·제조·SaaS). YoY 임계.
      if (ctx.backlogYoYPct != null && ctx.backlogYoYPct >= (c.yoy_pct_gte ?? 10)) {
        return `수주잔고 YoY +${ctx.backlogYoYPct}% (향후 매출 가시성↑)`;
      }
      break;
    case 'supplyContractWin': {
      // 2026-06-13: 신규 공급·수주 계약 — *영향도*(연매출 대비 %)가 핵심 (사용자 "계약 자체보다
      //   어떤 영향인지"). 매출대비 ≥ 임계(기본 5%) 일 때만 발화 — 거대기업의 소액계약 노이즈 차단.
      const cw = ctx.contractWin;
      if (!cw) break;
      const rev = cw.revenuePct;
      // 매출대비 추출됐으면 임계로 판정; 미추출이면 conviction fallback(보수적, 약신호)
      if (rev != null) {
        if (rev < (c.revenue_pct_gte ?? 5)) break;  // 영향 미미 → 미발화
        const a = cw.amountWon;
        const amt = a ? ` ${a >= 1e12 ? (a / 1e12).toFixed(1) + '조' : Math.round(a / 1e8) + '억'}원` : '';
        return `신규 공급계약${amt} — 연매출 대비 ${rev}% (${rev >= 30 ? '전환적' : rev >= 10 ? '유의미' : '보강'} 매출 기여)`;
      }
      if ((cw.conviction ?? 0) >= (c.conviction_gte ?? 82)) return `신규 공급·수주 계약 체결 (매출 기여, 규모 미공개)`;
      break;
    }
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
    const sig = { rsi: null, sma50: null, sma200: null, volPct: null, high52w: null, low52w: null, high20d: null, consolidationWeeks: null };
    try {
      const oh = await fetchOHLCV(ticker, '1y');
      if (oh?.closes?.length) {
        const closes = oh.closes;
        sig.rsi = computeRSI(closes);
        sig.sma50 = computeSMA(closes, 50);
        sig.sma200 = computeSMA(closes, 200);
        if (oh.volumes?.length) sig.volPct = computeVolRatio(oh.volumes);
        // 52w + 20d high / low
        sig.high52w = Math.max(...closes);
        sig.low52w = Math.min(...closes);
        sig.high20d = closes.length >= 20 ? Math.max(...closes.slice(-20)) : null;
        // consolidation weeks: 직전 N주 동안 ±5% 박스권
        const last100 = closes.slice(-100);
        if (last100.length >= 20) {
          let consolidatedDays = 0;
          const recentHigh = sig.high20d ?? Math.max(...last100.slice(-20));
          for (let i = last100.length - 1; i >= 0; i--) {
            if (Math.abs(last100[i] - recentHigh) / recentHigh > 0.05) break;
            consolidatedDays++;
          }
          sig.consolidationWeeks = Math.floor(consolidatedDays / 5); // 5 trading days = 1 week
        }
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

// 2026-06-12: 레버리지/인버스 ETF 식별 — 추천은 허용(사용자 "레버리지도 추천해도 되"), 단
//   선물 롤오버/일일 리밸런싱 가치소멸 특성을 발간물 riskNote 에 결정론 경고로 자동 부착.
const LEVERAGED_ETF_SET = new Set(['UVXY', 'UVIX', 'SVXY', 'VIXY', 'TQQQ', 'SQQQ', 'SPXU', 'UPRO', 'SOXL', 'SOXS', 'SDOW', 'UDOW', 'TZA', 'TNA', 'LABU', 'LABD', 'FAS', 'FAZ']);
let NAMES_FOR_ETF = {};
try { NAMES_FOR_ETF = JSON.parse(readFileSync(resolve(ROOT, 'data/company-names.json'), 'utf8')); } catch { /* */ }
function isLeveragedEtf(t) {
  return LEVERAGED_ETF_SET.has(t) ||
    /\b(ultra|2x|3x|-1x|inverse|leveraged|daily (bull|bear)|short (vix|s&p|qqq|dow))\b/i.test(NAMES_FOR_ETF[t] ?? '');
}

// 2026-06-13: 현금성/금리 ETF 제외 (사용자 "KODEX CD금리액티브가 전기차 관련주?" — deadCross fix 가
//   평탄MA 금리ETF 를 언블록해 포트폴리오 유입 + LLM 이 "전기차 수요" 등 환각 근거 부착). MMF/CD/KOFR/
//   통안/단기금융 = 주차용 현금성 — 매수 추천 프레임 부적합(레버리지/인버스와 동일 취지). 이름패턴 +
//   초저변동(52주 레인지<5% = 현금성) 2중 감지.
function isCashLikeEtf(name, hi52, lo52) {
  const n = String(name ?? '');
  if (/금리|KOFR|\bCD\b|MMF|머니\s*마켓|머니마켓|통안|단기\s*금융|초단기|현금성|단기통안|파킹|양도성예금/i.test(n)) return true;
  if (hi52 > 0 && lo52 > 0 && (hi52 / lo52 - 1) < 0.05) return true; // 52주 레인지 <5% = 현금성(금리ETF)
  return false;
}

// 2026-06-14: 일반 ETF 식별 — 사용자 "ETF는 ETF 섹션에서 다뤄, 매수추천(종목 포트폴리오)에선 빼.
//   US/KR 나눠서". 종목 풀(KOSPI/KOSDAQ·미국주식)에 ETF(TIGER 미국배당·KODEX 200·미국지수추종 등)가
//   섞여 환각근거 붙던 문제. US=cap'etf', KR=브랜드명(meta cap 은 'kr' 이라 이름으로). ETF 는 etfStrategy
//   섹션이 별도 담당. (과거 '일반ETF 추천허용' 지시를 사용자가 명시 변경 — [[feedback_etf-recommendation-ok]])
const KR_ETF_BRAND = /^(TIGER|KODEX|KBSTAR|ARIRANG|ACE|SOL|KINDEX|HANARO|PLUS|RISE|KOSEF|TIMEFOLIO|KCGI|마이티|히어로즈|마이다스|파워|FOCUS|포커스|WON|TREX|BNK|에셋플러스|마이다스)\b/i;
function isEtf(ticker, meta) {
  if (/etf/i.test(meta?.cap ?? '')) return true;            // US ETF (cap 밴드)
  const n = String(meta?.name ?? '');
  if (KR_ETF_BRAND.test(n)) return true;                    // KR ETF 브랜드 prefix
  if (/레버리지|인버스|\bETF\b|미국\s*(S&P|S\&P|나스닥|다우|배당)|채권|국채|회사채/i.test(n)) return true;
  return false;
}

// 2026-06-12: 시장별 쿼터 슬라이스 — 사용자 "KR 350+ 전 종목 다 고려?" 실측: stage-1 신호
//   (insider=SEC Form4·squeeze=US 공매도·뉴스갭=US IB)가 미국 위주라 KR(풀 35%)이 주간 top30 의
//   2%만 진입 — 룰 경쟁에서 구조적 배제. 시장 내 점수순으로 KR 슬롯을 보장해 시장중립 룰
//   (기술/기본 — Stage 2/3, KR 도 Yahoo OHLCV/재무 평가 가능)에서 공정 경쟁시킴. 미달 시 US backfill.
function sliceWithKrQuota(sorted, total, krSlots) {
  const kr = sorted.filter(c => c.market === 'kr').slice(0, krSlots);
  const picked = new Set(kr.map(c => c.ticker));
  const rest = sorted.filter(c => !picked.has(c.ticker)).slice(0, total - kr.length);
  return [...rest, ...kr].sort((a, b) => b.stage1Score - a.stage1Score);
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

  // 2026-06-12(v3, 사용자 "레버리지도 추천해도 되"): 제외 없음 — 전 상품 퍼널 참여.
  //   레버리지/인버스는 발간직전 게이트에서 결정론 경고 라벨만 부착 (isLeveragedEtf, 모듈 스코프).

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
    // 2026-06-14: ETF 전부 제외 (사용자 "ETF는 ETF 섹션에서, 종목 추천엔 빼") — US cap'etf' + KR 브랜드.
    //   현금성/금리 ETF(52주<5%)도 포함. ETF 는 etfStrategy 섹션이 US/KR 분리 담당.
    if (isEtf(ticker, meta) || isCashLikeEtf(meta.name, pd.high52w, pd.low52w)) continue;
    const sectorKey = String(meta.sector ?? '').toLowerCase();
    const ctx = {
      ticker, price: pd.price, change1d: pd.change1d, sector: meta.sector,
      high52w: pd.high52w ?? null,  // 2026-06-12: stage-1 모멘텀 룰용 (시장중립 — KR 도 동작)
      market: isKR ? 'kr' : 'us',
      macroRiskLevel: macroCtx.riskLevel,
      vix: macroCtx.vix,
      fgScore: macroCtx.fgScore,
      sectorStance: macroCtx.sectorStanceMap?.get(sectorKey),
      regionStance: macroCtx.regionStanceMap?.get(isKR ? 'kr' : 'us'),
      newsPosRatio: macroCtx.newsSentimentMap?.get(ticker)?.posRatio ?? null,
      newsArticleCount: macroCtx.newsSentimentMap?.get(ticker)?.count ?? 0,
      newsGapScore: macroCtx.newsGapMap?.get(ticker) ?? null,
      optionsCallPrem: macroCtx.uoaMap?.get(ticker)?.callPrem ?? 0,    // 2026-06-13 UOA
      optionsPutPrem: macroCtx.uoaMap?.get(ticker)?.putPrem ?? 0,
      burstUpNotional: macroCtx.burstMap?.get(ticker)?.dir === 'up' ? macroCtx.burstMap.get(ticker).notional : 0,
      contractWin: macroCtx.contractMap?.get(ticker)?.type === 'contract_win' ? macroCtx.contractMap.get(ticker) : null,  // 2026-06-13 공급계약
      backlogYoYPct: macroCtx.backlogMap?.get(ticker)?.rpoYoYPct ?? null,  // 2026-06-13 수주잔고 증가율
      // 2026-06-13: 사전수집 재무 (사용자 "미리 수집") — 전 종목 stage-1 에서 펀더멘털 평가 (top-50
      //   깔때기 제약 제거). financials.json(US SEC + KR DART). revenueYoY/opMargin/roe.
      revenueYoY: macroCtx.finCacheMap?.get(ticker)?.revYoYPct ?? null,
      opMarginPct: macroCtx.finCacheMap?.get(ticker)?.opMarginPct ?? null,
      roePct: macroCtx.finCacheMap?.get(ticker)?.roePct ?? null,
      // 2026-06-14 (ChatGPT D0-5 차용): evaluateBuyRule 은 ctx.roe/opMargin/revenueGrowth 를 읽는데
      //   위 *Pct 이름과 불일치 → stage-1 fundamental 룰(roeAbove/revenueGrowth/buffettMoat)이 silent
      //   미발화였음. alias 로 정합(전 종목 0비용 펀더멘털 평가 목표 달성). opMarginExpand/peg 는
      //   financials.json 에 YoY-pp/peg 미수록 → Stage3 fetchBuyFundSignals 가 계속 담당.
      roe: macroCtx.finCacheMap?.get(ticker)?.roePct ?? null,
      opMargin: macroCtx.finCacheMap?.get(ticker)?.opMarginPct ?? null,
      revenueGrowth: macroCtx.finCacheMap?.get(ticker)?.revYoYPct ?? null,
      insiderFilings: macroCtx.insiderMap?.get(ticker) ?? 0,
      squeezeScore: macroCtx.squeezeMap?.get(ticker) ?? null,
      cascadeUpstream: macroCtx.cascadeUpstreamSet?.has(ticker) ?? false,
      boostListMember: boostList.has(ticker),
      banListMember: banList.has(ticker),
    };
    let cumScore = 0;
    const reasons = [];
    // 2026-06-13: 사전수집 재무가 있으면 fundamental 룰을 stage-1 에서 평가 (top-50 깔때기 제거).
    //   ctx.revenueYoY/opMargin/roe 가 finCache 에서 채워진 종목만 — 나머지는 종전대로 stage-3.
    const hasFinCache = ctx.revenueYoY != null || ctx.opMarginPct != null || ctx.roePct != null;
    for (const rule of ruleSpec.rules) {
      // Stage 1 = 데이터 없이 평가 가능한 룰 + (사전수집 있으면) fundamental.
      // technical / guru 는 Stage 2/3 에서 OHLCV/financials fetch 후 평가.
      if (['technical', 'guru'].includes(rule.category)) continue;
      if (rule.category === 'fundamental' && !hasFinCache) continue;  // 사전수집 없으면 stage-3 로
      if (rule.category === 'price' && !['price_oversold_gap', 'price_momentum_52w_high'].includes(rule.id)) continue; // 나머지 가격은 Stage 2
      if (rule.category === 'rotation' && !['rotation_defensive'].includes(rule.id)) continue; // 나머지 회전은 Stage 3
      const r = evaluateBuyRule(rule, ctx);
      if (r) { cumScore += rule.score; reasons.push({ ruleId: rule.id, category: rule.category, score: rule.score, reason: r }); }
    }
    if (cumScore <= -50) continue; // ban
    if (cumScore > 0) stage1Scored.push({ ticker, sector: meta.sector ?? 'Unknown', market: isKR ? 'kr' : 'us', stage1Score: cumScore, reasons, price: pd.price });
  }
  stage1Scored.sort((a, b) => b.stage1Score - a.stage1Score);
  const stage2Cands = sliceWithKrQuota(stage1Scored, 100, 30); // top 100 → Stage 2 (KR 30 슬롯 보장)

  // ── Stage 2 (OHLCV): top 100 의 기술 + 가격 (52w/MA/20d high) ──
  console.log(`  [buy-cand Stage 2] top ${stage2Cands.length} OHLCV fetch...`);
  const techSignals = await fetchBuyTechSignals(stage2Cands.map(c => c.ticker));
  for (const c of stage2Cands) {
    const sig = techSignals.get(c.ticker) ?? {};
    const ctx = { ...c, ...sig };
    for (const rule of ruleSpec.rules) {
      // 기술 전체 + 가격 중 OHLCV 필요한 것 (price_oversold_gap 은 Stage 1 에서 이미 평가)
      const needsOHLCV = rule.category === 'technical' ||
        (rule.category === 'price' && rule.id !== 'price_oversold_gap') ||
        rule.id === 'rotation_new_high_after_consolidation';
      if (!needsOHLCV) continue;
      const r = evaluateBuyRule(rule, ctx);
      if (r) { c.stage1Score += rule.score; c.reasons.push({ ruleId: rule.id, category: rule.category, score: rule.score, reason: r }); }
    }
  }
  stage2Cands.sort((a, b) => b.stage1Score - a.stage1Score);
  const stage3Cands = sliceWithKrQuota(stage2Cands, 50, 15); // KR 15 슬롯 보장

  // ── Stage 3 (financials): top 50 의 기본/구루 + 회전 sector_in (P/E discount 필요) ──
  console.log(`  [buy-cand Stage 3] top ${stage3Cands.length} company-financials fetch...`);
  const fundSignals = await fetchBuyFundSignals(stage3Cands.map(c => c.ticker));
  const sectorPeMap = macroCtx.sectorPeMap ?? new Map();
  for (const c of stage3Cands) {
    const sig = fundSignals.get(c.ticker) ?? {};
    const sectorKey = String(c.sector ?? '').toLowerCase();
    const ctx = {
      ...c, ...sig,
      sectorPe: sectorPeMap.get(sectorKey) ?? null,
      sectorStance: macroCtx.sectorStanceMap?.get(sectorKey) ?? null,
    };
    // 2026-06-13: stage-1 에서 이미 사전수집 재무로 평가된 fundamental 룰은 재평가 금지(이중 가산 방지).
    const alreadyScored = new Set((c.reasons ?? []).map(r => r.ruleId));
    for (const rule of ruleSpec.rules) {
      if (!['fundamental', 'guru'].includes(rule.category) && rule.id !== 'rotation_sector_in') continue;
      if (alreadyScored.has(rule.id)) continue;
      const r = evaluateBuyRule(rule, ctx);
      if (r) { c.stage1Score += rule.score; c.reasons.push({ ruleId: rule.id, category: rule.category, score: rule.score, reason: r }); }
    }
  }
  stage3Cands.sort((a, b) => b.stage1Score - a.stage1Score);
  const finalCands = sliceWithKrQuota(stage3Cands, topN, Math.round(topN * 0.3)); // KR ~30% 슬롯 보장
  const krN = finalCands.filter(c => c.market === 'kr').length;
  console.log(`  [buy-cand 최종] top ${finalCands.length} (KR ${krN}): ${finalCands.slice(0, 8).map(c => `${c.ticker}(${c.stage1Score})`).join(' ')}...`);
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
        -- 2026-06-04: 이미 매도추천/청산된 종목 제외 — "매수했던 목록"에서 빠지도록 (재-매도추천 방지)
        AND r.id NOT IN (SELECT recommendation_id FROM recommendation_outcomes WHERE outcome IN ('sold', 'hit_target', 'stop_loss'))
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
      // 2026-06-14: 보유 1일 미만(직전 리포트 ~몇시간 전 추천) 제외 — 사용자 "매도추천 다 0.0%인데 맞아?".
      //   price_at_gen≈현재가라 P&L 0%·보유 0일 = "방금 산 걸 0%에 팔라"는 무의미 추천. 의미있는 P&L 가진
      //   포지션만 매도 평가. (5회/일 cadence 라 직전세션 추천이 sell 후보로 잡히던 노이즈 제거.)
      if (heldDays < 1) continue;
      const pnl = r.pnl_pct ?? (r.price_at_gen ? ((price - r.price_at_gen) / r.price_at_gen) * 100 : null);

      const sig = macroCtx.signals?.get(ticker) ?? {};
      const sectorKey = (r.sector ?? '').toLowerCase();
      const evalCtx = {
        price, stop, target, heldDays, pnl, sector: r.sector,
        change1d: pd.change1d ?? null,
        // 기술
        rsi: sig.rsi, sma50: sig.sma50, sma200: sig.sma200, volPct: sig.volPct,
        // 기본
        opMarginDecline: sig.opMarginDecline, peRatio: sig.peRatio, peg: sig.peg, revenueYoY: sig.revenueYoY,
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
        // 2026-06-06: 내부자 매도 (매수·매도 대칭) — signalDigest insider {buys,sells}
        insiderSells: macroCtx.insider?.get(ticker)?.sells ?? null,
        insiderBuys: macroCtx.insider?.get(ticker)?.buys ?? null,
        insiderSellToBuyRatio: macroCtx.insider?.get(ticker) ? (macroCtx.insider.get(ticker).sells / Math.max(macroCtx.insider.get(ticker).buys, 1)) : null,
        // 2026-06-06: 13F 기관 수급
        instReducers: macroCtx.inst13f?.get(ticker)?.reducers ?? null,
        instAdders: macroCtx.inst13f?.get(ticker)?.adders ?? null,
        instNetShares: macroCtx.inst13f?.get(ticker)?.netShares ?? null,
        // 2026-06-13: UOA put 편중 (보유 종목 하방 베팅 감지)
        optionsCallPrem: macroCtx.uoaMap?.get(ticker)?.callPrem ?? 0,
        optionsPutPrem: macroCtx.uoaMap?.get(ticker)?.putPrem ?? 0,
        contractLoss: macroCtx.contractMap?.get(ticker)?.type === 'contract_loss' ? macroCtx.contractMap.get(ticker) : null,  // 공급계약 해지
      };
      // 2026-06-06: 누적 점수화 (ChatGPT D3) — 첫 매칭 1개가 아니라 매칭 룰 *전부* 합산.
      //   target_near 단독(7)과 target_near+RSI과매수+내부자매도(20)를 같은 7로 취급하던 비대칭 해소.
      //   buy 후보 경합심사가 누적인데 sell 은 first-match 였던 비대칭도 정렬.
      const sellHits = [];
      for (const rule of ruleSpec.rules) {
        const result = evaluateSellRule(rule, evalCtx);
        if (result) sellHits.push({ ruleId: rule.id, category: rule.category ?? null, score: rule.score ?? 0, urgency: rule.urgency, reason: result });
      }
      if (!sellHits.length) continue;
      // 2026-06-12: 익절류 룰의 무수익 발화 차단 (사용자 "0.0%인데 분할익절하라고?" — 당일 추천
      //   종목이 target 근접만으로 pnl 0% 에 분할익절 카드 발행). 익절 권고는 실수익 ≥2% 또는
      //   보유 1일+ 일 때만 의미 — 미달이면 해당 hit 제거 (다른 신호는 유지).
      const PROFIT_RULES = new Set(['price_target_near', 'rotation_profit']);
      const realizedPnl = pnl != null ? pnl : 0;
      const filteredHits = sellHits.filter(h => !PROFIT_RULES.has(h.ruleId) || realizedPnl >= 2 || heldDays >= 1);
      if (filteredHits.length !== sellHits.length) console.log(`  [sell-cand] ${ticker} 익절 hit 제거 (pnl ${realizedPnl.toFixed(1)}% < 2% & 보유 ${Math.round(heldDays)}일)`);
      if (!filteredHits.length) continue;
      const totalScore = filteredHits.reduce((s, h) => s + h.score, 0);
      const URG_RANK = { high: 3, medium: 2, low: 1 };
      const maxUrgency = filteredHits.reduce((u, h) => (URG_RANK[h.urgency] ?? 0) > (URG_RANK[u] ?? 0) ? h.urgency : u, 'low');
      const primary = [...filteredHits].sort((a, b) => b.score - a.score)[0];

      const fmt = n => isKR ? `₩${Math.round(n).toLocaleString()}` : `$${n.toFixed(2)}`;
      candidates.push({
        ticker, name: r.name ?? ticker, sector: r.sector ?? 'Unknown',
        market: isKR ? 'kr' : 'us',
        score: totalScore,
        ruleId: primary.ruleId,
        category: primary.category,
        urgency: maxUrgency,
        sellHits: filteredHits,  // 양방향 심판/trail 용 — 매칭 룰 전체 보존 (무수익 익절 hit 제외 후)
        reason: filteredHits.map(h => h.reason).join(' | '),
        currentPrice: fmt(price),
        entryPrice: r.price_at_gen ? fmt(r.price_at_gen) : null,
        target: target ? fmt(target) : null,
        stopLoss: stop ? fmt(stop) : null,
        pnlPct: pnl != null ? Math.round(pnl * 10) / 10 : null,
        heldDays: Math.round(heldDays),
        // 2026-06-12: 매수추천일 명시 (사용자 "분할매도 권장 날짜도 적어줘야지 안 그럼 오해함" —
        //   어제 산 종목의 익절인지 오래 보유한 종목의 이탈인지 타임라인이 안 보이던 문제)
        entryDate: r.generated_at ? new Date(new Date(r.generated_at + (String(r.generated_at).endsWith('Z') ? '' : 'Z')).getTime() + 9 * 3600000).toISOString().slice(0, 10) : null,
        outcome: r.outcome ?? 'open',
      });
    }
    // 2026-06-12: 매도권장 시작일 (사용자 "분할익절 이전 권장했던 날짜도") — 같은 종목·같은 유형의
    //   첫 권장일을 DB 에서 조회. 권고가 며칠째 이어지는지 타임라인 명시 (오늘 처음이면 오늘 날짜).
    try {
      // 주의: DB sell_type 은 후단 LLM override(c.sellType)라 ruleId 와 자주 불일치 (PVH:
      //   ruleId=price_target_near 가 stop_breach 로 적재된 실측). 정확 일치 대신 UI sellKind 와
      //   동일한 4그룹(익절/손절/신호악화/매크로)으로 묶어 "같은 성격의 권고가 언제 시작됐나" 매칭.
      const sellKindGroup = (t) => {
        if (!t) return 'macro';
        if (t === 'price_target_near' || t === 'target_near' || t === 'rotation_profit') return 'profit';
        if (t.startsWith('price_stop') || t.startsWith('stop_') || t === 'rotation_loss') return 'stop';
        if (/^(tech_|fund_|guru_)/.test(t) || t === 'dead_cross' || t === 'RSI_overbought'
          || ['micro_news_negative', 'micro_insider_selling', 'micro_13f_distribution'].includes(t)) return 'weak';
        return 'macro';
      };
      const fdb = new Database(resolve(ROOT, 'data/flowvium.db'), { readonly: true });  // 위 db 는 이미 close 됨
      const rowsStmt = fdb.prepare(`SELECT sell_type, generated_at FROM sell_recommendations WHERE ticker = ?`);
      for (const c of candidates) {
        const grp = sellKindGroup(c.ruleId);
        const mins = rowsStmt.all(c.ticker).filter((r) => sellKindGroup(r.sell_type) === grp).map((r) => r.generated_at).sort();
        const mn = mins[0];
        // 선행 행 없음 = 이 보고서가 첫 권고 → 오늘(KST). (TSM 빈 값 실측 — 같은 발간 내 일관성)
        c.firstSellDate = mn
          ? new Date(new Date(mn + (String(mn).endsWith('Z') ? '' : 'Z')).getTime() + 9 * 3600000).toISOString().slice(0, 10)
          : new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
      }
      fdb.close();
    } catch { /* 표시 누락만 — non-fatal */ }
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
  // 2026-05-30: F26/Karpathy closed loop — 최근 7일 환각 list 를 anti-pattern 으로 inject.
  //   verify-report → hallucination_history → 다음 prompt 의 [⚠️ AVOID THESE HALLUCINATIONS]
  //   LLM 가 같은 실수 반복하지 않도록 학습. 후처리 fix 와 별개로 source-level 차단.
  let antiPatternBlock = '';
  try {
    const halluc = getRecentHallucinationsForPromptInject(7, 15);
    if (halluc.length > 0) {
      const lines = halluc.map(h => {
        const tk = h.ticker ? `${h.ticker} ` : '';
        return `  ❌ ${tk}${h.defect_type}: "${(h.llm_value ?? '').slice(0, 80)}" → 정답 "${(h.correct_value ?? '').slice(0, 60)}"`;
      });
      antiPatternBlock = `[⚠️ AVOID — 최근 7일간 발견된 환각 (${halluc.length}건, 반복 금지)]\n${lines.join('\n')}\n→ 위와 같은 패턴 출력 시 후처리에서 reject 됨. 처음부터 정확한 값 사용.`;
      console.log(`  [F26/AntiPattern] 최근 환각 ${halluc.length}건 prompt inject ✓`);
    } else {
      console.log(`  [F26/AntiPattern] ✅ 최근 환각 0건 (학습 효과)`);
    }
  } catch (e) {
    console.warn(`  [F26/AntiPattern] ⚠️ inject 실패: ${String(e).slice(0, 80)}`);
  }
  // 2026-05-29 F24: 세션별 시장 focus inject — 해당 시장 종목 비중 강화
  const session = getSession();
  const focus = getSessionFocus(session);
  const priorityLines = (focus.dataPriority ?? []).map((d, i) => `   ${i + 1}. ${d}`).join('\n');
  const focusBlock = `[Session Focus] ${session.toUpperCase()} (${focus.label})\n` +
    `Primary 시장: ${focus.primary} | 보조: ${focus.secondary.join('/')}\n` +
    `목표 비중: ${Object.entries(focus.marketWeight).map(([k,v])=>`${k.toUpperCase()} ${v}%`).join(' / ')}\n` +
    `→ 이 세션은 위 primary 시장 종목을 우선 추천 (해당 시장 ≥${focus.marketWeight[focus.primary] ?? 50}%).\n` +
    // 2026-06-05 (b) 세션 가중: 8B attention 을 세션 핵심 신호에 집중시킴.
    `[Session Data Priority — 아래 신호를 attention 최우선 순으로 가중. 종목 선정·entry·rationale 시 이 순서로 근거 채택, 그 외 블록은 보조 참고]\n` +
    priorityLines;
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
    antiPatternBlock,  // 2026-05-30 F26: Karpathy closed loop — 최근 환각 anti-pattern inject
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
      '(괄호 뒤 → = 실제 사업/주력제품. rationale 은 이 사업 사실에만 근거할 것. 모르는 종목 추측 금지.)',
      ...buyCandidates.slice(0, 30).map((c, i) => {
        const biz = businessOneLiner(c.ticker);
        return `  ${(i + 1).toString().padStart(2)}. ${c.ticker.padEnd(11)} score=${c.stage1Score} (${c.market}/${c.sector})${biz ? ` → ${biz}` : ''} — ${c.reasons.slice(0, 3).map(r => r.ruleId).join(', ')}`;
      }),
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
    '🚫 rationale/entryRationale/targetRationale 는 해당 종목의 실제 sector 사업에만 근거. 무관한 산업의 "수요/시장/성장" thesis 금지 (예: 자동차주에 "바이오 수요", 반도체주에 "건설 수요"). 모르면 기술적/재무 신호만 인용.',
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
    // 2026-06-12: "미국-이라의 평화협정" 사건 — 뉴스의 약어(US-IR)를 절단된 국가명으로 출력.
    '- Country names: NEVER abbreviate or truncate. Write full names (이란/이라크/사우디아라비아, NOT 이라/IR/사우디아). If unsure of the country, omit it.',
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
  // 2026-06-02: KR 종목이 companyChanges 에서 누락되던 문제(institutional=US 13F 편향) — KR 명시.
  const krRef = portfolioItems.filter(p => /\.(KS|KQ)$/.test(p.ticker)).map(p => `${p.ticker}(${p.name ?? ''})`).join(', ');
  return [
    `You are a corporate analyst. Date: ${TODAY}. Write keyChange in ${TARGET_LANG}.`,
    '',
    `Portfolio (reference only): ${portfolioRef}`,
    krRef ? `Korean portfolio holdings (MUST cover ≥2 if any DART financials/news exist): ${krRef}` : '',
    '',
    `[Recent Financials] ${financials || 'No data'}`,
    `[Upcoming/Recent Earnings] ${earnings || 'None'}`,
    `[Institutional Changes] ${institutional || 'None'}`,
    `[News & Events] ${news || 'None'}`,
    '',
    'RULES:',
    '- Select ONLY 5-10 companies with the most NOTABLE recent changes from ALL context data above.',
    '- Include ANY company mentioned in context (NOT limited to portfolio tickers) if it has material news.',
    '- KR(.KS/.KQ) 종목도 반드시 포함: institutional(13F)은 US 전용이라 비어있어도, [Recent Financials](DART) + [News & Events] 로 KR 변화를 다뤄라. US 편향 금지.',
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
    `- fundamentalBasis: ≤120 chars — use [Recent Company Financials] data ONLY; revenue growth%, operating margin, ROE, PE (제공된 경우만).`,
    `  ⚠️ PE/PEG/ROE 는 [Recent Company Financials] 에 명시된 값만 인용. 없으면 절대 지어내지 말고(메모리 PE 금지) ROE·마진·매출성장으로 근거. KR 은 보통 PE 미제공 → ROE/netMargin 사용.`,
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
    `{"stockDetails":[{"ticker":"[TICKER_1]","catalysts":["[company-specific event+number]","[second event]","[third]"],"fundamentalBasis":"[YoY%, margin%, ROE; PE만 제공시]","technicalBasis":"[MA status, RSI, vol]","riskNote":"[TICKER_1-unique risk ≤60 chars]"},{"ticker":"[TICKER_2]","catalysts":["[DIFFERENT event for TICKER_2]","..."],"fundamentalBasis":"...","technicalBasis":"...","riskNote":"[TICKER_2-unique risk]"}]}`,
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
  // 2026-05-29: candidate-tickers 풀에 있는 KR 종목의 .KS/.KQ suffix lookup.
  //   문제: LLM 이 KOSDAQ 종목 (예: 056080 유진로봇) 을 .KS 로 잘못 출력 → 가격 fetch 실패.
  //   해결: 6자리 코드 → 풀에서 .KS / .KQ 둘 다 찾고 실제 존재하는 것 선택.
  const krSuffixMap = new Map();
  for (const t of CANDIDATE_TICKERS) {
    if (typeof t !== 'string') continue;
    const m = t.match(/^(\d{6})\.(KS|KQ)$/);
    if (m) krSuffixMap.set(m[1], t); // 첫 번째 발견된 suffix 사용
  }
  let items = portfolio.map(p => {
    let ticker = (p.ticker ?? '').trim();
    // 6자리 → 풀에서 정확한 suffix 찾기. 없으면 .KS 기본.
    if (KR_NUM.test(ticker)) {
      ticker = krSuffixMap.get(ticker) ?? `${ticker}.KS`;
    }
    // 잘못된 suffix 보정: 053610.KS 인데 풀엔 053610.KQ 만 있으면 .KQ 로 swap
    const krMatch = ticker.match(/^(\d{6})\.(KS|KQ)$/);
    if (krMatch && krSuffixMap.has(krMatch[1]) && krSuffixMap.get(krMatch[1]) !== ticker) {
      const correct = krSuffixMap.get(krMatch[1]);
      console.warn(`  [ticker-suffix] ${ticker} → ${correct} (풀에 ${correct} 만 존재)`);
      ticker = correct;
    }
    // Normalize alias: NVIDIA→NVDA, ALPHABET→GOOGL, etc.
    const aliasKey = ticker.toUpperCase().replace(/[\s.]/g, '');
    ticker = TICKER_ALIASES.get(aliasKey) ?? ticker;
    const action = p.action && ['buy','watch','hold'].includes(p.action) ? p.action : 'buy';
    // 2026-05-30: candidate-tickers meta 강제 override — LLM 환각 차단.
    //   원인: LLM 가 SK하이닉스 sector="Construction", NAVER sector="Energy" 같은 잘못된 매핑.
    //   meta 의 정확한 sector + name 으로 override. KR 종목은 한글 이름 (사용자 가시 표시).
    const meta = CANDIDATE_META[ticker];
    let sector = p.sector;
    let name = p.name;
    if (meta) {
      // sector: meta 우선. LLM 환각 차단.
      // 2026-05-30: case mismatch 도 catch — "It-software" vs "it-software" 같은 차이.
      if (meta.sector && meta.sector !== 'Unknown') {
        const llmLower = (p.sector ?? '').toLowerCase().trim();
        const metaLower = meta.sector.toLowerCase().trim();
        if (p.sector && llmLower !== metaLower) {
          console.warn(`  [sector-fix] ${ticker} sector "${p.sector}" → "${meta.sector}" (meta override, LLM 환각 차단)`);
        }
        sector = meta.sector;  // 항상 meta 사용 (case 통일)
      }
      // name: KR 종목은 한글 이름 (005490.KS → POSCO홀딩스). meta.name 가 ticker 와 같지 않을 때만.
      const isKR = ticker.endsWith('.KS') || ticker.endsWith('.KQ');
      if (isKR && meta.name && meta.name !== ticker) {
        name = meta.name;
      } else if (!isKR && meta.name && !name) {
        name = meta.name;
      }
    }
    // 2026-05-30: rationale 안의 52주/MA 환각 strip — Yahoo OHLCV 5y 섞임/액면분할 unit mismatch 차단.
    let rationale = p.rationale ?? '';
    const week52 = rationale.match(/52주\s*:\s*[₩$]?([\d,.]+)\s*-\s*[₩$]?([\d,.]+)/);
    if (week52) {
      const lo = parseFloat(week52[1].replace(/,/g, ''));
      const hi = parseFloat(week52[2].replace(/,/g, ''));
      if (lo > 0 && isFinite(hi) && hi / lo > 3) {
        // 52주 비정상 → 해당 segment 통째로 strip
        rationale = rationale.replace(/\s*,?\s*52주\s*:[^,|]+/, '').trim();
        console.warn(`  [52w-halluc] ${ticker} 52주 ${lo}-${hi} (${(hi/lo).toFixed(1)}x) — strip`);
      }
    }
    const m50 = rationale.match(/50MA[^₩$\d]*[₩$]?([\d,.]+)/);
    const m200 = rationale.match(/200MA[^₩$\d]*[₩$]?([\d,.]+)/);
    if (m50 && m200) {
      const v50 = parseFloat(m50[1].replace(/,/g, ''));
      const v200 = parseFloat(m200[1].replace(/,/g, ''));
      if (v50 > 0 && v200 > 0 && Math.abs(v50 / v200 - 1) > 0.5) {
        rationale = rationale.replace(/\s*,?\s*200MA[^,|]+/, '').replace(/\s*,?\s*50MA[^,|]+/, '').trim();
        console.warn(`  [ma-halluc] ${ticker} 50MA=${v50} vs 200MA=${v200} (gap>50%) — strip`);
      }
    }
    return { ...p, ticker, action, sector, name, rationale };
  }).filter(p => {
    const k = (p.ticker ?? '').toUpperCase();
    if (!k || INDEX_TICKERS.has(k)) return false;
    // 2026-05-29: 환각 ticker 차단. KR 6자리 코드인데 풀에 없으면 reject.
    //   예: 056100~130.KS 같은 LLM 가 만들어낸 환각 ticker.
    const krM = k.match(/^(\d{6})\.(KS|KQ)$/);
    if (krM && !krSuffixMap.has(krM[1])) {
      console.warn(`  [ticker-halluc] ❌ ${k} reject — candidate-tickers 풀에 없음 (LLM 환각)`);
      return false;
    }
    return true;
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
  const [ctxRaw, livePrices, sectorPe, sectorPeRaw, earnings] = await Promise.all([
    gatherContext(),
    getLivePrices(),
    getSectorSummary(),
    getSectorPeRaw(),
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
  console.log(`  prices=${livePrices.size} tickers, sectorPe=${sectorPe.length}c (raw ${sectorPeRaw.length} 섹터), earnings=${earnings.length}c`);

  // 2026-05-29: 매수 후보 4-stage scoring (Wave 1 portfolio LLM 호출 직전)
  // macro/sector/region 데이터는 ctxRaw 에서 추출. 매도와 동일 macroCtx 재사용.
  console.log('\n[1.5/7] 매수 후보 4-stage scoring (1,200+ ticker)...');
  const buyMacroCtx = {
    riskLevel: null, // Wave 1 macroData 가 아직 없음 — fg/vix 만 활용
    // 2026-06-12 fix: volatility 응답 필드는 .vix (.score 는 미존재 — earlyWarning 과 동일 오필드 버그.
    //   매수 룰의 ctx.vix 가 항상 null 이라 VIX 조건 룰이 한 번도 발화 못 하던 상태)
    vix: ctxRaw?.volatility?.vix ?? null,
    fgScore: ctxRaw?.fearGreed?.score ?? ctxRaw?.fear_greed?.score ?? null,
    sectorPeMap: new Map((sectorPeRaw ?? []).map(s => [String(s.sector ?? '').toLowerCase(), s.peAvg ?? s.peRatio])),
    sectorStanceMap: new Map(), // Wave1 후 채워질 데이터 — Stage 1 에는 빈 Map
    regionStanceMap: new Map(),
    newsSentimentMap: (() => {
      // 2026-06-12 죽은 신호 복원: ① 기사 스키마에 tickers 필드 부재 ② 필드명도 ctxRaw.news(미존재,
      //   실제는 cascade) — micro_news_positive 가 개통 이래 0 발화. 제목/요약 ↔ 종목명·티커
      //   결정론 매칭으로 복원 (KR 은 한글 종목명 — KR 뉴스 신호맹 부분 해소).
      const m = new Map();
      const articles = ctxRaw?.cascade ?? [];
      if (!articles.length) return m;
      let candMeta = {}; let usNames = {};
      try { candMeta = JSON.parse(readFileSync(resolve(ROOT, 'data/candidate-tickers.json'), 'utf8')); } catch { /* */ }
      try { usNames = JSON.parse(readFileSync(resolve(ROOT, 'data/company-names.json'), 'utf8')); } catch { /* */ }
      const texts = articles.map((a) => ({ text: `${a.title ?? ''} ${a.summary ?? ''}`, sentiment: a.sentiment }));
      for (const t of candMeta.tickers ?? []) {
        const isKR = /\.(KS|KQ)$/.test(t);
        const needles = [];
        const metaName = candMeta.meta?.[t]?.name;
        if (isKR) { if (metaName && metaName.length >= 2 && /[가-힣]/.test(metaName)) needles.push(metaName); }
        else {
          if (t.length >= 3) needles.push(new RegExp(`\\b${t.replace(/[.\-]/g, '\\$&')}\\b`));  // 티커 심볼 (대문자 그대로)
          const full = String(usNames[t] ?? '').replace(/,? (inc|corp|co|plc|ltd|holdings?|group)\.?$/i, '').trim();
          if (full.length >= 5) needles.push(new RegExp(`\\b${full.replace(/[.*+?^${'$'}{}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i'));
        }
        if (!needles.length) continue;
        for (const { text, sentiment } of texts) {
          const hit = needles.some((n) => typeof n === 'string' ? text.includes(n) : n.test(text));
          if (!hit) continue;
          if (!m.has(t)) m.set(t, { pos: 0, neg: 0, count: 0 });
          const s = m.get(t); s.count++;
          if (sentiment === 'positive' || sentiment === 'bullish') s.pos++;
          else if (sentiment === 'negative' || sentiment === 'bearish') s.neg++;
        }
      }
      for (const [, v] of m) {
        v.posRatio = v.count ? v.pos / v.count : 0;
        v.negRatio = v.count ? v.neg / v.count : 0;
      }
      if (m.size) console.log(`  [news-match] 기사↔종목 매칭 ${m.size}종 (뉴스 sentiment 신호 복원)`);
      return m;
    })(),
    insiderMap: new Map((ctxRaw?.insider ?? []).map(i => [i.ticker, i.filings ?? i.count ?? 1])),
    newsGapMap: new Map((ctxRaw?.newsGap ?? []).filter(g => g.ticker && typeof g.gapScore === 'number').map(g => [g.ticker, g.gapScore])),  // 2026-06-12
    squeezeMap: new Map((ctxRaw?.shorts ?? ctxRaw?.shortSqueeze ?? []).map(s => [s.ticker, s.score ?? s.squeezeScore])),
    cascadeUpstreamSet: new Set((ctxRaw?.cascade ?? []).flatMap(c => (c.downstreamBeneficiaries ?? []).map(d => d.ticker ?? d))),
    // 2026-06-13: 전 종목 사전수집 재무 (사용자 "미리미리 수집") — build-financials-cache 산출.
    //   stage-1 에서 전 종목 펀더멘털(매출YoY/영업이익률/ROE) 평가 → top-50 깔때기 제약 제거.
    finCacheMap: (() => {
      try {
        const fc = JSON.parse(readFileSync(resolve(ROOT, 'data/financials.json'), 'utf8'));
        const m = new Map(Object.entries(fc));
        if (m.size) console.log(`  [fin-cache] 사전수집 재무 ${m.size}종 로드 (전 종목 펀더멘털 stage-1)`);
        return m;
      } catch { return new Map(); }
    })(),
    // 2026-06-13: 수주잔고 (사용자 "전종목 할수있는법") — SEC RPO(ASC606 표준태그) build-backlog 산출.
    //   잔고 레벨 + YoY(증가율 = 향후 매출 가시성). 주문기반 산업만 보유(은행/소매 null=정상).
    backlogMap: (() => {
      try {
        const bl = JSON.parse(readFileSync(resolve(ROOT, 'data/backlog.json'), 'utf8'));
        const m = new Map(Object.entries(bl));
        if (m.size) console.log(`  [backlog] 수주잔고(RPO) ${m.size}종 로드 (종목선정 입력)`);
        return m;
      } catch { return new Map(); }
    })(),
    // 2026-06-13: 공급망 계약 신호 (사용자 "계약 상세가 종목선정에 반영돼야 — US·KR 둘다") — DART(KR)
    //   +SEC 8-K(US) 계약 win/loss 를 ticker별 매핑. 금액(원) 있으면 동봉 → 룰이 규모 가중.
    contractMap: (() => {
      const m = new Map();
      for (const s of (ctxRaw?.supplyChainSignals ?? [])) {
        if (!s.ticker || (s.signalType !== 'contract_win' && s.signalType !== 'contract_loss')) continue;
        const e = m.get(s.ticker);
        const cand = { type: s.signalType, conviction: s.conviction ?? 0, amountWon: s.contractAmountWon ?? null, revenuePct: s.contractRevenuePct ?? null, summary: s.summary ?? '' };
        if (!e || cand.conviction > e.conviction) m.set(s.ticker, cand);
      }
      if (m.size) console.log(`  [contract] 공급망 계약 신호 ${m.size}종 매핑 (종목선정 입력)`);
      return m;
    })(),
    // 2026-06-13: UOA·버스트 micro 신호 (사용자 "옵션플로우/블록트레이드도 보고서 참고되나") —
    //   ticker별 call/put 프리미엄 합산 + 최대 버스트 (둘 다 무료 파생 라이브, 결정론).
    uoaMap: (() => {
      const m = new Map();
      for (const o of (ctxRaw?.optionsFlow ?? [])) {
        if (!o.ticker || !o.premiumUsd) continue;
        const e = m.get(o.ticker) ?? { callPrem: 0, putPrem: 0 };
        if (o.optionType === 'call') e.callPrem += o.premiumUsd; else e.putPrem += o.premiumUsd;
        m.set(o.ticker, e);
      }
      if (m.size) console.log(`  [uoa] 옵션 unusual activity ${m.size}종 매핑`);
      return m;
    })(),
    burstMap: (() => {
      const m = new Map();
      for (const b of (ctxRaw?.blockTrades ?? [])) {
        if (!b.ticker || !b.valueUsd) continue;
        const e = m.get(b.ticker);
        if (!e || b.valueUsd > e.notional) m.set(b.ticker, { notional: b.valueUsd, dir: b.exchange === 'burst-up' ? 'up' : 'down' });
      }
      if (m.size) console.log(`  [burst] 거래량 버스트 ${m.size}종 매핑`);
      return m;
    })(),
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
  const [companyFinancials, technicalData, financialsMap] = await Promise.all([
    getCompanyFinancials(portfolioForFinancials, livePrices),
    buildTechnicalData(buyStocks.map(s => s.ticker), livePrices),
    getFinancialsMap(portfolioForFinancials),  // 2026-06-03: earnings_archive 적재용 ticker-keyed 맵
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
  const sectorPeMap = new Map((sectorPeRaw ?? []).map(s => [String(s.sector ?? '').toLowerCase(), s.peAvg ?? s.peRatio]));
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
  // 2026-06-06: 내부자 매도 데이터 plumbing — signalDigest insider {buys,sells} → 매도엔진 ctx.
  const insiderDigest = new Map();
  for (const [t, d] of signalDigest) if (d.insider) insiderDigest.set(t, d.insider);
  // 2026-06-06: 13F 기관 수급 digest (ChatGPT D3) — ctxRaw.signals(reducing/adding) → 매도엔진.
  const inst13f = new Map();
  for (const s of (ctxRaw?.signals ?? [])) {
    const t = s.ticker; if (!t) continue;
    const d = inst13f.get(t) ?? { reducers: 0, adders: 0, netShares: 0 };
    if (/reduc|sell/i.test(s.action)) d.reducers++; else if (/add|buy/i.test(s.action)) d.adders++;
    d.netShares += (s.sharesChanged ?? 0);
    inst13f.set(t, d);
  }
  const macroCtx = {
    riskLevel: macroData?.riskLevel ?? null,
    vix: ctxRaw?.volatility?.score ?? ctxRaw?.vix?.score ?? null,
    fgScore: ctxRaw?.fearGreed?.score ?? ctxRaw?.fear_greed?.score ?? null,
    sectorPeMap, sectorStanceMap, regionStanceMap, newsSentimentMap,
    insider: insiderDigest, inst13f,
    uoaMap: buyMacroCtx.uoaMap,  // 2026-06-13: UOA put 편중 매도 신호 (매수와 동일 소스)
    contractMap: buyMacroCtx.contractMap,  // 2026-06-13: 공급계약 해지 매도 신호
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
      // 2026-06-12: LLM sellType override 제거 — 분류는 룰엔진의 결정론 사실 ("숫자는 코드가").
      //   실측: PVH ruleId=price_target_near 를 LLM 이 stop_breach 로 오분류 적재 → firstSellDate
      //   kind-group 매칭 실패. LLM 은 rationale 문장만 담당.
      c.sellType = c.ruleId;
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

  // 2026-06-06: 양방향 경합심사 (사용자 "매도 후보를 매수신호로도 재심사") — 매도 추천을 *매수신호*로
  //   cross-examine. 강한 매수신호(과매도 반등 / 골든크로스 추세유효)가 있으면 매도와 충돌 → 플래그.
  //   리스크관리 우선이라 매도 자체는 취소 안 하되, "전량매도 대신 부분매도/관망" 으로 충돌을 surface.
  //   buy→sell veto(경합심사 게이트)와 합쳐 양방향 합의 완성. sellSideReview 는 trail 에도 적재.
  // 2026-06-14 (ChatGPT D1 차용): adjudicateSellVsBuy 전면 강화.
  //   ① 기존엔 macroCtx.signals(미정의)→sig={}→buyOpp 항상 공백 → 역심판이 사실상 inert 였음.
  //      sell 후보 tech 를 fetchSellSignals 로 실측 + evaluateBuyRule(전체 buy 엔진)으로 buyScore 산출.
  //   ② 3개 하드코딩(RSI/골든크로스/PEG) → 전체 buy-rule 엔진 평가(데이터 가용 룰 발화).
  //   ③ target_near 를 sell/partial_take_profit/trail/hold action ladder 로 분리(매수score vs 매도score).
  const HARD_SELL = new Set(['price_stop_breach', 'tech_dead_cross', 'tech_200ma_breach', 'fund_margin_decline', 'micro_insider_selling', 'micro_supply_contract_loss']);
  const TARGET_NEAR = new Set(['price_target_near']);
  const buyRulesForReview = loadBuyRules()?.rules ?? [];
  let sellSideReview = [];
  const sellListAll = [...sellCands.us, ...sellCands.kr];
  const revSig = sellListAll.length ? await fetchSellSignals(sellListAll.map(c => c.ticker)) : new Map();
  for (const c of sellListAll) {
    const s = revSig.get(c.ticker) ?? {};
    const isKR = /\.(KS|KQ)$/.test(c.ticker);
    const sectorKey = String(c.sector ?? '').toLowerCase();
    // 매수 엔진 재평가 ctx (evaluateBuyRule). fetchSellSignals 필드 → buy-rule 기대명 alias.
    const buyCtx = {
      price: livePrices.get(c.ticker)?.price ?? null,
      rsi: s.rsi, sma50: s.sma50, sma200: s.sma200,
      revenueGrowth: s.revenueYoY ?? null, peg: s.peg ?? null, peRatio: s.peRatio ?? null,
      sectorPe: macroCtx.sectorPeMap?.get(sectorKey) ?? null,
      sectorStance: macroCtx.sectorStanceMap?.get(sectorKey) ?? null,
      regionStance: macroCtx.regionStanceMap?.get(isKR ? 'kr' : 'us') ?? null,
      insiderBuys: macroCtx.insider?.get(c.ticker)?.buys ?? null,
      newsSentiment: macroCtx.newsSentimentMap?.get(c.ticker)?.negRatio != null ? (1 - macroCtx.newsSentimentMap.get(c.ticker).negRatio) : null,
    };
    const buyHits = [];
    for (const rule of buyRulesForReview) { const r = evaluateBuyRule(rule, buyCtx); if (r) buyHits.push({ id: rule.id, score: rule.score ?? 0, reason: r }); }
    const buyScore = buyHits.reduce((a, h) => a + h.score, 0);
    const sellScore = c.score ?? 0;
    const hits = c.sellHits ?? [];
    const hasHard = hits.some(h => HARD_SELL.has(h.ruleId));
    const targetNearOnly = hits.some(h => TARGET_NEAR.has(h.ruleId)) && !hasHard;
    let action, size, msg;
    if (hasHard) { action = 'sell'; size = 1.0; msg = `hard-sell 우선 — 전량매도 (매수score ${buyScore} 무시, 리스크관리)`; }
    else if (targetNearOnly && buyScore >= sellScore + 3) { action = 'trail'; size = 0.0; msg = `목표가 근접이나 매수신호 우세(buy ${buyScore}>sell ${sellScore}) — 전량매도 말고 trailing stop`; }
    else if (targetNearOnly && buyScore >= sellScore - 2) { action = 'partial_take_profit'; size = 0.33; msg = `목표가 근접+추세 일부 유지(buy ${buyScore}~sell ${sellScore}) — 1/3 부분익절`; }
    else if (sellScore >= buyScore + 3) { action = 'sell'; size = 0.5; msg = `매도 우세(sell ${sellScore}>buy ${buyScore}) — 절반 매도`; }
    else { action = 'watch'; size = 0.0; msg = `신호 혼재(buy ${buyScore} vs sell ${sellScore}) — 관망`; }
    c.adjudicatedAction = action; c.adjudicatedSize = size; c.buyConflict = msg;
    if (buyHits.length || hasHard || targetNearOnly) {
      sellSideReview.push({ ticker: c.ticker, sellType: c.sellType ?? c.ruleId, sellScore, buyScore, buyHits: buyHits.map(h => h.id), action, size });
      console.log(`  [역심판] ${c.ticker} sell${sellScore}/buy${buyScore} → ${action}${size ? `(${Math.round(size * 100)}%)` : ''}: ${msg}`);
    }
  }
  if (sellSideReview.length) console.log(`  [역심판] 매도 ${sellSideReview.length}건 buy-rule 엔진 재평가 + action ladder 적용`);

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
        sigDigest?.fin?.yoy ? `Last quarter: revenue YoY ${sigDigest.fin.yoy}, opMargin ${sigDigest.fin.margin ?? 'N/A'}%, ROE ${sigDigest.fin.roe ?? 'N/A'}%, PE ${sigDigest.fin.pe ?? 'N/A'}` : '',
        '',
        '⚠️ RULES:',
        '- Catalysts MUST be specific to this ticker — NOT generic sector talk.',
        '- Each catalyst ≤ 60 chars. Cite actual signal (insider count / squeeze score / revenue % YoY).',
        '- fundamentalBasis ≤ 80 chars — Revenue/margin/ROE/PE values from above signals ONLY. PE 가 신호에 없으면 인용 금지(환각 방지).',
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

  // 2026-06-06: fundamentalBasis 결정론적 렌더 (ChatGPT 조언 — "숫자는 코드가, LLM은 문장만").
  //   sig.fin(실 재무) 있으면 LLM 출력 대신 코드가 직접 렌더 → 매출/마진/ROE/PE 환각 구조적 차단
  //   (GOOGL "35%" 같은 단일 환각도 막힘). fin 없으면 LLM/strip 값 유지.
  {
    const isKrT = (t) => /\.(KS|KQ)$/.test(t || '');
    const renderFB = (fin, kr) => {
      if (!fin) return null;
      const parts = [];
      if (fin.yoy) parts.push(`매출 ${String(fin.yoy).replace(/^\+?/, '')} YoY`);
      if (fin.margin) parts.push(`영업이익률 ${fin.margin}%`);
      if (fin.roe) parts.push(`ROE ${fin.roe}%`);
      if (fin.pe && !kr) parts.push(`PE ${fin.pe}x`);  // KR 은 DART EPS 부재로 PE 인용 금지
      return parts.length ? `${fin.label ?? '최근 실적'}: ${parts.join(' · ')}` : null;
    };
    let grounded = 0;
    for (const p of mergedPortfolio) {
      const fin = signalDigest.get(p.ticker)?.fin;
      const rendered = renderFB(fin, isKrT(p.ticker));
      if (rendered && rendered !== p.fundamentalBasis) { p.fundamentalBasis = rendered; grounded++; }
    }
    if (grounded) console.log(`  [fundamentalBasis/deterministic] 실재무 기반 렌더 ${grounded}건 (LLM 숫자 환각 차단)`);
  }

  // 2026-06-06: catalysts 결정론적 grounding (ChatGPT D1 — "숫자는 코드가, LLM은 문장만").
  //   숫자 포함 catalyst 는 sig(실 insider/squeeze/fin)에서 코드가 직접 생성. LLM catalyst 는
  //   *숫자 없는 정성적 이벤트*만 보충. → "insider 12.3%" copy-paste·"매출 35%" 환각 원천 차단.
  {
    const hasNum = (s) => /\d+\.?\d*\s*%|\d+\s*배|\$\s*\d|₩\s*\d|\d+\.?\d*x\b/.test(String(s || ''));
    const detCatalysts = (sig) => {
      if (!sig) return [];
      const out = [];
      const fin = sig.fin;
      if (fin?.yoy) { const y = parseFloat(String(fin.yoy).replace(/[^\d.-]/g, '')); if (Number.isFinite(y) && Math.abs(y) >= 5) out.push(`매출 ${String(fin.yoy).replace(/^\+?/, '')} YoY ${y >= 0 ? '성장' : '감소'}`); }
      if (sig.insider?.buys >= 2) out.push(`내부자 매수 ${sig.insider.buys}건${sig.insider.totalUsd ? ` ($${Math.round(sig.insider.totalUsd / 1000)}K)` : ''}`);
      if (typeof sig.squeeze === 'number' && sig.squeeze >= 60) out.push(`공매도 스퀴즈 점수 ${sig.squeeze}`);
      return out;
    };
    let cg = 0;
    for (const p of mergedPortfolio) {
      const sig = signalDigest.get(p.ticker);
      const det = detCatalysts(sig);
      if (!det.length) continue; // sig 데이터 없으면 기존 유지
      // LLM catalyst 중 숫자 없는 정성적 항목만 보충
      const qualitative = (Array.isArray(p.catalysts) ? p.catalysts : []).filter(c => !hasNum(c));
      const merged = [...det, ...qualitative].slice(0, 3);
      if (JSON.stringify(merged) !== JSON.stringify(p.catalysts)) { p.catalysts = merged; cg++; }
    }
    if (cg) console.log(`  [catalysts/deterministic] 숫자 catalyst 코드생성 + 정성 LLM 보충 ${cg}건`);
  }

  // 2026-06-06: whitelist validator 는 발간 직전 최종 게이트로 이동(아래 writeFileSync 前) — enforceRotation/
  //   pool-fill 이 추가한 종목까지 커버. 여기(중간)서 돌리면 rotation 종목 우회(name-gate/IV 와 동일 패턴).

  let dedupedPortfolio = dedupCrossTickerCatalysts(mergedPortfolio);
  // 2026-05-29: price_at_gen=null (livePrices 못 받은 ticker) 제외 — NE 확정 차단.
  //   원인: 환각 ticker (예: 056100.KS) / 데이터 source 갱신 누락 → 가격 미수신.
  //   entry zone / target / stop 모두 환각 위험. NVDA-class 환각도 validateEntryZones 가 잡지만,
  //   가격 자체가 없으면 calibration 못함.
  {
    const before = dedupedPortfolio.length;
    dedupedPortfolio = dedupedPortfolio.filter(p => {
      const pd = livePrices.get(p.ticker);
      if (pd?.price && Number.isFinite(pd.price) && pd.price > 0) return true;
      console.warn(`  [no-price] ❌ ${p.ticker} reject — livePrices 미수신 (NE 확정 차단)`);
      return false;
    });
    if (before !== dedupedPortfolio.length) console.log(`  [no-price] ${before} → ${dedupedPortfolio.length} (${before - dedupedPortfolio.length} 제거)`);
  }
  let reconciliationLog = null; // 매수↔매도 경합심사 결과 (보고서 JSON + trail 에 보존)
  // 2026-06-05: 매수↔매도 경합심사 게이트 (사용자 "양측 경합심사 기준") — 발간 前 매수 후보를 *매도룰
  //   전체*로 cross-examine. 종목 고유 악화 신호(기본/기술/구루 카테고리)가 임계 score 이상이면
  //   "매도 대상이 매수에 오른 모순"으로 보고 매수 탈락 → 두 엔진 합의. (기아 op margin -3.8%p "사라/팔라").
  //   held-position 룰(가격/회전, ctx.stop/pnl/heldDays 필요)은 fresh buy 에 자연 미발동(포지션관리지 종목불량 아님).
  //   기준(VETO_SCORE=7): 단일 강신호(dead_cross 9·200ma_breach 9·rsi_overbought 7·margin_decline 7)는
  //   solo veto, 약신호(lynch 6·pe_expansion 5)는 누적 ≥7 시 veto. cap 前이라 탈락 슬롯 backfill.
  try {
    // 2026-06-14: 양면 등급제 심판 (사용자 "심판 엔진 논리 빈약"). 일방향 veto(매도score≥7 단일컷) →
    //   ① 매수확신(stage1Score) vs 매도확신을 net 으로 저울질(강한 매수는 soft 매도신호 상쇄)
    //   ② micro 카테고리(옵션 풋편중·부정뉴스) 편입 — 종전 fund/tech/guru 3개만 봐 내부자/수급 사각
    //   ③ 신호크기 가중(RSI 과열도·PE 프리미엄·마진하락폭) ④ 등급제: hard/high→탈락,
    //      mid→감점보류(보유+확신강등+비중축소+경고노트), 약→통과. macro 국면 위험 시 임계 하향(엄격).
    const VETO_CATS = new Set(['fundamental', 'technical', 'guru', 'micro']);
    const vetoRules = (loadSellRules()?.rules ?? []).filter(r => VETO_CATS.has(r.category));
    // hard-sell: 매수확신 무관 즉시 탈락(리스크관리 우선). 나머지 soft 는 매수확신으로 상쇄 가능.
    const HARD_IDS = new Set(['price_stop_breach', 'tech_dead_cross', 'tech_200ma_breach', 'fund_margin_decline', 'micro_insider_selling', 'micro_supply_contract_loss']);
    const sellSig = await fetchSellSignals(dedupedPortfolio.map(p => p.ticker));
    const buyScoreOf = new Map((buyCandidates ?? []).map(c => [c.ticker, c.stage1Score ?? 0]));
    // 신호크기 가중: 정의 명확한 신호만 magnitude bump(최대 +3). 과추정 방지 위해 보수적.
    const weightedScore = (rule, ex) => {
      let s = rule.score ?? 0;
      const t = rule.condition?.type;
      if (t === 'rsiOverbought' && ex.rsi != null) s += Math.min(3, Math.max(0, (ex.rsi - 75) / 5));
      else if (t === 'peVsSector' && ex.peRatio && ex.sectorPe) s += Math.min(3, Math.max(0, ((ex.peRatio / ex.sectorPe - 1) * 100 - 30) / 20));
      else if (t === 'opMarginDecline' && ex.opMarginDecline != null) s += Math.min(3, Math.max(0, (ex.opMarginDecline - 2) / 2));
      return s;
    };
    // 거시 국면 modifier — 위험 regime 일수록 심판 엄격(임계 하향). earlyWarning 은 이 시점 미산출 →
    //   Wave1 macroData.riskLevel 사용(가용). high → 임계 −1.
    const macroTighten = macroData?.riskLevel === 'high' ? 1 : 0;
    const HIGH = 7 - macroTighten, MID = 4 - macroTighten, VETO_SCORE = HIGH;  // VETO_SCORE: refill 호환 alias
    const before = dedupedPortfolio.length;
    // 합의 과정 trail (reports/reconciliation/) — veto/감점/통과 + net 점수 보존(연구용).
    const adjudication = { ts: new Date().toISOString(), session, thresholds: { HIGH, MID, macroTighten }, candidates: [], downgraded: [] };
    dedupedPortfolio = dedupedPortfolio.filter(p => {
      const sig = sellSig.get(p.ticker) ?? {};
      if (sig.rsi != null) p._realRsi = sig.rsi;  // technicalBasis RSI 라벨 grounding 용 (발간직전 삭제)
      // 2026-06-14 (ChatGPT D0-7/D1 차용): 게이트 exCtx 를 sell 후보와 동일한 rich macroCtx 로 정합.
      //   기존엔 buyMacroCtx 의 옵션/뉴스만 봐 micro_insider_selling(hard)·micro_13f_distribution·계약해지·
      //   sector/region stance 가 게이트에서 silent 미발화. macroCtx 는 insider{buys,sells}/inst13f/
      //   contractMap/sector·regionStanceMap 보유 → 내부자매도가 실제 hard-veto 로 작동.
      const news = macroCtx.newsSentimentMap?.get(p.ticker);
      const ins = macroCtx.insider?.get(p.ticker);
      const i13f = macroCtx.inst13f?.get(p.ticker);
      const isKRt = /\.(KS|KQ)$/.test(p.ticker);
      const sectorKey = String(p.sector ?? '').toLowerCase();
      const exCtx = {
        price: livePrices.get(p.ticker)?.price ?? null, market: isKRt ? 'kr' : 'us', sector: p.sector ?? null,
        rsi: sig.rsi, sma50: sig.sma50, sma200: sig.sma200, volPct: sig.volPct,
        opMarginDecline: sig.opMarginDecline, peRatio: sig.peRatio, peg: sig.peg, revenueYoY: sig.revenueYoY,
        sectorPe: macroCtx.sectorPeMap?.get(sectorKey) ?? sectorPeMap.get(sectorKey) ?? null,
        macroRiskLevel: macroData?.riskLevel ?? null, vix: macroCtx.vix, fgScore: macroCtx.fgScore,
        optionsCallPrem: macroCtx.uoaMap?.get(p.ticker)?.callPrem ?? 0, optionsPutPrem: macroCtx.uoaMap?.get(p.ticker)?.putPrem ?? 0,
        newsNegRatio: news?.negRatio ?? null, newsArticleCount: news?.count ?? 0,
        insiderSells: ins?.sells ?? null, insiderBuys: ins?.buys ?? null,
        insiderSellToBuyRatio: ins ? (ins.sells / Math.max(ins.buys, 1)) : null,
        instReducers: i13f?.reducers ?? null, instAdders: i13f?.adders ?? null, instNetShares: i13f?.netShares ?? null,
        contractLoss: macroCtx.contractMap?.get(p.ticker)?.type === 'contract_loss' ? macroCtx.contractMap.get(p.ticker) : null,
        sectorStance: macroCtx.sectorStanceMap?.get(sectorKey) ?? null,
        regionStance: macroCtx.regionStanceMap?.get(isKRt ? 'kr' : 'us') ?? null,
      };
      const hits = [];
      for (const rule of vetoRules) {
        const reason = evaluateSellRule(rule, exCtx);
        if (reason) hits.push({ id: rule.id, category: rule.category, score: +weightedScore(rule, exCtx).toFixed(1), hard: HARD_IDS.has(rule.id), reason });
      }
      const buyConviction = buyScoreOf.get(p.ticker) ?? 20;
      const buyDiscount = Math.max(0, Math.min(4, (buyConviction - 25) / 5));        // 강한 매수일수록 soft 매도 상쇄
      const hardHit = hits.find(h => h.hard);
      const softScore = hits.filter(h => !h.hard).reduce((s, h) => s + h.score, 0);
      const netSoft = +(softScore - buyDiscount).toFixed(1);
      const tier = hardHit ? 'veto' : netSoft >= HIGH ? 'veto' : netSoft >= MID ? 'downgrade' : 'pass';
      adjudication.candidates.push({
        ticker: p.ticker, sector: p.sector ?? null, buyConviction, buyDiscount: +buyDiscount.toFixed(1),
        softScore: +softScore.toFixed(1), netSoft, hardHit: hardHit?.id ?? null, tier,
        signals: { rsi: sig.rsi, sma50: sig.sma50, sma200: sig.sma200, opMarginDecline: sig.opMarginDecline, peRatio: sig.peRatio, peg: sig.peg, revenueYoY: sig.revenueYoY, price: exCtx.price, putPrem: exCtx.optionsPutPrem, newsNegRatio: exCtx.newsNegRatio },
        hits,
      });
      if (tier === 'veto') {
        console.warn(`  [심판] ${p.ticker} 탈락 (${hardHit ? `hard:${hardHit.id}` : `netSoft ${netSoft}≥${HIGH} 매수확신${buyConviction}`}): ${hits.map(h => h.id).join(',')}`);
        return false;
      }
      if (tier === 'downgrade') {
        const downConf = p.confidence === 'high' ? 'medium' : 'low';
        const tags = hits.map(h => h.id.replace(/^[a-z]+_/, '')).join('·');
        const caution = `⚠️ 경합심사 감점(매도신호 ${tags}, netSoft ${netSoft}) — 비중 축소·확신 강등`;
        p.confidence = downConf;
        p.allocation = Math.max(3, Math.round((p.allocation ?? 8) * 0.6));
        p.riskNote = p.riskNote ? `${caution}. ${p.riskNote}` : caution;
        p.adjudicationTier = 'downgrade';
        adjudication.downgraded.push({ ticker: p.ticker, netSoft, hits: hits.map(h => h.id) });
        console.log(`  [심판] ${p.ticker} 감점보류 (netSoft ${netSoft}∈[${MID},${HIGH}) 매수확신${buyConviction} → 비중↓·확신→${downConf}): ${hits.map(h => h.id).join(',')}`);
        return true;
      }
      if (hits.length) console.log(`  [심판] ${p.ticker} 통과 (netSoft ${netSoft}<${MID} 매수확신${buyConviction} 우위): ${hits.map(h => h.id).join(',')}`);
      return true;
    });
    adjudication.sellSide = sellSideReview;  // 양방향: 매도 후보의 매수신호 상충 기록
    adjudication.summary = { evaluated: before, passed: dedupedPortfolio.length, vetoed: before - dedupedPortfolio.length, downgraded: adjudication.downgraded.length, sellConflicts: sellSideReview.length };
    if (before !== dedupedPortfolio.length || adjudication.downgraded.length) console.log(`  [심판] 매수 ${before}→${dedupedPortfolio.length} (탈락 ${before - dedupedPortfolio.length}, 감점보류 ${adjudication.downgraded.length})`);

    // 2026-06-12: 탈락 시장 재충원 (사용자 "kr종목이 없네 의도적인가?" — 17:33 발간 실측: 탈락 6종
    //   전원 KR(RSI 과열) → KR 0 발간). 탈락 자체는 정당하나 차순위 재심 없이 시장 전체가 침묵 소실되는
    //   건 구조 공백(종전 6218 주석의 "backfill"은 미구현이었음). 룰 점수 차순위 buyCandidates 를
    //   같은 veto 게이트로 재심해 시장별 최소 2석 충원. 전원 저촉 시 명시 노트(침묵 금지).
    const MIN_PER_MARKET = 2;
    const isKRt = (t) => /\.(KS|KQ)$/.test(t ?? '');
    for (const mkt of ['kr', 'us']) {
      const want = mkt === 'kr';
      const inMkt = dedupedPortfolio.filter(p => isKRt(p.ticker) === want).length;
      const hadCands = adjudication.candidates.some(c => isKRt(c.ticker) === want);
      if (inMkt >= MIN_PER_MARKET || !hadCands) continue;
      const have = new Set(dedupedPortfolio.map(p => p.ticker));
      const tried = new Set(adjudication.candidates.map(c => c.ticker));
      const pool = (buyCandidates ?? []).filter(c => isKRt(c.ticker) === want && !have.has(c.ticker) && !tried.has(c.ticker) && livePrices.get(c.ticker)?.price).slice(0, 8);
      if (!pool.length) continue;
      const refillSig = await fetchSellSignals(pool.map(c => c.ticker));
      let added = 0;
      for (const cand of pool) {
        if (inMkt + added >= MIN_PER_MARKET) break;
        const sig = refillSig.get(cand.ticker) ?? {};
        const exCtx = {
          price: livePrices.get(cand.ticker)?.price ?? null,
          rsi: sig.rsi, sma50: sig.sma50, sma200: sig.sma200, volPct: sig.volPct,
          opMarginDecline: sig.opMarginDecline, peRatio: sig.peRatio, peg: sig.peg, revenueYoY: sig.revenueYoY,
          sectorPe: sectorPeMap.get(String(cand.sector ?? '').toLowerCase()) ?? null,
          macroRiskLevel: macroData?.riskLevel ?? null,
        };
        const hits = [];
        for (const rule of vetoRules) { const reason = evaluateSellRule(rule, exCtx); if (reason) hits.push({ id: rule.id, category: rule.category, score: rule.score ?? 0, reason }); }
        const total = hits.reduce((s, h) => s + h.score, 0);
        adjudication.candidates.push({ ticker: cand.ticker, sector: cand.sector ?? null, sellScore: total, verdict: total >= VETO_SCORE ? 'refill-veto' : 'refill-pass', hits, refill: true });
        if (total >= VETO_SCORE) { console.log(`  [경합심사/재충원] ${cand.ticker} 재심 탈락 (score ${total})`); continue; }
        const actual = livePrices.get(cand.ticker).price;
        const fmt = (n) => want ? `₩${Math.round(n).toLocaleString()}` : `$${n.toFixed(2)}`;
        dedupedPortfolio.push({
          ticker: cand.ticker, name: cand.ticker,
          sector: CANDIDATE_META[cand.ticker]?.sector ?? cand.sector ?? 'Unknown',
          market: want ? 'korea' : 'us',
          rationale: `룰 점수 상위 차순위 재충원 — 상위 후보들이 과열/매도신호로 탈락한 자리, 매도룰 재심 통과(score ${total}<${VETO_SCORE})`,
          allocation: 8,
          entryZone: `${fmt(actual * 0.98)}-${fmt(actual * 1.01)}`,
          entryRationale: '시장가 -2%~+1% 진입 (재충원 신규)',
          stopLoss: fmt(actual * 0.93),
          target: fmt(actual * 1.10),
          targetBull: fmt(actual * 1.20),
          targetRationale: '시장가 +10% 보수적 target',
          confidence: 'medium',
          action: 'buy',
          catalysts: [`룰 기반 점수 ${cand.stage1Score ?? '?'}점 차순위 후보`, `시장가 ${fmt(actual)} 신규 편입 (추가 검증 후 진입 권장)`],
          fundamentalBasis: '재충원 신규 — 펀더멘털 상세는 종목 페이지 참조',
          technicalBasis: `진입 ${fmt(actual)} · 손절 -7% · 1차 목표 +10%`,
          riskNote: '상위 후보 과열 탈락 후 차순위 편입 — 추가 검증 후 진입 권장',
        });
        added++;
        console.log(`  [경합심사/재충원] ${cand.ticker} 편입 (${mkt} ${inMkt}+${added}석, 재심 score ${total})`);
      }
      if (inMkt + added === 0) {
        adjudication.summary[`${mkt}Note`] = `${mkt.toUpperCase()} 전 후보가 매도룰 저촉(과열 등) — 이번 세션 ${mkt.toUpperCase()} 매수 추천 의도적 공석`;
        console.log(`  [경합심사/재충원] ${mkt} 후보 전원 재심 탈락 — 명시적 공석 처리`);
      }
    }
    // trail 영속화 (연구용)
    try {
      const reconDir = resolve(REPORTS_DIR, 'reconciliation');
      if (!existsSync(reconDir)) mkdirSync(reconDir, { recursive: true });
      const tsSafe = adjudication.ts.replace(/[:.]/g, '-');
      writeFileSync(resolve(reconDir, `reconcile-${tsSafe}.json`), JSON.stringify(adjudication, null, 2));
      console.log(`  [경합심사] trail 저장 → reports/reconciliation/reconcile-${tsSafe}.json (${adjudication.candidates.length} 후보)`);
    } catch (e) { console.warn(`  [경합심사] trail 저장 실패: ${e.message}`); }
    // 보고서 JSON 에도 요약 첨부(연구·UI 노출용)
    reconciliationLog = adjudication;
  } catch (e) { console.warn(`  [경합심사] skip: ${e.message}`); }

  // 2026-05-29: KR cap 6 강제 — buildPortfolio LLM 이 KR 11+ 출력하는 경우 차단.
  //   US 6 + KR 6 = 12 portfolio 가 목표. KR 종목수 cap 안 하면 비중 분산 + UI 표시 무너짐.
  {
    const us = dedupedPortfolio.filter(p => !p.ticker?.endsWith('.KS') && !p.ticker?.endsWith('.KQ'));
    const kr = dedupedPortfolio.filter(p => p.ticker?.endsWith('.KS') || p.ticker?.endsWith('.KQ'));
    const krCap = kr.slice(0, 6);
    const usCap = us.slice(0, 6);
    if (kr.length > 6 || us.length > 6) {
      console.log(`  [market-cap] US ${us.length}→${usCap.length}, KR ${kr.length}→${krCap.length} (cap 6 적용)`);
    }
    dedupedPortfolio = [...usCap, ...krCap];
  }
  // 2026-06-05: 최종 권위 name 게이트 (모든 진입 경로 커버) — applyLocalHarness 6f 는 LLM r.portfolio 에만
  //   적용돼, 룰 기반 buy-candidate 펀넬로 들어온 종목(name=ticker)이 우회했음(DOC="DOC" 사건, 정답
  //   "Healthpeak Properties, Inc."가 company-names.json 에 있었는데도 미적용). 발간 직전 전수 재보정.
  {
    const nameFixes = [];
    for (const p of dedupedPortfolio) {
      const tk = p.ticker?.toUpperCase();
      if (!tk) continue;
      const auth = US_NAME_LOOKUP[tk] ?? KR_NAMES_HARNESS[tk];                       // 권위 맵 우선
      const expected = auth ?? (((!p.name || p.name === p.ticker) && CANDIDATE_META[tk]?.name) || null); // 없으면 meta(name=ticker 일 때만)
      if (expected && p.name !== expected) { nameFixes.push(`${p.ticker}:"${p.name}"→"${expected}"`); p.name = expected; }
    }
    if (nameFixes.length) console.log(`  [name-gate] 권위 회사명 재보정 ${nameFixes.length}: ${nameFixes.slice(0, 8).join(', ')}`);
  }
  // 2026-06-05: PE prose 중복(=copy-paste 환각) strip — verify-report [6] 와 동일 기준. 동일 PE 값이
  //   서로 다른 2+종목 fundamentalBasis 에 박히면 환각 확정 → 실제 PE 모르므로 제거(strip-when-uncertain).
  {
    const peRe = /PE\s*([\d.]+)x?/i;
    const counts = {};
    for (const p of dedupedPortfolio) { const m = (p.fundamentalBasis || '').match(peRe); if (m) counts[m[1]] = (counts[m[1]] || 0) + 1; }
    const dup = new Set(Object.entries(counts).filter(([, c]) => c >= 2).map(([v]) => v));
    if (dup.size) {
      let stripped = 0;
      for (const p of dedupedPortfolio) {
        const m = (p.fundamentalBasis || '').match(peRe);
        if (m && dup.has(m[1])) { p.fundamentalBasis = p.fundamentalBasis.replace(/[,，·]?\s*PE\s*[\d.]+x?/i, '').replace(/\s{2,}/g, ' ').trim(); stripped++; }
      }
      if (stripped) console.log(`  [pe-prose] 중복 PE(환각) strip ${stripped}건: 값 ${[...dup].join(',')}`);
    }
  }
  // 2026-06-06: 발간 前 copy-paste 환각 strip (사용자 "하네스가 왜 못 잡나"). verify-report [6b] 는
  //   POST-발간 감지였음 → PRE-발간 strip 으로 이동. 소수%(정수%는 우연중복 흔함)가 2+종목 공유 시
  //   fundamentalBasis+catalysts 에서 해당 clause 제거(strip-when-uncertain). 인사이더 12.3% 4종목 등.
  {
    const pctRe = /(\d+\.\d+)%/g;
    const counts = {};
    for (const p of dedupedPortfolio) {
      const text = (p.fundamentalBasis || '') + ' ' + (Array.isArray(p.catalysts) ? p.catalysts.join(' ') : '');
      for (const v of new Set([...text.matchAll(pctRe)].map(m => m[1]))) if (parseFloat(v) >= 1) counts[v] = (counts[v] || 0) + 1;
    }
    const dup = new Set(Object.entries(counts).filter(([, c]) => c >= 2).map(([v]) => v));
    if (dup.size) {
      let stripped = 0;
      const stripDup = (text) => {
        let t = text;
        for (const v of dup) t = t.replace(new RegExp(`[^,，·|/]*${v.replace('.', '\\.')}%[^,，·|/]*`, 'g'), '');
        return t.replace(/\s*[,，·|]\s*[,，·|]\s*/g, ', ').replace(/^[\s,，·|]+|[\s,，·|]+$/g, '').replace(/\s{2,}/g, ' ');
      };
      for (const p of dedupedPortfolio) {
        const sig = (p.fundamentalBasis || '') + '|' + (Array.isArray(p.catalysts) ? p.catalysts.join('|') : '');
        if (p.fundamentalBasis) p.fundamentalBasis = stripDup(p.fundamentalBasis);
        if (Array.isArray(p.catalysts)) p.catalysts = p.catalysts.map(stripDup).filter(c => c && c.length > 4);
        if (((p.fundamentalBasis || '') + '|' + (Array.isArray(p.catalysts) ? p.catalysts.join('|') : '')) !== sig) stripped++;
      }
      if (stripped) console.log(`  [dup-pct] 종목간 중복 %수치(환각) strip ${stripped}종목: 값 ${[...dup].join(',')}`);
    }
  }
  // 2026-06-06: 매출 YoY grounding (사용자 GOOGL 35% vs 실제 21.8% 사건). "매출/revenue N%" 가
  //   signalDigest 실 fin.yoy 와 >7%p 이탈 시 실값으로 교정(권위 grounding). "수익"(이익/매출 모호)·
  //   "마진" 은 제외해 오교정 방지. fin.yoy 있는 종목만.
  {
    let grounded = 0;
    for (const p of dedupedPortfolio) {
      const real = parseFloat(signalDigest.get(p.ticker)?.fin?.yoy ?? '');
      if (!Number.isFinite(real) || !p.fundamentalBasis) continue;
      // 2026-06-06 fix: 분리자 그룹 [^%]{0,4} 가 greedy 라 숫자 앞부분(" 16.")까지 삼켜 group3 가
      //   "6" 만 매칭→parseFloat 6 이 real 16.6 과 >7 이탈→오교정 prepend "16.16.6%". 분리자에서
      //   숫자·부호 제외([^%\d]) 해 숫자 침범 차단.
      p.fundamentalBasis = p.fundamentalBasis.replace(/(매출|revenue)([^%\d]{0,4})([+-]?\d+\.?\d*)%/gi, (m, lbl, mid, num) => {
        if (Math.abs(parseFloat(num) - real) > 7) { grounded++; return `${lbl}${mid}${real}%`; }
        return m;
      });
    }
    if (grounded) console.log(`  [rev-ground] 매출 YoY 실값 교정 ${grounded}건 (signalDigest fin.yoy 기준)`);
  }
  // 2026-06-06: technicalBasis RSI 라벨 grounding (사용자 "각기업 내용 틀린거 없어" + "숫자는 코드가").
  //   LLM 이 technicalBasis 에 "RSI: Overbought" 를 RSI 실값(59/48=중립) 무시하고 환각(매 보고서 4종목
  //   동일 copy-paste). verify probe[7]은 "RSI N+과매수" 모순만 잡고 숫자없는 "Overbought" 는 통과.
  //   실 RSI(p._realRsi=계산값, 없으면 텍스트 "RSI N" 파싱)로 라벨 결정론적 교정: ≥70 과매수, ≤30 과매도, else 중립.
  {
    let tbg = 0;
    for (const p of dedupedPortfolio) {
      if (typeof p.technicalBasis !== 'string' || !/overbought|oversold|과매수|과매도/i.test(p.technicalBasis)) continue;
      let rsi = (typeof p._realRsi === 'number') ? p._realRsi : null;
      if (rsi == null) { const m = `${p.technicalBasis} ${p.entryRationale || ''} ${p.rationale || ''}`.match(/RSI[:\s]*([0-9]{1,3})/i); if (m) rsi = +m[1]; }
      const en = rsi == null ? 'Neutral' : rsi >= 70 ? 'Overbought' : rsi <= 30 ? 'Oversold' : 'Neutral';
      const ko = en === 'Overbought' ? '과매수' : en === 'Oversold' ? '과매도' : '중립';
      const before = p.technicalBasis;
      p.technicalBasis = p.technicalBasis.replace(/Overbought|Oversold/gi, en).replace(/과매수|과매도/g, ko);
      if (p.technicalBasis !== before) tbg++;
    }
    for (const p of dedupedPortfolio) delete p._realRsi;
    if (tbg) console.log(`  [tech-ground] technicalBasis RSI 라벨 실값 교정 ${tbg}건 (≥70 과매수/≤30 과매도/else 중립)`);
  }
  // 2026-06-07: 주력 매출상품/사업개요 주입 (사용자 "뭐로 매출 내는지 보고서에 적어줘").
  //   company-business.json(큐레이션 products+desc) 1차. 2026-06-14: 미커버 종목(KR 대부분/US 폴백)은
  //   company-profiles.json(Yahoo summary) 로 보강 — businessDesc 공백 방지(사용자 "주력 사업 왜 비어/안나와").
  {
    let biz = 0, fromProfile = 0;
    for (const p of dedupedPortfolio) {
      const key = String(p.ticker || '').replace(/\.(KS|KQ)$/, '');
      const b = COMPANY_BUSINESS_JSON[p.ticker] || COMPANY_BUSINESS_JSON[key];
      const prof = COMPANY_PROFILES_JSON[p.ticker] || COMPANY_PROFILES_JSON[key];
      if (b && (b.products || b.desc)) {
        p.businessSummary = b.products || '';
        p.businessDesc = b.desc || (prof?.summary ? String(prof.summary).split(/(?<=[.。])\s/).slice(0, 2).join(' ').slice(0, 240) : '');
        biz++;
      } else if (prof?.summary) {
        // 큐레이션 미수록 → Yahoo 사업개요 첫 2문장(영문 — ReportPage <T> 가 로케일 번역).
        p.businessDesc = String(prof.summary).split(/(?<=[.。])\s/).slice(0, 2).join(' ').slice(0, 240);
        if (prof.industry) p.businessSummary = String(prof.industry); // 주력 라벨에 업종 표기
        fromProfile++;
      }
    }
    console.log(`  [business] 주력 매출상품 주입: 큐레이션 ${biz} + 프로필 ${fromProfile} = ${biz + fromProfile}/${dedupedPortfolio.length}`);
  }
  // 2026-06-04: 종목별 내재변동성(IV) 주입 (사용자 요청) — US 옵션 IV(atmIv30d). KR 은 옵션 IV 미제공 → null.
  await Promise.all(dedupedPortfolio.map(async (p) => {
    if (!p.ticker || /\.(KS|KQ)$/.test(p.ticker)) { p.impliedVol = null; return; }
    try {
      const iv = await safeFetch(`${SITE}/api/iv/${encodeURIComponent(p.ticker)}`, 8000);
      p.impliedVol = (iv && typeof iv.atmIv30d === 'number') ? Math.round(iv.atmIv30d * 1000) / 10 : null; // %, 1자리
      p.ivSkew = (iv && typeof iv.skew25d === 'number') ? Math.round(iv.skew25d * 1000) / 10 : null;
    } catch { p.impliedVol = null; }
  }));
  console.log(`  [IV] 내재변동성 주입: ${dedupedPortfolio.filter(p => p.impliedVol != null).length}/${dedupedPortfolio.length} (US 옵션 IV)`);
  // Quality pre-flight
  {
    const { ok: qOk, issues: qIssues, warnings: qWarnings, score: qScore } = qualityCheck({ ...{}, portfolio: dedupedPortfolio, regionStances: regionalData?.regionStances ?? {}, shortSqueeze: opportunityData?.shortSqueeze ?? [], marketNarrative: narrativeData ?? {}, thesis: macroData?.thesis ?? '', macroAnalysis: macroData?.macroAnalysis ?? '', technicalAnalysis: macroData?.technicalAnalysis ?? '' });
    console.log(`  [quality pre-flight] score=${qScore}/100, issues=${qIssues.length}, warnings=${qWarnings?.length ?? 0}`);
    for (const w of qWarnings ?? []) console.warn(`    WARN: ${w}`);
    for (const e of qIssues) console.error(`    ERROR: ${e}`);
  }

  const now = new Date().toISOString();
  // 2026-05-30: sectorAllocation fallback — qwen3:8b 가 portfolio 후 sectorAllocation 잊고 종료 빈번.
  // portfolio 의 sector + allocation 합산으로 자동 생성 (LLM 응답에 sectorAllocation 있으면 우선).
  const sectorAllocationFallback = (() => {
    if (Array.isArray(portfolioData.sectorAllocation) && portfolioData.sectorAllocation.length > 0) {
      return portfolioData.sectorAllocation;
    }
    const byCat = new Map();
    for (const p of dedupedPortfolio) {
      const key = (p.sector ?? 'Unknown').trim();
      byCat.set(key, (byCat.get(key) ?? 0) + (p.allocation ?? 0));
    }
    const rows = [...byCat.entries()]
      .map(([sector, pct]) => ({ sector, pct: Math.round(pct), stance: pct >= 25 ? 'overweight' : pct >= 12 ? 'neutral' : 'underweight', reason: `portfolio ${pct.toFixed(0)}% 노출` }))
      .sort((a, b) => b.pct - a.pct);
    console.log(`  [sectorAllocation/fallback] LLM 누락 → portfolio.sector 합산 ${rows.length}건 자동 생성`);
    return rows;
  })();
  // 2026-06-12: stance 결정론 게이트 — 6/5~6/10 급락(NASDAQ -7%/KOSPI -12%) 동안 LLM stance 가
  //   bullish 관성 유지("왜 예측 못했어" 사건). 경보가 높으면 LLM 의견과 무관하게 cap:
  //   elevated → bullish 금지(neutral) · high → neutral cap + risk high · severe → bearish + high.
  let prevFgScore = null;
  try { prevFgScore = getPreviousFearGreedScore(); } catch { /* DB 미가용 시 변화율 입력만 생략 */ }
  const earlyWarning = computeMacroEarlyWarning(ctxRaw, ctxRaw?.fx ?? {}, { prevFgScore });
  const reboundWatch = computeReboundWatch(ctxRaw);
  if (reboundWatch.level === 'watch') console.log(`  [rebound-watch] 반등관찰: ${reboundWatch.drivers.join(' | ')}`);
  // 2026-06-12: 종합 판정 (하락전조+상승전조+공포매수+과거 유사국면 → 관망/매수/중립 결정)
  const analogData = await computeHistoricalAnalog(ctxRaw);
  const fearBuySig = computeFearBuy(ctxRaw, analogData);
  const marketVerdict = computeMarketVerdict(earlyWarning, reboundWatch, fearBuySig, analogData, ctxRaw);
  console.log(`  [verdict] ${marketVerdict.verdict} — ${marketVerdict.reasons[0] ?? ''}${analogData?.matches ? ` (유사국면 ${analogData.matches}회, 3m 중앙값 ${analogData.med3m}%)` : ''}`);
  let gatedStance = portfolioData.stance ?? 'neutral';
  let gatedRiskLevel = macroData?.riskLevel ?? 'medium';
  if (earlyWarning.level === 'severe') {
    if (gatedStance !== 'bearish' || gatedRiskLevel !== 'high') console.log(`  [stance-gate] earlyWarning severe(${earlyWarning.score}) → stance ${gatedStance}→bearish, risk ${gatedRiskLevel}→high`);
    gatedStance = 'bearish'; gatedRiskLevel = 'high';
  } else if (earlyWarning.level === 'high') {
    if (gatedStance === 'bullish') { console.log(`  [stance-gate] earlyWarning high(${earlyWarning.score}) → stance bullish→neutral`); gatedStance = 'neutral'; }
    if (gatedRiskLevel !== 'high') { console.log(`  [stance-gate] earlyWarning high(${earlyWarning.score}) → risk ${gatedRiskLevel}→high`); gatedRiskLevel = 'high'; }
  } else if (earlyWarning.level === 'elevated' && gatedStance === 'bullish') {
    console.log(`  [stance-gate] earlyWarning elevated(${earlyWarning.score}) → stance bullish→neutral`);
    gatedStance = 'neutral';
    if (gatedRiskLevel === 'low') gatedRiskLevel = 'medium';
  }
  const finalReport = {
    stance: gatedStance,
    thesis: macroData?.thesis ?? gatedStance,
    portfolio: dedupedPortfolio,
    buySellReconciliation: reconciliationLog,  // 매수↔매도 경합심사 요약 (연구·UI 노출용)
    earlyWarning,  // 거시 급락 조기경보 (결정론적 composite)
    reboundWatch,  // 과매도 반등 관찰 신호 (결정론, 매수 단정 아님 — 2026-06-12)
    marketVerdict, // 종합 판정: 전조+공포매수+과거 유사국면 → 관망/매수/중립 (결정론 — 2026-06-12)
    sectorAllocation: sectorAllocationFallback,
    riskEvents: macroData?.riskEvents ?? [],
    macroAnalysis: macroData?.macroAnalysis ?? '',
    technicalAnalysis: macroData?.technicalAnalysis ?? '',
    fundamentalAnalysis: macroData?.fundamentalAnalysis ?? '',
    riskLevel: gatedRiskLevel,
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
        // 2026-06-13: 계약 상세 (사용자 "여전히 내용 안나오네") — DART 본문 추출 금액·상대방·매출대비%.
        //   이전엔 headline(reportNm)만 실어 UI 가 "단일판매·공급계약체결" 만 표시. summary 는 영향도 문장.
        summary: s.summary ?? null,
        contractAmountWon: s.contractAmountWon ?? null,
        contractCounterparty: s.contractCounterparty ?? null,
        contractRevenuePct: s.contractRevenuePct ?? null,
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
  // 2026-06-04: ETF 전략 섹션 — 보고서의 sector/region/stance 에 grounded (환각 없음, 가격 라이브).
  try {
    finalReport.etfStrategy = await buildEtfStrategy({
      sectorAllocation: finalReport.sectorAllocation, regionStances: finalReport.regionStances,
      stance: finalReport.stance, riskLevel: finalReport.riskLevel, livePrices,
      capitalAssets: ctxRaw?.capital?.assets ?? [],
    });
    console.log(`  [ETF] ${finalReport.etfStrategy.length} 추천 (${finalReport.etfStrategy.map(e => e.ticker).join(',')})`);
    // 2026-06-06: ETF 경합심사 (사용자 "etf전략은 매수·매도 엔진이 상의하나?") — ETF 는 종전 stance 만
    //   보고 매도룰 cross-exam 을 안 거쳤음(개별주만 경합심사). ETF 매수 신호도 *기술적* 매도신호
    //   (dead cross·200MA 이탈·RSI 과매수)와 충돌하면 watch 로 강등. 펀더멘털 룰(opMargin/PE)은 ETF
    //   바스켓이라 N/A — 기술 카테고리만 적용. fetchSellSignals(개별주 경합심사와 동일 신호) 재사용.
    try {
      const buyEtfs = (finalReport.etfStrategy || []).filter(e => e.action === 'buy');
      if (buyEtfs.length) {
        const techRules = (loadSellRules()?.rules ?? []).filter(r => r.category === 'technical');
        const etfSig = await fetchSellSignals(buyEtfs.map(e => e.ticker));
        let dg = 0;
        for (const e of buyEtfs) {
          const sig = etfSig.get(e.ticker) ?? {};
          const ctx = { price: livePrices.get(e.ticker)?.price ?? null, rsi: sig.rsi, sma50: sig.sma50, sma200: sig.sma200, volPct: sig.volPct };
          const hit = techRules.map(r => evaluateSellRule(r, ctx)).filter(Boolean);
          if (hit.length) {
            e.action = 'watch';
            e.rationale = `${e.rationale} ⚖️ 기술적 매도신호(${hit[0]}) — 매수→관망 강등`;
            dg++;
          }
        }
        if (dg) console.log(`  [ETF 경합심사] 기술적 매도신호 충돌 ${dg}건 매수→관망`);
      }
    } catch (e) { console.warn('  [ETF 경합심사] skip:', e.message); }
  } catch (e) { finalReport.etfStrategy = []; console.warn('  [ETF] 실패:', e.message); }
  finalReport.companyChanges = fillCompanyChangesYoY(finalReport.companyChanges, signalDigest);
  finalReport.portfolio = enrichRationales(finalReport.portfolio, signalDigest, localeArg);
  finalReport.stopLossRationale = enrichStopLoss(finalReport.stopLossRationale, livePrices, technicalData, localeArg);

  // 2026-06-05: KR(.KS/.KQ) 은 DART 가 EPS 미제공 → PE grounded 불가. 8B 가 프롬프트 지시("KR PE 인용
  //   금지")를 무시하고 PE 환각(005930·000660 둘 다 "12.3") → 결정론적 strip(verify-report [6] 검출 +
  //   Karpathy 루프에 더한 방어심층화). PE/PER/P/E 토큰만 제거, ROE/매출 등 grounded 근거는 보존.
  {
    let krPeStripped = 0;
    for (const p of (finalReport.portfolio ?? [])) {
      if (!/\.(KS|KQ)$/.test(p.ticker ?? '')) continue;
      for (const f of ['fundamentalBasis', 'rationale']) {
        if (typeof p[f] !== 'string') continue;
        const before = p[f];
        p[f] = p[f]
          .replace(/[,;·]?\s*(?:P\/?E|PER)\s*[=:]?\s*\d+\.?\d*\s*(?:x|배|%)?/gi, '')
          .replace(/\s{2,}/g, ' ').replace(/^[\s,;·]+|[\s,;·]+$/g, '').trim();
        if (p[f] !== before) krPeStripped++;
      }
    }
    if (krPeStripped > 0) console.log(`  [후처리] KR PE 환각 strip ${krPeStripped}건 (DART EPS 부재 → grounded 불가)`);
  }

  // 2026-06-05: RSI/지지선 환각 결정론적 보정 — LLM 이 technicalBasis/entryRationale 에 실제와 다른
  //   RSI·"과매도"·지지가격을 환각(기아/포스코 잘못된 "과매도 눌림목 매수" 근거 → 손실) → COMPUTED_TECH
  //   (buildTechnicalData)의 실제 RSI/진입지지선으로 강제 교체. verify-report [7] 검출에 더한 발간-전 차단.
  {
    let techFix = 0;
    const parseNum = (s) => { const m = String(s).replace(/[,\s]/g, '').match(/(\d{3,})/); return m ? +m[1] : null; };
    // 2026-06-05: 2소스 RSI grounding (제일 정확) — 발간 시점에 price-history(어제 Yahoo 직접과 ±0 일치
    //   검증된 신뢰 소스)로 RSI 재계산해 검증값 확보. technicalData(buildTechnicalData)와 ±5 초과 불일치면
    //   technicalData 버그 신호로 log. price-history 없으면 strip(틀린 값보다 공백). KR/US 통일.
    const rsiFromCloses = (c) => { if (!c || c.length < 15) return null; let g = 0, l = 0; for (let i = c.length - 14; i < c.length; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; } const ag = g / 14, al = l / 14; return al === 0 ? 100 : Math.round(100 - 100 / (1 + ag / al)); };
    const verifiedRsi = new Map();
    await Promise.all((finalReport.portfolio ?? []).map(async p => {
      try {
        const h = await safeFetch(`${SITE}/api/price-history?ticker=${encodeURIComponent(p.ticker)}`, 6000);
        const r2 = rsiFromCloses((h?.points ?? []).map(x => x.close).filter(v => typeof v === 'number'));
        if (r2 != null) {
          verifiedRsi.set((p.ticker ?? '').toUpperCase(), r2);
          const t = technicalData.get(p.ticker) ?? technicalData.get((p.ticker ?? '').toUpperCase());
          const r1 = String(t ?? '').match(/RSI\s*(\d+)/i)?.[1];
          if (r1 && Math.abs(+r1 - r2) > 5) console.warn(`  [rsi-2source] ${p.ticker} technicalData RSI ${r1} ≠ price-history ${r2} — technicalData 의심, price-history 채택`);
        }
      } catch { /* price-history 실패 → verifiedRsi 미설정 → strip */ }
    }));
    for (const p of (finalReport.portfolio ?? [])) {
      const realRsi = verifiedRsi.get((p.ticker ?? '').toUpperCase()) ?? null;   // 2소스 검증값(없으면 strip)
      const ezLow = parseNum((p.entryZone ?? '').split(/[-~]/)[0]);
      for (const f of ['technicalBasis', 'entryRationale', 'rationale']) {
        if (typeof p[f] !== 'string') continue;
        const before = p[f];
        let v = p[f];
        if (realRsi != null) {
          v = v.replace(/RSI\s*\d+(?:\.\d+)?%?/gi, `RSI ${realRsi}`);   // LLM RSI 값 → 2소스 검증값
          if (realRsi >= 35) v = v.replace(/RSI\s*과매도/g, `RSI ${realRsi}`).replace(/과매도/g, realRsi >= 65 ? '과매수' : '중립');
          if (realRsi <= 65) v = v.replace(/과매수/g, realRsi <= 35 ? '과매도' : '중립');
        } else {
          // 2소스 검증값 없음(price-history 실패) → RSI 값 + 과매도/과매수 제거(strip-when-uncertain)
          v = v.replace(/[,·]?\s*RSI\s*\d+(?:\.\d+)?%?/gi, '').replace(/[,·]?\s*RSI\s*(?:과매도|과매수)/g, '').replace(/[,·]?\s*(?:과매도|과매수)\b/g, '');
        }
        // KR 종목에 $ 단위 MA(₩여야 함, technicalData 깨짐 잔재) 제거
        if (/\.(KS|KQ)$/.test(p.ticker ?? '')) v = v.replace(/[,·]?\s*\d+MA[^,;·]*\$[\d,.]+\)?/g, '');
        // 지지가격 환각: entryRationale 의 "N 수준 지지" 가 entryZone 과 >25% 이탈 → 제거
        if (f === 'entryRationale' && ezLow) {
          const supW = parseNum(v.match(/([\d,]{4,})\s*(?:수준|선)?\s*지지/)?.[1] ?? '');
          if (supW && Math.abs(supW / ezLow - 1) > 0.25) {
            v = v.replace(/[,·]?\s*[\d,]{4,}\s*(?:수준|선)?\s*지지/g, '');
          }
        }
        v = v.replace(/\s{2,}/g, ' ').replace(/^[\s,·]+|[\s,·]+$/g, '').trim();
        if (v !== before) { p[f] = v; techFix++; }
      }
    }
    if (techFix > 0) console.log(`  [후처리] RSI/지지선 환각 보정 ${techFix}건 (COMPUTED_TECH 실제값)`);
  }

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
  // 강제 rotation — 최근 5보고서와 5+ 종목 겹치면 boost-list 종목으로 교체 (투입 전 매도룰 사전심사 포함)
  finalReport.portfolio = await enforceRotation(finalReport.portfolio, livePrices);
  // 구루 분할 매매 ladder 자동 생성 (entry 30/40/30 + exit 33/33/34 + trailing)
  finalReport.portfolio = buildLadders(finalReport.portfolio, livePrices);
  // 2026-05-31: enforceRotation/buildLadders 가 postProcessPortfolio(line 4934) 이후 실행 →
  //   rotation 주입 종목이 meta sector override 를 못 받음 (ALNY "Pharma-biotech" vs meta "pharma-biotech").
  //   verify-report 의 case-sensitive 비교 통과를 위해 최종 저장 직전 sector 를 meta canonical 로 재정규화.
  for (const p of finalReport.portfolio) {
    const m = CANDIDATE_META[p.ticker];
    if (m?.sector && m.sector !== 'Unknown' && p.sector !== m.sector) {
      if (p.sector) console.warn(`  [sector-renorm] ${p.ticker} "${p.sector}" → "${m.sector}" (post-rotation meta override)`);
      p.sector = m.sector;
    }
    // 2026-05-31: sector-keyword mismatch strip (잔여결함 #3). final sector 확정 후,
    //   LLM free-text 필드의 thesis 에서 sector 금지 키워드 포함 clause 제거.
    //   예: NAVER(it services) "건설 수요 증가, 기술적 돌파 | ..." → "건설" clause strip.
    //   verify-report:SECTOR_FORBID 와 단일 source. 기술데이터(' | ' 뒤)는 보존.
    // 2026-06-01: blacklist(forbid) + positive 어휘(mismatchedIndustryTerm) 병행 —
    //   나열 안 한 산업어(바이오 등)도 cross-sector thesis 면 strip. 현대차 "바이오 수요" 사건.
    const sec = (p.sector || '').toLowerCase();
    const forbid = SECTOR_FORBID[sec];
    if (sec) {
      const hasKw = (s) => typeof s === 'string' && ((forbid && forbid.some(kw => s.includes(kw))) || mismatchedIndustryTerm(s, sec) != null);
      // clause 단위 strip — ' | ' 앞 thesis 만 손대고 기술데이터 suffix 는 보존.
      const stripClauses = (str) => {
        const [thesis, ...rest] = str.split(' | ');
        const kept = thesis.split(/,\s*/).filter(c => !hasKw(c));
        let newThesis = kept.join(', ').trim();
        if (!newThesis) newThesis = '기술적 신호 기반 진입';  // thesis 전부 제거되면 fallback
        return [newThesis, ...rest].join(' | ');
      };
      // verify-report 가 검사하는 모든 LLM 텍스트 필드 동일 처리.
      for (const f of ['rationale', 'entryRationale', 'targetRationale', 'fundamentalBasis', 'riskNote']) {
        if (typeof p[f] === 'string' && hasKw(p[f])) {
          const before = p[f];
          p[f] = stripClauses(p[f]);
          if (p[f] !== before) console.warn(`  [sector-kw-strip] ${p.ticker} (${p.sector}) ${f} 금지키워드 clause strip`);
        }
      }
      if (Array.isArray(p.catalysts)) {
        const before = p.catalysts.length;
        p.catalysts = p.catalysts.filter(c => !hasKw(c));
        if (p.catalysts.length !== before) console.warn(`  [sector-kw-strip] ${p.ticker} catalysts ${before}→${p.catalysts.length} (금지키워드 제거)`);
      }
    }
  }
  // 2026-05-30: 후처리 (harness/validateEntryZones/enforceRotation/buildLadders) 가 portfolio 늘리는 케이스 차단.
  //   DB-JSON mismatch (DB=15, JSON=12) 사건 fix. saveRecommendations 호출 직전 cap 한 번 더 강제.
  {
    const us = finalReport.portfolio.filter(p => !p.ticker?.endsWith('.KS') && !p.ticker?.endsWith('.KQ'));
    const kr = finalReport.portfolio.filter(p => p.ticker?.endsWith('.KS') || p.ticker?.endsWith('.KQ'));
    if (us.length > 6 || kr.length > 6) {
      console.log(`  [final-cap] 후처리 후 US ${us.length}→${Math.min(us.length,6)}, KR ${kr.length}→${Math.min(kr.length,6)} (cap 6 재적용)`);
    }
    finalReport.portfolio = [...us.slice(0, 6), ...kr.slice(0, 6)];
  }
  // portfolioByMarket 도 cap 후 portfolio 기준으로 재계산
  finalReport.portfolioByMarket = {
    us: finalReport.portfolio.filter(p => !p.ticker?.endsWith('.KS') && !p.ticker?.endsWith('.KQ')),
    kr: finalReport.portfolio.filter(p => p.ticker?.endsWith('.KS') || p.ticker?.endsWith('.KQ')),
  };

  // 2026-06-05: allocation 100 정규화 — *모든 portfolio mutation(cap/rotation/validateEntryZones) 후·
  //   저장 직전* 에 실행해야 cap 이 종목 제거해도 합=100 보장(이전엔 cap 전 실행 → 재깨짐 버그).
  //   LLM 이 합 74 처럼 출력(RULES "sum=100" 위반, verify-report [8] 발견) → 결정론적 스케일.
  {
    const port = finalReport.portfolio ?? [];
    const sum = port.reduce((s, p) => s + (Number(p.allocation) || 0), 0);
    if (port.length > 0 && sum > 0 && Math.abs(sum - 100) > 1) {
      const f = 100 / sum;
      let acc = 0;
      port.forEach((p, i) => {
        if (i === port.length - 1) p.allocation = Math.max(0, 100 - acc);   // 잔차 흡수 → 정확히 100
        else { p.allocation = Math.round((Number(p.allocation) || 0) * f); acc += p.allocation; }
      });
      console.log(`  [후처리] allocation 정규화 ${sum}% → 100% (${port.length}종목, 저장 직전)`);
    }
  }

  // 2026-06-05: 최종 name 게이트 (writeFileSync 직전 = 절대 마지막) — 중간(dedupedPortfolio 5551)
  //   게이트 후 portfolio 가 6번 재할당(enrichRationales/map/validateEntryZones/enforceRotation/
  //   buildLadders/cap)되고 critique 재머지로 일부 종목(TSLA/TSM)이 LLM 명("TSMC")으로 되돌아오던
  //   사건(2026-06-05 evening). portfolio + companyChanges 둘 다 권위명으로 최종 확정.
  {
    const fixNames = (arr) => {
      let n = 0;
      for (const p of arr ?? []) {
        const tk = p?.ticker?.toUpperCase();
        if (!tk) continue;
        const auth = US_NAME_LOOKUP[tk] ?? KR_NAMES_HARNESS[tk];
        const expected = auth ?? (((!p.name || p.name === p.ticker) && CANDIDATE_META[tk]?.name) || null);
        if (expected && p.name !== expected) { p.name = expected; n++; }
      }
      return n;
    };
    const np = fixNames(finalReport.portfolio);
    const nc = fixNames(finalReport.companyChanges);
    if (np + nc > 0) console.log(`  [name-gate/final] 발간직전 권위명 확정 portfolio ${np} + companyChanges ${nc}`);
  }

  // 2026-06-05: 완전성 게이트 (F23) — buy 종목이 technicalBasis/riskNote 없이 발간되던 사건(TSM).
  //   원인: LLM 이 stockDetail 을 "TSMC" ticker 로 출력 → merge-by-ticker("TSM") miss(이름 TSM↔TSMC
  //   불일치와 동일 뿌리). 빈 필드는 verify [F23] 실패 + UI 공백. grounded 데이터로만 채움(날조 금지):
  //   technicalBasis=signalDigest 실 RSI/MA, riskNote=RSI 과매수/환율/섹터 등 실지표 기반.
  {
    let filled = 0;
    for (const p of finalReport.portfolio ?? []) {
      if (p.action !== 'buy') continue;
      const sig = signalDigest.get(p.ticker);
      if (!p.technicalBasis) {
        p.technicalBasis = sig?.tech || `시장가 기준 보수적 진입 (기술 데이터 제한)`;
        filled++;
      }
      if (!p.riskNote) {
        const rsiM = (sig?.tech || '').match(/RSI\s*(\d+)/);
        const isKr = /\.(KS|KQ)$/.test(p.ticker);
        p.riskNote = (rsiM && +rsiM[1] >= 70) ? `RSI ${rsiM[1]} 과매수 — 단기 되돌림 위험`
          : isKr ? `원화 변동성 + ${p.sector ?? '섹터'} 사이클 노출`
          : `${p.sector ?? '섹터'} 사이클 변동성 + 밸류에이션 부담`;
        filled++;
      }
    }
    if (filled > 0) console.log(`  [completeness-gate] buy 종목 누락 필드 grounded 채움 ${filled}건 (F23)`);
  }

  // 2026-06-06: 최종 IV 주입 — 초기 IV 주입(dedupedPortfolio) 後 enforceRotation/pool-fill 이 추가한
  //   종목(TSLA boost·ULTA pool)이 impliedVol=undefined 였음(유동 옵션주인데 IV 누락, 사용자 지적).
  //   발간 직전 누락분(undefined) 재주입 — 이미 주입된(number/null) 건 skip.
  {
    let n = 0;
    await Promise.all((finalReport.portfolio || []).map(async (p) => {
      if (p.impliedVol !== undefined) return;
      if (!p.ticker || /\.(KS|KQ)$/.test(p.ticker)) { p.impliedVol = null; return; }
      try {
        const iv = await safeFetch(`${SITE}/api/iv/${encodeURIComponent(p.ticker)}`, 8000);
        p.impliedVol = (iv && typeof iv.atmIv30d === 'number') ? Math.round(iv.atmIv30d * 1000) / 10 : null;
        p.ivSkew = (iv && typeof iv.skew25d === 'number') ? Math.round(iv.skew25d * 1000) / 10 : null;
        n++;
      } catch { p.impliedVol = null; }
    }));
    if (n) console.log(`  [IV/final] rotation/pool 추가 종목 IV 재주입 ${n}건`);
  }

  // 2026-06-11: 최종 businessSummary 주입 — [5.5/7] 주입 後 enforceRotation 이 교체 투입한 종목
  //   (BDX/PPL/TSLA 사건: JSON 에 있는데도 발간본 누락)이 빈 채 발간되던 산재-불변식 결함.
  //   name-gate/IV/final 과 같은 발간직전 chokepoint 에서 누락분만 재주입.
  {
    let n = 0;
    for (const p of finalReport.portfolio || []) {
      if (p.businessSummary !== undefined) continue;
      const key = String(p.ticker || '').replace(/\.(KS|KQ)$/, '');
      const b = COMPANY_BUSINESS_JSON[p.ticker] || COMPANY_BUSINESS_JSON[key];
      if (b && (b.products || b.desc)) {
        p.businessSummary = b.products || '';
        p.businessDesc = b.desc || '';
        n++;
      }
    }
    if (n) console.log(`  [business/final] rotation/pool 추가 종목 주력사업 재주입 ${n}건`);
    const noBiz = (finalReport.portfolio || []).filter((p) => !p.businessSummary && !p.businessDesc).map((p) => p.ticker);
    if (noBiz.length) console.warn(`  ⚠️ [business/final] company-business.json 미수록 ${noBiz.length}종: ${noBiz.join(', ')} — build-company-business.mjs CURATED 보강 필요`);
  }

  // 2026-06-12: 레버리지/인버스 ETF 경고 라벨 (추천 허용 + 상품 특성 정직 고지 — 결정론, LLM 무관)
  for (const p of finalReport.portfolio ?? []) {
    if (p.ticker && isLeveragedEtf(p.ticker)) {
      const warn = '⚠️ 레버리지/인버스 ETF — 일일 리밸런싱·선물 롤오버로 장기보유 시 가치소멸, 단기 트레이딩 전용 상품.';
      if (!String(p.riskNote ?? '').includes('레버리지/인버스')) p.riskNote = `${warn} ${p.riskNote ?? ''}`.trim();
      console.log(`  [leveraged-label] ${p.ticker} 경고 라벨 부착`);
    }
  }

  // 2026-06-12: [reconcile/final] 매수∩매도 겹침 최종 게이트 — 경합심사는 rotation 前 실행이라
  //   rotation 투입 종목이 매도룰 cross-exam 을 안 거친 채 양쪽 동시 발간(TSLA buy+tech_dead_cross
  //   sell 사건). 발간직전 겹침을 결정론 재심: 매도 score>=7 → 매수 제거, <7 → 매도 제거(약신호).
  try {
    const sellArr = [...(finalReport.sellRecommendations?.us ?? []), ...(finalReport.sellRecommendations?.kr ?? [])];
    const sellTickers = new Set(sellArr.map((s) => s.ticker));
    const overlap = (finalReport.portfolio ?? []).filter((p) => sellTickers.has(p.ticker)).map((p) => p.ticker);
    if (overlap.length) {
      const vetoRulesF = (loadSellRules()?.rules ?? []).filter((r) => ['fundamental', 'technical', 'guru'].includes(r.category));
      const sigF = await fetchSellSignals(overlap);
      const decisions = [];
      for (const t of overlap) {
        const sig = sigF.get(t) ?? {};
        const exCtx = {
          price: livePrices.get(t)?.price ?? null,
          rsi: sig.rsi, sma50: sig.sma50, sma200: sig.sma200, volPct: sig.volPct,
          opMarginDecline: sig.opMarginDecline, peRatio: sig.peRatio, peg: sig.peg, revenueYoY: sig.revenueYoY,
          sectorPe: sectorPeMap.get(String((finalReport.portfolio.find((p) => p.ticker === t)?.sector ?? '')).toLowerCase()) ?? null,
          macroRiskLevel: macroData?.riskLevel ?? null,
        };
        const hits = vetoRulesF.map((r) => ({ r, reason: evaluateSellRule(r, exCtx) })).filter((x) => x.reason);
        const total = hits.reduce((s, x) => s + (x.r.score ?? 0), 0);
        if (total >= 7) {
          finalReport.portfolio = finalReport.portfolio.filter((p) => p.ticker !== t);
          decisions.push({ ticker: t, verdict: 'buy-removed', sellScore: total, hits: hits.map((x) => x.r.id) });
          console.warn(`  [reconcile/final] ${t} 양쪽 발간 모순 → 매수 제거 (매도 score ${total}≥7: ${hits.map((x) => x.r.id).join(',')})`);
        } else {
          for (const side of ['us', 'kr']) {
            if (finalReport.sellRecommendations?.[side]) finalReport.sellRecommendations[side] = finalReport.sellRecommendations[side].filter((s) => s.ticker !== t);
          }
          decisions.push({ ticker: t, verdict: 'sell-removed', sellScore: total, hits: hits.map((x) => x.r.id) });
          console.warn(`  [reconcile/final] ${t} 양쪽 발간 모순 → 매도 제거 (score ${total}<7 약신호, 매수 유지)`);
        }
      }
      if (finalReport.buySellReconciliation) finalReport.buySellReconciliation.finalOverlap = decisions;
    }
  } catch (e) { console.warn(`  [reconcile/final] skip: ${e.message}`); }

  // 2026-06-12: 파생 필드 재파생 — portfolioByMarket 재계산(final-cap)이 reconcile/final 게이트보다
  //   먼저 실행돼, 게이트가 제거한 종목(TSLA)이 파생 필드에 잔존 → UI 가 매수·매도 양쪽 표시한 사건.
  //   모든 portfolio mutation 의 마지막 지점에서 단일 재파생 (산재 불변식 → chokepoint).
  finalReport.portfolioByMarket = {
    us: finalReport.portfolio.filter((p) => !p.ticker?.endsWith('.KS') && !p.ticker?.endsWith('.KQ')),
    kr: finalReport.portfolio.filter((p) => p.ticker?.endsWith('.KS') || p.ticker?.endsWith('.KQ')),
  };

  // 2026-06-12: 반등관찰 신호를 보고서 본문(macroAnalysis)에도 결정론 문장으로 반영 — UI 배너 없이도
  //   사용자가 텍스트에서 확인 가능. LLM 생성 아닌 코드 생성 문장(환각 0).
  if (finalReport.reboundWatch?.level === 'watch' && typeof finalReport.macroAnalysis === 'string') {
    finalReport.macroAnalysis += ` | [반등관찰] ${finalReport.reboundWatch.drivers.join(' · ')} — 과매도 반등 가능성 관찰 구간 (매수 단정 아님)`;
  }

  // 2026-06-06: whitelist validator 최종 게이트 — 모든 portfolio 재할당(rotation/cap) 後 실행해
  //   rotation/pool 추가 종목의 ungrounded 숫자까지 차단(중간 배치 버그 fix).
  {
    const sv = validateGroundedNumbers(finalReport.portfolio, signalDigest, livePrices);
    if (sv) console.log(`  [whitelist-validator/final] ungrounded %·x 숫자 strip ${sv}건 (rotation 포함 전수)`);
  }

  // 2026-06-12: 엔진 리뷰 섹션 제거 (사용자 "엔진 리뷰 그냥 넣지 말자 앞으로").
  //   경합심사/rotation-veto/모순 재심 trail 은 콘솔 로그 + buySellReconciliation 필드로 유지.

  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
  const kstDate = getReportKstDate(session);  // midnight 은 발간일(익일)
  const filename = `report-${kstDate}-${session}-${localeArg}.json`;
  const filepath = resolve(REPORTS_DIR, filename);

  // 2026-06-14 (ChatGPT D0-1 차용): **품질 게이트를 DB 적재·학습 루프 이전으로 이동.**
  //   기존엔 qualityCheck ok=false 여도 saveRecommendations/saveSellRecommendations/saveBuyCandidates
  //   /snapshot/verify-report 가 먼저 실행되고 마지막 업로드만 skip → **발간 안 된 불량 보고서가
  //   outcome 평가·tune-rules·hallucination_history 학습 루프에 섞이는 순환오염**. 게이트 실패 시
  //   격리 파일만 남기고 DB 적재·학습·업로드 전부 SKIP (published 만 학습 대상).
  if (!ok) {
    const qDir = resolve(REPORTS_DIR, 'quarantine');
    if (!existsSync(qDir)) mkdirSync(qDir, { recursive: true });
    const qPath = resolve(qDir, filename);
    writeFileSync(qPath, JSON.stringify({ ...finalReport, _quarantine: { ts: new Date().toISOString(), issues } }, null, 2), 'utf8');
    console.error(`\n🚫 [발간 차단] 품질 게이트 실패 → DB 적재·학습 루프 오염 방지 위해 추천/스냅샷/verify/업로드 전부 SKIP.`);
    console.error(`   issues: ${issues.join(' | ')}`);
    console.error(`   격리: reports/quarantine/${filename} (검토용 — 발간·학습 제외)`);
    return;
  }
  writeFileSync(filepath, JSON.stringify(finalReport, null, 2), 'utf8');

  // ── 로컬 SQLite 적재 (data/flowvium.db) — 보고서 + 추천 + 엔드포인트 스냅샷 ──
  // 전향적 추천 평가의 컨텍스트로 사용. 실패해도 보고서 저장 자체는 영향 없음. (품질 ok 일 때만 도달 — 위 게이트.)
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
    // 2026-05-29: 매수 후보 전량 적재 (LLM 선택 12 외 score top N 까지) — Karpathy source 누락 방지
    let buyCandCount = 0;
    try {
      const selectedTickers = new Set((finalReport.portfolio ?? []).map(p => p.ticker).filter(Boolean));
      buyCandCount = saveBuyCandidates(reportId, finalReport.generatedAt, buyCandidates, selectedTickers);
      console.log(`[db] 🛒 매수 후보 적재: ${buyCandCount}건 (선택=${selectedTickers.size})`);
    } catch (e) {
      console.warn(`[db] ⚠️ 매수 후보 적재 실패: ${String(e).slice(0, 100)}`);
    }
    // 2026-05-29: 뉴스 + macro 시점 스냅샷 적재 (30년 누적 검색 가능)
    let newsCount = 0;
    try {
      newsCount = saveNewsArchive({
        reportId,
        locale: localeArg,
        // 2026-05-30: ctxRaw.cascade (gatherContext line 2665) — 이전엔 newsCascade.articles 참조해서 100% NULL.
        newsArticles: ctxRaw?.cascade ?? ctxRaw?.newsCascade?.articles ?? ctxRaw?.news ?? [],
        supplyChainChanges: finalReport.supplyChainChanges ?? [],
        companyChanges: finalReport.companyChanges ?? [],
      });
      saveMacroSnapshot({
        reportId,
        capturedAt: finalReport.generatedAt,
        ctxRaw,
        macroData,
      });
    } catch (e) {
      console.warn(`[db] ⚠️ news/macro 적재 실패: ${String(e).slice(0, 100)}`);
    }
    // 2026-06-03: 각 archive 를 독립 try/catch 로 격리 — 이전엔 news/macro/domain/fg 가 한 try 라
    //   앞 단계 하나만 throw 해도 saveFearGreedArchive 가 skip 돼 fg_archive 가 5-28 이후 중단됐음.
    try {
      // 숏스퀴즈/실적/insider 시점별 아카이브. companyFinancials=ticker-keyed Map(2026-06-03 문자열 버그 fix).
      saveDomainArchives({
        reportId,
        capturedAt: finalReport.generatedAt,
        shortSqueeze: finalReport.shortSqueeze ?? [],
        companyChanges: finalReport.companyChanges ?? [],
        insiderSignals: finalReport.insiderSignals ?? [],
        companyFinancials: financialsMap,
        livePrices,
      });
    } catch (e) {
      console.warn(`[db] ⚠️ domain archive 적재 실패: ${String(e).slice(0, 100)}`);
    }
    try {
      // F&G 10국가 + asset flow 시점별 아카이브.
      // 2026-06-04: ctxRaw.fearGreed 가 비면(컨텍스트 수집 시 fetch 실패) 조용히 0행 적재돼
      //   fg_archive 적재율 19%로 떨어지던 사각지대 → byCountry 비면 발간 시점 직접 재fetch 폴백.
      let fgResponse = ctxRaw?.fearGreed ?? ctxRaw?.fear_greed;
      let capitalFlowsResponse = ctxRaw?.capital ?? ctxRaw?.capitalFlows;
      const fgEmpty = !(Array.isArray(fgResponse?.byCountry) ? fgResponse.byCountry.length
        : Object.keys(fgResponse?.byCountry ?? {}).length);
      if (fgEmpty) {
        const fresh = await safeFetch(`${SITE}/api/fear-greed`, 12000);
        if (fresh && !fresh.error) { fgResponse = fresh; console.log('[db] fg_archive 폴백 재fetch (ctx 비어있었음)'); }
      }
      if (!(capitalFlowsResponse?.assets?.length)) {
        const freshCap = await safeFetch(`${SITE}/api/capital-flows`, 12000);
        if (freshCap && !freshCap.error) capitalFlowsResponse = freshCap;
      }
      saveFearGreedArchive({ reportId, capturedAt: finalReport.generatedAt, fgResponse, capitalFlowsResponse });
    } catch (e) {
      console.warn(`[db] ⚠️ fear-greed archive 적재 실패: ${String(e).slice(0, 100)}`);
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

    // 2026-06-12: 보고서 신규 종목 풀페이지 보장 (사용자 "새 종목 잡힐 때마다 풀페이지. KS 도").
    //   프로필: US+KR 전부 — Yahoo assetProfile 이 .KS 도 지원 ("KR 은 DART 커버" 가정은 사업설명
    //   전무로 반증됨, KT&G 사건). 세그먼트(XBRL)는 US 만 (KR 은 DART 파싱 — 차기).
    try {
      const { execFile: efRaw } = await import('child_process');
      const efAsync = (await import('util')).promisify(efRaw);
      const usTickers = portfolioTickers.filter((t) => !/\.(KS|KQ)$/.test(t));
      let profJson = {};
      try { profJson = JSON.parse(readFileSync(resolve(ROOT, 'data/company-profiles.json'), 'utf8')); } catch { /* 미생성 */ }
      const needProfile = portfolioTickers.filter((t) => !profJson[t]);
      const DatabaseCtor = (await import('better-sqlite3')).default;
      const segDb = new DatabaseCtor(resolve(ROOT, 'data/flowvium.db'), { readonly: true });
      const segSet = new Set(segDb.prepare('SELECT ticker FROM company_segments').all().map((r) => r.ticker));
      segDb.close();
      const needSeg = usTickers.filter((t) => !segSet.has(t));
      if (needProfile.length) {
        await efAsync('node', ['scripts/build-company-profiles.mjs', `--tickers=${needProfile.join(',')}`], { timeout: 120000, windowsHide: true });
        console.log(`[fullpage] 신규 종목 프로필 수집: ${needProfile.join(', ')}`);
      }
      if (needSeg.length) {
        // timeout 종목 수 비례 (LLM 폴백 최대 90s/종목 — 6/12 고정 300s 가 3종목에 SIGTERM 났던 사건)
        const { stdout: segOut } = await efAsync('node', ['scripts/build-segments-dynamic.mjs', ...needSeg], { timeout: Math.max(300000, needSeg.length * 150000), windowsHide: true, maxBuffer: 5 * 1024 * 1024 });
        const segOk = (segOut.match(/✓/g) || []).length;
        console.log(`[fullpage] 신규 종목 세그먼트 추출 시도 ${needSeg.length} → 성공 ${segOk} (검증 미통과는 큐레이션/미표시 유지)`);
      }
      if (!needProfile.length && !needSeg.length) console.log('[fullpage] portfolio 전 종목 풀페이지 데이터 보유 ✅');
    } catch (e) {
      console.warn(`[fullpage] ⚠️ 신규 종목 보강 실패 (non-fatal): ${String(e?.message).slice(0, 80)}`);
    }

    // 2026-05-30: Karpathy closed loop — 보고서 발간 직후 verify-report 자동 실행
    //   결함 detect → hallucination_history 적재 → 다음 보고서 prompt 에 anti-pattern inject.
    //   같은 환각 반복 방지 (사용자가 catch 하기 전에 학습).
    try {
      const verifyMod = await import('./verify-report.mjs');
      const { saveHallucinationHistory } = await import('./lib/db.mjs');
      const { defects } = await verifyMod.verifyReport(filepath, { silent: true });
      if (defects.length > 0) {
        const n = saveHallucinationHistory(reportId, defects);
        console.log(`[verify-loop] 🎯 결함 ${defects.length}건 detect → hallucination_history ${n}건 적재 (다음 보고서 prompt 에 inject 예정)`);
        const bySev = defects.reduce((m, d) => { m[d.severity] = (m[d.severity] ?? 0) + 1; return m; }, {});
        console.log(`[verify-loop] 분포: ${Object.entries(bySev).map(([k, v]) => `${k}=${v}`).join(', ')}`);
      } else {
        console.log(`[verify-loop] ✅ 결함 0건 — 깨끗`);
      }
      // 2026-05-31: cron 후 verify-all 결과 reports/verify-{ts}.json 자동 저장.
      //   사용자: "지금 방법이 최선이니?" — 매 cron 후 종합 dashboard 흔적.
      //   다음 보고서 작성 전 audit-coverage Probe [9] 가 이걸 source 로 학습 추세 추적.
      try {
        const { existsSync, mkdirSync, writeFileSync } = await import('node:fs');
        const verifyDir = resolve(ROOT, 'reports/verify');
        if (!existsSync(verifyDir)) mkdirSync(verifyDir, { recursive: true });
        const verifyResult = {
          reportId,
          generatedAt: finalReport.generatedAt,
          session,
          defectCount: defects.length,
          defects: defects.map(d => ({ ticker: d.ticker, type: d.defect_type, llmValue: d.llm_value, correct: d.correct_value, severity: d.severity })),
        };
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        writeFileSync(resolve(verifyDir, `verify-${ts}.json`), JSON.stringify(verifyResult, null, 2), 'utf8');
        console.log(`[verify-loop] 📋 결과 reports/verify/verify-${ts}.json 저장`);
      } catch (e) {
        console.warn(`[verify-loop] ⚠️ 결과 저장 실패: ${String(e).slice(0, 80)}`);
      }
    } catch (e) {
      console.warn(`[verify-loop] ⚠️ 검증 실패: ${String(e).slice(0, 120)}`);
    }
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
// 2026-05-29: silent failure 차단 — throw 시 exit code 1 (batch 가 [SUCCESS] 오기록 방지).
const onFatal = (e) => {
  console.error('[FATAL]', e?.stack ?? e?.message ?? String(e));
  process.exit(1);
};
if (uploadArg) {
  uploadFromFile(uploadArg).catch(onFatal);
} else {
  generateViaOllama().catch(onFatal);
}
