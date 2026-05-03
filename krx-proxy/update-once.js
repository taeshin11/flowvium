/**
 * One-shot KRX flow updater — called by GitHub Actions cron.
 * Fetches KRX investor flow data and writes all 4 periods to Upstash Redis.
 *
 * Fix history:
 * - v2: Added session cookie pre-fetch to resolve KRX 403 (Azure IP block workaround).
 *       Replaced parallel burst with sequential batching to avoid rate-limit 400s.
 *       Removed process.exit(1) — job no longer fails on KRX unavailability.
 */
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const EN_NAMES = {
  '005930': 'Samsung Electronics', '000660': 'SK Hynix',       '005380': 'Hyundai Motor',
  '035420': 'NAVER',               '005490': 'POSCO Holdings',  '000270': 'Kia',
  '035720': 'Kakao',               '051910': 'LG Chem',         '028260': 'Samsung C&T',
  '003550': 'LG',                  '012330': 'Hyundai Mobis',   '096770': 'SK Innovation',
  '017670': 'SK Telecom',          '030200': 'KT',              '055550': 'Shinhan Financial',
  '105560': 'KB Financial',        '086790': 'Hana Financial',  '032830': 'Samsung Life',
  '018260': 'Samsung SDS',         '009150': 'Samsung Electro-Mechanics',
};

const PERIOD_CONFIGS = {
  '1d':  { tradingDays: 1,  ttl: 15 * 60,     key: 'flowvium:korea-flow:v4:1d'  },
  '1w':  { tradingDays: 5,  ttl: 30 * 60,     key: 'flowvium:korea-flow:v4:1w'  },
  '4w':  { tradingDays: 20, ttl: 60 * 60,     key: 'flowvium:korea-flow:v4:4w'  },
  '13w': { tradingDays: 65, ttl: 4 * 60 * 60, key: 'flowvium:korea-flow:v4:13w' },
};

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Referer': 'https://data.krx.co.kr/',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
  'Content-Type': 'application/x-www-form-urlencoded',
  'Origin': 'https://data.krx.co.kr',
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Pre-fetch KRX main page to obtain session cookies (resolves 403 from cloud IPs). */
async function getKrxCookie() {
  try {
    const res = await fetch('https://data.krx.co.kr/', {
      headers: {
        'User-Agent': BASE_HEADERS['User-Agent'],
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': BASE_HEADERS['Accept-Language'],
      },
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
    });
    const raw = res.headers.get('set-cookie') ?? '';
    // Collect all name=value pairs (headers may contain multiple cookies separated by commas)
    const pairs = raw.split(/,(?=[^;]+=)/)
      .map(c => c.split(';')[0].trim())
      .filter(Boolean)
      .join('; ');
    console.log(`[krx] session cookie: ${pairs ? pairs.slice(0, 60) + '...' : 'none'}`);
    return pairs || null;
  } catch (err) {
    console.warn('[krx] cookie pre-fetch failed:', err.message);
    return null;
  }
}

function kstDateStr(daysAgo = 0) {
  const ts = Date.now() + 9 * 3600000 - daysAgo * 86400000;
  return new Date(ts).toISOString().slice(0, 10).replace(/-/g, '');
}

function getLastNTradingDays(n) {
  const days = [];
  let offset = 0;
  while (days.length < n && offset < n * 3) {
    const ts = Date.now() + 9 * 3600000 - offset * 86400000;
    const dow = new Date(ts).getDay();
    if (dow !== 0 && dow !== 6) days.push(new Date(ts).toISOString().slice(0, 10).replace(/-/g, ''));
    offset++;
  }
  return days;
}

async function fetchKrxFlowForDate(market, trdDd, headers) {
  const body = new URLSearchParams({
    bld: 'dbms/MDC/STAT/standard/MDCSTAT02301',
    mktId: market === 'KOSPI' ? 'STK' : 'KSQ',
    invstTpCd: '9000',
    trdDd,
    share: '1',
    money: '1',
    csvxls_isNo: 'false',
  });
  try {
    const res = await fetch('https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd', {
      method: 'POST',
      headers,
      body: body.toString(),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) { console.warn(`[krx] HTTP ${res.status} ${market} ${trdDd}`); return []; }
    const json = await res.json();
    const rows = json?.output ?? [];
    console.log(`[krx] ${market} ${trdDd}: ${rows.length} rows`);
    return rows.map(r => ({
      ticker: r.ISU_SRT_CD,
      name: EN_NAMES[r.ISU_SRT_CD] ?? r.ISU_ABBRV,
      market,
      foreignerNetBuy:   Number((r.FORN_NETBY_TRDVAL  ?? '0').replace(/,/g, '')) || null,
      institutionNetBuy: Number((r.ORGN_NETBY_TRDVAL   ?? '0').replace(/,/g, '')) || null,
      individualNetBuy:  Number((r.IND_NETBY_TRDVAL    ?? '0').replace(/,/g, '')) || null,
      closePrice:        Number((r.TDD_CLSPRC          ?? '0').replace(/,/g, '')) || null,
      changePct:         Number((r.FLUC_RT             ?? '0').replace(/,/g, '')) || null,
    })).filter(e => e.ticker && e.name);
  } catch (err) {
    console.error(`[krx] error ${market} ${trdDd}:`, err.message);
    return [];
  }
}

async function fetchSingleDay(market, headers) {
  for (let daysAgo = 0; daysAgo <= 7; daysAgo++) {
    const trdDd = kstDateStr(daysAgo);
    const entries = await fetchKrxFlowForDate(market, trdDd, headers);
    if (entries.length > 0) return { entries, trdDd };
    await sleep(300);
  }
  return { entries: [], trdDd: kstDateStr(0) };
}

/** Sequential batching with delay to avoid KRX rate-limit 400s. */
async function fetchAccumulated(market, tradingDays, headers) {
  const nameMap = new Map();
  const acc = new Map();
  let mostRecent = [], mostRecentDate = '';

  // Fetch sequentially in pairs (2 concurrent max) with 400ms pause between pairs
  const BATCH = 2;
  for (let i = 0; i < tradingDays.length; i += BATCH) {
    const batch = tradingDays.slice(i, i + BATCH);
    const results = await Promise.allSettled(batch.map(d => fetchKrxFlowForDate(market, d, headers)));
    results.forEach((r, bi) => {
      if (r.status !== 'fulfilled') return;
      const day = batch[bi];
      for (const e of r.value) {
        if (!nameMap.has(e.ticker)) nameMap.set(e.ticker, e.name);
        const ex = acc.get(e.ticker);
        if (ex) { ex.fb += e.foreignerNetBuy ?? 0; ex.ib += e.institutionNetBuy ?? 0; ex.indi += e.individualNetBuy ?? 0; }
        else acc.set(e.ticker, { fb: e.foreignerNetBuy ?? 0, ib: e.institutionNetBuy ?? 0, indi: e.individualNetBuy ?? 0 });
      }
      if (r.value.length > 0 && day > mostRecentDate) { mostRecent = r.value; mostRecentDate = day; }
    });
    if (i + BATCH < tradingDays.length) await sleep(400);
  }

  const priceMap = new Map(mostRecent.map(e => [e.ticker, { closePrice: e.closePrice, changePct: e.changePct }]));
  const entries = Array.from(acc.entries()).map(([ticker, s]) => ({
    ticker, name: EN_NAMES[ticker] ?? nameMap.get(ticker) ?? ticker, market,
    foreignerNetBuy: s.fb || null, institutionNetBuy: s.ib || null, individualNetBuy: s.indi || null,
    closePrice: priceMap.get(ticker)?.closePrice ?? null,
    changePct:  priceMap.get(ticker)?.changePct  ?? null,
  })).filter(e => e.name !== e.ticker);
  return { entries, trdDd: mostRecentDate || tradingDays[0] };
}

function buildPayload(all, trdDd, period) {
  const tradingDayFmt = `${trdDd.slice(0,4)}-${trdDd.slice(4,6)}-${trdDd.slice(6,8)}`;
  const topForeignBuy  = [...all].filter(e => (e.foreignerNetBuy   ?? 0) > 0).sort((a,b) => (b.foreignerNetBuy   ?? 0) - (a.foreignerNetBuy   ?? 0)).slice(0,15);
  const topForeignSell = [...all].filter(e => (e.foreignerNetBuy   ?? 0) < 0).sort((a,b) => (a.foreignerNetBuy   ?? 0) - (b.foreignerNetBuy   ?? 0)).slice(0,15);
  const topInstBuy     = [...all].filter(e => (e.institutionNetBuy ?? 0) > 0).sort((a,b) => (b.institutionNetBuy ?? 0) - (a.institutionNetBuy ?? 0)).slice(0,15);
  const topInstSell    = [...all].filter(e => (e.institutionNetBuy ?? 0) < 0).sort((a,b) => (a.institutionNetBuy ?? 0) - (b.institutionNetBuy ?? 0)).slice(0,15);
  const hasFlow = all.some(e => e.foreignerNetBuy != null);
  return {
    updatedAt: new Date().toISOString(),
    tradingDay: tradingDayFmt,
    topForeignBuy, topForeignSell, topInstBuy, topInstSell,
    totalTickers: all.length,
    foreignNet:     hasFlow ? all.reduce((s,e) => s + (e.foreignerNetBuy   ?? 0), 0) : null,
    institutionNet: hasFlow ? all.reduce((s,e) => s + (e.institutionNetBuy ?? 0), 0) : null,
    retailNet:      hasFlow ? all.reduce((s,e) => s + (e.individualNetBuy  ?? 0), 0) : null,
    fallback: false,
    period,
  };
}

async function updatePeriod(period, headers) {
  const cfg = PERIOD_CONFIGS[period];
  let all, trdDd;
  if (period === '1d') {
    const [kospi, kosdaq] = await Promise.all([fetchSingleDay('KOSPI', headers), fetchSingleDay('KOSDAQ', headers)]);
    all = [...kospi.entries, ...kosdaq.entries];
    trdDd = kospi.trdDd >= kosdaq.trdDd ? kospi.trdDd : kosdaq.trdDd;
  } else {
    const days = getLastNTradingDays(cfg.tradingDays);
    const [kospi, kosdaq] = await Promise.all([
      fetchAccumulated('KOSPI', days, headers),
      fetchAccumulated('KOSDAQ', days, headers),
    ]);
    all = [...kospi.entries, ...kosdaq.entries];
    trdDd = kospi.trdDd >= kosdaq.trdDd ? kospi.trdDd : kosdaq.trdDd;
  }
  if (all.length === 0) { console.warn(`[update] period=${period} KRX empty — skip`); return false; }
  const payload = buildPayload(all, trdDd, period);
  await redis.set(cfg.key, payload, { ex: cfg.ttl });
  console.log(`[update] period=${period} ✓ ${all.length} tickers → Redis (TTL=${cfg.ttl}s, day=${payload.tradingDay})`);
  return true;
}

// ── Main ────────────────────────────────────────────────────────────────────
const cookie = await getKrxCookie();
const KRX_HEADERS = cookie ? { ...BASE_HEADERS, Cookie: cookie } : BASE_HEADERS;

const results = await Promise.allSettled(Object.keys(PERIOD_CONFIGS).map(p => updatePeriod(p, KRX_HEADERS)));
const ok = results.filter(r => r.status === 'fulfilled' && r.value).length;
const fail = results.filter(r => r.status === 'rejected' || !r.value).length;
console.log(`\n[done] ${ok} periods updated, ${fail} skipped/failed`);
// No process.exit(1) — KRX unavailability should not fail the GitHub Actions job.
// Stale Redis data is handled gracefully by the korea-flow API route (fallback mode).
