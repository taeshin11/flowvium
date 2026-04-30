import { logger, loggedRedisSet} from '@/lib/logger';
/**
 * /api/flow-analysis
 *
 * 통합 AI 체인 (vLLM → GROQ → Gemini) 으로 국가별 자금흐름의 원인을 분석.
 * 각 국가의 수익률 데이터를 받아 "왜 이렇게 움직였는가"를 설명.
 *
 * Cache: 8h Redis
 */
import { NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import type { Redis } from '@upstash/redis';
import { callAI } from '@/lib/ai-providers';
export const dynamic = 'force-dynamic';

export const maxDuration = 60;

const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=12000, stale-while-revalidate=600' };

// Module-level memory cache — without Redis, every request calls GROQ → 100k TPD exhausted by midday.
// 4h TTL matches the primary Redis TTL; keyed by tf.
const FLOW_MEMORY_CACHE = new Map<string, { result: Record<string, unknown>; expiresAt: number }>();
const FLOW_MEMORY_TTL_MS = 8 * 60 * 60 * 1000;

// Time-independent key + 8h TTL (vs. hourly-rotating key).
// Previously hourly key caused 24 Redis misses/day × 3k tokens = 72k tokens consumed by probes alone.
// 8h TTL: ~3 regenerations/day, same freshness for a "4-week capital flows" analysis.
// v4: prompt switched to English (iter141) — stale v3 cache would serve Korean responses
function cacheKey(tf: string): string {
  return `flowvium:flow-analysis:v4:${tf}`;
}
// Stale fallback key: 48h TTL, only written on AI success.
// Served when AI is exhausted and the primary 4h cache has expired.
function staleCacheKey(tf: string): string {
  return `flowvium:flow-analysis:v4:stale:${tf}`;
}
const CACHE_TTL_S = 8 * 60 * 60;        // 8 hours (capital flows change daily, not hourly)
const STALE_CACHE_TTL_S = 48 * 60 * 60; // 48 hours (fallback)

const FLOW_SYSTEM_PROMPT = `You are a global capital flows analyst.
Analyze market return data by country and identify the fundamental drivers of those flows.
Be specific and substantive (e.g., "tariff relief expectations", "semiconductor demand surge", "Fed rate cut bets").
Respond in JSON format only.`;

const COUNTRY_EN: Record<string, string> = {
  'us': 'US', 'korea': 'Korea', 'japan': 'Japan', 'china': 'China',
  'europe': 'Europe', 'uk': 'UK', 'india': 'India', 'brazil': 'Brazil',
  'taiwan': 'Taiwan', 'australia': 'Australia', 'germany': 'Germany', 'mexico': 'Mexico',
};

// ── 프롬프트 빌더 ─────────────────────────────────────────────────────────────
function buildPrompt(
  tf: string,
  countries: Array<{ country: string; ticker: string; ret: number }>,
  rotations: Array<{ from: string; to: string; diff: number }>,
  topAssets: Array<{ name: string; ticker: string; ret: number }>,
  gvd: { goldRet: number | null; dollarRet: number | null; signal: string },
) {
  const tfLabel = tf === '1w' ? '1W' : tf === '4w' ? '4W' : '13W';
  const fmt = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
  const cList = countries.map(c => `${c.country}(${c.ticker}): ${fmt(c.ret)}`).join(', ');
  const rList = rotations.slice(0, 5).map(r => `${r.from}→${r.to}(+${r.diff.toFixed(1)}%p)`).join(', ');
  const aList = topAssets.slice(0, 8).map(a => `${a.ticker}: ${fmt(a.ret)}`).join(', ');

  return `${tfLabel} Global Capital Flows Analysis

=== Country ETF Returns ===
${cList}

=== Key Country Rotations ===
${rList}

=== Top Asset Returns ===
${aList}

=== Gold / Dollar ===
Gold: ${gvd.goldRet != null ? fmt(gvd.goldRet) : 'N/A'}, Dollar: ${gvd.dollarRet != null ? fmt(gvd.dollarRet) : 'N/A'}, Signal: ${gvd.signal}

Analyze the drivers of capital flows for each country/asset. Respond in the following JSON format only:
{
  "summary": "Key summary of overall capital flows (2-3 sentences)",
  "mainTheme": "Single dominant market theme (max 10 words)",
  "countries": [
    {
      "country": "country name",
      "ret": "+X.X%",
      "direction": "inflow or outflow",
      "causes": ["cause1 (specific)", "cause2"],
      "risk": "single short-term risk"
    }
  ],
  "rotations": [
    {
      "from": "source country",
      "to": "destination country",
      "reason": "core reason for this rotation (1 sentence)"
    }
  ],
  "keyWatchpoints": ["key watchpoint 1", "watchpoint 2", "watchpoint 3"]
}`;
}

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tf = searchParams.get('tf') ?? '4w';
  // probe=1: return cached data or minimal fallback without calling AI — used by verify-metrics
  const probe = searchParams.get('probe') === '1';

  const redis = createRedis();

  // Module-level memory cache hit (no-Redis path)
  if (!redis) {
    const mem = FLOW_MEMORY_CACHE.get(tf);
    if (mem && Date.now() < mem.expiresAt) {
      logger.info('flow-analysis', 'memory_cache_hit', { tf });
      return NextResponse.json({ ...mem.result, cached: true }, { headers: CDN_HEADERS });
    }
  }

  // Fetch fresh cache and stale fallback in parallel — saves one sequential Redis round-trip
  let staleResult: object | null = null;
  if (redis) {
    try {
      const [freshResult, staleRead] = await Promise.allSettled([
        redis.get(cacheKey(tf)),
        redis.get<object>(staleCacheKey(tf)),
      ]);
      if (freshResult.status === 'fulfilled' && freshResult.value) {
        return NextResponse.json({ ...(freshResult.value as object), cached: true }, { headers: CDN_HEADERS });
      }
      if (staleRead.status === 'fulfilled') staleResult = staleRead.value;
    } catch { /* non-fatal */ }
  }

  if (probe) {
    return NextResponse.json({ source: 'probe-fallback', analysis: null, cached: false }, { headers: { 'Cache-Control': 'no-store' } });
  }

  // Fetch capital flows data.
  // NOTE: avoid `process.env.VERCEL_URL` — it returns the deployment-specific
  // URL which is often Vercel-auth-protected for team deployments (401).
  // Use the incoming request's host, which is the public alias.
  const reqHost = new URL(request.url).host;
  const reqProto = new URL(request.url).protocol;
  const baseUrl = reqHost.startsWith('localhost')
    ? 'http://localhost:3000'
    : `${reqProto}//${reqHost}`;

  let capitalData: Record<string, unknown> | null = null;
  try {
    const res = await fetch(`${baseUrl}/api/capital-flows`, { signal: AbortSignal.timeout(20000), cache: 'no-store' });
    if (res.ok) {
      capitalData = await res.json();
    } else {
      logger.warn('flow-analysis', 'capital_flows_http_error', { status: res.status });
    }
  } catch (e) {
    logger.error('flow-analysis', 'capital_flows_fetch_failed', { error: e });
  }

  if (!capitalData) {
    if (staleResult) {
      logger.warn('flow-analysis', 'serving_stale_capital_unavailable', { tf });
      return NextResponse.json({ ...(staleResult as object), stale: true, staleFallback: true }, { headers: CDN_HEADERS });
    }
    // No stale and no capital data — continue with empty object so static fallback (line ~292) applies.
    // Returns degraded analysis instead of 503 so UI can show a status message.
    logger.warn('flow-analysis', 'capital_unavailable_using_static_fallback', { tf });
    capitalData = {};
  }

  const retKey = tf === '1w' ? 'ret1w' : tf === '4w' ? 'ret4w' : 'ret13w';

  // Extract country returns
  // capital-flows uses 'label' for display name and 'id' for key — not 'country'
  const countryFlow = capitalData.countryFlow as Record<string, unknown> | undefined;
  const rawCountries = (countryFlow?.countries as Array<Record<string, unknown>>) ?? [];
  const countries = rawCountries.map(c => ({
    country: COUNTRY_EN[(c.id as string) ?? ''] ?? (c.id as string) ?? 'Unknown',
    ticker: c.ticker as string,
    ret: (c[retKey] as number | null) ?? null,
  })).filter((c): c is { country: string; ticker: string; ret: number } => c.ret != null).sort((a, b) => b.ret - a.ret);

  // Extract rotations — capital-flows uses 'magnitude', not 'diff'
  const rotKey = tf === '1w' ? 'rotations1w' : tf === '4w' ? 'rotations4w' : 'rotations13w';
  const rotations = ((countryFlow?.[rotKey] as Array<Record<string, unknown>>) ?? []).map(r => ({
    from: COUNTRY_EN[(r.fromId as string) ?? ''] ?? COUNTRY_EN[(r.from as string) ?? ''] ?? (r.from as string),
    to: COUNTRY_EN[(r.toId as string) ?? ''] ?? COUNTRY_EN[(r.to as string) ?? ''] ?? (r.to as string),
    diff: (r.magnitude as number) ?? 0,
  }));

  // Extract top assets — capital-flows uses 'label', not 'name'
  const assets = (capitalData.assets as Array<Record<string, unknown>>) ?? [];
  const topAssets = [...assets]
    .sort((a, b) => Math.abs((b[retKey] as number) ?? 0) - Math.abs((a[retKey] as number) ?? 0))
    .slice(0, 8)
    .filter(a => (a[retKey] as number | null) != null)
    .map(a => ({ name: (a.label ?? a.ticker) as string, ticker: a.ticker as string, ret: (a[retKey] as number) }));

  // Gold vs dollar
  const gvd = capitalData.goldVsDollar as Record<string, unknown> | undefined;
  const goldRet = ((tf === '1w' ? gvd?.goldRet1w : tf === '4w' ? gvd?.goldRet4w : gvd?.goldRet13w) as number | null) ?? null;
  const dollarRet = ((tf === '1w' ? gvd?.dollarRet1w : tf === '4w' ? gvd?.dollarRet4w : gvd?.dollarRet13w) as number | null) ?? null;
  const signal = (tf === '1w' ? gvd?.signal1w : tf === '4w' ? gvd?.signal4w : gvd?.signal13w) as string ?? '';

  const prompt = buildPrompt(tf, countries, rotations, topAssets, { goldRet, dollarRet, signal });
  const aiResult = await callAI(prompt, {
    systemPrompt: FLOW_SYSTEM_PROMPT,
    maxTokens: 1400,
    temperature: 0.55,
    // EXAONE-2.4B는 JSON 구조 분석에 취약 — GROQ 70b 부터 시작
    skipVllm: true,
    timeoutMs: 25000,
    tag: 'flow-analysis',
  });
  const raw = aiResult.text;

  let analysis: Record<string, unknown> | null = null;
  if (raw) {
    try {
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, raw];
      analysis = JSON.parse((jsonMatch[1] ?? raw).trim());
    } catch (e) { logger.warn('flow-analysis', 'ai_parse_failed', { tf, rawLength: raw.length, error: e }); }
  }

  const result: Record<string, unknown> = {
    analysis,
    tf,
    source: aiResult.source,
    generatedAt: new Date().toISOString(),
    cached: false,
    durationMs: aiResult.durationMs,
  };
  // Expose failure attempts when all providers fail — aids diagnosis without secrets
  if (!analysis && aiResult.attempts?.length) {
    result.attempts = aiResult.attempts;
  }

  if (redis && analysis) {
    try {
      await Promise.all([
        loggedRedisSet(redis, 'api.flow-analysis', cacheKey(tf), result, { ex: CACHE_TTL_S }),
        loggedRedisSet(redis, 'api.flow-analysis', staleCacheKey(tf), result, { ex: STALE_CACHE_TTL_S }),
      ]);
      logger.info('flow-analysis', 'cache_saved', { tf });
    } catch (e) { logger.warn('flow-analysis', 'cache_write_error', { tf, error: e }); }
  }

  // Module-level memory cache write (no-Redis path) — only cache real AI analysis, not static fallback
  if (!redis && analysis && !(analysis as Record<string, unknown>)._staticFallback) {
    FLOW_MEMORY_CACHE.set(tf, { result, expiresAt: Date.now() + FLOW_MEMORY_TTL_MS });
    logger.info('flow-analysis', 'memory_cache_written', { tf });
  }

  // Never let CDN cache a failure — stale fallback traps subsequent requests in a loop.
  // If AI failed but we have a previous stale result, serve it with a stale flag.
  if (!analysis && staleResult) {
    logger.warn('flow-analysis', 'serving_stale', { tf, source: (staleResult as Record<string, unknown>).source });
    return NextResponse.json({ ...(staleResult as object), stale: true, staleFallback: true }, { headers: CDN_HEADERS });
  }

  // Static fallback: AI quota 소진 시 capital flows 데이터로 기계적 요약 생성
  // analysis가 없어도 사용자가 수치 기반 요약을 볼 수 있도록
  if (!analysis && countries.length > 0) {
    const fmtRet = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
    const sorted = [...countries].sort((a, b) => b.ret - a.ret);
    const tfLabel = tf === '1w' ? '1W' : tf === '4w' ? '4W' : '13W';
    analysis = {
      summary: `${tfLabel} capital flows mechanical summary (AI analysis pending). Leaders: ${sorted.slice(0, 3).map(c => `${c.country} ${fmtRet(c.ret)}`).join(', ')}.`,
      mainTheme: `Data summary (AI quota exhausted — resets 09:00 KST)`,
      countries: sorted.map(c => ({
        country: c.country,
        ret: fmtRet(c.ret),
        direction: c.ret >= 0 ? 'inflow' : 'outflow',
        causes: ['Return data only — AI analysis unavailable'],
        risk: '',
      })),
      rotations: rotations.slice(0, 3).map(r => ({
        from: r.from,
        to: r.to,
        reason: `Return spread ${r.diff >= 0 ? '+' : ''}${r.diff.toFixed(1)}%p`,
      })),
      keyWatchpoints: [
        `Bull markets: ${sorted.slice(0, 3).map(c => c.country).join(', ')}`,
        `Bear markets: ${sorted.slice(-3).reverse().map(c => c.country).join(', ')}`,
        `Gold ${goldRet != null ? fmtRet(goldRet) : 'N/A'} / Dollar ${dollarRet != null ? fmtRet(dollarRet) : 'N/A'}`,
      ],
      _staticFallback: true,
    };
    result.analysis = analysis;
    result.source = 'static-fallback';
    logger.info('flow-analysis', 'static_fallback_served', { tf, countries: countries.length });
  }

  // Final minimal fallback: prevents null analysis (error) when both AI and price data fail.
  // Returns degraded (source=static-fallback) instead of error so UI can show a status.
  if (!analysis) {
    analysis = {
      summary: 'AI capital flow analysis pending (GROQ quota exhausted — resets 09:00 KST). Price data unavailable.',
      mainTheme: 'Data unavailable — AI analysis pending',
      countries: [],
      rotations: [],
      keyWatchpoints: ['AI quota: exhausted (daily reset 09:00 KST)'],
      _staticFallback: true,
    };
    result.analysis = analysis;
    result.source = 'static-fallback';
    logger.info('flow-analysis', 'minimal_fallback_served', { tf, reason: 'no_data_no_ai' });
  }

  const isStaticFallback = !!(analysis as Record<string, unknown>)?._staticFallback;
  const headers = isStaticFallback ? { 'Cache-Control': 'no-store' } : CDN_HEADERS;
  return NextResponse.json(result, { headers });
}
