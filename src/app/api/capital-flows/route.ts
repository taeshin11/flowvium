import { logger, loggedRedisSet} from '@/lib/logger';
/**
 * /api/capital-flows
 *
 * Data source priority:
 *   1. Twelve Data (if TWELVE_DATA_KEY set) — real-time, higher rate limit
 *   2. Yahoo Finance fallback — 15-min delayed
 *
 * Features:
 *   - 1w/4w/13w returns per asset
 *   - Cross-asset rotation detection with start date + momentum (accel/hold/fade)
 *   - Redis 4h cache
 */
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const CACHE_TTL = 4 * 60 * 60;
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=14400, stale-while-revalidate=600' };

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

const ASSETS = [
  { id: 'us-stocks',   ticker: 'SPY',   label: '미국 주식',    group: 'equity',      flag: '🇺🇸' },
  { id: 'em-stocks',   ticker: 'EEM',   label: '이머징마켓 주식', group: 'equity',   flag: '🌏' },
  { id: 'eu-stocks',   ticker: 'VGK',   label: '유럽 주식',    group: 'equity',      flag: '🇪🇺' },
  { id: 'us-tech',     ticker: 'QQQ',   label: '미국 테크',    group: 'equity',      flag: '💻' },
  { id: 'us-bonds-lt', ticker: 'TLT',   label: '미 장기채',    group: 'bonds',       flag: '📊' },
  { id: 'us-bonds-st', ticker: 'SHY',   label: '미 단기채',    group: 'bonds',       flag: '📋' },
  { id: 'hy-bonds',    ticker: 'HYG',   label: '하이일드채',   group: 'bonds',       flag: '📈' },
  { id: 'gold',        ticker: 'GLD',   label: '금',           group: 'alts',        flag: '🥇' },
  { id: 'silver',      ticker: 'SLV',   label: '은',           group: 'alts',        flag: '🪙' },
  { id: 'bitcoin',     ticker: 'BITO',  label: '비트코인',     group: 'alts',        flag: '₿' },
  { id: 'oil',         ticker: 'USO',   label: '원유',         group: 'commodities', flag: '🛢️' },
  { id: 'energy',      ticker: 'XLE',   label: '에너지',       group: 'commodities', flag: '⚡' },
  { id: 'agri',        ticker: 'DBA',   label: '농산물',       group: 'commodities', flag: '🌾' },
  { id: 'dollar',      ticker: 'UUP',   label: '달러',         group: 'currency',    flag: '💵' },
  { id: 'yen',         ticker: 'FXY',   label: '엔화',         group: 'currency',    flag: '💴' },
];

// ── Smart Beta Factor ETFs ────────────────────────────────────────────────────
const FACTORS = [
  { id: 'momentum', ticker: 'MTUM', label: '모멘텀',       flag: '📈', desc: 'Momentum (MTUM)' },
  { id: 'quality',  ticker: 'QUAL', label: '퀄리티',       flag: '⭐', desc: 'Quality (QUAL)' },
  { id: 'value',    ticker: 'VLUE', label: '가치',         flag: '💎', desc: 'Value (VLUE)' },
  { id: 'lowvol',   ticker: 'USMV', label: '저변동성',     flag: '🛡️', desc: 'Low Vol (USMV)' },
  { id: 'growth',   ticker: 'IVW',  label: '성장',         flag: '🚀', desc: 'Growth (IVW)' },
  { id: 'blend',    ticker: 'IVE',  label: '블렌드(가치)',  flag: '⚖️', desc: 'Value Blend (IVE)' },
];

// ── US Sector ETFs ───────────────────────────────────────────────────────────
const SECTORS = [
  { id: 'tech',        ticker: 'XLK',  label: '기술',         flag: '💻' },
  { id: 'financials',  ticker: 'XLF',  label: '금융',         flag: '🏦' },
  { id: 'energy',      ticker: 'XLE',  label: '에너지',       flag: '⚡' },
  { id: 'healthcare',  ticker: 'XLV',  label: '헬스케어',     flag: '🏥' },
  { id: 'industrials', ticker: 'XLI',  label: '산업재',       flag: '🏭' },
  { id: 'materials',   ticker: 'XLB',  label: '소재',         flag: '⚗️' },
  { id: 'consdisc',    ticker: 'XLY',  label: '임의소비재',   flag: '🛍️' },
  { id: 'consstaples', ticker: 'XLP',  label: '필수소비재',   flag: '🛒' },
  { id: 'utilities',   ticker: 'XLU',  label: '유틸리티',     flag: '💡' },
  { id: 'realestate',  ticker: 'XLRE', label: '부동산',       flag: '🏠' },
  { id: 'commsvc',     ticker: 'XLC',  label: '통신',         flag: '📡' },
];

// ── Country ETFs ──────────────────────────────────────────────────────────────
const COUNTRIES = [
  { id: 'us',        ticker: 'SPY',  label: '미국',       flag: '🇺🇸' },
  { id: 'korea',     ticker: 'EWY',  label: '한국',       flag: '🇰🇷' },
  { id: 'japan',     ticker: 'EWJ',  label: '일본',       flag: '🇯🇵' },
  { id: 'china',     ticker: 'FXI',  label: '중국',       flag: '🇨🇳' },
  { id: 'europe',    ticker: 'VGK',  label: '유럽',       flag: '🇪🇺' },
  { id: 'uk',        ticker: 'EWU',  label: '영국',       flag: '🇬🇧' },
  { id: 'india',     ticker: 'INDA', label: '인도',       flag: '🇮🇳' },
  { id: 'brazil',    ticker: 'EWZ',  label: '브라질',     flag: '🇧🇷' },
  { id: 'taiwan',    ticker: 'EWT',  label: '대만',       flag: '🇹🇼' },
  { id: 'australia', ticker: 'EWA',  label: '호주',       flag: '🇦🇺' },
  { id: 'germany',   ticker: 'EWG',  label: '독일',       flag: '🇩🇪' },
  { id: 'mexico',    ticker: 'EWW',  label: '멕시코',     flag: '🇲🇽' },
];

// ── Data fetchers ─────────────────────────────────────────────────────────────

// ── Source 1: Twelve Data (real-time, 800 calls/day free) ─────────────────────
async function fetchPricesTwelve(ticker: string, apiKey: string): Promise<number[]> {
  const url = `https://api.twelvedata.com/time_series?symbol=${ticker}&interval=1day&outputsize=120&apikey=${apiKey}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), cache: 'no-store' });
  if (!res.ok) throw new Error(`Twelve HTTP ${res.status}`);
  const data = await res.json();
  if (data.status === 'error') throw new Error(data.message);
  const values: Array<{ close: string }> = data?.values ?? [];
  const prices = values.reverse().map((v) => parseFloat(v.close)).filter((v) => !isNaN(v));
  if (prices.length < 20) throw new Error('Twelve: insufficient data');
  return prices;
}

// ── Source 2: Yahoo Finance (15-min delay, no key, primary fallback) ──────────
async function fetchPricesYahoo(ticker: string): Promise<number[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=120d`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(8000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  const data = await res.json();
  const closes: number[] = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
  const prices = closes.filter((v) => v != null && !isNaN(v));
  if (prices.length < 20) throw new Error('Yahoo: insufficient data');
  return prices;
}

// ── Source 3: Stooq (no key, no rate limit, secondary fallback) ───────────────
async function fetchPricesStooq(ticker: string): Promise<number[]> {
  // Stooq uses symbol format like "SPY.US" for US ETFs
  const sym = ticker.includes('.') ? ticker : `${ticker}.US`;
  const url = `https://stooq.com/q/d/l/?s=${sym.toLowerCase()}&i=d`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(10000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Stooq HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.trim().split('\n').slice(1); // skip header
  const prices = lines
    .slice(-120) // last 120 trading days
    .map((line) => {
      const cols = line.split(',');
      return parseFloat(cols[4] ?? ''); // Close is column 5
    })
    .filter((v) => !isNaN(v));
  if (prices.length < 20) throw new Error('Stooq: insufficient data');
  return prices;
}

// ── Source 2b: Yahoo Finance spark batch (up to 20 symbols per request) ──────
// Returns a map of ticker → closes[]. Missing/failed tickers are omitted.
async function fetchPricesBatchYahoo(tickers: string[]): Promise<Record<string, number[]>> {
  if (tickers.length === 0) return {};
  const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${tickers.join(',')}&range=6mo&interval=1d`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(12000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Yahoo spark HTTP ${res.status}`);
  const data = await res.json();
  const results: Array<{ symbol: string; response?: Array<{ indicators?: { quote?: Array<{ close?: (number | null)[] }> } }> }>
    = data?.spark?.result ?? [];
  const out: Record<string, number[]> = {};
  for (const r of results) {
    const closes = r.response?.[0]?.indicators?.quote?.[0]?.close ?? [];
    const prices = closes.filter((v): v is number => v != null && !isNaN(v));
    if (prices.length >= 20) out[r.symbol] = prices;
  }
  return out;
}

// ── Cascade: Twelve → Yahoo → Stooq ──────────────────────────────────────────
async function fetchPrices(ticker: string, twelveKey: string | null): Promise<{ prices: number[]; source: string }> {
  if (twelveKey) {
    try { return { prices: await fetchPricesTwelve(ticker, twelveKey), source: 'twelve' }; }
    catch (e) { logger.warn('capital-flows', 'twelve_failed', { ticker, error: e }); }
  }
  try { return { prices: await fetchPricesYahoo(ticker), source: 'yahoo' }; }
  catch (e) { logger.warn('capital-flows', 'yahoo_failed', { ticker, error: e }); }
  try { return { prices: await fetchPricesStooq(ticker), source: 'stooq' }; }
  catch (e) {
    logger.error('capital-flows', 'all_sources_failed', { ticker, error: e });
    return { prices: [], source: 'failed' };
  }
}

// ── Batch fetch: split tickers into ≤20 chunks, fetch in parallel ─────────────
async function fetchAllPrices(
  allTickers: string[],
  twelveKey: string | null,
): Promise<{ priceMap: Record<string, number[]>; sourceCount: Record<string, number> }> {
  const priceMap: Record<string, number[]> = {};
  const sourceCount: Record<string, number> = {};

  if (twelveKey) {
    // Twelve Data: individual fetches (no batch API)
    await Promise.all(
      allTickers.map(async (ticker) => {
        const { prices, source } = await fetchPrices(ticker, twelveKey);
        priceMap[ticker] = prices;
        sourceCount[source] = (sourceCount[source] ?? 0) + 1;
      })
    );
    return { priceMap, sourceCount };
  }

  // Yahoo batch: ≤20 per request, 3 parallel batches for ~41 tickers
  const BATCH_SIZE = 20;
  const batches: string[][] = [];
  for (let i = 0; i < allTickers.length; i += BATCH_SIZE) {
    batches.push(allTickers.slice(i, i + BATCH_SIZE));
  }

  const batchResults = await Promise.allSettled(
    batches.map((batch) => fetchPricesBatchYahoo(batch))
  );

  const failed: string[] = [];
  for (let i = 0; i < batchResults.length; i++) {
    const r = batchResults[i];
    if (r.status === 'fulfilled') {
      const batchTickers = batches[i];
      for (const ticker of batchTickers) {
        if (r.value[ticker]) {
          priceMap[ticker] = r.value[ticker];
          sourceCount['yahoo'] = (sourceCount['yahoo'] ?? 0) + 1;
        } else {
          failed.push(ticker);
        }
      }
    } else {
      logger.warn('capital-flows', 'batch_failed', { batch: i, error: r.reason });
      failed.push(...batches[i]);
    }
  }

  // Individual fallback for any that weren't in batch results
  if (failed.length > 0) {
    await Promise.all(
      failed.map(async (ticker) => {
        try {
          const prices = await fetchPricesStooq(ticker);
          priceMap[ticker] = prices;
          sourceCount['stooq'] = (sourceCount['stooq'] ?? 0) + 1;
        } catch {
          priceMap[ticker] = [];
          sourceCount['failed'] = (sourceCount['failed'] ?? 0) + 1;
        }
      })
    );
  }

  return { priceMap, sourceCount };
}

// ── Analytics ─────────────────────────────────────────────────────────────────

function pctReturn(prices: number[], days: number): number {
  if (prices.length < days + 1) return 0;
  const last = prices[prices.length - 1];
  const prev = prices[prices.length - 1 - days];
  return parseFloat(((last - prev) / prev * 100).toFixed(2));
}

/** Scan back to find roughly when the group spread first became significant (≥1%/wk).
 *  maxWeeks bounds the lookback — the caller passes the selected timeframe so that
 *  e.g. a "1주 기준" view doesn't report a 13주-전 start. */
function estimateRotationStart(
  priceMap: Record<string, number[]>,
  toGroup: string,
  fromGroup: string,
  assets: typeof ASSETS,
  maxWeeks: number = 12,
): { weeksAgo: number; startDate: string; momentum: 'accelerating' | 'holding' | 'fading' } {
  const toTickers = assets.filter((a) => a.group === toGroup).map((a) => a.ticker);
  const fromTickers = assets.filter((a) => a.group === fromGroup).map((a) => a.ticker);

  const avgGroupReturn = (tickers: string[], daysBack: number, window: number): number => {
    const rets = tickers
      .map((t) => {
        const p = priceMap[t] ?? [];
        const end = p.length - daysBack;
        if (end < window + 1) return null;
        const slice = p.slice(0, end);
        return pctReturn(slice, window);
      })
      .filter((v): v is number => v !== null);
    return rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
  };

  // Scan back in 1-week steps (bounded by maxWeeks) to find start of divergence
  let weeksAgo = 1;
  for (let w = maxWeeks; w >= 1; w--) {
    const toRet = avgGroupReturn(toTickers, w * 5, 5);
    const fromRet = avgGroupReturn(fromTickers, w * 5, 5);
    if (toRet - fromRet < 0.5) {
      weeksAgo = Math.min(w + 1, maxWeeks);
      break;
    }
    weeksAgo = 1; // still going
  }

  // Momentum: compare 1w spread vs 4w average weekly spread
  const spread1w = avgGroupReturn(toTickers, 0, 5) - avgGroupReturn(fromTickers, 0, 5);
  const spread4wPerWeek = (avgGroupReturn(toTickers, 0, 20) - avgGroupReturn(fromTickers, 0, 20)) / 4;
  const momentum: 'accelerating' | 'holding' | 'fading' =
    spread1w > spread4wPerWeek * 1.3 ? 'accelerating' :
    spread1w < spread4wPerWeek * 0.4 ? 'fading' : 'holding';

  const start = new Date();
  start.setDate(start.getDate() - weeksAgo * 7);
  const startDate = `${start.getFullYear()}년 ${start.getMonth() + 1}월`;

  return { weeksAgo, startDate, momentum };
}

const GROUP_LABELS: Record<string, string> = {
  equity: '주식', bonds: '채권', alts: '금·비트코인·실물자산', commodities: '원자재', currency: '통화',
};

type RotationEntry = {
  from: string; to: string; magnitude: number;
  weeksAgo: number; startDate: string; momentum: 'accelerating' | 'holding' | 'fading';
};

type AssetResult = { id: string; label: string; flag: string; group: string; ticker: string; ret1w: number; ret4w: number; ret13w: number };

function buildRotations(
  results: AssetResult[],
  priceMap: Record<string, number[]>,
  retKey: 'ret1w' | 'ret4w' | 'ret13w',
  minSpread: number,
): RotationEntry[] {
  // Limit rotation-start lookback to the selected timeframe so the UI label is consistent
  const maxWeeks = retKey === 'ret1w' ? 2 : retKey === 'ret4w' ? 5 : 13;
  const groupPerf: Record<string, number[]> = {};
  for (const r of results) {
    if (!groupPerf[r.group]) groupPerf[r.group] = [];
    groupPerf[r.group].push(r[retKey]);
  }
  const groupAvg = Object.entries(groupPerf).map(([group, vals]) => ({
    group,
    avg: parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)),
  })).sort((a, b) => b.avg - a.avg);

  const rotations: RotationEntry[] = [];
  for (let i = 0; i < groupAvg.length; i++) {
    for (let j = i + 1; j < groupAvg.length; j++) {
      const spread = groupAvg[i].avg - groupAvg[j].avg;
      if (spread > minSpread) {
        const timing = estimateRotationStart(priceMap, groupAvg[i].group, groupAvg[j].group, ASSETS, maxWeeks);
        rotations.push({
          from: GROUP_LABELS[groupAvg[j].group] ?? groupAvg[j].group,
          to: GROUP_LABELS[groupAvg[i].group] ?? groupAvg[i].group,
          magnitude: parseFloat(spread.toFixed(1)),
          ...timing,
        });
      }
    }
  }
  return rotations.sort((a, b) => b.magnitude - a.magnitude).slice(0, 5);
}

function detectRotation(results: AssetResult[], priceMap: Record<string, number[]>) {
  const sorted4w = [...results].sort((a, b) => b.ret4w - a.ret4w);
  const topInflows = sorted4w.slice(0, 5);
  const topOutflows = sorted4w.slice(-5).reverse();

  const groupPerf: Record<string, number[]> = {};
  for (const r of results) {
    if (!groupPerf[r.group]) groupPerf[r.group] = [];
    groupPerf[r.group].push(r.ret4w);
  }
  const groupAvg = Object.entries(groupPerf).map(([group, vals]) => ({
    group,
    avg4w: parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)),
  })).sort((a, b) => b.avg4w - a.avg4w);

  return {
    topInflows,
    topOutflows,
    groupAvg,
    rotations1w:  buildRotations(results, priceMap, 'ret1w',  0.5),
    rotations4w:  buildRotations(results, priceMap, 'ret4w',  1.5),
    rotations13w: buildRotations(results, priceMap, 'ret13w', 3.0),
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET() {
  const redis = createRedis();
  const twelveKey = process.env.TWELVE_DATA_KEY?.trim() || null;
  const dataSource = twelveKey ? 'Twelve Data (실시간)' : 'Yahoo Finance (15분 지연)';
  const cacheKey = `flowvium:capital-flows:v7:${twelveKey ? 'twelve' : 'yahoo'}`;

  if (redis) {
    try {
      const cached = await redis.get<object>(cacheKey);
      if (cached) return NextResponse.json(cached, { headers: CDN_HEADERS });
    } catch (e) { logger.warn('capital-flows', 'cache_read_error', { error: e }); }
  }

  const allTickers = Array.from(new Set([
    ...ASSETS.map((a) => a.ticker),
    ...COUNTRIES.map((c) => c.ticker),
    ...FACTORS.map((f) => f.ticker),
    ...SECTORS.map((s) => s.ticker),
  ]));

  const { priceMap, sourceCount } = await fetchAllPrices(allTickers, twelveKey);

  // Describe which sources actually provided data
  const sourceSummary = Object.entries(sourceCount)
    .filter(([s]) => s !== 'failed')
    .map(([s, n]) => ({ twelve: 'Twelve Data(실시간)', yahoo: 'Yahoo Finance(15분)', stooq: 'Stooq(종가)' }[s] ?? s) + ` ${n}개`)
    .join(' + ');

  const results = ASSETS.map((asset) => {
    const prices = priceMap[asset.ticker] ?? [];
    return {
      id: asset.id,
      label: asset.label,
      flag: asset.flag,
      group: asset.group,
      ticker: asset.ticker,
      ret1w:  pctReturn(prices, 5),
      ret4w:  pctReturn(prices, 20),
      ret13w: pctReturn(prices, 65),
    };
  }).filter((r) => r.ret4w !== 0 || r.ret13w !== 0);

  const flow = detectRotation(results, priceMap);

  const gldPrices = priceMap['GLD'] ?? [];
  const uupPrices = priceMap['UUP'] ?? [];

  function goldSignal(g: number, d: number) {
    return g > d + 2 ? '금 선호 (달러 약세 헷지)' : d > g + 2 ? '달러 강세 (안전자산 달러로)' : '혼조';
  }

  const goldVsDollar = {
    // 1w
    goldRet1w:  pctReturn(gldPrices, 5),
    dollarRet1w: pctReturn(uupPrices, 5),
    signal1w: goldSignal(pctReturn(gldPrices, 5), pctReturn(uupPrices, 5)),
    // 4w
    goldRet4w:  pctReturn(gldPrices, 20),
    dollarRet4w: pctReturn(uupPrices, 20),
    signal4w: goldSignal(pctReturn(gldPrices, 20), pctReturn(uupPrices, 20)),
    // 13w
    goldRet13w:  pctReturn(gldPrices, 65),
    dollarRet13w: pctReturn(uupPrices, 65),
    signal13w: goldSignal(pctReturn(gldPrices, 65), pctReturn(uupPrices, 65)),
  };

  // ── Country flows ─────────────────────────────────────────────────────────
  const countryResults = COUNTRIES.map((c) => {
    const prices = priceMap[c.ticker] ?? [];
    return {
      id: c.id, label: c.label, flag: c.flag, ticker: c.ticker,
      ret1w:  pctReturn(prices, 5),
      ret4w:  pctReturn(prices, 20),
      ret13w: pctReturn(prices, 65),
    };
  }).filter((r) => r.ret4w !== 0 || r.ret13w !== 0);

  // Build country rotation (top 3 pairs per timeframe)
  function buildCountryRotations(retKey: 'ret1w' | 'ret4w' | 'ret13w', minSpread: number) {
    const sorted = [...countryResults].sort((a, b) => b[retKey] - a[retKey]);
    const pairs: { from: string; fromFlag: string; to: string; toFlag: string; magnitude: number; momentum: 'accelerating' | 'holding' | 'fading' }[] = [];
    for (let i = 0; i < Math.min(sorted.length, 4); i++) {
      for (let j = sorted.length - 1; j >= Math.max(0, sorted.length - 4); j--) {
        if (i >= j) continue;
        const spread = parseFloat((sorted[i][retKey] - sorted[j][retKey]).toFixed(1));
        if (spread > minSpread) {
          // Estimate momentum: compare 1w vs 4w per-week
          const spread1w = sorted[i].ret1w - sorted[j].ret1w;
          const spread4wPerWeek = (sorted[i].ret4w - sorted[j].ret4w) / 4;
          const momentum: 'accelerating' | 'holding' | 'fading' =
            spread1w > spread4wPerWeek * 1.3 ? 'accelerating' :
            spread1w < spread4wPerWeek * 0.4 ? 'fading' : 'holding';
          pairs.push({ from: sorted[j].label, fromFlag: sorted[j].flag, to: sorted[i].label, toFlag: sorted[i].flag, magnitude: spread, momentum });
        }
      }
    }
    return pairs.sort((a, b) => b.magnitude - a.magnitude).slice(0, 4);
  }

  const countryFlow = {
    countries: countryResults,
    rotations1w:  buildCountryRotations('ret1w',  0.5),
    rotations4w:  buildCountryRotations('ret4w',  1.5),
    rotations13w: buildCountryRotations('ret13w', 3.0),
  };

  // ── Smart Beta factor performance ─────────────────────────────────────────
  const factorPerformance = FACTORS.map(f => {
    const prices = priceMap[f.ticker] ?? [];
    return {
      id: f.id, label: f.label, flag: f.flag, ticker: f.ticker, desc: f.desc,
      ret1w:  pctReturn(prices, 5),
      ret4w:  pctReturn(prices, 20),
      ret13w: pctReturn(prices, 65),
    };
  }).filter(f => f.ret4w !== 0 || f.ret13w !== 0);

  // ── US Sector performance ─────────────────────────────────────────────────
  const sectorPerformance = SECTORS.map(s => {
    const prices = priceMap[s.ticker] ?? [];
    return {
      id: s.id, label: s.label, flag: s.flag, ticker: s.ticker,
      ret1w:  pctReturn(prices, 5),
      ret4w:  pctReturn(prices, 20),
      ret13w: pctReturn(prices, 65),
    };
  }).filter(s => s.ret4w !== 0 || s.ret13w !== 0);

  const response = { assets: results, flow, goldVsDollar, countryFlow, factorPerformance, sectorPerformance, dataSource: sourceSummary || dataSource, updatedAt: new Date().toISOString() };

  if (redis) {
    try {
      await loggedRedisSet(redis, 'api.capital-flows', cacheKey, response, { ex: CACHE_TTL });
      logger.info('capital-flows', 'cache_saved', { assets: results.length, failedTickers: sourceCount['failed'] ?? 0 });
    } catch (e) { logger.warn('capital-flows', 'cache_write_error', { error: e }); }
  }

  return NextResponse.json(response, { headers: CDN_HEADERS });
}
