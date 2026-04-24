import { logger, loggedRedisSet } from '@/lib/logger';
/**
 * /api/market-caps
 *
 * Returns a { ticker: band } map for every ticker in allCompanies.
 * Fetches live market caps via Yahoo Finance v7 (crumb-authenticated).
 * Falls back to static `marketCap` field for tickers that fail.
 *
 * Optional ?ticker=AAPL param returns single-ticker data (still from cache).
 *
 * Redis cache: 24h.
 */
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { allCompanies } from '@/data/companies';
import { fetchYFMarketCaps, marketCapToBand, type MarketCapBand } from '@/lib/yahoo-finance';

const CACHE_KEY = 'flowvium:market-caps:v2';
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
  const url = new URL(req.url);
  const force = url.searchParams.get('refresh') === '1';
  const filterTicker = url.searchParams.get('ticker')?.toUpperCase() ?? null;

  const reqStart = Date.now();
  if (redis && !force) {
    try {
      const cached = await redis.get<MarketCapPayload>(CACHE_KEY);
      if (cached) {
        logger.info('api.market-caps', 'cache_hit', { count: cached.count });
        if (filterTicker) {
          const band = cached.bands[filterTicker] ?? null;
          const cap = cached.caps[filterTicker] ?? null;
          return NextResponse.json({ bands: band ? { [filterTicker]: band } : {}, caps: cap ? { [filterTicker]: cap } : {}, updatedAt: cached.updatedAt, count: 1, cached: true });
        }
        return NextResponse.json({ ...cached, cached: true });
      }
    } catch (err) { logger.warn('api.market-caps', 'cache_read_error', { error: err }); }
  }

  // Build static fallback from companies data
  const staticBands: Record<string, MarketCapBand> = {};
  const allTickers: string[] = [];
  const seen = new Set<string>();
  for (const c of allCompanies) {
    if (!c.ticker || seen.has(c.ticker)) continue;
    seen.add(c.ticker);
    staticBands[c.ticker] = c.marketCap as MarketCapBand;
    allTickers.push(c.ticker);
  }

  // Fetch live market caps from Yahoo Finance v7 (crumb-required)
  const bands: Record<string, MarketCapBand> = { ...staticBands };
  const caps: Record<string, number> = {};
  let liveCount = 0;

  try {
    const liveData = await fetchYFMarketCaps(allTickers);
    for (const item of liveData) {
      if (item.marketCap != null && item.marketCap > 0) {
        caps[item.ticker] = item.marketCap;
        const liveBand = item.band ?? marketCapToBand(item.marketCap);
        if (liveBand) {
          bands[item.ticker] = liveBand;
          liveCount++;
        }
      }
    }
    logger.info('api.market-caps', 'live_fetched', { total: allTickers.length, live: liveCount, durationMs: Date.now() - reqStart });
  } catch (err) {
    logger.warn('api.market-caps', 'live_fetch_failed_using_static', { error: err });
  }

  const payload: MarketCapPayload = {
    bands,
    caps,
    updatedAt: new Date().toISOString(),
    count: Object.keys(bands).length,
  };

  await loggedRedisSet(redis, 'api.market-caps', CACHE_KEY, payload, { ex: CACHE_TTL });

  logger.info('api.market-caps', 'served', { tickers: seen.size, live: liveCount, durationMs: Date.now() - reqStart });

  if (filterTicker) {
    const band = payload.bands[filterTicker] ?? null;
    const cap = payload.caps[filterTicker] ?? null;
    return NextResponse.json({ bands: band ? { [filterTicker]: band } : {}, caps: cap ? { [filterTicker]: cap } : {}, updatedAt: payload.updatedAt, count: 1, cached: false });
  }
  return NextResponse.json({ ...payload, cached: false });
}
