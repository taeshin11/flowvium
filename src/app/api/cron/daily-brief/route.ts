import { logger, loggedRedisSet } from '@/lib/logger';
/**
 * Vercel Cron — 21:00 UTC = 06:00 KST
 * Regenerates 1w / 4w / 13w daily briefs and stores in Redis.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  createRedis, cacheKey, callAI, buildPrompt, parseAIResponse, fallbackBrief,
  gatherTabContext,
  type Timeframe,
} from '@/lib/daily-brief';

export const maxDuration = 60;

const TIMEFRAMES: Timeframe[] = ['1w', '4w', '13w'];

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const start = Date.now();
  const redis = createRedis();
  const results: Record<string, string> = {};

  // Gather all-tab context once and reuse across timeframes
  const ctx = await gatherTabContext(redis);

  for (const tf of TIMEFRAMES) {
    try {
      if (redis) {
        try {
          logger.info('cron.daily-brief', 'cache_bust_start', { key: cacheKey(tf) });
          await redis.del(cacheKey(tf));
          logger.info('cron.daily-brief', 'cache_bust_ok', { key: cacheKey(tf) });
        } catch { /* ignore */ }
      }
      const { text, source } = await callAI(buildPrompt(tf, ctx));
      const brief = (text && parseAIResponse(text, tf, source)) ?? fallbackBrief(tf, ctx);
      if (redis) {
        await loggedRedisSet(redis, 'api.cron.daily-brief', cacheKey(tf), brief, { ex: 26 * 60 * 60 });
      }
      results[tf] = `ok (${source})`;
    } catch (e) {
      results[tf] = `error: ${e instanceof Error ? e.message : String(e)}`;
      logger.error('cron.daily-brief', 'tf_failed', { tf, error: e });
    }
  }
  logger.info('cron.daily-brief', 'run_complete', { results, durationMs: Date.now() - start });

  const kstNow = new Date(Date.now() + 9 * 3600000);
  return NextResponse.json({
    ok: true,
    results,
    durationMs: Date.now() - start,
    kstTime: kstNow.toISOString().slice(0, 16).replace('T', ' ') + ' KST',
  });
}
