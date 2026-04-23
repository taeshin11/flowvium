import { logger, loggedRedisSet } from '@/lib/logger';
/**
 * /api/market-caps
 *
 * Returns a { ticker: band } map for every ticker in allCompanies.
 * Uses the static `marketCap` field from the companies data file as the
 * band source (Yahoo v7 crumb-based fetching is unreliable on Vercel).
 *
 * Redis cache: 24h.
 */
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { allCompanies } from '@/data/companies';
import type { MarketCapBand } from '@/lib/yahoo-finance';

const CACHE_KEY = 'flowvium:market-caps:v1';
const CACHE_TTL = 24 * 60 * 60; // 24h

export const maxDuration = 60;

export interface MarketCapPayload {
  bands: Record<string, MarketCapBand>;  // ticker → band
  caps: Record<string, number>;          // ticker → raw USD cap
  updatedAt: string;
  count: number;
  cached?: boolean;
}

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export async function GET(req: Request) {
  const redis = createRedis();
  const force = new URL(req.url).searchParams.get('refresh') === '1';

  const reqStart = Date.now();
  if (redis && !force) {
    try {
      const cached = await redis.get<MarketCapPayload>(CACHE_KEY);
      if (cached) {
        logger.info('api.market-caps', 'cache_hit', { count: cached.count });
        return NextResponse.json({ ...cached, cached: true });
      }
    } catch (err) { logger.warn('api.market-caps', 'cache_read_error', { error: err }); }
  }

  // Build bands from static marketCap field — deduplicate by ticker so later
  // entries (with potentially drifted enums) don't overwrite the first.
  const bands: Record<string, MarketCapBand> = {};
  const caps: Record<string, number> = {};
  const seen = new Set<string>();
  for (const c of allCompanies) {
    if (!c.ticker || seen.has(c.ticker)) continue;
    seen.add(c.ticker);
    const band = c.marketCap as MarketCapBand;
    if (band) bands[c.ticker] = band;
  }

  const payload: MarketCapPayload = {
    bands,
    caps,
    updatedAt: new Date().toISOString(),
    count: Object.keys(bands).length,
  };

  await loggedRedisSet(redis, 'api.market-caps', CACHE_KEY, payload, { ex: CACHE_TTL });

  logger.info('api.market-caps', 'served', { tickers: seen.size, mapped: Object.keys(bands).length, durationMs: Date.now() - reqStart });
  return NextResponse.json({ ...payload, cached: false });
}
