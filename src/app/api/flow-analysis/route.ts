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
import { isGarbage } from '@/lib/strategy-quality';
import { parseTimeframe, TIMEFRAME, type Timeframe } from '@/lib/timeframes';
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

IMPORTANT: The data above is PRICE RETURNS of country ETFs — a rotation proxy, NOT measured fund flows.
Never claim "money flowed in/out" or cite inflow amounts. Use relative-performance language
(outperforming/lagging) in summary and causes.
Analyze the drivers of the return rotation for each country/asset. Respond in the following JSON format only:
{
  "summary": "Key summary of the return rotation (2-3 sentences, relative-performance language)",
  "mainTheme": "Single dominant market theme (max 10 words)",
  "countries": [
    {
      "country": "country name",
      "ret": "+X.X%",
      "returnSignal": "outperforming or lagging",
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
  // 단일 소스 parseTimeframe 으로 정규화 — invalid tf 가 캐시 키와 retKey/rotKey 사이에 모순을 만들지 않게 막음
  const tf: Timeframe = parseTimeframe(searchParams.get('tf'));
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

  const retKey = TIMEFRAME[tf].retKey;

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
  const rotKey = TIMEFRAME[tf].rotKey;
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
    // 2026-07-02: skipVllm 제거 — 클라우드 키 전부 revoked(.env.local 2026-06-15) 상태에서 skipVllm 은
    //   유일한 LLM(vLLM Qwen3-30B)을 건너뛰어 영구 static-fallback 이었음. "EXAONE-2.4B 취약" 은 stale 가정.
    //   timeout: finance 모델 실측 ~10 tok/s (AWQ 재양자화 전) — 1400 tok 상한이면 25s 는 항상 timeout.
    timeoutMs: 150000,
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

  // 2026-07-04: returnSignal(신 스키마) → direction 별칭 파생 — UI(화살표/색상)는 direction 소비, 데이터
  //   의미는 returnSignal(수익률 우위/부진)이 정본. measurement 로 proxy 임을 명시.
  if (analysis && Array.isArray((analysis as Record<string, unknown>).countries)) {
    for (const c of (analysis as { countries: Array<Record<string, unknown>> }).countries) {
      if (c && typeof c === 'object') {
        if (c.returnSignal && !c.direction) c.direction = c.returnSignal === 'outperforming' ? 'inflow' : 'outflow';
        if (c.direction && !c.returnSignal) c.returnSignal = c.direction === 'inflow' ? 'outperforming' : 'lagging';
        c.measurement = 'price_return_proxy';
      }
    }
  }

  // Garbage check: summary가 반복/짧은 텍스트면 parse 실패와 동일 처리 → stale 서빙
  if (analysis) {
    const summaryText = (analysis as Record<string, unknown>).summary;
    if (typeof summaryText === 'string' && isGarbage(summaryText, 40)) {
      logger.warn('flow-analysis', 'garbage_summary', { tf, sample: summaryText.slice(0, 80) });
      analysis = null;
    }
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
      mainTheme: `Data summary (AI analysis temporarily unavailable)`,
      countries: sorted.map(c => ({
        country: c.country,
        ret: fmtRet(c.ret),
        returnSignal: c.ret >= 0 ? 'outperforming' : 'lagging',   // 2026-07-04: 가격수익률 proxy 정직화
        direction: c.ret >= 0 ? 'inflow' : 'outflow',             // deprecated alias — UI 화살표/색상 전용
        measurement: 'price_return_proxy',
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
      summary: 'AI capital flow analysis pending (local LLM unavailable). Price data unavailable.',
      mainTheme: 'Data unavailable — AI analysis pending',
      countries: [],
      rotations: [],
      keyWatchpoints: ['AI analysis unavailable — local LLM offline'],
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
