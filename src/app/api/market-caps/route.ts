import { logger, loggedRedisSet } from '@/lib/logger';
/**
 * /api/market-caps
 *
 * Returns a { ticker: band } map for every ticker in allCompanies.
 * Uses static marketCap bands from allCompanies data.
 * Yahoo Finance v7 crumb auth fails from Vercel IPs — live fetch removed.
 * Single-ticker ?ticker=AAPL requests fetch live marketCap via Yahoo v8 chart endpoint.
 *
 * Optional ?ticker=AAPL param returns single-ticker data with live market cap.
 *
 * Redis cache: 24h.
 */
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { allCompanies } from '@/data/companies';
import { type MarketCapBand, YAHOO_HEADERS } from '@/lib/yahoo-finance';
export const dynamic = 'force-dynamic';

const CACHE_KEY = 'flowvium:market-caps:v2';
const CACHE_TTL = 24 * 60 * 60; // 24h
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600' };

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

async function fetchYahooCap(ticker: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`,
      {
        headers: YAHOO_HEADERS,
        signal: AbortSignal.timeout(4000),
        cache: 'no-store',
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return (data?.chart?.result?.[0]?.meta?.marketCap as number | undefined) ?? null;
  } catch { return null; }
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
          const liveCap = await fetchYahooCap(filterTicker);
          const caps = liveCap != null ? { [filterTicker]: liveCap } : {};
          return NextResponse.json({ bands: band ? { [filterTicker]: band } : {}, caps, updatedAt: cached.updatedAt, count: 1, cached: true }, { headers: CDN_HEADERS });
        }
        return NextResponse.json({ ...cached, cached: true }, { headers: CDN_HEADERS });
      }
    } catch (err) { logger.warn('api.market-caps', 'cache_read_error', { error: err }); }
  }

  const bands: Record<string, MarketCapBand> = {};
  const seen = new Set<string>();
  for (const c of allCompanies) {
    if (!c.ticker || seen.has(c.ticker)) continue;
    seen.add(c.ticker);
    bands[c.ticker] = c.marketCap as MarketCapBand;
  }

  const payload: MarketCapPayload = {
    bands,
    caps: {},
    updatedAt: new Date().toISOString(),
    count: seen.size,
  };

  await loggedRedisSet(redis, 'api.market-caps', CACHE_KEY, payload, { ex: CACHE_TTL });

  logger.info('api.market-caps', 'served', { tickers: seen.size, durationMs: Date.now() - reqStart });

  if (filterTicker) {
    const band = payload.bands[filterTicker] ?? null;
    const liveCap = await fetchYahooCap(filterTicker);
    const caps = liveCap != null ? { [filterTicker]: liveCap } : {};
    return NextResponse.json({ bands: band ? { [filterTicker]: band } : {}, caps, updatedAt: payload.updatedAt, count: 1, cached: false }, { headers: CDN_HEADERS });
  }
  return NextResponse.json({ ...payload, cached: false }, { headers: CDN_HEADERS });
}
