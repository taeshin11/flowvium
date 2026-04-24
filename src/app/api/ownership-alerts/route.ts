/**
 * /api/ownership-alerts
 *
 * Schedule 13D/13G filings — any entity crossing 5%+ ownership of a public
 * company must file within 10 days of the crossing. This is the "early-warning
 * system" for activist investors and major stake builds that won't appear in
 * 13F for another 45+ days.
 *
 * Redis cache: 2h (filings trickle in throughout the day, filings are weekly-ish
 * for any single name).
 */
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { fetchRecentOwnershipAlerts, type OwnershipAlert } from '@/lib/edgar-insider';
import { logger, loggedRedisSet } from '@/lib/logger';

const CACHE_KEY = 'flowvium:ownership-alerts:v1';
const CACHE_TTL = 2 * 60 * 60;
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=6000, stale-while-revalidate=300' };

export const maxDuration = 60;

// Module-level fallback when Upstash env vars are unset. Persists across
// requests while the function instance stays warm. Prevents quiet EDGAR
// 10-min windows from wiping visible results for Redis-less environments.
let MEMORY_CACHE: { alerts: OwnershipAlert[]; expiresAt: number } | null = null;
const MEMORY_TTL_MS = 2 * 60 * 60 * 1000;

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
  const tickerFilter = url.searchParams.get('ticker')?.toUpperCase();

  const reqStart = Date.now();
  if (redis && !force) {
    try {
      const cached = await redis.get<OwnershipAlert[]>(CACHE_KEY);
      if (cached) {
        const filtered = tickerFilter ? cached.filter(a => a.ticker === tickerFilter) : cached;
        logger.info('api.ownership-alerts', 'cache_hit', { total: cached.length, filtered: filtered.length });
        return NextResponse.json({ items: filtered, cached: true, total: cached.length }, { headers: CDN_HEADERS });
      }
    } catch (err) { logger.warn('api.ownership-alerts', 'cache_read_error', { error: err }); }
  }

  // Memory cache fallback (Upstash 미설정 시).
  if (!redis && !force && MEMORY_CACHE && MEMORY_CACHE.expiresAt > Date.now() && MEMORY_CACHE.alerts.length > 0) {
    const cached = MEMORY_CACHE.alerts;
    const filtered = tickerFilter ? cached.filter(a => a.ticker === tickerFilter) : cached;
    logger.info('api.ownership-alerts', 'memory_cache_hit', { total: cached.length, filtered: filtered.length });
    return NextResponse.json({ items: filtered, cached: true, cacheLayer: 'memory', total: cached.length }, { headers: CDN_HEADERS });
  }

  const alerts = await fetchRecentOwnershipAlerts({ minPercent: 5 });

  // EDGAR getcurrent RSS only surfaces filings from the last ~10 minutes.
  // SC 13D/G are rare enough that quiet periods routinely return 0 entries —
  // caching that empty list would wipe a prior good snapshot for 2h.
  // Behavior: only overwrite the cache when we actually have entries.
  // On empty fetch, fall back to whatever we cached last.
  if (alerts.length > 0) {
    await loggedRedisSet(redis, 'api.ownership-alerts', CACHE_KEY, alerts, { ex: CACHE_TTL });
    if (!redis) MEMORY_CACHE = { alerts, expiresAt: Date.now() + MEMORY_TTL_MS };
  } else if (redis) {
    logger.info('api.ownership-alerts', 'empty_fetch_preserving_prior');
    try {
      const prior = await redis.get<OwnershipAlert[]>(CACHE_KEY);
      if (prior && Array.isArray(prior) && prior.length > 0) {
        const priorFiltered = tickerFilter ? prior.filter(a => a.ticker === tickerFilter) : prior;
        return NextResponse.json({
          items: priorFiltered,
          cached: true,
          total: prior.length,
          note: 'EDGAR getcurrent feed empty — returning prior snapshot',
          durationMs: Date.now() - reqStart,
        }, { headers: CDN_HEADERS });
      }
    } catch (err) { logger.warn('api.ownership-alerts', 'prior_read_error', { error: err }); }
  } else if (MEMORY_CACHE && MEMORY_CACHE.alerts.length > 0) {
    // No Redis + empty fetch — use memory cache (expired or not, still preserves visible state)
    const prior = MEMORY_CACHE.alerts;
    const priorFiltered = tickerFilter ? prior.filter(a => a.ticker === tickerFilter) : prior;
    logger.info('api.ownership-alerts', 'memory_cache_preserve', { total: prior.length });
    return NextResponse.json({
      items: priorFiltered,
      cached: true,
      cacheLayer: 'memory',
      total: prior.length,
      note: 'EDGAR empty window — returning prior in-memory snapshot',
      durationMs: Date.now() - reqStart,
    }, { headers: CDN_HEADERS });
  }

  const filtered = tickerFilter ? alerts.filter(a => a.ticker === tickerFilter) : alerts;
  logger.info('api.ownership-alerts', 'served', { total: alerts.length, filtered: filtered.length, durationMs: Date.now() - reqStart });
  return NextResponse.json({ items: filtered, cached: false, total: alerts.length }, { headers: CDN_HEADERS });
}
