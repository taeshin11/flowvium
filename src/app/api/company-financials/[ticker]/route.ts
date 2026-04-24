import { logger, loggedRedisSet } from '@/lib/logger';
/**
 * /api/company-financials/[ticker]
 *
 * Returns live annual revenue data from SEC EDGAR. Redis-cached for 24h.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { fetchLiveFinancials } from '@/lib/sec-financials';

const TTL = 24 * 60 * 60;

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
  const cacheKey = `flowvium:company-financials:v2:${ticker}`;  // v2: pick most-recent-FY across all concepts

  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return NextResponse.json({ ...(cached as object), cached: true });
    } catch { /* non-fatal */ }
  }

  const data = await fetchLiveFinancials(ticker);
  if (!data) {
    return NextResponse.json({ error: 'not-found', ticker }, { status: 404 });
  }

  if (redis) {
    await loggedRedisSet(redis, 'api.company-financials', cacheKey, data, { ex: TTL });
  }

  return NextResponse.json({ ...data, cached: false });
}
