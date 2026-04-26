import { logger, loggedRedisSet} from '@/lib/logger';
import { YAHOO_HEADERS } from '@/lib/yahoo-finance';
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
export const dynamic = 'force-dynamic';
import { Redis } from '@upstash/redis';

const CACHE_TTL = 4 * 60 * 60;
const STALE_KEY_PREFIX = 'flowvium:capital-flows:stale';
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=14400, stale-while-revalidate=600' };

// Module-level memory cache — this route makes ~41 Yahoo API calls on every miss.
// Without Redis, downstream routes (flow-analysis, daily-brief) each trigger a full refetch.
// 15-min TTL matches Yahoo Finance's own delay granularity.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let CAPITAL_MEMORY_CACHE: { data: any; expiresAt: number } | null = null;
const CAPITAL_MEMORY_TTL_MS = 15 * 60 * 1000;

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

const ASSETS = [
  { id: 'us-stocks',   ticker: 'SPY',   label: 'US Equities',   group: 'equity',      flag: '🇺🇸' },
  { id: 'em-stocks',   ticker: 'EEM',   label: 'EM Equities',   group: 'equity',      flag: '🌏' },
  { id: 'eu-stocks',   ticker: 'VGK',   label: 'EU Equities',   group: 'equity',      flag: '🇪🇺' },
  { id: 'us-tech',     ticker: 'QQQ',   label: 'US Tech',       group: 'equity',      flag: '💻' },
  { id: 'us-bonds-lt', ticker: 'TLT',   label: 'US LT Bonds',   group: 'bonds',       flag: '📊' },
  { id: 'us-bonds-st', ticker: 'SHY',   label: 'US ST Bonds',   group: 'bonds',       flag: '📋' },
  { id: 'hy-bonds',    ticker: 'HYG',   label: 'High Yield',    group: 'bonds',       flag: '📈' },
  { id: 'gold',        ticker: 'GLD',   label: 'Gold',          group: 'alts',        flag: '🥇' },
  { id: 'silver',      ticker: 'SLV',   label: 'Silver',        group: 'alts',        flag: '🪙' },
  { id: 'bitcoin',     ticker: 'BITO',  label: 'Bitcoin',       group: 'alts',        flag: '₿' },
  { id: 'oil',         ticker: 'USO',   label: 'WTI Oil',       group: 'commodities', flag: '🛢️' },
  { id: 'energy',      ticker: 'XLE',   label: 'US Energy',     group: 'commodities', flag: '⚡' },
  { id: 'agri',        ticker: 'DBA',   label: 'Agriculture',   group: 'commodities', flag: '🌾' },
  { id: 'dollar',      ticker: 'UUP',   label: 'USD',           group: 'currency',    flag: '💵' },
  { id: 'yen',         ticker: 'FXY',   label: 'JPY',           group: 'currency',    flag: '💴' },
];

// ── Smart Beta Factor ETFs ────────────────────────────────────────────────────
const FACTORS = [
  { id: 'momentum', ticker: 'MTUM', label: 'Momentum',    flag: '📈', desc: 'Momentum (MTUM)' },
  { id: 'quality',  ticker: 'QUAL', label: 'Quality',     flag: '⭐', desc: 'Quality (QUAL)' },
  { id: 'value',    ticker: 'VLUE', label: 'Value',       flag: '💎', desc: 'Value (VLUE)' },
  { id: 'lowvol',   ticker: 'USMV', label: 'Low Vol',     flag: '🛡️', desc: 'Low Vol (USMV)' },
  { id: 'growth',   ticker: 'IVW',  label: 'Growth',      flag: '🚀', desc: 'Growth (IVW)' },
  { id: 'blend',    ticker: 'IVE',  label: 'Value Blend', flag: '⚖️', desc: 'Value Blend (IVE)' },
];

// ── US Sector ETFs ───────────────────────────────────────────────────────────
const SECTORS = [
  { id: 'tech',        ticker: 'XLK',  label: 'Tech',          flag: '💻' },
  { id: 'financials',  ticker: 'XLF',  label: 'Financials',    flag: '🏦' },
  { id: 'energy',      ticker: 'XLE',  label: 'Energy',        flag: '⚡' },
  { id: 'healthcare',  ticker: 'XLV',  label: 'Healthcare',    flag: '🏥' },
  { id: 'industrials', ticker: 'XLI',  label: 'Industrials',   flag: '🏭' },
  { id: 'materials',   ticker: 'XLB',  label: 'Materials',     flag: '⚗️' },
  { id: 'consdisc',    ticker: 'XLY',  label: 'Cons. Disc.',   flag: '🛍️' },
  { id: 'consstaples', ticker: 'XLP',  label: 'Cons. Staples', flag: '🛒' },
  { id: 'utilities',   ticker: 'XLU',  label: 'Utilities',     flag: '💡' },
  { id: 'realestate',  ticker: 'XLRE', label: 'Real Estate',   flag: '🏠' },
  { id: 'commsvc',     ticker: 'XLC',  label: 'Comm. Svcs',    flag: '📡' },
];

// ── Country ETFs ──────────────────────────────────────────────────────────────
const COUNTRIES = [
  { id: 'us',        ticker: 'SPY',  label: 'US',          flag: '🇺🇸' },
  { id: 'korea',     ticker: 'EWY',  label: 'Korea',       flag: '🇰🇷' },
  { id: 'japan',     ticker: 'EWJ',  label: 'Japan',       flag: '🇯🇵' },
  { id: 'china',     ticker: 'FXI',  label: 'China',       flag: '🇨🇳' },
  { id: 'europe',    ticker: 'VGK',  label: 'Europe',      flag: '🇪🇺' },
  { id: 'uk',        ticker: 'EWU',  label: 'UK',          flag: '🇬🇧' },
  { id: 'india',     ticker: 'INDA', label: 'India',       flag: '🇮🇳' },
  { id: 'brazil',    ticker: 'EWZ',  label: 'Brazil',      flag: '🇧🇷' },
  { id: 'taiwan',    ticker: 'EWT',  label: 'Taiwan',      flag: '🇹🇼' },
  { id: 'australia', ticker: 'EWA',  label: 'Australia',   flag: '🇦🇺' },
  { id: 'germany',   ticker: 'EWG',  label: 'Germany',     flag: '🇩🇪' },
  { id: 'mexico',    ticker: 'EWW',  label: 'Mexico',      flag: '🇲🇽' },
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

// ── Source 2b: Finnhub candle (free 60rpm, FINNHUB_KEY required) ─────────────
async function fetchPricesFinnhub(ticker: string, finnhubKey: string): Promise<number[]> {
  const to = Math.floor(Date.now() / 1000);
  const from = to - 130 * 86400; // 130 calendar days → ~90 trading days
  const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(ticker)}&resolution=D&from=${from}&to=${to}&token=${finnhubKey}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), cache: 'no-store' });
  if (!res.ok) throw new Error(`Finnhub HTTP ${res.status}`);
  const data = await res.json();
  if (data.s !== 'ok') throw new Error(`Finnhub status: ${data.s}`);
  const closes: number[] = data.c ?? [];
  if (closes.length < 20) throw new Error('Finnhub: insufficient data');
  return closes;
}

// ── Source 3: Yahoo Finance (15-min delay, no key, primary fallback) ──────────
async function fetchPricesYahoo(ticker: string): Promise<number[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=120d`;
  const res = await fetch(url, {
    headers: YAHOO_HEADERS,
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

// ── Source 2b: Yahoo Finance spark batch (up to 20 symbols per request) ──────
// Returns a map of ticker → closes[]. Missing/failed tickers are omitted.
async function fetchPricesBatchYahoo(tickers: string[]): Promise<Record<string, number[]>> {
  if (tickers.length === 0) return {};
  const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${tickers.join(',')}&range=6mo&interval=1d`;
  const res = await fetch(url, {
    headers: YAHOO_HEADERS,
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

// ── Cascade: Twelve → Yahoo (individual) ─────────────────────────────────────
async function fetchPrices(ticker: string, twelveKey: string | null): Promise<{ prices: number[]; source: string }> {
  if (twelveKey) {
    try { return { prices: await fetchPricesTwelve(ticker, twelveKey), source: 'twelve' }; }
    catch (e) { logger.warn('capital-flows', 'twelve_failed', { ticker, error: e }); }
  }
  try { return { prices: await fetchPricesYahoo(ticker), source: 'yahoo' }; }
  catch (e) {
    logger.error('capital-flows', 'all_sources_failed', { ticker, error: e });
    return { prices: [], source: 'failed' };
  }
}

// ── Batch fetch: split tickers into ≤20 chunks, fetch in parallel ─────────────
async function fetchAllPrices(
  allTickers: string[],
  twelveKey: string | null,
  finnhubKey: string | null,
): Promise<{ priceMap: Record<string, number[]>; sourceCount: Record<string, number> }> {
  const priceMap: Record<string, number[]> = {};
  const sourceCount: Record<string, number> = {};

  if (twelveKey) {
    // Twelve Data: individual fetches (no batch endpoint)
    await Promise.all(
      allTickers.map(async (ticker) => {
        try {
          priceMap[ticker] = await fetchPricesTwelve(ticker, twelveKey);
          sourceCount['twelve'] = (sourceCount['twelve'] ?? 0) + 1;
        } catch (e) {
          logger.warn('capital-flows', 'twelve_failed', { ticker, error: e });
          // leave priceMap[ticker] undefined — checked below
        }
      })
    );

    const twelveSuccess = sourceCount['twelve'] ?? 0;
    if (twelveSuccess > allTickers.length / 2) {
      // Twelve Data mostly succeeded — fill missing slots with individual Yahoo
      const failed = allTickers.filter(t => !(priceMap[t]?.length > 0));
      await Promise.all(failed.map(async t => {
        try { priceMap[t] = await fetchPricesYahoo(t); sourceCount['yahoo'] = (sourceCount['yahoo'] ?? 0) + 1; }
        catch { priceMap[t] = []; sourceCount['failed'] = (sourceCount['failed'] ?? 0) + 1; }
      }));
      return { priceMap, sourceCount };
    }

    // Twelve Data mostly failed (rate-limit / key exhausted) — fall through to Yahoo batch.
    // 41 concurrent individual Yahoo calls would trigger rate-block; batch is safer.
    logger.warn('capital-flows', 'twelve_mass_failure_batch_fallback', { success: twelveSuccess, total: allTickers.length });
    // Reset priceMap for Yahoo batch re-population
    for (const t of allTickers) delete priceMap[t];
    sourceCount['twelve'] = 0;
  }

  // Yahoo v7 spark batch: ≤20 per request, 3 parallel batches for ~41 tickers
  // (runs when no twelve key OR when twelve data mass-failed)
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

  // Finnhub fallback for tickers that still have no data (Yahoo batch blocked)
  if (finnhubKey && failed.length > 0) {
    logger.warn('capital-flows', 'yahoo_batch_failed_finnhub_fallback', { failed: failed.length });
    await Promise.all(failed.map(async (ticker) => {
      try {
        priceMap[ticker] = await fetchPricesFinnhub(ticker, finnhubKey);
        sourceCount['finnhub'] = (sourceCount['finnhub'] ?? 0) + 1;
      } catch {
        priceMap[ticker] = [];
        sourceCount['failed'] = (sourceCount['failed'] ?? 0) + 1;
      }
    }));
  } else {
    for (const ticker of failed) {
      priceMap[ticker] = [];
      sourceCount['failed'] = (sourceCount['failed'] ?? 0) + 1;
    }
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

  // Scan back in 1-week steps (bounded by maxWeeks) to find start of divergence.
  // Default to maxWeeks so a rotation that spans the full window reports the correct age,
  // not "1 week ago" (the old off-by-direction bug).
  let weeksAgo = maxWeeks;
  for (let w = maxWeeks; w >= 1; w--) {
    const toRet = avgGroupReturn(toTickers, w * 5, 5);
    const fromRet = avgGroupReturn(fromTickers, w * 5, 5);
    if (toRet - fromRet < 0.5) {
      weeksAgo = Math.min(w + 1, maxWeeks);
      break;
    }
  }

  // Momentum: compare 1w spread vs 4w average weekly spread
  const spread1w = avgGroupReturn(toTickers, 0, 5) - avgGroupReturn(fromTickers, 0, 5);
  const spread4wPerWeek = (avgGroupReturn(toTickers, 0, 20) - avgGroupReturn(fromTickers, 0, 20)) / 4;
  const momentum: 'accelerating' | 'holding' | 'fading' =
    spread1w > spread4wPerWeek * 1.3 ? 'accelerating' :
    spread1w < spread4wPerWeek * 0.4 ? 'fading' : 'holding';

  const start = new Date();
  start.setDate(start.getDate() - weeksAgo * 7);
  const startDate = start.toISOString().split('T')[0];

  return { weeksAgo, startDate, momentum };
}

// Group IDs are returned to client; client resolves labels via i18n
// Removed GROUP_LABELS (was Korean-only; replaced with stable group IDs)

type RotationEntry = {
  from: string; to: string; magnitude: number;
  weeksAgo: number; startDate: string; momentum: 'accelerating' | 'holding' | 'fading';
};

type AssetResult = { id: string; label: string; flag: string; group: string; ticker: string; ret1w: number; ret4w: number; ret13w: number; sparkline?: number[] };

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
          from: groupAvg[j].group,
          to: groupAvg[i].group,
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
  const finnhubKey = process.env.FINNHUB_KEY?.trim() || null;
  const dataSource = twelveKey ? 'Twelve Data (realtime)' : 'Yahoo Finance (15min delay)';
  const cacheKey = `flowvium:capital-flows:v11:${twelveKey ? 'twelve' : 'yahoo'}`;

  // Module-level memory cache — saves ~41 Yahoo calls per warm-instance hit
  if (!redis && CAPITAL_MEMORY_CACHE && Date.now() < CAPITAL_MEMORY_CACHE.expiresAt) {
    logger.info('capital-flows', 'memory_cache_hit');
    return NextResponse.json(CAPITAL_MEMORY_CACHE.data, { headers: CDN_HEADERS });
  }

  let staleResult: object | null = null;
  if (redis) {
    try {
      const [fresh, stale] = await Promise.allSettled([
        redis.get<object>(cacheKey),
        redis.get<object>(`${STALE_KEY_PREFIX}:${twelveKey ? 'twelve' : 'yahoo'}`),
      ]);
      if (fresh.status === 'fulfilled' && fresh.value) {
        return NextResponse.json(fresh.value, { headers: CDN_HEADERS });
      }
      if (stale.status === 'fulfilled') staleResult = stale.value;
    } catch (e) { logger.warn('capital-flows', 'cache_read_error', { error: e }); }
  }

  const allTickers = Array.from(new Set([
    ...ASSETS.map((a) => a.ticker),
    ...COUNTRIES.map((c) => c.ticker),
    ...FACTORS.map((f) => f.ticker),
    ...SECTORS.map((s) => s.ticker),
  ]));

  const { priceMap, sourceCount } = await fetchAllPrices(allTickers, twelveKey, finnhubKey);

  // Describe which sources actually provided data
  const sourceSummary = Object.entries(sourceCount)
    .filter(([s]) => s !== 'failed')
    .filter(([, n]) => (n as number) > 0)
    .map(([s, n]) => ({ twelve: 'Twelve Data', yahoo: 'Yahoo Finance', finnhub: 'Finnhub' }[s] ?? s) + ` ×${n}`)
    .join(' + ');

  const results = ASSETS.map((asset) => {
    const prices = priceMap[asset.ticker] ?? [];
    const sparkline = prices.length >= 5 ? prices.slice(-26).map(p => parseFloat(p.toFixed(2))) : undefined;
    return {
      id: asset.id,
      label: asset.label,
      flag: asset.flag,
      group: asset.group,
      ticker: asset.ticker,
      ret1w:  pctReturn(prices, 5),
      ret4w:  pctReturn(prices, 20),
      ret13w: pctReturn(prices, 65),
      sparkline,
    };
  }).filter((r) => r.ret4w !== 0 || r.ret13w !== 0);

  const flow = detectRotation(results, priceMap);

  const gldPrices = priceMap['GLD'] ?? [];
  const uupPrices = priceMap['UUP'] ?? [];

  function goldSignal(g: number, d: number): string {
    return g > d + 2 ? 'gold_preferred' : d > g + 2 ? 'dollar_preferred' : 'mixed';
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
    const pairs: { from: string; fromFlag: string; fromId: string; to: string; toFlag: string; toId: string; magnitude: number; momentum: 'accelerating' | 'holding' | 'fading' }[] = [];
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
          pairs.push({ from: sorted[j].label, fromFlag: sorted[j].flag, fromId: sorted[j].id, to: sorted[i].label, toFlag: sorted[i].flag, toId: sorted[i].id, magnitude: spread, momentum });
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

  const hasData = results.length > 0;
  if (redis) {
    try {
      const staleKey = `${STALE_KEY_PREFIX}:${twelveKey ? 'twelve' : 'yahoo'}`;
      await loggedRedisSet(redis, 'api.capital-flows', cacheKey, response, { ex: CACHE_TTL });
      if (hasData) await loggedRedisSet(redis, 'api.capital-flows', staleKey, response, {});
      logger.info('capital-flows', 'cache_saved', { assets: results.length, failedTickers: sourceCount['failed'] ?? 0 });
    } catch (e) { logger.warn('capital-flows', 'cache_write_error', { error: e }); }
  }

  // All price sources failed — serve stale cache to preserve flow-analysis downstream
  if (!hasData && staleResult) {
    logger.info('capital-flows', 'stale_fallback', { note: 'All price sources failed, serving stale' });
    return NextResponse.json({ ...(staleResult as object), stale: true }, { headers: CDN_HEADERS });
  }

  // Module-level memory cache write (no-Redis path)
  if (!redis) {
    CAPITAL_MEMORY_CACHE = { data: response, expiresAt: Date.now() + CAPITAL_MEMORY_TTL_MS };
    logger.info('capital-flows', 'memory_cache_written', { assets: results.length });
  }

  return NextResponse.json(response, { headers: CDN_HEADERS });
}
