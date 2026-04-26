import { NextResponse } from 'next/server';
import { createMemoryCache } from '@/lib/memory-cache';
import { Redis } from '@upstash/redis';
import { logger, loggedRedisSet } from '@/lib/logger';
import { YAHOO_HEADERS } from '@/lib/yahoo-finance';

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min memory
const REDIS_TTL = 6 * 60 * 60;       // 6h Redis
const STALE_KEY = 'flowvium:commodity-curve:stale';
const REDIS_KEY = 'flowvium:commodity-curve:v1';
const mem = createMemoryCache<object>('commodity-curve', CACHE_TTL_MS);
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=1500, stale-while-revalidate=120' };

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Futures month codes: index 0=Jan, 1=Feb, ...
const MONTH_CODES = ['F','G','H','J','K','M','N','Q','U','V','X','Z'];
// Gold trades major months: Feb/Apr/Jun/Aug/Oct/Dec
const GOLD_MONTHS = new Set([1, 3, 5, 7, 9, 11]); // 0-indexed

function contractSymbols(prefix: string, exchange: string, startMonth: number, startYear: number, count: number, majorOnly?: Set<number>): string[] {
  const results: string[] = [];
  let m = startMonth;
  let y = startYear;
  while (results.length < count) {
    if (!majorOnly || majorOnly.has(m)) {
      const yy = String(y).slice(-2);
      results.push(`${prefix}${MONTH_CODES[m]}${yy}${exchange}`);
    }
    m++;
    if (m >= 12) { m = 0; y++; }
  }
  return results;
}

// gold-api.com: free, no auth, cloud-IP accessible. Returns XAU spot in USD/troy oz.
async function fetchGoldSpotGoldAPI(): Promise<number | null> {
  try {
    const res = await fetch('https://api.gold-api.com/price/XAU', {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json() as { price?: number; currency?: string };
    if (data.currency !== 'USD') return null;
    const price = data.price;
    if (typeof price !== 'number' || price <= 0) return null;
    return parseFloat(price.toFixed(2));
  } catch { return null; }
}

// FRED WTI crude spot price — not Yahoo, not IP-blocked from Vercel cloud IPs.
// Series DCOILWTICO: EIA spot, 1-day lag, free no auth.
async function fetchFREDSeries(series: string, days = 14): Promise<{ latest: number; prev: number | null } | null> {
  try {
    const startDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const res = await fetch(
      `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series}&cosd=${startDate}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000), cache: 'no-store' }
    );
    if (!res.ok) return null;
    const text = await res.text();
    const lines = text.trim().split('\n').slice(1);
    const values: number[] = [];
    for (const line of lines) {
      const val = line.split(',')[1]?.trim();
      if (val && val !== '.') {
        const n = parseFloat(val);
        if (!isNaN(n) && n > 0) values.push(n);
      }
    }
    if (!values.length) return null;
    return { latest: parseFloat(values[values.length - 1].toFixed(2)), prev: values.length >= 2 ? parseFloat(values[values.length - 2].toFixed(2)) : null };
  } catch { return null; }
}

async function fetchOilSpotFRED(): Promise<number | null> {
  const r = await fetchFREDSeries('DCOILWTICO');
  return r?.latest ?? null;
}

// Build carry-model forward curve from spot price and risk-free rate.
// F(T) = Spot * exp((r + storage) * T/12) — theoretically correct, labeled as 'model'
function buildCarryCurve(spotPrice: number, riskFreeAnnual: number, storageAnnual: number, months: number, label: string): CurvePoint[] {
  const carry = riskFreeAnnual + storageAnnual; // e.g. 0.043 + 0.06 = 0.103 per year
  const points: CurvePoint[] = [{ ticker: label, label: 'Spot', price: spotPrice }];
  for (let m = 1; m <= months; m++) {
    const fwd = parseFloat((spotPrice * Math.exp(carry * m / 12)).toFixed(2));
    points.push({ ticker: `${label}:M+${m}`, label: `M+${m}`, price: fwd });
  }
  return points;
}

async function fetchPrice(ticker: string): Promise<{ ticker: string; price: number; label: string } | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`;
    const res = await fetch(url, {
      headers: YAHOO_HEADERS,
      signal: AbortSignal.timeout(6000),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) return null;
    const shortName: string = meta.shortName ?? ticker;
    // Extract "Jun 26" → label "Jun 26"
    const label = shortName.replace(/^(Crude Oil|Gold)\s+/, '');
    return { ticker, price: meta.regularMarketPrice, label };
  } catch {
    return null;
  }
}

export interface CurvePoint {
  ticker: string;
  label: string;  // e.g. "Jun 26"
  price: number;
}

export interface CommodityCurve {
  id: 'oil' | 'gold';
  name: string;
  unit: string;
  curve: CurvePoint[];
  structure: 'contango' | 'backwardation' | 'flat';
  slope: number; // % change front-to-back (positive=contango)
  updatedAt: string;
  synthetic?: boolean; // true when curve is carry-model derived (no live futures)
}

export async function GET() {
  const cacheKey = 'curves';
  const cached = mem.get(cacheKey);
  if (cached) return NextResponse.json({ ...cached, cached: true }, { headers: CDN_HEADERS });

  const redis = createRedis();
  if (redis) {
    try {
      const rCached = await redis.get(REDIS_KEY);
      if (rCached) {
        mem.set(cacheKey, rCached as object);
        return NextResponse.json({ ...(rCached as object), cached: true }, { headers: CDN_HEADERS });
      }
    } catch (e) { logger.warn('commodity-curve', 'redis_read_error', { error: e }); }
  }

  const now = new Date();
  const curMonth = now.getMonth();  // 0-indexed
  const curYear = now.getFullYear();

  // Front month for WTI: typically 2 months out (April → June front)
  // We start from current month+1 and take 7 oil months, 5 gold months
  const oilStart = (curMonth + 1) % 12;
  const oilStartYear = curYear + Math.floor((curMonth + 1) / 12);
  const goldStart = (curMonth + 1) % 12;
  const goldStartYear = curYear + Math.floor((curMonth + 1) / 12);

  const oilSymbols = contractSymbols('CL', '.NYM', oilStart, oilStartYear, 7);
  const goldSymbols = contractSymbols('GC', '.CMX', goldStart, goldStartYear, 5, GOLD_MONTHS);

  const [oilResults, goldResults] = await Promise.all([
    Promise.all(oilSymbols.map(fetchPrice)),
    Promise.all(goldSymbols.map(fetchPrice)),
  ]);

  function buildCurve(results: (CurvePoint | null)[], id: 'oil' | 'gold', name: string, unit: string): CommodityCurve {
    const curve = results.filter((r): r is CurvePoint => r !== null);
    if (curve.length < 2) {
      return { id, name, unit, curve, structure: 'flat', slope: 0, updatedAt: now.toISOString() };
    }
    const front = curve[0].price;
    const back = curve[curve.length - 1].price;
    const slope = parseFloat(((back - front) / front * 100).toFixed(2));
    const structure: 'contango' | 'backwardation' | 'flat' =
      slope > 0.5 ? 'contango' : slope < -0.5 ? 'backwardation' : 'flat';
    return { id, name, unit, curve, structure, slope, updatedAt: now.toISOString() };
  }

  const oilCurve = buildCurve(oilResults, 'oil', 'WTI Crude Oil', 'USD/bbl');
  const goldCurve = buildCurve(goldResults, 'gold', 'Gold (COMEX)', 'USD/oz');

  // Fetch FRED T-bill rate for carry model (DTB3: 3-month T-bill secondary market rate)
  const tbillData = await fetchFREDSeries('DTB3', 30);
  const riskFreeAnnual = tbillData ? tbillData.latest / 100 : 0.043; // fallback ~4.3%

  // FRED WTI spot + carry-model curve fallback (Yahoo blocked from Vercel IPs)
  if (oilCurve.curve.length === 0) {
    const fredSpot = await fetchOilSpotFRED();
    if (fredSpot !== null) {
      logger.info('commodity-curve', 'fred_oil_carry_curve', { spot: fredSpot, riskFree: riskFreeAnnual });
      // WTI storage cost ~6%/yr (pipeline + tank fees); carry model gives realistic contango
      const carryCurve = buildCarryCurve(fredSpot, riskFreeAnnual, 0.06, 5, 'FRED:DCOILWTICO');
      oilCurve.curve = carryCurve;
      // Recompute structure from synthetic curve
      if (carryCurve.length >= 2) {
        const slopeVal = parseFloat(((carryCurve[carryCurve.length - 1].price - carryCurve[0].price) / carryCurve[0].price * 100).toFixed(2));
        oilCurve.slope = slopeVal;
        oilCurve.structure = slopeVal > 0.5 ? 'contango' : slopeVal < -0.5 ? 'backwardation' : 'flat';
      }
      oilCurve.synthetic = true;
    }
  }

  // gold-api.com spot + carry-model curve fallback (Yahoo GC futures blocked)
  if (goldCurve.curve.length === 0) {
    const goldSpot = await fetchGoldSpotGoldAPI();
    if (goldSpot !== null) {
      logger.info('commodity-curve', 'goldapi_gold_carry_curve', { spot: goldSpot, riskFree: riskFreeAnnual });
      // Gold storage cost ~0.2%/yr (secure vault); carry model for gold
      const carryCurve = buildCarryCurve(goldSpot, riskFreeAnnual, 0.002, 5, 'GOLDAPI:XAU');
      goldCurve.curve = carryCurve;
      if (carryCurve.length >= 2) {
        const slopeVal = parseFloat(((carryCurve[carryCurve.length - 1].price - carryCurve[0].price) / carryCurve[0].price * 100).toFixed(2));
        goldCurve.slope = slopeVal;
        goldCurve.structure = slopeVal > 0.5 ? 'contango' : slopeVal < -0.5 ? 'backwardation' : 'flat';
      }
      goldCurve.synthetic = true;
    }
  }

  const result = { curves: [oilCurve, goldCurve], updatedAt: now.toISOString(), cached: false };
  const hasData = oilCurve.curve.length > 0 || goldCurve.curve.length > 0;
  if (hasData) {
    mem.set(cacheKey, result);
    if (redis) {
      await loggedRedisSet(redis, 'commodity-curve', REDIS_KEY, result, { ex: REDIS_TTL });
      await loggedRedisSet(redis, 'commodity-curve', STALE_KEY, result, {});
    }
  } else if (redis) {
    // Yahoo returned no data — try stale fallback
    try {
      const stale = await redis.get(STALE_KEY);
      if (stale) {
        logger.info('commodity-curve', 'stale_fallback', { note: 'Yahoo returned 0 pts, serving stale' });
        return NextResponse.json({ ...(stale as object), cached: true, stale: true }, { headers: CDN_HEADERS });
      }
    } catch (e) { logger.warn('commodity-curve', 'stale_read_error', { error: e }); }
  }

  return NextResponse.json(result, { headers: CDN_HEADERS });
}
