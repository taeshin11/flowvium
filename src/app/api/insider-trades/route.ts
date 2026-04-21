/**
 * /api/insider-trades
 *
 * Real-time Form 4 insider transactions (officer/director/10%+ holder open-market
 * buys and sells). Beats the 45-day 13F delay because Form 4 must be filed
 * within D+2 business days of the trade.
 *
 * Redis cache: 30 minutes (SEC publishes throughout the day).
 */
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { fetchRecentForm4, type InsiderTransaction } from '@/lib/edgar-insider';
import { logger, loggedRedisSet } from '@/lib/logger';

const CACHE_KEY = 'flowvium:insider-trades:v1';
const CACHE_TTL = 30 * 60;

export const maxDuration = 60;

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export async function GET(req: Request) {
  const reqStart = Date.now();
  const redis = createRedis();
  const url = new URL(req.url);
  const force = url.searchParams.get('refresh') === '1';
  const tickerFilter = url.searchParams.get('ticker')?.toUpperCase();

  if (redis && !force) {
    try {
      const cached = await redis.get<InsiderTransaction[]>(CACHE_KEY);
      if (cached) {
        const filtered = tickerFilter ? cached.filter(t => t.ticker === tickerFilter) : cached;
        logger.info('api.insider-trades', 'cache_hit', { total: cached.length, filtered: filtered.length, durationMs: Date.now() - reqStart });
        return NextResponse.json({ items: filtered, cached: true, total: cached.length });
      }
    } catch (err) { logger.warn('api.insider-trades', 'cache_read_error', { error: err }); }
  }

  const transactions = await fetchRecentForm4({ feedCount: 80, includeOther: false });

  // Mirror ownership-alerts: EDGAR getcurrent RSS is a ~10-min window.
  // Form 4 is usually busy but occasional quiet periods could wipe a good
  // snapshot. Only overwrite when we have entries; on empty, keep prior cache.
  if (transactions.length > 0) {
    await loggedRedisSet(redis, 'api.insider-trades', CACHE_KEY, transactions, { ex: CACHE_TTL });
  } else if (redis) {
    logger.info('api.insider-trades', 'empty_fetch_preserving_prior');
    try {
      const prior = await redis.get<InsiderTransaction[]>(CACHE_KEY);
      if (prior && Array.isArray(prior) && prior.length > 0) {
        const priorFiltered = tickerFilter ? prior.filter(t => t.ticker === tickerFilter) : prior;
        return NextResponse.json({
          items: priorFiltered,
          cached: true,
          total: prior.length,
          note: 'EDGAR getcurrent feed empty — returning prior snapshot',
          durationMs: Date.now() - reqStart,
        });
      }
    } catch (err) { logger.warn('api.insider-trades', 'prior_read_error', { error: err }); }
  }

  const filtered = tickerFilter ? transactions.filter(t => t.ticker === tickerFilter) : transactions;
  logger.info('api.insider-trades', 'served', { total: transactions.length, filtered: filtered.length, forced: force, durationMs: Date.now() - reqStart });
  return NextResponse.json({ items: filtered, cached: false, total: transactions.length });
}
