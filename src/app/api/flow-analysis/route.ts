import { logger, loggedRedisSet} from '@/lib/logger';
/**
 * /api/flow-analysis
 *
 * 통합 AI 체인 (vLLM → GROQ → Gemini) 으로 국가별 자금흐름의 원인을 분석.
 * 각 국가의 수익률 데이터를 받아 "왜 이렇게 움직였는가"를 설명.
 *
 * Cache: 4h Redis
 */
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { callAI } from '@/lib/ai-providers';

export const maxDuration = 60;

const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=12000, stale-while-revalidate=600' };

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

// Time-independent key + 4h TTL (vs. hourly-rotating key).
// Previously hourly key caused 24 Redis misses/day × 3k tokens = 72k tokens consumed by probes alone.
// 4h TTL: ~6 regenerations/day, same freshness for a "4-week capital flows" analysis.
function cacheKey(tf: string): string {
  return `flowvium:flow-analysis:v3:${tf}`;
}
// Stale fallback key: 48h TTL, only written on AI success.
// Served when AI is exhausted and the primary 4h cache has expired.
function staleCacheKey(tf: string): string {
  return `flowvium:flow-analysis:v3:stale:${tf}`;
}
const CACHE_TTL_S = 4 * 60 * 60;        // 4 hours (primary)
const STALE_CACHE_TTL_S = 48 * 60 * 60; // 48 hours (fallback)

const FLOW_SYSTEM_PROMPT = `당신은 글로벌 자금흐름 전문 애널리스트입니다.
각 국가별 시장 수익률 데이터를 보고, 그 흐름의 근본적인 원인을 분석하세요.
원인 분석은 구체적이고 실질적이어야 합니다 (예: "관세 완화 기대", "반도체 수주 증가", "연준 인하 기대").
반드시 JSON 형식으로만 응답하세요.`;

// ── 프롬프트 빌더 ─────────────────────────────────────────────────────────────
function buildPrompt(
  tf: string,
  countries: Array<{ country: string; ticker: string; ret: number }>,
  rotations: Array<{ from: string; to: string; diff: number }>,
  topAssets: Array<{ name: string; ticker: string; ret: number }>,
  gvd: { goldRet: number; dollarRet: number; signal: string },
) {
  const tfLabel = tf === '1w' ? '1주' : tf === '4w' ? '4주' : '13주';
  const cList = countries.map(c => `${c.country}(${c.ticker}): ${c.ret >= 0 ? '+' : ''}${c.ret.toFixed(1)}%`).join(', ');
  const rList = rotations.slice(0, 5).map(r => `${r.from}→${r.to}(+${r.diff.toFixed(1)}%p)`).join(', ');
  const aList = topAssets.slice(0, 8).map(a => `${a.ticker}: ${a.ret >= 0 ? '+' : ''}${a.ret.toFixed(1)}%`).join(', ');

  return `${tfLabel} 기간 글로벌 자금흐름 원인 분석

=== 국가별 ETF 수익률 ===
${cList}

=== 주요 국가간 로테이션 ===
${rList}

=== 주요 자산 수익률 ===
${aList}

=== 금/달러 ===
금: ${gvd.goldRet >= 0 ? '+' : ''}${gvd.goldRet.toFixed(1)}%, 달러: ${gvd.dollarRet >= 0 ? '+' : ''}${gvd.dollarRet.toFixed(1)}%, 신호: ${gvd.signal}

각 국가/자산의 흐름 원인을 분석하세요. 아래 JSON 형식으로만 응답하세요:
{
  "summary": "전체 자금흐름 핵심 요약 (2-3문장)",
  "mainTheme": "현재 시장을 지배하는 핵심 테마 1가지 (10단어 이내)",
  "countries": [
    {
      "country": "국가명",
      "ret": "+X.X%",
      "direction": "inflow 또는 outflow",
      "causes": ["원인1 (구체적)", "원인2"],
      "risk": "단기 리스크 1가지"
    }
  ],
  "rotations": [
    {
      "from": "출발국가",
      "to": "도착국가",
      "reason": "이 로테이션의 핵심 원인 (1문장)"
    }
  ],
  "keyWatchpoints": ["주목해야 할 포인트 1", "포인트 2", "포인트 3"]
}`;
}

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tf = searchParams.get('tf') ?? '4w';

  const redis = createRedis();
  if (redis) {
    try {
      const cached = await redis.get(cacheKey(tf));
      if (cached) return NextResponse.json({ ...(cached as object), cached: true }, { headers: CDN_HEADERS });
    } catch { /* non-fatal */ }
  }

  // Stale fallback guard: read it now so we can serve it if AI fails later in this request.
  let staleResult: object | null = null;
  if (redis) {
    try {
      staleResult = await redis.get<object>(staleCacheKey(tf));
    } catch { /* non-fatal */ }
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
    return NextResponse.json({ error: 'capital-flows data unavailable' }, { status: 503 });
  }

  const retKey = tf === '1w' ? 'ret1w' : tf === '4w' ? 'ret4w' : 'ret13w';

  // Extract country returns
  // capital-flows uses 'label' for display name and 'id' for key — not 'country'
  const countryFlow = capitalData.countryFlow as Record<string, unknown> | undefined;
  const rawCountries = (countryFlow?.countries as Array<Record<string, unknown>>) ?? [];
  const countries = rawCountries.map(c => ({
    country: (c.label ?? c.id) as string,
    ticker: c.ticker as string,
    ret: (c[retKey] as number) ?? 0,
  })).sort((a, b) => b.ret - a.ret);

  // Extract rotations — capital-flows uses 'magnitude', not 'diff'
  const rotKey = tf === '1w' ? 'rotations1w' : tf === '4w' ? 'rotations4w' : 'rotations13w';
  const rotations = ((countryFlow?.[rotKey] as Array<Record<string, unknown>>) ?? []).map(r => ({
    from: r.from as string,
    to: r.to as string,
    diff: (r.magnitude as number) ?? 0,
  }));

  // Extract top assets — capital-flows uses 'label', not 'name'
  const assets = (capitalData.assets as Array<Record<string, unknown>>) ?? [];
  const topAssets = [...assets]
    .sort((a, b) => Math.abs((b[retKey] as number) ?? 0) - Math.abs((a[retKey] as number) ?? 0))
    .slice(0, 8)
    .map(a => ({ name: (a.label ?? a.ticker) as string, ticker: a.ticker as string, ret: (a[retKey] as number) ?? 0 }));

  // Gold vs dollar
  const gvd = capitalData.goldVsDollar as Record<string, unknown> | undefined;
  const goldRet = (tf === '1w' ? gvd?.goldRet1w : tf === '4w' ? gvd?.goldRet4w : gvd?.goldRet13w) as number ?? 0;
  const dollarRet = (tf === '1w' ? gvd?.dollarRet1w : tf === '4w' ? gvd?.dollarRet4w : gvd?.dollarRet13w) as number ?? 0;
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

  // Never let CDN cache a failure — stale fallback traps subsequent requests in a loop.
  // If AI failed but we have a previous stale result, serve it with a stale flag.
  if (!analysis && staleResult) {
    logger.warn('flow-analysis', 'serving_stale', { tf, source: (staleResult as Record<string, unknown>).source });
    return NextResponse.json({ ...(staleResult as object), stale: true, staleFallback: true }, { headers: CDN_HEADERS });
  }
  const headers = analysis ? CDN_HEADERS : { 'Cache-Control': 'no-store' };
  return NextResponse.json(result, { headers });
}
