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
  'SPY','QQQ','GLD','TLT','USO','IWM','XLE','XLK','XLF','XLV',
  'EWY','EWJ','FXI','VGK','INDA','EWT','EWZ','EWA',
  'BITO','SLV','DBA',
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
function qualityCheck(report) {
  const issues = [];
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

  let score = 0;
  if ((report.thesis?.length ?? 0) >= garbageMinLen(GARBAGE_MIN_LEN.thesis))               score += 15;
  if ((report.macroAnalysis?.length ?? 0) >= garbageMinLen(GARBAGE_MIN_LEN.macroAnalysis))  score += 15;
  if ((report.technicalAnalysis?.length ?? 0) >= garbageMinLen(GARBAGE_MIN_LEN.technicalAnalysis)) score += 10;
  if ((report.fundamentalAnalysis?.length ?? 0) >= garbageMinLen(GARBAGE_MIN_LEN.fundamentalAnalysis)) score += 10;
  if ((report.portfolio?.length ?? 0) >= 2)                                                  score += 15;
  if ((report.riskEvents?.length ?? 0) >= 1)                                                 score += 5;
  if (Object.keys(report.regionStances ?? {}).length >= 2)                                   score += 5;
  if ((report.shortSqueeze?.length ?? 0) >= 1)                                               score += 5;
  if ((report.insiderSignals?.length ?? 0) >= 1)                                             score += 3;
  if ((report.stopLossRationale?.length ?? 0) >= 1)                                          score += 5;
  if (report.marketNarrative?.why || report.marketNarrative?.story)                          score += 5;
  if ((report.companyChanges?.length ?? 0) >= 1)                                             score += 7;
  return { ok: issues.length === 0, issues, score };
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
    const files = readdirSync(REPORTS_DIR).filter(f => f.endsWith('.json')).sort();
    if (!files.length) { console.error('reports/ 에 파일 없음'); process.exit(1); }
    resolved = resolve(REPORTS_DIR, files[files.length - 1]);
    console.log(`최신 파일: ${basename(resolved)}`);
  } else {
    resolved = resolve(process.cwd(), filePath);
  }

  let report;
  try {
    report = JSON.parse(readFileSync(resolved, 'utf8'));
  } catch (e) { console.error('파일 읽기 실패:', e.message); process.exit(1); }

  console.log('\n=== 품질 게이트 검사 ===');
  const { ok, issues, score } = qualityCheck(report);
  console.log(`품질 점수: ${score}/100`);
  if (issues.length) {
    console.log('⚠️  문제 발견:');
    for (const i of issues) console.log('   ', i);
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
  const kstDate = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const sessionKey = `flowvium:investment-strategy:v8:${kstDate}:${session}:${locale}`;
  const staleKeyStr = `flowvium:investment-strategy:stale:v8:${locale}`;

  console.log(`\n=== Redis 업로드 ===`);
  console.log(`session key: ${sessionKey}`);
  console.log(`stale   key: ${staleKeyStr}`);

  const [ok1, ok2] = await Promise.all([
    redisSet(sessionKey, report, 86400),
    redisSet(staleKeyStr, report, 7 * 86400),
  ]);

  const HIST_KEY = 'flowvium:investment-strategy:history:arr:v1';
  const histMeta = {
    key: sessionKey,
    generatedAt: report.generatedAt,
    session,
    kstDate: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' '),
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

  console.log(`\nsession key: ${ok1 ? '✅' : '❌'}`);
  console.log(`stale   key: ${ok2 ? '✅' : '❌'}`);
  console.log(`source: ${report.source}`);
  console.log(`quality score: ${score}/100`);
  console.log(`\n✅ 업로드 완료! ${SITE}/${locale}/report 에서 확인`);
}

// ── Ollama 호출 ────────────────────────────────────────────────────────────────
async function callOllama(prompt, model = modelArg, timeoutMs = 180000) {
  const isQwen3 = model.startsWith('qwen3');
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
    options: { temperature: 0.7, num_predict: 2048 },
    ...(isQwen3 ? { think: false } : {}),
  };
  const res = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
  const d = await res.json();
  return d.message?.content ?? '';
}

function parseJson(raw) {
  if (!raw) return null;
  try {
    const clean = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const codeBlock = clean.match(/```(?:json)?\s*([\s\S]*?)```/);
    const str = codeBlock ? codeBlock[1] : clean;
    const m = str.match(/\{[\s\S]*\}/);
    if (!m) return null;
    return JSON.parse(m[0].replace(/,\s*([}\]])/g, '$1'));
  } catch { return null; }
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
      const parts = [];
      if (sma200 != null) parts.push(actual > sma200 ? '200MA 위' : '200MA 아래');
      else if (sma50 != null) parts.push(actual > sma50 ? '50MA 위' : '50MA 아래');
      if (rsi != null) parts.push(`RSI ${rsi}`);
      if (volRatio != null) parts.push(`거래량${volRatio >= 0 ? '+' : ''}${volRatio}%`);
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
 * Wave1이 생성한 entryZone/stopLoss/target이 실제 현재가와 동떨어진 경우 보정.
 * LLM 모델이 현재가를 무시하고 훈련 데이터 기반 가격을 사용하는 버그를 방지.
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
    const inRange = nums => nums.some(n => n > actual * 0.25 && n < actual * 4);

    let updated = { ...p };
    const zoneNums = extractNums(p.entryZone);
    if (!zoneNums.length || !inRange(zoneNums)) {
      if (zoneNums.length) console.warn(`  ⚠️  ${p.ticker} entryZone="${p.entryZone}" vs actual ${fmt(actual)} → 보정`);
      updated.entryZone = `${fmt(Math.round(actual * 0.97 * (isKR ? 1 : 100) / (isKR ? 1 : 100)))}-${fmt(Math.round(actual * 1.02 * (isKR ? 1 : 100) / (isKR ? 1 : 100)))}`;
    }
    const stopNums = extractNums(p.stopLoss);
    if (stopNums.length && !inRange(stopNums)) {
      console.warn(`  ⚠️  ${p.ticker} stopLoss="${p.stopLoss}" vs actual ${fmt(actual)} → 보정`);
      updated.stopLoss = fmt(isKR ? Math.round(actual * 0.92) : parseFloat((actual * 0.92).toFixed(2)));
    }
    const targetNums = extractNums(p.target);
    if (targetNums.length && !inRange(targetNums)) {
      console.warn(`  ⚠️  ${p.ticker} target="${p.target}" vs actual ${fmt(actual)} → 보정`);
      updated.target = fmt(isKR ? Math.round(actual * 1.15) : parseFloat((actual * 1.15).toFixed(2)));
    }
    return updated;
  });
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
  const [
    capital, fearGreed, fedwatch, macro,
    creditBalance, insider, ownershipAlerts, koreaFlow,
    nport, shortInterest, newsCascade, econCal,
    volatility, cot, commodity,
  ] = await Promise.all([
    safeFetch(`${base}/api/capital-flows`, 15000),
    safeFetch(`${base}/api/fear-greed`, 12000),
    safeFetch(`${base}/api/fedwatch`, 10000),
    safeFetch(`${base}/api/macro-indicators`, 10000),
    safeFetch(`${base}/api/credit-balance`, 10000),
    safeFetch(`${base}/api/insider-trades`, 15000),
    safeFetch(`${base}/api/ownership-alerts`, 15000),
    safeFetch(`${base}/api/korea-flow`, 10000),
    safeFetch(`${base}/api/nport-holdings`, 15000),
    safeFetch(`${base}/api/short-interest`, 12000),
    safeFetch(`${base}/api/news-cascade`, 15000),
    safeFetch(`${base}/api/economic-calendar?country=US`, 8000),
    safeFetch(`${base}/api/volatility`, 8000),
    safeFetch(`${base}/api/cot-positions`, 10000),
    safeFetch(`${base}/api/commodity-curve`, 10000),
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
        const c = clusterMap.get(t) ?? { buys: 0, sells: 0, totalUsd: 0 };
        if (i.direction === 'buy') c.buys++; else c.sells++;
        c.totalUsd += i.transactionValueUsd ?? 0;
        clusterMap.set(t, c);
      }
      const hot = Array.from(clusterMap.entries())
        .filter(([, c]) => c.buys + c.sells >= 5)
        .sort((a, b) => (b[1].buys + b[1].sells) - (a[1].buys + a[1].sells))
        .slice(0, 3)
        .map(([t, c]) => `${t}(${c.buys}buy/${c.sells}sell $${Math.round(c.totalUsd / 1000)}K)`);
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
    const squeeze = arr.filter(s => (s.squeezeScore ?? 0) >= 25).slice(0, 3)
      .map(s => `${s.ticker}(squeeze=${s.squeezeScore})`);
    if (squeeze.length) shorts = squeeze.join(', ');
  } catch { /* ignore */ }

  // News (cascade)
  let news = '';
  try {
    const cascadeArr = Array.isArray(ctx.cascade) ? ctx.cascade : [];
    const sorted = [...cascadeArr].sort((a, b) => {
      const isFedA = /powell|fomc|fed|ecb|lagarde|monetary|rate/i.test(String(a.title ?? a.summary));
      const isFedB = /powell|fomc|fed|ecb|lagarde|monetary|rate/i.test(String(b.title ?? b.summary));
      return (isFedB ? 1 : 0) - (isFedA ? 1 : 0);
    });
    const topNews = sorted.slice(0, 5).map(n => {
      const sent = n.sentiment === 'bullish' ? '↑' : n.sentiment === 'bearish' ? '↓' : '·';
      const isFed = /powell|fomc|fed|ecb|lagarde|boj|monetary|rate cut|rate hike/i.test(String(n.title ?? n.summary));
      const prefix = isFed ? '[연준/중앙은행]' : '';
      const text = ((n.summary || n.title || '')).slice(0, 60);
      const impacts = (n.cascades ?? [])
        .filter(c => (c.magnitude === 'high' || c.magnitude === 'medium') && c.direction !== 'neutral')
        .slice(0, 2).map(c => `${c.asset}${c.direction === 'positive' ? '↑' : '↓'}`).join(',');
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

  return { macro, sentiment, flows, cot, commodity, institutional, shorts, news, koreaFlow, assetFg, bbWarnings, credit, nport, optionsFlow, ownership, econCal, vixCtx };
}

// ── Cascade signals ────────────────────────────────────────────────────────────
async function getActiveCascadeSignals(prices) {
  const CASCADES = [
    { leader: 'NVDA', followers: ['MU','000660.KS','TSM','AMAT','LRCX','AMD'], sector: 'AI반도체' },
    { leader: 'ASML', followers: ['AMAT','LRCX','KLAC','TSM'], sector: '반도체장비' },
    { leader: 'MSFT', followers: ['NVDA','GOOGL','AMZN','ORCL'], sector: 'AI클라우드' },
    { leader: 'TSM',  followers: ['NVDA','AMD','AVGO','QCOM'], sector: 'TSMC파운드리' },
    { leader: 'LMT',  followers: ['RTX','NOC','BA','GE'], sector: '방산' },
    { leader: 'ABBV', followers: ['LLY','JNJ','PFE','MRK'], sector: '바이오파마' },
    { leader: 'TSLA', followers: ['RIVN','NIO','LI','LCID'], sector: 'EV' },
    { leader: 'WMT',  followers: ['COST','HD','TGT','AMZN'], sector: '소비유통' },
  ];
  try {
    const active = [];
    for (const c of CASCADES) {
      const lp = prices.get(c.leader);
      if (!lp) continue;
      // change1d가 있으면 1d로 cascade 판단 (5d 데이터 없으므로 1d±3% 이상)
      const ret = lp.change1d;
      if (ret == null || Math.abs(ret) < 3) continue;
      const dir = ret > 0 ? '상승' : '하락';
      active.push(
        `[CASCADE ACTIVE] ${c.sector} ${c.leader} 1d ${ret >= 0 ? '+' : ''}${ret.toFixed(1)}% → ` +
        `팔로워 주목: ${c.followers.slice(0, 3).join(', ')}`
      );
    }
    return active.join('\n');
  } catch { return ''; }
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
    const d = await safeFetch(`${SITE}/api/earnings`, 8000);
    const items = (d?.earnings ?? []).slice(0, 5);
    return items.map(e => `${e.symbol} ${e.date}`).join(', ');
  } catch { return ''; }
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

function buildPortfolioPrompt(ctx, sectorPe, earnings, priceData) {
  return [
    buildGroundingFacts(priceData),
    '',
    `You are a portfolio manager building an investment strategy. Date: ${TODAY}.${li}`,
    '',
    `[Live Prices — base for entryZone/stopLoss/target]`,
    priceData || 'No data',
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
    '',
    getGuruContext(),
    '',
    '** OBJECTIVE: ALPHA GENERATION — Beat the index (S&P 500). **',
    '** Passive ETFs (SPY/QQQ/VTI) and bonds combined ≤ 20% total. **',
    '** Concentrate on HIGH-CONVICTION individual stocks. **',
    '** Minimum 5 individual stocks, each ≥ 10% allocation. **',
    '',
    'RULES:',
    '1. 6-8 items: PRIMARILY individual stocks — ONLY pick tickers in [Live Prices]',
    '   Rank by signal: (1) insider 집중매수/13D, (2) squeeze score, (3) 13F accumulation, (4) options flow, (5) capital-flow momentum',
    '2. "market" field = us/korea/japan/china/europe/india/taiwan/global',
    '3. entryZone/stopLoss/target: actual dollar ranges from live prices',
    '4. rationale 100 chars max with real data signals',
    '5. allocation sum = 100, no single position > 25%',
    '6. action: buy=accumulate now, hold=keep, watch=wait for entry',
    '7. entryRationale ≤80자: MUST cite ≥1 fundamental signal',
    '8. targetRationale ≤80자: fundamentals-first',
    '9. CRITICAL — UNIQUE rationale per stock: Each ticker MUST have a DIFFERENT rationale',
    '   citing THAT stock\'s specific primary signal. Do NOT copy-paste the same text.',
    '   Examples of different signals: insider filings count, squeeze score, options flow,',
    '   13F accumulation, earnings beat %, PE vs sector, RSI level, 52w position.',
    '',
    `Respond in pure JSON (no markdown). ALL text values MUST be in ${TARGET_LANG}:`,
    '{"stance":"bullish|neutral|bearish",',
    '"portfolio":[{"ticker":"NVDA","name":"NVIDIA","sector":"Technology","market":"us",',
    `"rationale":"[≤100 chars in ${TARGET_LANG}, cite real data signals]","allocation":15,"entryZone":"$X-Y",`,
    `"entryRationale":"[≤80 chars in ${TARGET_LANG}, ≥1 fundamental signal]","stopLoss":"$Z",`,
    `"target":"$A","targetBull":"$B","targetRationale":"[≤80 chars in ${TARGET_LANG}, fundamentals-first]","confidence":"high","action":"buy"}],`,
    `"sectorAllocation":[{"sector":"Technology","pct":25,"stance":"overweight","reason":"[≤40 chars in ${TARGET_LANG}]"}]}`,
    '6-8 portfolio items, 5 sectorAllocation items. Pure JSON only.',
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
    `Respond in pure JSON. ALL text values in ${TARGET_LANG}:`,
    `{"shortSqueeze":[{"ticker":"SMCI","score":48,"timing":"[≤40 chars in ${TARGET_LANG}]","risk":"[≤40 chars in ${TARGET_LANG}]"}],`,
    `"insiderSignals":[{"ticker":"CRWV","filings":63,"significance":"[≤40 chars in ${TARGET_LANG}]","pattern":"[≤30 chars in ${TARGET_LANG}]"}],`,
    `"topOpportunity":"[≤100 chars in ${TARGET_LANG}]"}`,
    'Pure JSON only.',
  ].join('\n');
}

function buildNarrativePrompt(ctx, session) {
  const sc = session === 'morning' ? '미국장 마감 직후' : session === 'afternoon' ? '아시아장 마감 직후' : '미국장 개장 전';
  return [
    `You are a market narrative writer. Session: ${sc} ${TODAY}. Write in ${TARGET_LANG}.`,
    '',
    `[Capital Flow Story] ${ctx.flows || 'No data'}`,
    `[News Events] ${ctx.news || 'No data'}`,
    `[Macro Context] ${ctx.macro || 'No data'}`,
    '',
    'Respond in pure JSON:',
    `{"why":"[≤100 chars in ${TARGET_LANG}]","watch":"[≤80 chars in ${TARGET_LANG}]","story":"[≤200 chars in ${TARGET_LANG}]","sessionNote":"[≤60 chars in ${TARGET_LANG}]"}`,
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
  // SEC EDGAR only covers US-listed companies. Korean .KS tickers have no financials source.
  const usTickers = portfolioItems.filter(p => !p.ticker.endsWith('.KS'));
  const krTickers  = portfolioItems.filter(p =>  p.ticker.endsWith('.KS'));
  const tickers = usTickers.map(p => `${p.ticker}(${p.name ?? p.ticker})`).join(', ');
  const krNote = krTickers.length
    ? `\nKorean tickers (NO financials data — OMIT from companyChanges): ${krTickers.map(p => p.ticker).join(', ')}`
    : '';
  return [
    `You are a corporate analyst. Date: ${TODAY}. Write keyChange in ${TARGET_LANG}.`,
    '',
    `US portfolio tickers (include these): ${tickers || 'None'}${krNote}`,
    '',
    `[Recent Financials — US only] ${financials || 'No data'}`,
    `[Upcoming/Recent Earnings] ${earnings || 'None'}`,
    `[Institutional Changes] ${institutional || 'None'}`,
    `[News & Events] ${news || 'None'}`,
    '',
    'RULES:',
    '- Include ONLY tickers listed under "US portfolio tickers".',
    '- Korean .KS tickers have no financial data — do NOT include them.',
    '- revenueYoY: use actual number from [Recent Financials]. If unknown, use null (NEVER 0).',
    '',
    'Respond in pure JSON:',
    `{"companyChanges":[{"ticker":"NVDA","name":"NVIDIA","revenueYoY":73.2,"latestQuarter":"Q4 FY2026","keyChange":"[≤60 chars in ${TARGET_LANG}]","guidance":"raised|maintained|lowered|unknown","sentiment":"positive|neutral|negative"}]}`,
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
    '- catalysts: 2-3 SPECIFIC near-term catalysts with numbers',
    `- fundamentalBasis: ≤120 chars — use [Recent Company Financials] data; EPS/revenue growth%, operating margin, PE/PEG, institutional`,
    `- technicalBasis: ≤80 chars — MUST use [COMPUTED_TECH] values verbatim if provided; otherwise estimate MA/RSI/volume`,
    '- riskNote: ≤60 chars — single biggest downside risk',
    '',
    'Respond in pure JSON:',
    `{"stockDetails":[{"ticker":"NVDA","catalysts":["Blackwell GPU QoQ+40%","13F 47건 매집","AI capex $200B"],"fundamentalBasis":"매출 YoY+73%, 영업이익률 55%, PEG 1.3","technicalBasis":"200MA 위, RSI 55, 거래량+18%","riskNote":"수출규제 매출 15% 하락 위험"}]}`,
    'Include ALL buy tickers. Pure JSON only.',
  ].join('\n');
}

function buildCritiquePrompt(portfolio, macroAnalysis, bbWarnings, assetFg) {
  const summary = portfolio.map(p =>
    `${p.ticker}(${p.action}) entry=${p.entryZone} target=${p.target}: ${p.rationale}`
  ).join('\n');
  return [
    `You are a contrarian analyst critiquing a portfolio. Write correction in ${TARGET_LANG}.`,
    '',
    `[Draft Portfolio]\n${summary}`,
    '',
    `[Macro] ${macroAnalysis || 'No data'}`,
    `[BB Overextension] ${bbWarnings || 'None'}`,
    `[Asset F&G] ${assetFg || 'No data'}`,
    '',
    'REVISE: action is wrong (buy→watch or buy→hold) — major structural problem only.',
    'WARN: target too high, risk overlooked, or entry zone needs adjustment.',
    'OK: position is sound — use OK for minor target adjustments.',
    'Be selective: only flag items with genuine concerns. Typical result: 0-2 flags.',
    '',
    'Respond in pure JSON:',
    `{"critiques":[{"ticker":"NVDA","verdict":"REVISE|WARN|OK","correction":"[≤80 chars in ${TARGET_LANG}, include specific numbers]"}]}`,
    'Pure JSON only.',
  ].join('\n');
}

function applyCritique(portfolio, critiqueRaw) {
  try {
    const m = critiqueRaw.match(/\{[\s\S]*\}/);
    if (!m) return portfolio;
    const parsed = JSON.parse(m[0]);
    const critiques = parsed.critiques ?? [];
    if (!critiques.length) return portfolio;
    return portfolio.map(p => {
      const c = critiques.find(cr => cr.ticker === p.ticker);
      if (!c || c.verdict === 'OK') return p;
      if (c.verdict === 'REVISE') {
        // action 변경이 필요한 경우만 action 변경, rationale 보존
        const newAction = c.correction.includes('진입금지') || c.correction.includes('watch') ? 'watch' : p.action;
        return { ...p, action: newAction, critiqueNote: c.correction.slice(0, 80) };
      }
      if (c.verdict === 'WARN') {
        return { ...p, critiqueNote: c.correction.slice(0, 80) };
      }
      return p;
    });
  } catch { return portfolio; }
}

// ── 포트폴리오 후처리 ────────────────────────────────────────────────────────────
function postProcessPortfolio(portfolio) {
  if (!Array.isArray(portfolio)) return [];
  const KR_NUM = /^\d{6}$/;
  let items = portfolio.map(p => ({
    ...p,
    ticker: KR_NUM.test(p.ticker ?? '') ? `${p.ticker}.KS` : (p.ticker ?? ''),
  })).filter(p => {
    const k = (p.ticker ?? '').toUpperCase();
    return k && !INDEX_TICKERS.has(k);
  });

  const dedupMap = new Map();
  for (const p of items) {
    const k = p.ticker.toUpperCase();
    const ex = dedupMap.get(k);
    if (!ex || (p.allocation ?? 0) > (ex.allocation ?? 0)) dedupMap.set(k, p);
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
  const ctxWithCascade = {
    ...ctx,
    flows: ctx.flows + (cascadeStr ? `\n[ACTIVE CASCADE SIGNALS]\n${cascadeStr}` : ''),
    news: ctx.news + (cascadeStr ? `\n[공급망 cascade 활성]\n${cascadeStr}` : ''),
  };

  console.log(`  macro=${ctx.macro.length}c, sentiment=${ctx.sentiment.length}c, flows=${ctx.flows.length}c`);
  console.log(`  news=${ctx.news.length}c, institutional=${ctx.institutional.length}c, shorts=${ctx.shorts.length}c`);
  console.log(`  prices=${livePrices.size} tickers, sectorPe=${sectorPe.length}c, earnings=${earnings.length}c`);

  // ── [2/7] Wave 1: 5섹션 병렬 ─────────────────────────────────────────────────
  console.log('\n[2/7] Wave1 — 5개 병렬 Ollama 호출 (macro/portfolio/regional/opportunity/narrative)...');
  const [macroRaw, portfolioRaw, regionalRaw, opportunityRaw, narrativeRaw] = await Promise.all([
    callOllama(buildMacroPrompt(ctxWithCascade, ctx.vixCtx, session)),
    callOllama(buildPortfolioPrompt(ctxWithCascade, sectorPe, earnings, priceData)),
    callOllama(buildRegionalPrompt(ctxWithCascade)),
    callOllama(buildOpportunityPrompt(ctxWithCascade)),
    callOllama(buildNarrativePrompt(ctxWithCascade, session)),
  ]);

  let macroData        = parseJson(macroRaw);
  const portfolioData  = parseJson(portfolioRaw);
  let regionalData     = parseJson(regionalRaw);
  const opportunityData = parseJson(opportunityRaw);
  const narrativeData  = parseJson(narrativeRaw);

  // Retry failed wave1 calls once (qwen3:8b occasionally produces malformed JSON)
  const retryNeeded = [];
  if (!macroData)    retryNeeded.push('macro');
  if (!regionalData) retryNeeded.push('regional');
  if (retryNeeded.length > 0) {
    console.log(`  parse failed [${retryNeeded.join(', ')}] — retrying...`);
    const retries = await Promise.all([
      !macroData    ? callOllama(buildMacroPrompt(ctxWithCascade, ctx.vixCtx, session))    : Promise.resolve(null),
      !regionalData ? callOllama(buildRegionalPrompt(ctxWithCascade))                       : Promise.resolve(null),
    ]);
    if (!macroData    && retries[0]) macroData    = parseJson(retries[0]);
    if (!regionalData && retries[1]) regionalData = parseJson(retries[1]);
  }

  console.log(`  macro=${!!macroData}, portfolio=${!!portfolioData}(${portfolioData?.portfolio?.length ?? 0}개), regional=${!!regionalData}`);
  console.log(`  opportunity=${!!opportunityData}, narrative=${!!narrativeData}`);

  // Portfolio retry — portfolio failure is fatal so retry immediately
  if (!portfolioData?.portfolio?.length) {
    console.log('  portfolio parse failed — retrying once...');
    const portfolioRetry = await callOllama(buildPortfolioPrompt(ctxWithCascade, sectorPe, earnings, priceData));
    const portfolioRetryData = parseJson(portfolioRetry);
    if (!portfolioRetryData?.portfolio?.length) {
      console.error('❌ Wave1 포트폴리오 생성 실패 (2회). 종료합니다.');
      process.exit(1);
    }
    Object.assign(portfolioData, portfolioRetryData);
  }

  // ── [3/7] Wave 2: 3섹션 병렬 ─────────────────────────────────────────────────
  console.log('\n[3/7] Wave2 — 리스크/기업변화/종목상세 병렬 호출...');
  // 현재가와 동떨어진 entryZone/stopLoss/target 보정 (LLM 환각 방지)
  const portfolioItems = validateEntryZones(postProcessPortfolio(portfolioData.portfolio), livePrices);
  const buyStocks = portfolioItems
    .filter(p => p.action === 'buy')
    .map(p => ({ ticker: p.ticker, name: p.name ?? p.ticker, sector: p.sector ?? '', rationale: p.rationale ?? '', entryZone: p.entryZone ?? '', target: p.target ?? '' }));

  const portfolioForFinancials = portfolioItems.map(p => p.ticker);
  // 재무 데이터 + OHLCV 기술 지표 병렬 수집
  const [companyFinancials, technicalData] = await Promise.all([
    getCompanyFinancials(portfolioForFinancials),
    buildTechnicalData(buyStocks.map(s => s.ticker), livePrices),
  ]);
  if (technicalData.size > 0) {
    console.log(`  기술지표 계산 완료: ${[...technicalData.entries()].map(([t, v]) => `${t}(${v})`).join(', ')}`);
  }

  const wave2Calls = [
    callOllama(buildRiskMgmtPrompt(portfolioItems, macroData?.riskLevel ?? 'medium', ctx.bbWarnings, ctx.vixCtx)),
    callOllama(buildCompanyChangesPrompt(portfolioItems, earnings, ctx.institutional, ctx.news, companyFinancials)),
  ];
  if (buyStocks.length > 0) {
    wave2Calls.push(callOllama(buildStockDetailPrompt(buyStocks, ctx.institutional, ctx.shorts, earnings, sectorPe, ctx.news, technicalData, companyFinancials)));
  }

  const [riskRaw, companyChangesRaw, stockDetailRaw] = await Promise.all(wave2Calls);
  const riskData = parseJson(riskRaw);
  const companyChangesData = parseJson(companyChangesRaw);

  const stockDetailMap = new Map();
  if (stockDetailRaw) {
    const sd = parseJson(stockDetailRaw);
    if (Array.isArray(sd?.stockDetails)) {
      for (const d of sd.stockDetails) {
        if (d.ticker) stockDetailMap.set(d.ticker.toUpperCase(), d);
      }
    }
  }
  console.log(`  risk=${!!riskData}, companyChanges=${companyChangesData?.companyChanges?.length ?? 0}개, stockDetail=${stockDetailMap.size}개`);

  // ── [4/7] Critique ──────────────────────────────────────────────────────────
  console.log('\n[4/7] Critique — 포트폴리오 자기비판...');
  let refinedPortfolio = portfolioItems;
  try {
    const critiqueRaw = await callOllama(buildCritiquePrompt(
      portfolioItems,
      macroData?.macroAnalysis ?? '',
      ctx.bbWarnings,
      ctx.assetFg,
    ));
    refinedPortfolio = applyCritique(portfolioItems, critiqueRaw);
    const changed = refinedPortfolio.filter((p, i) => p.action !== portfolioItems[i]?.action);
    console.log(`  critique 적용: ${changed.length}개 종목 수정`);
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

  const now = new Date().toISOString();
  const finalReport = {
    stance: portfolioData.stance ?? 'neutral',
    thesis: macroData?.thesis ?? portfolioData.stance ?? 'neutral',
    portfolio: mergedPortfolio,
    sectorAllocation: portfolioData.sectorAllocation ?? [],
    riskEvents: macroData?.riskEvents ?? [],
    macroAnalysis: macroData?.macroAnalysis ?? '',
    technicalAnalysis: macroData?.technicalAnalysis ?? '',
    fundamentalAnalysis: macroData?.fundamentalAnalysis ?? '',
    riskLevel: macroData?.riskLevel ?? 'medium',
    regionStances: regionalData?.regionStances ?? {},
    shortSqueeze: opportunityData?.shortSqueeze ?? [],
    insiderSignals: opportunityData?.insiderSignals ?? [],
    topOpportunity: opportunityData?.topOpportunity ?? '',
    stopLossRationale: riskData?.stopLossRationale ?? [],
    hedgingSuggestion: riskData?.hedgingSuggestion ?? '',
    portfolioRiskNote: riskData?.portfolioRiskNote ?? '',
    marketNarrative: narrativeData ?? {},
    companyChanges: companyChangesData?.companyChanges ?? [],
    generatedAt: now,
    dataAsOf: now,
    source: `local-${modelArg}`,
    locale: localeArg,
    session,
    schemaVersion: 8,
    buildId: 'local',
  };

  // ── [6/7] 품질 검사 + 저장 ──────────────────────────────────────────────────
  console.log('\n[6/7] 품질 게이트 검사...');
  const { ok, issues, score } = qualityCheck(finalReport);
  console.log(`  품질 점수: ${score}/100`);
  if (issues.length) {
    console.log('  ⚠️  문제:');
    for (const i of issues) console.log(`    - ${i}`);
  } else {
    console.log('  ✅ 품질 검사 통과');
  }

  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
  const kstDate = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const filename = `report-${kstDate}-${session}-${localeArg}.json`;
  const filepath = resolve(REPORTS_DIR, filename);
  writeFileSync(filepath, JSON.stringify(finalReport, null, 2), 'utf8');

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
