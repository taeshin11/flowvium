import { logger, loggedRedisSet } from '@/lib/logger';
import { YAHOO_HEADERS } from '@/lib/yahoo-finance';
/**
 * /api/volatility
 *
 * VIX term structure + historical data.
 * Sources (all Yahoo Finance chart API — free, confirmed reachable from Vercel):
 *   ^VXST = 9-day VIX
 *   ^VIX  = 30-day VIX (standard)
 *   ^VXMT = 6-month VIX
 *   ^VVIX = Vol of VIX (100+ = elevated uncertainty)
 *
 * Also returns 90-day VIX history for sparkline.
 * Cache: Redis 30min | memory 15min
 */
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { createMemoryCache } from '@/lib/memory-cache';
export const dynamic = 'force-dynamic';

const CACHE_TTL = 30 * 60;
const MEM_CACHE = createMemoryCache<VolatilityData>('volatility', 15 * 60_000);
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=60' };

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export interface VolPoint { date: string; value: number }

export interface VolatilityData {
  // Current values
  vxst: number | null;   // 9-day
  vix: number | null;    // 30-day
  vxmt: number | null;   // 6-month
  vvix: number | null;   // Vol of VIX
  // Regime
  regime: 'contango' | 'backwardation' | 'humped' | 'unknown';
  regimeLabel: string;
  // 90-day VIX history
  history: VolPoint[];
  dataDate: string | null;
  updatedAt: string;
  cached: boolean;
}

const YF_HEADERS = YAHOO_HEADERS;

async function fetchCurrentPrice(symbol: string): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
    const res = await fetch(url, { headers: YF_HEADERS, cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const json = await res.json();
    const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof price === 'number' ? price : null;
  } catch { return null; }
}

async function fetchHistory(symbol: string, range = '3mo'): Promise<VolPoint[]> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`;
    const res = await fetch(url, { headers: YF_HEADERS, cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    const ts: number[] = result?.timestamp ?? [];
    const closes: (number | null)[] = result?.indicators?.quote?.[0]?.close ?? [];
    const out: VolPoint[] = [];
    for (let i = 0; i < ts.length; i++) {
      const c = closes[i];
      if (typeof c !== 'number' || isNaN(c)) continue;
      out.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), value: parseFloat(c.toFixed(2)) });
    }
    return out;
  } catch { return []; }
}

function detectRegime(vxst: number | null, vix: number | null, vxmt: number | null): VolatilityData['regime'] {
  if (vxst == null || vix == null || vxmt == null) return 'unknown';
  if (vxst < vix && vix < vxmt) return 'contango';       // normal upward slope
  if (vxst > vix && vix > vxmt) return 'backwardation';  // stress inversion
  return 'humped';                                         // non-monotonic
}

const REGIME_LABEL: Record<VolatilityData['regime'], string> = {
  contango: 'Contango (normal — long-term uncertainty > short-term)',
  backwardation: 'Backwardation (stress — immediate shock)',
  humped: 'Humped (mixed — mid-term risk concentration)',
  unknown: 'No data',
};

export async function GET() {
  const cacheKey = 'flowvium:volatility:v1';
  const redis = createRedis();

  const mem = MEM_CACHE.get('global');
  if (mem) return NextResponse.json({ ...mem, cached: true, cacheLayer: 'memory' }, { headers: CDN_HEADERS });

  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return NextResponse.json({ ...(cached as object), cached: true }, { headers: CDN_HEADERS });
    } catch { /* non-fatal */ }
  }

  const start = Date.now();
  const [vxst, vix, vxmt, vvix, history] = await Promise.all([
    fetchCurrentPrice('^VXST'),
    fetchCurrentPrice('^VIX'),
    fetchCurrentPrice('^VXMT'),
    fetchCurrentPrice('^VVIX'),
    fetchHistory('^VIX', '3mo'),
  ]);
  logger.info('volatility', 'fetched', { durationMs: Date.now() - start });

  const regime = detectRegime(vxst, vix, vxmt);
  const latestDate = history.length ? history[history.length - 1].date : null;

  const data: VolatilityData = {
    vxst, vix, vxmt, vvix,
    regime,
    regimeLabel: REGIME_LABEL[regime],
    history: history.slice(-90),
    dataDate: latestDate,
    updatedAt: new Date().toISOString(),
    cached: false,
  };

  if (redis) {
    try { await loggedRedisSet(redis, 'api.volatility', cacheKey, data, { ex: CACHE_TTL }); } catch { /* non-fatal */ }
  } else {
    MEM_CACHE.set('global', data);
  }

  return NextResponse.json(data, { headers: CDN_HEADERS });
}
