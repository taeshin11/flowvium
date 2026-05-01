/**
 * /api/sector-metrics
 *
 * Live sector-level macro metrics for CompanyPage overlay.
 * Replaces hard-coded values in src/data/sector-context.ts.
 *
 * Sources:
 *   - WTI:  Yahoo Finance CL=F
 *   - ^TNX: Yahoo Finance (10Y yield)
 *   - MHHNGSP / DRCCLACBS / DFEDTARU: FRED CSV
 *   - ISM PMI: Redis macro-indicators cache
 *
 * Cache: Redis flowvium:sector-metrics:v1, TTL 6h
 * CDN:   public, s-maxage=21600
 */
import { NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import { logger, loggedFetch, loggedRedisSet } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const REDIS_KEY = 'flowvium:sector-metrics:v1';
const REDIS_TTL = 6 * 3600;
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=3600' };

export interface SectorMetricsResponse {
  wtiPrice: number | null;
  naturalGas: number | null;
  creditCardDelinquency: number | null;
  fedFundsRate: number | null;
  tnxYield: number | null;
  ismPmi: number | null;
  updatedAt: string;
}

// ── FRED CSV helpers ──────────────────────────────────────────────────────────
async function fetchFredLatest(seriesId: string): Promise<number | null> {
  try {
    const startDate = new Date(Date.now() - 18 * 30.5 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}&observation_start=${startDate}`;
    const res = await loggedFetch('sector-metrics', `fred_${seriesId}`, url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      cache: 'no-store',
    });
    if (!res || !res.ok) {
      if (res) logger.warn('sector-metrics', 'fred_http_error', { seriesId, status: res.status });
      return null;
    }
    const text = await res.text();
    const rows = text
      .trim()
      .split('\n')
      .slice(1)
      .map((line) => {
        const [, val] = line.split(',');
        const value = parseFloat(val);
        return isNaN(value) ? null : value;
      })
      .filter((v): v is number => v !== null);
    return rows.length ? rows[rows.length - 1] : null;
  } catch (err) {
    logger.error('sector-metrics', 'fred_error', { seriesId, error: err });
    return null;
  }
}

// ── Yahoo Finance helper ──────────────────────────────────────────────────────
async function fetchYahooClose(ticker: string): Promise<number | null> {
  try {
    const encodedTicker = encodeURIComponent(ticker);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodedTicker}?interval=1d&range=5d`;
    const res = await loggedFetch('sector-metrics', `yahoo_${ticker}`, url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Accept: 'application/json',
      },
      cache: 'no-store',
    });
    if (!res || !res.ok) {
      if (res) logger.warn('sector-metrics', 'yahoo_http_error', { ticker, status: res.status });
      return null;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    if (meta?.regularMarketPrice != null) return meta.regularMarketPrice as number;
    const closes: number[] = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    const validCloses = closes.filter((v) => v != null);
    return validCloses.length ? validCloses[validCloses.length - 1] : null;
  } catch (err) {
    logger.error('sector-metrics', 'yahoo_error', { ticker, error: err });
    return null;
  }
}

// ── ISM PMI from Redis macro-indicators cache ─────────────────────────────────
async function fetchIsmPmiFromRedis(): Promise<number | null> {
  try {
    const redis = createRedis();
    if (!redis) return null;
    // macro-indicators uses date-keyed keys: flowvium:macro-indicators:v13:YYYY-MM-DD
    // Try today and yesterday
    const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() + 9 * 60 * 60 * 1000 - 86400000)
      .toISOString()
      .slice(0, 10);
    for (const date of [today, yesterday]) {
      const key = `flowvium:macro-indicators:v13:${date}`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cached: any = await redis.get(key);
      if (!cached) continue;
      const data = typeof cached === 'string' ? JSON.parse(cached) : cached;
      const ism = data?.ism?.value ?? data?.indicators?.ism?.value ?? null;
      if (ism != null) return typeof ism === 'number' ? ism : parseFloat(ism);
    }
    return null;
  } catch (err) {
    logger.error('sector-metrics', 'ism_redis_error', { error: err });
    return null;
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function GET() {
  const redis = createRedis();

  // 1. Try Redis cache
  if (redis) {
    try {
      const cached = await redis.get(REDIS_KEY);
      if (cached) {
        const data = typeof cached === 'string' ? JSON.parse(cached) : cached;
        return NextResponse.json(data, { headers: CDN_HEADERS });
      }
    } catch (err) {
      logger.warn('sector-metrics', 'redis_get_error', { error: err });
    }
  }

  // 2. Fetch all in parallel
  const [wtiPrice, naturalGas, creditCardDelinquency, fedFundsRate, tnxYield, ismPmi] =
    await Promise.all([
      fetchYahooClose('CL=F'),
      fetchFredLatest('MHHNGSP'),
      fetchFredLatest('DRCCLACBS'),
      fetchFredLatest('DFEDTARU'),
      fetchYahooClose('^TNX'),
      fetchIsmPmiFromRedis(),
    ]);

  const result: SectorMetricsResponse = {
    wtiPrice,
    naturalGas,
    creditCardDelinquency,
    fedFundsRate,
    tnxYield,
    ismPmi,
    updatedAt: new Date().toISOString(),
  };

  // 3. Cache in Redis
  if (redis) {
    await loggedRedisSet(redis, 'sector-metrics', REDIS_KEY, result, { ex: REDIS_TTL });
  }

  return NextResponse.json(result, { headers: CDN_HEADERS });
}
