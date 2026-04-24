/**
 * /api/options-flow
 *
 * Institutional options flow via Unusual Whales (requires UNUSUAL_WHALES_KEY
 * env — $48/mo personal tier). When unset the endpoint returns an empty
 * list with `configured: false` so the UI can show a "upgrade locked" state
 * without crashing.
 *
 * Why this exists: options flow is the closest retail-accessible proxy for
 * real-time institutional positioning. A big call-sweep on SMCI before earnings
 * is visible here — in 13F you'd see it 45 days later.
 *
 * Redis cache: 10 minutes (flow data updates continuously intraday).
 */
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { fetchOptionsFlow, unusualWhalesKey, type OptionsFlowAlert } from '@/lib/unusual-whales';
import { logger, loggedRedisSet } from '@/lib/logger';

const CACHE_KEY = 'flowvium:options-flow:v1';
const CACHE_TTL = 10 * 60;
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=480, stale-while-revalidate=60' };

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export async function GET(req: Request) {
  const reqStart = Date.now();
  const configured = unusualWhalesKey() != null;
  if (!configured) {
    logger.info('api.options-flow', 'unconfigured');
    return NextResponse.json({ items: [], configured: false, total: 0 });
  }

  const redis = createRedis();
  const force = new URL(req.url).searchParams.get('refresh') === '1';
  if (redis && !force) {
    try {
      const cached = await redis.get<OptionsFlowAlert[]>(CACHE_KEY);
      if (cached) {
        logger.info('api.options-flow', 'cache_hit', { total: cached.length });
        return NextResponse.json({ items: cached, configured: true, cached: true, total: cached.length }, { headers: CDN_HEADERS });
      }
    } catch (err) { logger.warn('api.options-flow', 'cache_read_error', { error: err }); }
  }

  const items = await fetchOptionsFlow(60);
  await loggedRedisSet(redis, 'api.options-flow', CACHE_KEY, items, { ex: CACHE_TTL });
  logger.info('api.options-flow', 'served', { total: items.length, durationMs: Date.now() - reqStart });
  return NextResponse.json({ items, configured: true, cached: false, total: items.length }, { headers: CDN_HEADERS });
}
