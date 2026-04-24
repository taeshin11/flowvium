/**
 * /api/block-trades
 *
 * Block trade (>=10K shares) detection across our tracked tickers via Polygon.io.
 * Requires POLYGON_KEY ($29 Starter = 15-min delayed; $199 Advanced = realtime).
 * Returns { configured: false } when absent — UI shows donation-goal gate.
 *
 * Redis cache 5 min (tape is intraday).
 */
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { fetchBlockTradesForTickers, polygonKey, type BlockTrade } from '@/lib/polygon';
import { logger, loggedRedisSet } from '@/lib/logger';

const CACHE_KEY = 'flowvium:block-trades:v1';
const CACHE_TTL = 5 * 60;
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=240, stale-while-revalidate=60' };

// Keep roster small — each ticker = 1 paginated request
const TRACKED_TICKERS = [
  'NVDA', 'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AMD', 'TSM',
  'SMCI', 'COIN', 'MU', 'AVGO', 'ASML', 'KLAC', 'LRCX', 'AMAT',
  'LMT', 'RTX', 'NOC', 'LLY', 'LHX', 'MRNA', 'REGN', 'FCX', 'ALB', 'KTOS',
];

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export async function GET(req: Request) {
  const reqStart = Date.now();
  const configured = polygonKey() != null;
  if (!configured) {
    logger.info('api.block-trades', 'unconfigured');
    return NextResponse.json({ items: [], configured: false, total: 0 });
  }

  const redis = createRedis();
  const force = new URL(req.url).searchParams.get('refresh') === '1';
  if (redis && !force) {
    try {
      const cached = await redis.get<BlockTrade[]>(CACHE_KEY);
      if (cached) {
        logger.info('api.block-trades', 'cache_hit', { total: cached.length });
        return NextResponse.json({ items: cached, configured: true, cached: true, total: cached.length }, { headers: CDN_HEADERS });
      }
    } catch (err) { logger.warn('api.block-trades', 'cache_read_error', { error: err }); }
  }

  const trades = await fetchBlockTradesForTickers(TRACKED_TICKERS, 10_000);
  await loggedRedisSet(redis, 'api.block-trades', CACHE_KEY, trades, { ex: CACHE_TTL });
  logger.info('api.block-trades', 'served', { total: trades.length, durationMs: Date.now() - reqStart });
  return NextResponse.json({ items: trades, configured: true, cached: false, total: trades.length }, { headers: CDN_HEADERS });
}
