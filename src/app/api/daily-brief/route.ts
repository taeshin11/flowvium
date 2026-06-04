import { logger, loggedRedisSet, loggedRedisDel } from '@/lib/logger';
import { NextResponse } from 'next/server';
import {
  createRedis, cacheKey, staleCacheKey, callAI, buildPrompt, parseAIResponse, fallbackBrief,
  gatherTabContext, type DailyBrief,
} from '@/lib/daily-brief';
import { parseTimeframe, type Timeframe } from '@/lib/timeframes';
import { isGarbage } from '@/lib/strategy-quality';

export const dynamic = 'force-dynamic';

// Increase Vercel function timeout — required on Pro plan (60s), no-op on Hobby (10s)
export const maxDuration = 60;

// 4h CDN cache + 8h stale-while-revalidate — AI responses are expensive; serve stale rather than
// burning tokens on every cold Lambda start. Vercel edge serves this without hitting Lambda at all.
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=14400, stale-while-revalidate=28800' };

// Module-level in-memory cache for environments without Redis.
// Persists across requests while the function instance stays warm (typical ~several minutes).
// 4h TTL — without Redis every request calls GROQ, exhausting 100k TPD by midday.
// Keyed by tf; value = {brief, expiresAt}.
const MEMORY_CACHE: Map<Timeframe, { brief: DailyBrief; expiresAt: number }> = new Map();
const MEMORY_TTL_MS = 4 * 60 * 60 * 1000;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  // 단일 소스 parseTimeframe 으로 정규화 — invalid tf 가 캐시 키 분기와 라벨/retKey 사이의
  // 모순을 만들지 않도록 경계에서 정제
  const tf: Timeframe = parseTimeframe(searchParams.get('tf'));
  // 2026-06-04: locale 별 캐시/생성 — 이전엔 tf 만 키로 써서 영어 1개를 전 언어에 서빙(ko 미번역).
  const locale = (searchParams.get('locale') || 'en').trim();
  const lkey = locale === 'en' ? cacheKey(tf) : `${cacheKey(tf)}:${locale}`;
  const force = searchParams.get('force') === '1';
  const debug = searchParams.get('debug') === '1';
  // probe=1: return cached or data-fallback immediately without AI — used by verify-metrics
  const probe = searchParams.get('probe') === '1';

  const reqStart = Date.now();
  const redis = createRedis();
  if (redis && !force) {
    try {
      const cached = await redis.get(lkey);
      if (cached) {
        logger.info('api.daily-brief', 'cache_hit', { tf });
        return NextResponse.json({ ...(cached as object), cached: true }, { headers: CDN_HEADERS });
      }
    } catch (err) { logger.warn('api.daily-brief', 'cache_read_error', { tf, error: err }); }
  }

  // In-memory fallback cache (used when Redis unavailable — conserves GROQ TPD).
  if (!redis && !force) {
    const mem = MEMORY_CACHE.get(tf);
    if (mem && mem.expiresAt > Date.now()) {
      logger.info('api.daily-brief', 'memory_cache_hit', { tf, ageMs: Date.now() - (mem.expiresAt - MEMORY_TTL_MS) });
      return NextResponse.json({ ...mem.brief, cached: true, cacheLayer: 'memory' }, { headers: CDN_HEADERS });
    }
  }

  // probe mode: no cache found → return minimal static fallback (no AI, no heavy context fetch)
  if (probe) {
    return NextResponse.json(fallbackBrief(tf), { headers: { 'Cache-Control': 'no-store' } });
  }

  // Stale AI brief — checked before gathering context so the 6h gap between
  // midnight-KST key rotation and 06:00 KST cron run serves yesterday's AI
  // brief rather than the data fallback. Only used when force=0.
  let staleAiBrief: DailyBrief | null = null;
  if (redis && !force) {
    try {
      staleAiBrief = await redis.get<DailyBrief>(staleCacheKey(tf));
    } catch { /* non-fatal */ }
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
  const ctx = await gatherTabContext(redis, baseUrl, tf);

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
      cot: ctx.cot != null,
      commodity: ctx.commodity != null,
    },
  } : null;

  const prompt = buildPrompt(tf, ctx, locale);
  let brief = null;
  let aiDiag: { source?: string; textLength?: number; textSample?: string; parsed?: boolean; error?: string; attempts?: unknown } = {};
  try {
    const r = await callAI(prompt);
    aiDiag = { source: r.source, textLength: r.text?.length ?? 0, textSample: (r.text ?? '').slice(0, 300), parsed: false, attempts: r.attempts };
    if (r.text) brief = parseAIResponse(r.text, tf, r.source);
    if (brief) aiDiag.parsed = true;
    if (!brief) logger.warn('api.daily-brief', 'ai_unparseable', { tf, source: r.source, textLength: r.text?.length });
    // Garbage check: outlook이 반복/짧은 텍스트면 parse 실패와 동일 → stale/fallback 경로
    if (brief && isGarbage(brief.outlook ?? '', 30)) {
      logger.warn('api.daily-brief', 'garbage_outlook', { tf, sample: (brief.outlook ?? '').slice(0, 80) });
      brief = null;
    }
  } catch (err) {
    aiDiag.error = err instanceof Error ? err.message : String(err);
    logger.error('api.daily-brief', 'ai_exception', { tf, error: err });
  }

  if (!brief) {
    // Prefer yesterday's AI brief (stale) over the data-driven fallback.
    // The stale brief is still AI-quality context; data-fallback is lower quality.
    if (staleAiBrief) {
      brief = { ...staleAiBrief, cached: true, source: `stale(${staleAiBrief.source ?? 'ai'})` } as DailyBrief;
      logger.info('api.daily-brief', 'used_stale_ai', { tf, origSource: staleAiBrief.source });
    } else {
      brief = fallbackBrief(tf, ctx);
      logger.warn('api.daily-brief', 'used_fallback', { tf });
    }
  }

  // 캐시는 AI 생성 결과(또는 이와 동등한 품질)만 저장. data-fallback 은
  // 일시적 AI 장애 때문에 생성된 저품질 snapshot 이므로 캐시했다가 이후 10분간
  // fallback 브리프를 계속 서빙하는 악순환 방지 — 다음 요청이 AI 재시도하도록 패스스루.
  const isFreshAi = brief.source !== 'data' && !brief.source?.startsWith('stale(');
  const isAiQuality = brief.source !== 'data';
  if (redis && isFreshAi) {
    // Write both primary (date-keyed) and stale (date-free) keys.
    await Promise.allSettled([
      loggedRedisSet(redis, 'api.daily-brief', lkey, brief, { ex: 26 * 60 * 60 }),
      loggedRedisSet(redis, 'api.daily-brief', staleCacheKey(tf), brief, { ex: 48 * 60 * 60 }),
    ]);
  } else if (!redis && isAiQuality) {
    // No Redis — populate in-memory cache so subsequent non-force requests in the
    // same warm instance skip the costly HTTP-fallback + AI-call path.
    MEMORY_CACHE.set(tf, { brief, expiresAt: Date.now() + MEMORY_TTL_MS });
  } else {
    logger.info('api.daily-brief', 'skip_cache_fallback_source', { tf, source: brief.source });
  }

  logger.info('api.daily-brief', 'served', { tf, source: brief.source, durationMs: Date.now() - reqStart });
  // AI-quality responses: 4h CDN cache.
  // Data-fallback (AI exhausted): 5min CDN so repeat users don't each wait 16s for the
  // Lambda. Stale-loop bounded at 5min, acceptable — GROQ recovers daily at 09:00 KST.
  const responseHeaders = isAiQuality ? CDN_HEADERS : { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' };
  return NextResponse.json({
    ...brief,
    cached: false,
    ...(debugInfo ? { debug: { ...debugInfo, ai: aiDiag } } : {}),
  }, { headers: responseHeaders });
}

export async function DELETE(request: Request) {
  if (request.headers.get('x-cron-secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const redis = createRedis();
  if (!redis) return NextResponse.json({ error: 'No Redis' }, { status: 503 });
  const keys = (['1w', '4w', '13w'] as Timeframe[]).map(cacheKey);
  await loggedRedisDel(redis, 'api.daily-brief', keys);
  return NextResponse.json({ deleted: keys });
}
