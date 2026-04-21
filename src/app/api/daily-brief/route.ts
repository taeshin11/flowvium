import { logger, loggedRedisSet } from '@/lib/logger';
import { NextResponse } from 'next/server';
import {
  createRedis, cacheKey, callAI, buildPrompt, parseAIResponse, fallbackBrief,
  gatherTabContext,
  type Timeframe,
} from '@/lib/daily-brief';

// Increase Vercel function timeout — required on Pro plan (60s), no-op on Hobby (10s)
export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tf = (searchParams.get('tf') as Timeframe) ?? '4w';
  const force = searchParams.get('force') === '1';

  const reqStart = Date.now();
  const redis = createRedis();
  if (redis && !force) {
    try {
      const cached = await redis.get(cacheKey(tf));
      if (cached) {
        logger.info('api.daily-brief', 'cache_hit', { tf });
        return NextResponse.json({ ...(cached as object), cached: true });
      }
    } catch (err) { logger.warn('api.daily-brief', 'cache_read_error', { tf, error: err }); }
  }

  // Pull live data from every tab (heatmap, short, capital, fg, fed, macro,
  // credit, cascade, 13F signals). Feeds both the AI prompt and the
  // data-driven fallback so every section of the report reflects the
  // current site state.
  const ctx = await gatherTabContext(redis);

  const prompt = buildPrompt(tf, ctx);
  let brief = null;
  try {
    const { text, source } = await callAI(prompt);
    if (text) brief = parseAIResponse(text, tf, source);
    if (!brief) logger.warn('api.daily-brief', 'ai_unparseable', { tf, source });
  } catch (err) {
    logger.error('api.daily-brief', 'ai_exception', { tf, error: err });
  }

  if (!brief) {
    brief = fallbackBrief(tf, ctx);
    logger.warn('api.daily-brief', 'used_fallback', { tf });
  }

  if (redis) {
    await loggedRedisSet(redis, 'api.daily-brief', cacheKey(tf), brief, { ex: 26 * 60 * 60 });
  }

  logger.info('api.daily-brief', 'served', { tf, source: brief.source, durationMs: Date.now() - reqStart });
  return NextResponse.json({ ...brief, cached: false });
}

export async function DELETE(request: Request) {
  if (request.headers.get('x-cron-secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const redis = createRedis();
  if (!redis) return NextResponse.json({ error: 'No Redis' }, { status: 503 });
  const keys = (['1w', '4w', '13w'] as Timeframe[]).map(cacheKey);
  await Promise.allSettled(keys.map(async (k) => {
    logger.info('api.daily-brief', 'cache_bust_start', { key: k });
    await redis.del(k);
    logger.info('api.daily-brief', 'cache_bust_ok', { key: k });
  }));
  return NextResponse.json({ deleted: keys });
}
