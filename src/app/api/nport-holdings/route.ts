/**
 * /api/nport-holdings
 *
 * Form N-PORT-P mutual fund monthly holdings — 3× faster than 13F because
 * mutual funds file within 60 days of month-end vs 13F's quarterly cadence.
 *
 * Output shape:
 *   {
 *     funds:      NPortFundSnapshot[]   // raw per-fund snapshots
 *     byTicker:   NPortTickerAggregate[]// our-tickers first, aggregated
 *     updatedAt:  ISO
 *   }
 *
 * Redis cache 6h — N-PORT filings trickle in daily but are most valuable as
 * a daily snapshot rather than minute-by-minute.
 */
import { NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import type { Redis } from '@upstash/redis';
import { fetchRecentNPORT, aggregateByTicker, type NPortFundSnapshot, type NPortTickerAggregate } from '@/lib/edgar-nport';
import { logger, loggedRedisSet } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const CACHE_KEY = 'flowvium:nport-holdings:v1';
const CACHE_TTL = 6 * 60 * 60;
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=18000, stale-while-revalidate=600' };

export const maxDuration = 60;

export async function GET(req: Request) {
  const redis = createRedis();
  const force = new URL(req.url).searchParams.get('refresh') === '1';
  const reqStart = Date.now();
  if (redis && !force) {
    try {
      const cached = await redis.get<{ funds: NPortFundSnapshot[]; byTicker: NPortTickerAggregate[]; updatedAt: string }>(CACHE_KEY);
      if (cached) {
        logger.info('api.nport-holdings', 'cache_hit', { funds: cached.funds.length, byTicker: cached.byTicker.length });
        return NextResponse.json({ ...cached, cached: true }, { headers: CDN_HEADERS });
      }
    } catch (err) { logger.warn('api.nport-holdings', 'cache_read_error', { error: err }); }
  }

  const funds = await fetchRecentNPORT({ feedCount: 30 });
  const byTicker = aggregateByTicker(funds);
  const payload = {
    funds, byTicker,
    source: funds.length > 0 ? 'edgar-nport' : 'empty',
    fundCount: funds.length,
    updatedAt: new Date().toISOString(),
  };

  await loggedRedisSet(redis, 'api.nport-holdings', CACHE_KEY, payload, { ex: CACHE_TTL });
  logger.info('api.nport-holdings', 'served', { funds: funds.length, byTicker: byTicker.length, durationMs: Date.now() - reqStart });
  return NextResponse.json({ ...payload, cached: false }, { headers: CDN_HEADERS });
}
