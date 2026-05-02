import { logger, loggedRedisSet, loggedRedisDel } from '@/lib/logger';
/**
 * Vercel Cron — 21:00 UTC = 06:00 KST
 * Regenerates 1w / 4w / 13w daily briefs and stores in Redis.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  createRedis, cacheKey, staleCacheKey, callAI, buildPrompt, parseAIResponse, fallbackBrief,
  gatherTabContext,
  type Timeframe,
} from '@/lib/daily-brief';

export const dynamic = 'force-dynamic';

export const maxDuration = 60;

// Only pre-generate 4w (most-viewed). 1w and 13w are lazy-generated on first request.
// This saves 2/3 of cron GROQ token spend (~6k tokens/run saved).
const TIMEFRAMES: Timeframe[] = ['4w'];

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const start = Date.now();
  const redis = createRedis();
  const results: Record<string, string> = {};

  // Gather all-tab context once and reuse across timeframes.
  // When Redis is unavailable, falls back to HTTP fetches against the public alias.
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\s+/g, '').replace(/\\n/g, '') || 'https://flowvium.net';
  const ctx = await gatherTabContext(redis, baseUrl);

  for (const tf of TIMEFRAMES) {
    try {
      if (redis) {
        await loggedRedisDel(redis, 'cron.daily-brief', [cacheKey(tf)]);
      }
      const { text, source } = await callAI(buildPrompt(tf, ctx));
      const brief = (text ? parseAIResponse(text, tf, source) : null) ?? fallbackBrief(tf, ctx);
      const isAiQuality = brief.source !== 'data';
      if (redis) {
        const writes = [loggedRedisSet(redis, 'api.cron.daily-brief', cacheKey(tf), brief, { ex: 26 * 60 * 60 })];
        if (isAiQuality) {
          // Keep stale key fresh so midnight-KST key rotation gap never serves data fallback.
          writes.push(loggedRedisSet(redis, 'api.cron.daily-brief', staleCacheKey(tf), brief, { ex: 48 * 60 * 60 }));
        }
        await Promise.allSettled(writes);
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
