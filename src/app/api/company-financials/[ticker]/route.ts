import { logger, loggedRedisSet } from '@/lib/logger';
/**
 * /api/company-financials/[ticker]
 *
 * Returns live annual revenue data from SEC EDGAR. Redis-cached for 24h.
 * Module-level memory cache (4h) prevents SEC re-fetch on every cold start.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { fetchLiveFinancials, type LiveFinancials } from '@/lib/sec-financials';
import { createMemoryCache } from '@/lib/memory-cache';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TTL = 24 * 60 * 60;
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600' };
const MEMORY_CACHE = createMemoryCache<LiveFinancials>('company-financials', 4 * 60 * 60_000);

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { ticker: string } }
) {
  const ticker = params.ticker.toUpperCase();
  const redis = createRedis();
  const cacheKey = `flowvium:company-financials:v4:${ticker}`;  // v4: quarterly YTD→true-quarter fix

  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return NextResponse.json({ ...(cached as object), cached: true }, { headers: CDN_HEADERS });
    } catch { /* non-fatal */ }
  } else {
    const mem = MEMORY_CACHE.get(ticker);
    if (mem) return NextResponse.json({ ...mem, cached: true, cacheLayer: 'memory' }, { headers: CDN_HEADERS });
  }

  const data = await fetchLiveFinancials(ticker);
  if (!data) {
    return NextResponse.json({ error: 'not-found', ticker }, { status: 404 });
  }

  if (redis) {
    await loggedRedisSet(redis, 'api.company-financials', cacheKey, data, { ex: TTL });
  } else {
    MEMORY_CACHE.set(ticker, data);
  }

  return NextResponse.json({ ...data, cached: false }, { headers: CDN_HEADERS });
}
