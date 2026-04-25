import { logger, loggedRedisSet} from '@/lib/logger';
/**
 * Cron: /api/cron/update-credit-balance
 *
 * Runs daily. Fetches live margin debt / credit balance data for all
 * countries with a reliable source, stores results in Redis.
 *
 * Reliable sources:
 *   US — FRED BOGZ1FL663067003Q (quarterly)
 *   TW — TWSE MI_MARGN (daily)
 *   CN — SSE 融资融券 summary (daily)
 *   KR — BOK ECOS (if KOREA_BOK_API_KEY set)
 * Best-effort (often null):
 *   JP, IN, EU
 *
 * Missing entries fall back to static data in /api/credit-balance.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { revalidatePath } from 'next/cache';
import { fetchAllCreditData } from '@/lib/credit-fetchers';

export const dynamic = 'force-dynamic';

export const maxDuration = 60;

const REDIS_KEY_LIVE = 'flowvium:credit-balance:live:v1';
const TTL = 48 * 60 * 60; // 48 hours — refreshed daily by cron

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  const isVercelCron = !!req.headers.get('x-vercel-cron');
  if (process.env.CRON_SECRET && !isVercelCron && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const start = Date.now();
  const redis = createRedis();

  // Fetch all countries in parallel
  const live = await fetchAllCreditData();

  // Track which sources succeeded
  const results = Object.entries(live).map(([country, data]) => ({
    country,
    ok: data !== null,
    period: data?.period ?? null,
    balance: data?.balance ?? null,
    source: data?.source ?? null,
  }));

  // Store to Redis (store all entries — nulls included so the API knows we tried)
  if (redis) {
    const t0 = Date.now();
    logger.info('cron.update-credit-balance', 'save_start', { key: REDIS_KEY_LIVE, ttl: TTL });
    try {
      await loggedRedisSet(redis, 'cron.update-credit-balance', REDIS_KEY_LIVE, live, { ex: TTL });
      logger.info('cron.update-credit-balance', 'save_ok', { key: REDIS_KEY_LIVE, durationMs: Date.now() - t0 });
    } catch (saveErr) {
      logger.error('cron.update-credit-balance', 'save_failed', { key: REDIS_KEY_LIVE, error: saveErr });
    }
  }

  // Invalidate cached credit balance response
  if (redis) {
    const today = new Date().toISOString().slice(0, 10);
    const bustKey = `flowvium:credit-balance:v3:${today}`;
    try {
      // Wildcard delete — date-based keys
      logger.info('cron.update-credit-balance', 'cache_bust_start', { key: bustKey });
      await redis.del(bustKey);
      logger.info('cron.update-credit-balance', 'cache_bust_ok', { key: bustKey });
    } catch (bustErr) {
      logger.error('cron.update-credit-balance', 'cache_bust_failed', { key: bustKey, error: bustErr });
    }
  }

  // Revalidate relevant ISR pages
  try {
    revalidatePath('/api/credit-balance');
    logger.info('cron.update-credit-balance', 'isr_revalidated', { path: '/api/credit-balance' });
    revalidatePath('/intelligence');
    logger.info('cron.update-credit-balance', 'isr_revalidated', { path: '/intelligence' });
  } catch { /* non-fatal */ }

  return NextResponse.json({
    ok: true,
    durationMs: Date.now() - start,
    results,
    successCount: results.filter(r => r.ok).length,
    totalCount: results.length,
    timestamp: new Date().toISOString(),
  });
}
