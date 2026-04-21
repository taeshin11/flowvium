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
  const debug = searchParams.get('debug') === '1';

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
  // current site state. When Redis is not configured, falls back to
  // HTTP fetches via the public alias.
  const reqUrl = new URL(request.url);
  const baseUrl = reqUrl.host.startsWith('localhost')
    ? 'http://localhost:3000'
    : `${reqUrl.protocol}//${reqUrl.host}`;
  const ctx = await gatherTabContext(redis, baseUrl);

  // Debug mode — expose which ctx fields were populated to pinpoint
  // cache-key mismatches without needing Redis introspection.
  // Remove after diagnosing stale-key issues.
  const debugInfo = debug ? {
    redisConfigured: !!redis,
    ctxPopulated: {
      heatmap: ctx.heatmap != null,
      short: ctx.short != null,
      capital: ctx.capital != null,
      fearGreed: ctx.fearGreed != null,
      fedWatch: ctx.fedWatch != null,
      macro: ctx.macro != null,
      credit: ctx.credit != null,
      cascadeCount: Array.isArray(ctx.cascade) ? ctx.cascade.length : 0,
      signalsCount: Array.isArray(ctx.signals) ? ctx.signals.length : 0,
      insiderCount: Array.isArray(ctx.insider) ? ctx.insider.length : 0,
      ownershipCount: Array.isArray(ctx.ownership) ? ctx.ownership.length : 0,
      optionsCount: Array.isArray(ctx.options) ? ctx.options.length : 0,
      korea: ctx.korea != null,
      nport: ctx.nport != null,
      blocksCount: Array.isArray(ctx.blocks) ? ctx.blocks.length : 0,
    },
  } : null;

  const prompt = buildPrompt(tf, ctx);
  let brief = null;
  let aiDiag: { source?: string; textLength?: number; textSample?: string; parsed?: boolean; error?: string } = {};
  try {
    const { text, source } = await callAI(prompt);
    aiDiag = { source, textLength: text?.length ?? 0, textSample: (text ?? '').slice(0, 300), parsed: false };
    if (text) brief = parseAIResponse(text, tf, source);
    if (brief) aiDiag.parsed = true;
    if (!brief) logger.warn('api.daily-brief', 'ai_unparseable', { tf, source, textLength: text?.length });
  } catch (err) {
    aiDiag.error = err instanceof Error ? err.message : String(err);
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
  return NextResponse.json({
    ...brief,
    cached: false,
    ...(debugInfo ? { debug: { ...debugInfo, ai: aiDiag } } : {}),
  });
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
