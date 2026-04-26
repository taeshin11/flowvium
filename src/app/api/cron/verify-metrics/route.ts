/**
 * /api/cron/verify-metrics  —  30분 주기 메트릭 헬스 체커
 *
 * 목적: 개별 수치(F&G 국가별, Capital Flows 자산별, Macro 지표별 …)가
 * 각자 잘 작동하는지 한꺼번에 주기적으로 검증하고, 결과를 Redis에 스냅샷으로
 * 저장해 /admin/logs 페이지에서 한 화면에 확인 가능하게 함.
 *
 * 호출: Vercel Cron (vercel.json에 등록)
 * 보호: x-admin-secret 또는 Vercel 내부 크론 컨벤션
 *
 * 출력: Redis key `flowvium:metrics-health:v1` 에 아래 구조로 저장 (TTL 2h)
 *   {
 *     checkedAt: ISO 타임스탬프,
 *     overallStatus: 'healthy' | 'degraded' | 'error',
 *     summary: { ok: N, degraded: N, error: N, total: N },
 *     items: [ { key, label, status, value?, source?, lastError? }, ... ]
 *   }
 */
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { logger, loggedRedisSet } from '@/lib/logger';
import { logMetrics } from '@/lib/metrics-db';
import { YAHOO_HEADERS } from '@/lib/yahoo-finance';

export const dynamic = 'force-dynamic';

const SNAPSHOT_KEY = 'flowvium:metrics-health:v1';
const SNAPSHOT_TTL = 2 * 60 * 60; // 2h — 크론 30분 주기 대비 넉넉히

interface MetricItem {
  key: string;              // 고유 식별자 (e.g. 'fg.country.us')
  label: string;            // 사람이 읽을 이름
  group: string;            // 'fear-greed' | 'capital-flows' | 'macro' | ...
  // 'skipped' = intentionally optional/unreachable (e.g. paid-tier fallback not
  // configured, local-only service unreachable from prod). Not a degradation of
  // product health — tracked separately in summary, excluded from overallStatus.
  status: 'ok' | 'degraded' | 'error' | 'skipped';
  value?: number | string | null;
  source?: string;          // 'cnn' | 'composite' | 'yahoo' | 'fred' | ...
  details?: Record<string, unknown>;
  lastError?: string;
  /** 설명: 왜 skipped 인지. admin UI 에서 '무시' 라벨과 함께 노출. */
  skipReason?: string;
}

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

function checkAuth(req: Request): boolean {
  // Vercel Cron은 Authorization: Bearer <CRON_SECRET> 또는 user-agent vercel-cron 사용
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return true; // secret 미설정 환경에선 통과 (로컬 개발)
  const authHeader = req.headers.get('authorization');
  if (authHeader === `Bearer ${cronSecret}`) return true;
  if (req.headers.get('x-admin-secret') === cronSecret) return true;
  // Vercel 내부 크론은 user-agent 헤더에 'vercel-cron/' 포함
  if (req.headers.get('user-agent')?.includes('vercel-cron')) return true;
  return false;
}

// 내부 fetch용 베이스 URL (Vercel 배포 시 VERCEL_URL 사용)
function getBaseUrl(req: Request): string {
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

async function safeJson(base: string, path: string, timeoutMs = 12000): Promise<{ ok: boolean; data?: unknown; status?: number; error?: string }> {
  try {
    const res = await fetch(`${base}${path}`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'flowvium-metrics-verifier/1.0' },
      // MANDATORY: bypass Vercel CDN + Next.js Data Cache — probes must see live state,
      // not s-maxage-cached responses (causes caps.ALL bandCount=0 stale-cache bug, iter87)
      cache: 'no-store',
    });
    if (!res.ok) return { ok: false, status: res.status };
    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── 검증 모듈 ────────────────────────────────────────────────────────────────

async function verifyFearGreed(base: string): Promise<MetricItem[]> {
  const r = await safeJson(base, '/api/fear-greed');
  if (!r.ok) {
    return [{
      key: 'fg.ALL', label: 'Fear & Greed API', group: 'fear-greed',
      status: 'error', lastError: r.error ?? `HTTP ${r.status}`,
    }];
  }
  const data = r.data as { byCountry?: Array<Record<string, unknown>>; byAsset?: Array<Record<string, unknown>> };
  const items: MetricItem[] = [];

  for (const entry of data.byCountry ?? []) {
    const id = String(entry.id ?? '?');
    const score = typeof entry.score === 'number' ? entry.score : null;
    const source = entry.source as string | undefined;
    const quality = entry.dataQuality as string | undefined;
    const degraded = (entry.degradedFactors as string[] | undefined) ?? [];
    const status: MetricItem['status'] =
      score == null ? 'error' :
      quality === 'insufficient' ? 'error' :
      quality === 'partial' ? 'degraded' :
      // US는 source='cnn'여야 정상, composite면 degraded (CNN fetch 실패)
      (id === 'us' && source !== 'cnn') ? 'degraded' :
      'ok';
    items.push({
      key: `fg.country.${id}`,
      label: `F&G ${entry.label ?? id}`,
      group: 'fear-greed',
      status, value: score, source,
      details: { level: entry.level, dataQuality: quality, degradedFactors: degraded },
    });
  }
  for (const entry of data.byAsset ?? []) {
    const id = String(entry.id ?? '?');
    const score = typeof entry.score === 'number' ? entry.score : null;
    const quality = entry.dataQuality as string | undefined;
    const degraded = (entry.degradedFactors as string[] | undefined) ?? [];
    // 자산 카테고리(gold/tech/bonds/etc)는 fear-greed native 원지수가 존재하지 않는
    // 것이 설계상 기본값이므로 'no_native_index' 단독은 degradation 이 아니라 정상.
    // ETF composite 자체가 full 이면 ok 로 승격.
    const onlyNoNative = degraded.length === 1 && degraded[0] === 'no_native_index';
    const effectiveQuality = onlyNoNative ? 'full' : quality;
    const status: MetricItem['status'] =
      score == null ? 'error' :
      effectiveQuality === 'insufficient' ? 'error' :
      effectiveQuality === 'partial' ? 'degraded' :
      'ok';
    items.push({
      key: `fg.asset.${id}`,
      label: `F&G ${entry.label ?? id}`,
      group: 'fear-greed',
      status, value: score,
      source: entry.source as string | undefined,
      details: { level: entry.level, dataQuality: quality, degradedFactors: degraded },
    });
  }
  return items;
}

async function verifyCapitalFlows(base: string): Promise<MetricItem[]> {
  const r = await safeJson(base, '/api/capital-flows');
  if (!r.ok) {
    return [{
      key: 'cf.ALL', label: 'Capital Flows API', group: 'capital-flows',
      status: 'error', lastError: r.error ?? `HTTP ${r.status}`,
    }];
  }
  type RetEntry = { ticker: string; label?: string; ret1w?: number|null; ret4w?: number|null; ret13w?: number|null };
  const data = r.data as { assets?: RetEntry[]; factorPerformance?: RetEntry[]; sectorPerformance?: RetEntry[]; dataSource?: string };
  const items: MetricItem[] = [];

  const checkEntries = (entries: RetEntry[], prefix: string) => {
    for (const a of entries) {
      const vals = [a.ret1w, a.ret4w, a.ret13w];
      const nulls = vals.filter((v) => v == null).length;
      items.push({
        key: `${prefix}.${a.ticker}`,
        label: `CF ${a.label ?? a.ticker}`,
        group: 'capital-flows',
        status: nulls === 3 ? 'error' : nulls > 0 ? 'degraded' : 'ok',
        value: a.ret4w != null ? `${a.ret4w}%(4w)` : null,
        source: data.dataSource,
        details: { ret1w: a.ret1w, ret4w: a.ret4w, ret13w: a.ret13w },
      });
    }
  };

  checkEntries(data.assets ?? [], 'cf');
  checkEntries(data.factorPerformance ?? [], 'cf.factor');
  checkEntries(data.sectorPerformance ?? [], 'cf.sector');
  return items;
}

async function verifyVolatility(base: string): Promise<MetricItem[]> {
  const r = await safeJson(base, '/api/volatility');
  if (!r.ok) {
    return [{ key: 'vol.ALL', label: 'Volatility API', group: 'volatility', status: 'error', lastError: r.error ?? `HTTP ${r.status}` }];
  }
  const data = r.data as { vix?: number|null; vxst?: number|null; vxmt?: number|null; vvix?: number|null; regime?: string; history?: unknown[] };
  const items: MetricItem[] = [];
  items.push({ key: 'vol.vix',   label: 'VIX (30일)',   group: 'volatility', status: data.vix   != null ? 'ok' : 'error', value: data.vix   != null ? `${data.vix.toFixed(1)}`   : null });
  items.push({ key: 'vol.vxst',  label: 'VXST (9일)',   group: 'volatility', status: data.vxst  != null ? 'ok' : 'degraded', value: data.vxst  != null ? `${data.vxst.toFixed(1)}`  : null });
  items.push({ key: 'vol.vxmt',  label: 'VXMT (6개월)', group: 'volatility', status: data.vxmt  != null ? 'ok' : 'degraded', value: data.vxmt  != null ? `${data.vxmt.toFixed(1)}`  : null });
  items.push({ key: 'vol.regime',label: 'VIX Regime',   group: 'volatility', status: data.regime ? 'ok' : 'degraded', value: data.regime ?? null });
  items.push({ key: 'vol.hist',  label: 'VIX History',  group: 'volatility', status: Array.isArray(data.history) && data.history.length > 10 ? 'ok' : 'degraded', value: Array.isArray(data.history) ? `${data.history.length}일` : null });
  return items;
}


async function verifyCommodityCurve(base: string): Promise<MetricItem[]> {
  const r = await safeJson(base, '/api/commodity-curve');
  if (!r.ok) {
    return [{ key: 'comm.ALL', label: 'Commodity Curve API', group: 'commodity', status: 'error', lastError: r.error ?? `HTTP ${r.status}` }];
  }
  const data = r.data as { curves?: Array<{ id: string; name: string; curve?: Array<{ price: number }>; structure?: string; slope?: number }> };
  const items: MetricItem[] = [];
  for (const c of data.curves ?? []) {
    const pts = c.curve?.length ?? 0;
    items.push({
      key: `comm.${c.id}`,
      label: c.name,
      group: 'commodity',
      status: pts >= 3 ? 'ok' : pts > 0 ? 'degraded' : 'error',
      value: c.structure ? `${c.structure} ${(c.slope ?? 0) > 0 ? '+' : ''}${(c.slope ?? 0).toFixed(1)}%` : null,
      details: { points: pts, structure: c.structure, slope: c.slope },
    });
  }
  if (items.length === 0) items.push({ key: 'comm.EMPTY', label: 'Commodity Curve (empty)', group: 'commodity', status: 'error' });
  return items;
}

async function verifyMacroIndicators(base: string): Promise<MetricItem[]> {
  const r = await safeJson(base, '/api/macro-indicators');
  if (!r.ok) {
    return [{
      key: 'macro.ALL', label: 'Macro Indicators API', group: 'macro',
      status: 'error', lastError: r.error ?? `HTTP ${r.status}`,
    }];
  }
  const data = r.data as { indicators?: Array<{ name: string; actual?: unknown; forecast?: unknown; previous?: unknown }>; yieldCurve?: unknown };
  const items: MetricItem[] = [];
  for (const ind of data.indicators ?? []) {
    // actual=null but previous!=null → pre-release window (next release pending).
    // System is working correctly; previous = last confirmed actual. Mark as ok.
    // actual=null, no previous, has forecast → degraded (incomplete data)
    // actual=null, no previous, no forecast → error (missing entirely)
    const hasActual = ind.actual != null && ind.actual !== '';
    const hasForecast = ind.forecast != null && ind.forecast !== '';
    const hasPrevious = ind.previous != null && ind.previous !== '';
    const status: MetricItem['status'] = hasActual ? 'ok' : hasPrevious ? 'ok' : hasForecast ? 'degraded' : 'error';
    const value = hasActual ? String(ind.actual) : hasPrevious ? `prev: ${ind.previous}` : hasForecast ? `예상 ${ind.forecast}` : null;
    items.push({
      key: `macro.${String(ind.name).replace(/\s+/g, '_').toLowerCase()}`,
      label: `Macro ${ind.name}`,
      group: 'macro',
      status,
      value,
      details: { actual: ind.actual, forecast: ind.forecast, previous: ind.previous },
    });
  }
  // Yield curve 별도 체크
  items.push({
    key: 'macro.yield_curve',
    label: 'Yield Curve (1M~30Y)',
    group: 'macro',
    status: data.yieldCurve ? 'ok' : 'error',
  });
  return items;
}


async function verifyCreditBalance(base: string): Promise<MetricItem[]> {
  const r = await safeJson(base, '/api/credit-balance');
  if (!r.ok) {
    return [{
      key: 'credit.ALL', label: 'Credit Balance API', group: 'credit',
      status: 'error', lastError: r.error ?? `HTTP ${r.status}`,
    }];
  }
  // 실제 스키마: { id, country, currentBalance, gdpRatio, changeYoY, ... }
  const data = r.data as { countries?: Array<{ id: string; country?: string; currentBalance?: number|null; gdpRatio?: number|null; changeYoY?: number|null }> };
  return (data.countries ?? []).map((c) => {
    const hasBalance = c.currentBalance != null;
    const hasRatio = c.gdpRatio != null;
    return {
      key: `credit.${c.id}`,
      label: `신용잔고 ${c.country ?? c.id}`,
      group: 'credit',
      status: (hasBalance && hasRatio ? 'ok' : hasBalance || hasRatio ? 'degraded' : 'error') as MetricItem['status'],
      value: hasBalance ? `$${c.currentBalance}B` : null,
      details: { gdpRatio: c.gdpRatio, changeYoY: c.changeYoY },
    };
  });
}

// ── AI 체인 헬스 (vLLM / GROQ / Gemini) ────────────────────────────────────
// 중요: 환경변수 존재만 체크하지 말고, 실제 reachability를 ping.
async function verifyAIProviders(): Promise<MetricItem[]> {
  const items: MetricItem[] = [];

  // 1. vLLM — VLLM_URL이 설정돼 있으면 /models 엔드포인트 ping
  const vllmUrl = process.env.VLLM_URL?.replace(/\s+/g, '').replace(/\\n/g, '');
  if (vllmUrl) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${vllmUrl.replace(/\/v1$/, '')}/v1/models`, {
        signal: AbortSignal.timeout(6000),
        cache: 'no-store',
      });
      // vLLM 은 체인 1단계 — 터널이 내려가 있어도 GROQ 70b → GROQ 8b → Gemini 순서로
      // 폴백되므로 프로덕트 헬스에는 영향 없음. unreachable 은 skipped 로 분류.
      items.push({
        key: 'ai.vllm', label: 'vLLM EXAONE (로컬 1단계)', group: 'ai',
        status: res.ok ? 'ok' : 'skipped',
        value: res.ok ? `${Date.now() - t0}ms` : `HTTP ${res.status} — cascade GROQ 로 폴백`,
        source: 'tunnel',
        details: { url: vllmUrl, status: res.status, durationMs: Date.now() - t0 },
        skipReason: res.ok ? undefined : '로컬 Cloudflare tunnel 미응답 — cascade 하위 단계가 흡수',
      });
    } catch (err) {
      items.push({
        key: 'ai.vllm', label: 'vLLM EXAONE (로컬 1단계)', group: 'ai',
        status: 'skipped',
        value: 'unreachable — cascade GROQ 로 폴백',
        lastError: err instanceof Error ? err.message : String(err),
        details: { url: vllmUrl, durationMs: Date.now() - t0 },
        skipReason: '로컬 Cloudflare tunnel 미응답 — cascade 하위 단계가 흡수',
      });
    }
  } else {
    items.push({
      key: 'ai.vllm', label: 'vLLM EXAONE (로컬 1단계)', group: 'ai',
      status: 'skipped', value: 'not configured',
      details: { hint: 'VLLM_URL 미설정 — 로컬 전용 옵션' },
      skipReason: 'VLLM_URL 미설정 (cascade 1단계는 선택 사항)',
    });
  }

  // 2. GROQ — 실제 /chat/completions 호출 (quota 소진 감지 위해 /models 대신)
  //    GROQ 는 tokens-per-day (TPD) 100,000 한도가 있음 — 요청 수(14,400)보다 먼저 소진됨.
  //    /chat/completions 응답 헤더의 x-ratelimit-* 을 읽어 남은 토큰 예측·경보.
  const groqKey = process.env.GROQ_API_KEY?.trim();
  if (groqKey) {
    const t0 = Date.now();
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: 'ok' }],
          max_tokens: 1,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
      });
      // Parse rate-limit headers. GROQ 실제 의미:
      //   x-ratelimit-limit-tokens    = TPM (tokens per minute, 12,000)
      //   x-ratelimit-limit-requests  = RPD (requests per day, 1,000)
      //   TPD (tokens per day, 100,000) 는 헤더로 노출되지 않음 — 소진 시 429 응답 body 에만.
      const tpmLimit = Number(res.headers.get('x-ratelimit-limit-tokens') ?? 0);
      const tpmRem = Number(res.headers.get('x-ratelimit-remaining-tokens') ?? 0);
      const rpdLimit = Number(res.headers.get('x-ratelimit-limit-requests') ?? 0);
      const rpdRem = Number(res.headers.get('x-ratelimit-remaining-requests') ?? 0);
      const tpmPctUsed = tpmLimit > 0 ? ((tpmLimit - tpmRem) / tpmLimit) * 100 : 0;
      const rpdPctUsed = rpdLimit > 0 ? ((rpdLimit - rpdRem) / rpdLimit) * 100 : 0;

      // 판단:
      //   429 → degraded (quota exhausted — 응답 body 에 TPM/TPD 구분 있음)
      //   !res.ok(non-429) → error
      //   TPM ≥ 90% 또는 RPD ≥ 90% → degraded (사전 경보)
      //   otherwise ok
      let status: MetricItem['status'];
      let value: string;
      if (res.status === 429) {
        status = 'degraded';
        value = 'quota exhausted';
      } else if (!res.ok) {
        status = 'error';
        value = `HTTP ${res.status}`;
      } else if (rpdPctUsed >= 90) {
        status = 'degraded';
        value = `RPD ${rpdPctUsed.toFixed(0)}% used (${rpdRem}/${rpdLimit} reqs/day left)`;
      } else if (tpmPctUsed >= 90) {
        status = 'degraded';
        value = `TPM ${tpmPctUsed.toFixed(0)}% used (${tpmRem}/${tpmLimit} tok/min left)`;
      } else {
        status = 'ok';
        value = tpmLimit > 0 ? `${Date.now() - t0}ms (TPM ${tpmRem}/${tpmLimit}, RPD ${rpdRem}/${rpdLimit})` : `${Date.now() - t0}ms`;
      }
      items.push({
        key: 'ai.groq', label: 'GROQ llama-3.3-70b (클라우드 무료)', group: 'ai',
        status, value, source: 'groq',
        details: {
          durationMs: Date.now() - t0,
          status: res.status,
          probe: 'chat/completions',
          tpmLimit, tpmRemaining: tpmRem, tpmPctUsed: Math.round(tpmPctUsed * 10) / 10,
          rpdLimit, rpdRemaining: rpdRem, rpdPctUsed: Math.round(rpdPctUsed * 10) / 10,
          tpdNote: 'TPD (100k/day) not in headers — only visible via 429 response body',
        },
      });
    } catch (err) {
      items.push({
        key: 'ai.groq', label: 'GROQ llama-3.3-70b (클라우드 무료)', group: 'ai',
        status: 'error', lastError: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    items.push({
      key: 'ai.groq', label: 'GROQ llama-3.3-70b (클라우드 무료)', group: 'ai',
      status: 'degraded', value: 'not configured',
      details: { hint: 'GROQ_API_KEY 미설정 — https://console.groq.com 무료 발급' },
    });
  }

  // 3. Gemini — API 키 존재만 체크 (실제 추론 호출은 비용 발생)
  //    Gemini 는 cascade 최종단 유료 폴백. 미설정 은 product 고장 아님 —
  //    앞 3개(vllm/groq-70b/groq-8b) 중 하나만 동작해도 AI 정상. skipped 로 분류.
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  items.push({
    key: 'ai.gemini', label: 'Gemini 2.5 Flash (유료 최종 폴백)', group: 'ai',
    status: geminiKey ? 'ok' : 'skipped',
    value: geminiKey ? 'key configured' : 'not configured — optional',
    details: { hint: geminiKey ? '체인 최종 폴백으로만 호출됨' : '앞 3개(vllm/groq 70b/groq 8b) 중 하나만 동작해도 무관' },
    skipReason: geminiKey ? undefined : 'GEMINI_API_KEY 미설정 — 유료 최종 폴백, 선택 사항',
  });

  return items;
}

// ── 추가 엔드포인트 커버리지 (각 탭의 주 데이터 소스) ──────────────────────
async function verifyEndpoint(base: string, path: string, key: string, label: string, group: string, checkField?: (data: unknown) => boolean): Promise<MetricItem> {
  const r = await safeJson(base, path);
  if (!r.ok) {
    return { key, label, group, status: 'error', lastError: r.error ?? `HTTP ${r.status}` };
  }
  if (checkField && !checkField(r.data)) {
    return { key, label, group, status: 'degraded', value: 'empty payload' };
  }
  return { key, label, group, status: 'ok' };
}

async function verifyInsiderStack(base: string): Promise<MetricItem[]> {
  return Promise.all([
    verifyEndpoint(base, '/api/insider-trades', 'insider.form4', 'Insider Form 4 매집', 'insider',
      (d) => Array.isArray((d as { items?: unknown[] })?.items) && ((d as { items: unknown[] }).items.length > 0)),
    verifyEndpoint(base, '/api/ownership-alerts', 'insider.13dg', 'Ownership 13D/13G', 'insider',
      // SC 13D/G filings are rare — empty window is normal, not degraded. Check structure only.
      (d) => Array.isArray((d as { items?: unknown[] })?.items)),
    verifyEndpoint(base, '/api/nport-holdings', 'insider.nport', 'N-PORT 뮤추얼펀드', 'insider',
      (d) => Array.isArray((d as { funds?: unknown[] })?.funds) && ((d as { funds: unknown[] }).funds.length > 0)),
    // korea-flow is now tracked per-item in verifyKoreaFlowDetailed — removed here to avoid duplicates
  ]);
}

async function verifyShortInterestDetailed(base: string): Promise<MetricItem[]> {
  const r = await safeJson(base, '/api/short-interest');
  if (!r.ok) {
    return [{ key: 'short.ALL', label: 'Short Interest API', group: 'short-interest', status: 'error', lastError: r.error ?? `HTTP ${r.status}` }];
  }
  const data = r.data as { entries?: Array<{ ticker: string; shortVolPct: number | null; squeezeScore: number; shortRatio: number | null; companyName?: string }> };
  const entries = data.entries ?? [];
  if (entries.length === 0) return [{ key: 'short.ALL', label: 'Short Interest (empty)', group: 'short-interest', status: 'error' }];

  const items: MetricItem[] = [];
  for (const e of entries) {
    const hasVol = e.shortVolPct != null;
    items.push({
      key: `short.${e.ticker}`,
      label: `${e.ticker} 공매도율`,
      group: 'short-interest',
      status: hasVol ? 'ok' : 'degraded',
      value: hasVol ? `${e.shortVolPct}%` : null,
      details: { squeezeScore: e.squeezeScore, shortRatio: e.shortRatio },
    });
  }
  return items;
}

async function verifyMarketHeatmapDetailed(base: string): Promise<MetricItem[]> {
  const r = await safeJson(base, '/api/market-heatmap');
  if (!r.ok) {
    return [{ key: 'heatmap.ALL', label: 'Market Heatmap API', group: 'heatmap', status: 'error', lastError: r.error ?? `HTTP ${r.status}` }];
  }
  const data = r.data as { sectors?: Array<{ sector: string; avgChangePct: number | null; stocks?: unknown[] }> };
  const sectors = data.sectors ?? [];
  if (sectors.length === 0) return [{ key: 'heatmap.ALL', label: 'Market Heatmap (empty)', group: 'heatmap', status: 'error' }];

  return sectors.map(s => ({
    key: `heatmap.${s.sector.replace(/\s+/g, '_').toLowerCase()}`,
    label: `Heatmap ${s.sector}`,
    group: 'heatmap',
    status: s.avgChangePct != null ? 'ok' as const : 'degraded' as const,
    value: s.avgChangePct != null ? `${s.avgChangePct > 0 ? '+' : ''}${s.avgChangePct.toFixed(1)}%` : null,
    details: { stocks: Array.isArray(s.stocks) ? s.stocks.length : 0 },
  }));
}

async function verifyMarketCapsDetailed(base: string): Promise<MetricItem[]> {
  const r = await safeJson(base, '/api/market-caps');
  if (!r.ok) {
    return [{ key: 'caps.ALL', label: 'Market Caps API', group: 'market-caps', status: 'error', lastError: r.error ?? `HTTP ${r.status}` }];
  }
  // Bulk endpoint returns bands (static tiers) + caps:{} (live, only populated for ?ticker=X requests)
  // Use bands as the coverage check — caps is intentionally empty for bulk responses
  const data = r.data as { caps?: Record<string, number>; bands?: Record<string, string>; count?: number };
  const bands = data.bands ?? {};
  const bandCount = Object.keys(bands).length;
  if (bandCount === 0) return [{ key: 'caps.ALL', label: 'Market Caps (empty)', group: 'market-caps', status: 'error' }];

  return [{ key: 'caps.ALL', label: 'Market Caps bands', group: 'market-caps', status: 'ok', value: `${bandCount} tickers` }];
}

async function verifySectorPE(base: string): Promise<MetricItem[]> {
  const r = await safeJson(base, '/api/sector-pe');
  if (!r.ok) {
    return [{ key: 'sectorpe.ALL', label: 'Sector P/E API', group: 'sector-pe', status: 'error', lastError: r.error ?? `HTTP ${r.status}` }];
  }
  const data = r.data as { sectors?: Array<{ ticker: string; name: string; trailingPE: number | null; ytdReturn: number | null; changePct: number | null }> };
  const sectors = data.sectors ?? [];
  if (sectors.length === 0) return [{ key: 'sectorpe.ALL', label: 'Sector P/E (empty)', group: 'sector-pe', status: 'error' }];

  return sectors.map(s => ({
    key: `sectorpe.${s.ticker}`,
    label: `${s.name} P/E`,
    group: 'sector-pe',
    status: (s.trailingPE != null || s.ytdReturn != null) ? 'ok' as const : 'degraded' as const,
    value: s.trailingPE != null ? `PE=${s.trailingPE.toFixed(1)}` : s.ytdReturn != null ? `YTD=${s.ytdReturn > 0 ? '+' : ''}${(s.ytdReturn * 100).toFixed(1)}%` : null,
    details: { trailingPE: s.trailingPE, ytdReturn: s.ytdReturn, changePct: s.changePct },
  }));
}

async function verifyYieldCurvePoints(base: string): Promise<MetricItem[]> {
  const r = await safeJson(base, '/api/macro-indicators');
  if (!r.ok) {
    return [{ key: 'yc.ALL', label: 'Yield Curve API', group: 'yield-curve', status: 'error', lastError: r.error ?? `HTTP ${r.status}` }];
  }
  const data = r.data as { yieldCurve?: { points?: Array<{ label: string; value: number | null }>; spread10y2y?: number | null; inverted?: boolean } };
  const points = data.yieldCurve?.points ?? [];
  if (points.length === 0) return [{ key: 'yc.ALL', label: 'Yield Curve (empty)', group: 'yield-curve', status: 'error' }];

  const items: MetricItem[] = points.map(p => ({
    key: `yc.${p.label}`,
    label: `금리 ${p.label}`,
    group: 'yield-curve',
    status: p.value != null ? 'ok' as const : 'degraded' as const,
    value: p.value != null ? `${p.value.toFixed(2)}%` : null,
  }));

  const spread = data.yieldCurve?.spread10y2y;
  items.push({
    key: 'yc.spread10y2y',
    label: '금리 10Y-2Y 스프레드',
    group: 'yield-curve',
    status: spread != null ? 'ok' : 'degraded',
    value: spread != null ? `${spread.toFixed(2)}%` : null,
    details: { inverted: data.yieldCurve?.inverted },
  });
  return items;
}

async function verifyFedWatchDetailed(base: string): Promise<MetricItem[]> {
  const r = await safeJson(base, '/api/fedwatch');
  if (!r.ok) {
    return [{ key: 'fw.ALL', label: 'FedWatch API', group: 'fedwatch', status: 'error', lastError: r.error ?? `HTTP ${r.status}` }];
  }
  const data = r.data as {
    currentRateMid?: string | number;
    meetings?: Array<{ date: string; probHold?: number; probHike?: number; probCut25?: number; probCut50?: number; probCut75?: number; impliedRate?: number }>;
    yearEndImpliedRate?: string | number;
  };
  const meetings = Array.isArray(data.meetings) ? data.meetings : [];
  const items: MetricItem[] = [];

  items.push({
    key: 'fw.current', label: 'FedWatch 현재금리', group: 'fedwatch',
    status: data.currentRateMid != null ? 'ok' : 'error',
    value: data.currentRateMid != null ? `${data.currentRateMid}%` : null,
    source: 'CME FedWatch',
  });
  items.push({
    key: 'fw.yearEnd', label: 'FedWatch 연말 금리', group: 'fedwatch',
    status: data.yearEndImpliedRate != null ? 'ok' : 'degraded',
    value: data.yearEndImpliedRate != null ? `${data.yearEndImpliedRate}%` : null,
  });

  for (const m of meetings.slice(0, 6)) {
    const dateKey = m.date?.replace(/-/g, '') ?? 'unk';
    const totalCutPct = (m.probCut25 ?? 0) + (m.probCut50 ?? 0) + (m.probCut75 ?? 0);
    const holdPct = m.probHold ?? 0;
    const dominant = m.impliedRate != null
      ? (totalCutPct > holdPct ? `cut ${totalCutPct.toFixed(0)}%` : `hold ${holdPct.toFixed(0)}%`)
      : null;
    items.push({
      key: `fw.meeting.${dateKey}`,
      label: `FOMC ${m.date}`,
      group: 'fedwatch',
      status: dominant ? 'ok' : 'degraded',
      value: dominant,
      source: 'CME FedWatch',
    });
  }
  return items;
}

async function verifyCOTDetailed(base: string): Promise<MetricItem[]> {
  const r = await safeJson(base, '/api/cot-positions');
  if (!r.ok) return [{ key: 'cot.ALL', label: 'COT Positions API', group: 'cot', status: 'error', lastError: r.error ?? `HTTP ${r.status}` }];
  const data = r.data as { entries?: Array<{ id: string; label: string; netPctOI: number | null; sentiment: string; longPct?: number | null; shortPct?: number | null }> };
  const entries = data.entries ?? [];
  if (entries.length === 0) return [{ key: 'cot.ALL', label: 'COT (empty)', group: 'cot', status: 'error' }];

  return entries.map(e => ({
    key: `cot.${e.id}`,
    label: `COT ${e.label}`,
    group: 'cot',
    status: e.netPctOI != null ? 'ok' as const : 'degraded' as const,
    value: e.netPctOI != null ? `net ${e.netPctOI > 0 ? '+' : ''}${e.netPctOI.toFixed(1)}%` : null,
    details: { sentiment: e.sentiment, longPct: e.longPct, shortPct: e.shortPct },
  }));
}

async function verifyKoreaFlowDetailed(base: string): Promise<MetricItem[]> {
  const r = await safeJson(base, '/api/korea-flow');
  if (!r.ok) return [{ key: 'kr.ALL', label: 'Korea Flow API', group: 'korea-flow', status: 'error', lastError: r.error ?? `HTTP ${r.status}` }];
  // Korea flow returns: topForeignBuy/Sell, topInstBuy/Sell, totalTickers, fallback, fallbackReason
  // foreignNet/institutionNet/retailNet only available when KRX API is accessible (not in fallback mode)
  const data = r.data as {
    totalTickers?: number;
    fallback?: boolean;
    fallbackReason?: string;
    foreignNet?: number | null;
    institutionNet?: number | null;
    retailNet?: number | null;
    topForeignBuy?: unknown[];
    topInstBuy?: unknown[];
  };

  const isFallback = data.fallback === true;
  const items: MetricItem[] = [];

  // foreignNet/institutionNet only exist when KRX API is live (not in fallback)
  items.push({
    key: 'kr.foreign', label: '한국 외국인 순매수', group: 'korea-flow',
    status: typeof data.foreignNet === 'number' ? 'ok' :
      (isFallback ? 'skipped' : 'degraded'),
    value: typeof data.foreignNet === 'number' ? `${(data.foreignNet / 1e8).toFixed(0)}억` : null,
    skipReason: isFallback ? `KRX API 불가 — ${data.fallbackReason ?? 'fallback mode'}` : undefined,
  });
  items.push({
    key: 'kr.institution', label: '한국 기관 순매수', group: 'korea-flow',
    status: typeof data.institutionNet === 'number' ? 'ok' :
      (isFallback ? 'skipped' : 'degraded'),
    value: typeof data.institutionNet === 'number' ? `${(data.institutionNet / 1e8).toFixed(0)}억` : null,
    skipReason: isFallback ? `KRX API 불가 — ${data.fallbackReason ?? 'fallback mode'}` : undefined,
  });
  items.push({
    key: 'kr.retail', label: '한국 개인 순매수', group: 'korea-flow',
    status: typeof data.retailNet === 'number' ? 'ok' :
      (isFallback ? 'skipped' : 'degraded'),
    value: typeof data.retailNet === 'number' ? `${(data.retailNet / 1e8).toFixed(0)}억` : null,
    skipReason: isFallback ? `KRX API 불가 — ${data.fallbackReason ?? 'fallback mode'}` : undefined,
  });
  items.push({
    key: 'kr.tickers', label: '한국 수급 종목수', group: 'korea-flow',
    status: (data.totalTickers ?? 0) > 0 ? 'ok' : 'degraded',
    value: data.totalTickers != null ? `${data.totalTickers}종목` : null,
  });
  return items;
}

async function verifyAdditionalEndpoints(base: string): Promise<MetricItem[]> {
  return Promise.all([
    verifyEndpoint(base, '/api/news-cascade', 'market.news', '뉴스 캐스케이드', 'market',
      (d) => Array.isArray((d as { articles?: unknown[] })?.articles) && ((d as { articles: unknown[] }).articles.length > 0)),
    verifyEndpoint(base, '/api/signals', 'market.signals', '기관 신호 13F', 'market',
      (d) => Array.isArray((d as { signals?: unknown[] })?.signals) && ((d as { signals: unknown[] }).signals.length > 0)),
    verifyEndpoint(base, '/api/latest-updates', 'market.latest', '홈 LiveFeed', 'market',
      (d) => Array.isArray((d as { items?: unknown[] })?.items) && ((d as { items: unknown[] }).items.length > 0)),
    verifyEndpoint(base, '/api/price-history?ticker=SPY&days=30', 'market.priceHistory', 'SPY 가격 시계열', 'market',
      (d) => Array.isArray((d as { points?: unknown[] })?.points) && ((d as { points: unknown[] }).points.length >= 10)),
    verifyEndpoint(base, '/api/block-trades', 'market.blockTrades', '대량거래', 'market',
      (d) => Array.isArray((d as { items?: unknown[] })?.items)),  // field is 'items' not 'trades'
    verifyEndpoint(base, '/api/options-flow', 'market.optionsFlow', '옵션 플로우', 'market',
      (d) => Array.isArray((d as { items?: unknown[] })?.items)),  // field is 'items' not 'flows'
  ]);
}

// ── Value accuracy probes ───────────────────────────────────────────────────
// 외부 공식 소스를 직접 fetch 해서 우리 API 응답과 델타 비교.
// "endpoint alive" 와 "value 정확" 은 다름 — Next.js fetch cache 등 여러 계층의
// stale 이슈를 이 probe 로 catch. 2026-04-22 CNN F&G 2-point stale 실제 발생 후 신설.
async function verifyAccuracyStack(base: string): Promise<MetricItem[]> {
  const items: MetricItem[] = [];

  // 1. CNN Fear & Greed US score — ±3 point 델타 허용 (CNN 은 fractional publish, 반올림 차이)
  try {
    const t0 = Date.now();
    const [cnnRes, ourRes] = await Promise.all([
      fetch('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Referer': 'https://edition.cnn.com/markets/fear-and-greed',
          'Origin': 'https://edition.cnn.com',
        },
        signal: AbortSignal.timeout(6000),
        cache: 'no-store',
      }),
      fetch(`${base}/api/fear-greed`, { signal: AbortSignal.timeout(6000), cache: 'no-store' }),
    ]);
    if (!cnnRes.ok || !ourRes.ok) throw new Error(`cnn=${cnnRes.status} ours=${ourRes.status}`);
    const cnnData = await cnnRes.json();
    const ourData = await ourRes.json();
    const cnnScore = Math.round(cnnData?.fear_and_greed?.score ?? NaN);
    const ourUs = (ourData?.byCountry as Array<{ id?: string; score?: number }> | undefined)?.find(x => x?.id === 'us');
    const ourScore = ourUs?.score;
    if (typeof cnnScore !== 'number' || isNaN(cnnScore) || typeof ourScore !== 'number') {
      items.push({ key: 'accuracy.fg.us', label: 'CNN F&G US 값 대조', group: 'accuracy', status: 'error',
        lastError: `cnn=${cnnScore} ours=${ourScore}` });
    } else {
      const delta = Math.abs(cnnScore - ourScore);
      items.push({
        key: 'accuracy.fg.us', label: 'CNN F&G US 값 대조', group: 'accuracy',
        status: delta <= 3 ? 'ok' : delta <= 7 ? 'degraded' : 'error',
        value: `ours ${ourScore} vs cnn ${cnnScore} (Δ${delta})`,
        source: 'cnn-direct',
        details: { cnnScore, ourScore, delta, durationMs: Date.now() - t0, tolerance: 3 },
      });
    }
  } catch (err) {
    items.push({ key: 'accuracy.fg.us', label: 'CNN F&G US 값 대조', group: 'accuracy', status: 'error',
      lastError: err instanceof Error ? err.message : String(err) });
  }

  // 2. FRED 10Y-2Y Treasury spread — T10Y2Y series = 공식 spread value
  try {
    const t0 = Date.now();
    const [fredRes, ourRes] = await Promise.all([
      fetch('https://fred.stlouisfed.org/graph/fredgraph.csv?id=T10Y2Y&cosd=' +
        new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10), {
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'Mozilla/5.0' },
        cache: 'no-store',
      }),
      fetch(`${base}/api/macro-indicators`, { signal: AbortSignal.timeout(8000), cache: 'no-store' }),
    ]);
    if (!fredRes.ok || !ourRes.ok) throw new Error(`fred=${fredRes.status} ours=${ourRes.status}`);
    const csv = await fredRes.text();
    const ourData = await ourRes.json();
    // CSV: observation_date,T10Y2Y\n... — take last non-'.' value
    const lines = csv.trim().split('\n').slice(1);
    let fredSpread: number | null = null;
    for (let i = lines.length - 1; i >= 0; i--) {
      const val = lines[i].split(',')[1]?.trim();
      if (val && val !== '.') { const n = parseFloat(val); if (!isNaN(n)) { fredSpread = n; break; } }
    }
    const ourSpread = ourData?.yieldCurve?.spread10y2y;
    if (fredSpread == null || typeof ourSpread !== 'number') {
      items.push({ key: 'accuracy.curve', label: 'FRED 10Y-2Y spread 대조', group: 'accuracy', status: 'error',
        lastError: `fred=${fredSpread} ours=${ourSpread}` });
    } else {
      // Δ > 0.10 = 10bp off → degraded, > 0.25 = 25bp off → error
      const delta = Math.abs(fredSpread - ourSpread);
      items.push({
        key: 'accuracy.curve', label: 'FRED 10Y-2Y spread 대조', group: 'accuracy',
        status: delta <= 0.10 ? 'ok' : delta <= 0.25 ? 'degraded' : 'error',
        value: `ours ${ourSpread.toFixed(2)} vs fred ${fredSpread.toFixed(2)} (Δ${delta.toFixed(2)})`,
        source: 'fred-direct',
        details: { fredSpread, ourSpread, delta, durationMs: Date.now() - t0, tolerance: 0.10 },
      });
    }
  } catch (err) {
    items.push({ key: 'accuracy.curve', label: 'FRED 10Y-2Y spread 대조', group: 'accuracy', status: 'error',
      lastError: err instanceof Error ? err.message : String(err) });
  }

  // 3. FRED CPI/PPI YoY + FOMC rate — 5 sources in 1 Promise.all, 3 MetricItems
  try {
    const t0 = Date.now();
    const start14mo = new Date(Date.now() - 430 * 86400000).toISOString().slice(0, 10);
    const start3mo  = new Date(Date.now() -  90 * 86400000).toISOString().slice(0, 10);
    const headers   = { 'User-Agent': 'Mozilla/5.0' };
    const sig       = AbortSignal.timeout(10000);
    const start2y = new Date(Date.now() - 730 * 86400000).toISOString().slice(0, 10);
    const [cpiCsv, ppiCsv, fomcUpperCsv, fomcLowerCsv, gdpCsv, ourRes] = await Promise.all([
      fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCSL&observation_start=${start14mo}`,
        { headers, signal: sig, cache: 'no-store' }),
      fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=WPSFD49207&observation_start=${start14mo}`,
        { headers, signal: sig, cache: 'no-store' }),
      fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFEDTARU&observation_start=${start3mo}`,
        { headers, signal: sig, cache: 'no-store' }),
      fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFEDTARL&observation_start=${start3mo}`,
        { headers, signal: sig, cache: 'no-store' }),
      fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=A191RL1Q225SBEA&observation_start=${start2y}`,
        { headers, signal: sig, cache: 'no-store' }),
      fetch(`${base}/api/macro-indicators`, { signal: AbortSignal.timeout(8000), cache: 'no-store' }),
    ]);

    // Parse CSV into array of {date, value}
    const parseCsv = (text: string): Array<{ date: string; value: number }> =>
      text.trim().split('\n').slice(1).reduce<Array<{ date: string; value: number }>>((acc, line) => {
        const [date, raw] = line.split(',');
        if (raw?.trim() && raw.trim() !== '.') {
          const v = parseFloat(raw.trim());
          if (!isNaN(v)) acc.push({ date: date.trim(), value: v });
        }
        return acc;
      }, []);

    // YoY from monthly CPI/PPI index: (latest / value_12mo_ago - 1) * 100
    const csvYoY = (rows: Array<{ date: string; value: number }>): number | null => {
      if (rows.length < 12) return null;
      const latest = rows[rows.length - 1].value;
      const latestDate = new Date(rows[rows.length - 1].date);
      const target12 = new Date(latestDate); target12.setFullYear(target12.getFullYear() - 1);
      let best: { date: string; value: number } | null = null, bestDiff = Infinity;
      for (const r of rows) {
        const diff = Math.abs(new Date(r.date).getTime() - target12.getTime());
        if (diff < bestDiff) { bestDiff = diff; best = r; }
      }
      if (!best) return null;
      return parseFloat(((latest / best.value - 1) * 100).toFixed(2));
    };

    const ourData = ourRes.ok ? await ourRes.json() : null;
    const inds: Array<{ id: string; actual?: number | null }> = ourData?.indicators ?? [];
    const durationMs = Date.now() - t0;

    // CPI probe
    if (cpiCsv.ok) {
      const fredYoY = csvYoY(parseCsv(await cpiCsv.text()));
      const ourCpi = inds.find(x => x.id === 'cpi')?.actual ?? null;
      if (fredYoY == null || ourCpi == null) {
        items.push({ key: 'accuracy.cpi', label: 'FRED CPI YoY 대조', group: 'accuracy', status: 'error',
          lastError: `fred=${fredYoY} ours=${ourCpi}`, details: { durationMs } });
      } else {
        const delta = Math.abs(fredYoY - ourCpi);
        items.push({ key: 'accuracy.cpi', label: 'FRED CPI YoY 대조', group: 'accuracy',
          status: delta <= 0.2 ? 'ok' : delta <= 0.5 ? 'degraded' : 'error',
          value: `ours ${ourCpi} vs fred ${fredYoY} (Δ${delta.toFixed(2)})`,
          source: 'fred-direct',
          details: { fredYoY, ourCpi, delta, durationMs, tolerance: 0.2 },
        });
      }
    } else {
      items.push({ key: 'accuracy.cpi', label: 'FRED CPI YoY 대조', group: 'accuracy', status: 'error',
        lastError: `fred HTTP ${cpiCsv.status}` });
    }

    // PPI probe
    if (ppiCsv.ok) {
      const fredYoY = csvYoY(parseCsv(await ppiCsv.text()));
      const ourPpi = inds.find(x => x.id === 'ppi')?.actual ?? null;
      if (fredYoY == null || ourPpi == null) {
        items.push({ key: 'accuracy.ppi', label: 'FRED PPI YoY 대조', group: 'accuracy', status: 'error',
          lastError: `fred=${fredYoY} ours=${ourPpi}` });
      } else {
        const delta = Math.abs(fredYoY - ourPpi);
        items.push({ key: 'accuracy.ppi', label: 'FRED PPI YoY 대조', group: 'accuracy',
          status: delta <= 0.2 ? 'ok' : delta <= 0.5 ? 'degraded' : 'error',
          value: `ours ${ourPpi} vs fred ${fredYoY} (Δ${delta.toFixed(2)})`,
          source: 'fred-direct',
          details: { fredYoY, ourPpi, delta, tolerance: 0.2 },
        });
      }
    } else {
      items.push({ key: 'accuracy.ppi', label: 'FRED PPI YoY 대조', group: 'accuracy', status: 'error',
        lastError: `fred HTTP ${ppiCsv.status}` });
    }

    // FOMC rate probe
    if (fomcUpperCsv.ok && fomcLowerCsv.ok) {
      const upperRows = parseCsv(await fomcUpperCsv.text());
      const lowerRows = parseCsv(await fomcLowerCsv.text());
      const fredUpper = upperRows[upperRows.length - 1]?.value ?? null;
      const fredLower = lowerRows[lowerRows.length - 1]?.value ?? null;
      const fredMid = fredUpper != null && fredLower != null
        ? parseFloat(((fredUpper + fredLower) / 2).toFixed(3)) : null;
      const ourFomc = inds.find(x => x.id === 'fomc')?.actual ?? null;
      if (fredMid == null || ourFomc == null) {
        items.push({ key: 'accuracy.fomc', label: 'FRED FOMC 금리 대조', group: 'accuracy', status: 'error',
          lastError: `fred=${fredMid} ours=${ourFomc}` });
      } else {
        const delta = Math.abs(fredMid - ourFomc);
        items.push({ key: 'accuracy.fomc', label: 'FRED FOMC 금리 대조', group: 'accuracy',
          // ±0.25 tolerance = one Fed 25bp meeting's worth; intraday FRED revision can swing ~0.1
          status: delta <= 0.25 ? 'ok' : delta <= 0.50 ? 'degraded' : 'error',
          value: `ours ${ourFomc} vs fred ${fredMid} (Δ${delta.toFixed(3)})`,
          source: 'fred-direct',
          details: { fredUpper, fredLower, fredMid, ourFomc, delta, durationMs, tolerance: 0.25 },
        });
      }
    } else {
      items.push({ key: 'accuracy.fomc', label: 'FRED FOMC 금리 대조', group: 'accuracy', status: 'error',
        lastError: `fred-upper=${fomcUpperCsv.status} fred-lower=${fomcLowerCsv.status}` });
    }

    // GDP QoQ SAAR probe — A191RL1Q225SBEA (quarterly, advance estimate subject to revision)
    if (gdpCsv.ok) {
      const rows = parseCsv(await gdpCsv.text());
      const lastRow = rows.length > 0 ? rows[rows.length - 1] : null;
      const fredGdp = lastRow?.value ?? null;
      const fredDate = lastRow?.date ?? null;
      const ourGdp = inds.find(x => x.id === 'gdp')?.actual ?? null;
      // Skip only if FRED data is older than 4 quarters (1 year) — Q4 of prior year is valid
      const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      // Current quarter start (e.g. 2026-04-01 when today is Apr 2026).
      // FRED quarterly dates = quarter-start: if fredDate < currentQStart, FRED has prior-quarter
      // data only — our pending (null) is the correct state, not an error.
      const _now = new Date();
      const currentQStart = new Date(_now.getFullYear(), Math.floor(_now.getMonth() / 3) * 3, 1).toISOString().slice(0, 10);
      const isGdpPending = ourGdp == null && fredDate != null && fredDate < currentQStart;
      if (fredDate && fredDate < oneYearAgo) {
        items.push({ key: 'accuracy.gdp', label: 'FRED GDP QoQ 대조', group: 'accuracy', status: 'skipped',
          skipReason: `FRED 최신 데이터 ${fredDate} — 1년 이상 구형`,
          details: { fredDate, fredGdp, ourGdp } });
      } else if (isGdpPending) {
        items.push({ key: 'accuracy.gdp', label: 'FRED GDP QoQ 대조', group: 'accuracy', status: 'skipped',
          skipReason: `GDP pending release — FRED last=${fredDate} (${fredGdp}%), ours=null (pre-release)`,
          details: { fredDate, fredGdp, currentQStart } });
      } else if (fredGdp == null || ourGdp == null) {
        items.push({ key: 'accuracy.gdp', label: 'FRED GDP QoQ 대조', group: 'accuracy', status: 'error',
          lastError: `fred=${fredGdp} ours=${ourGdp}`, details: { durationMs } });
      } else {
        const delta = Math.abs(fredGdp - ourGdp);
        items.push({ key: 'accuracy.gdp', label: 'FRED GDP QoQ 대조', group: 'accuracy',
          // ±0.5 tolerance: advance estimate subject to revision; also handles rounding diffs
          status: delta <= 0.5 ? 'ok' : delta <= 1.0 ? 'degraded' : 'error',
          value: `ours ${ourGdp} vs fred ${fredGdp} (Δ${delta.toFixed(2)})`,
          source: 'fred-direct',
          details: { fredDate, fredGdp, ourGdp, delta, durationMs, tolerance: 0.5 },
        });
      }
    } else {
      items.push({ key: 'accuracy.gdp', label: 'FRED GDP QoQ 대조', group: 'accuracy', status: 'error',
        lastError: `fred HTTP ${gdpCsv.status}` });
    }
  } catch (err) {
    for (const key of ['accuracy.cpi', 'accuracy.ppi', 'accuracy.fomc', 'accuracy.gdp']) {
      items.push({ key, label: key.replace('accuracy.', 'FRED ') + ' 대조', group: 'accuracy', status: 'error',
        lastError: err instanceof Error ? err.message : String(err) });
    }
  }

  // 4. VIX — Yahoo Finance v8 직접 대조 (stale Redis cache 감지용)
  //    volatility route 는 Redis 30min 캐시 — cache: 'no-store' 빠뜨리면 stale 발생 가능.
  //    ±1 point tolerance (Yahoo 실시간 vs 30분 캐시 최대 드리프트 기준).
  try {
    const t0 = Date.now();
    const [yahooRes, ourRes] = await Promise.all([
      fetch('https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=5d', {
        headers: YAHOO_HEADERS,
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
      }),
      fetch(`${base}/api/volatility`, { signal: AbortSignal.timeout(8000), cache: 'no-store' }),
    ]);
    if (!ourRes.ok) throw new Error(`ours=${ourRes.status}`);
    // Yahoo rate-limited — fall back to CBOE CSV as comparison source.
    // Our VIX data now comes from CBOE when Yahoo is blocked, so CBOE is the valid ground truth.
    if (!yahooRes.ok) {
      try {
        const cboeVixRes = await fetch('https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv', {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'text/csv,text/plain,*/*',
            'Referer': 'https://www.cboe.com/tradable_products/vix/',
          },
          signal: AbortSignal.timeout(8000),
          cache: 'no-store',
        });
        if (cboeVixRes.ok) {
          const csvText = await cboeVixRes.text();
          const csvLines = csvText.trim().split('\n');
          const cboeVix = parseFloat(csvLines[csvLines.length - 1]?.split(',')[4] ?? '');
          const ourData = await ourRes.json();
          const ourVix: number | null = (ourData as { vix?: number | null })?.vix ?? null;
          if (!isNaN(cboeVix) && ourVix != null) {
            const delta = Math.abs(cboeVix - ourVix);
            items.push({
              key: 'accuracy.vix', label: 'CBOE VIX 대조 (Yahoo blocked)', group: 'accuracy',
              status: delta <= 1.0 ? 'ok' : delta <= 2.0 ? 'degraded' : 'error',
              value: `ours ${ourVix.toFixed(2)} vs cboe ${cboeVix.toFixed(2)} (Δ${delta.toFixed(2)})`,
              source: 'cboe-direct',
              details: { cboeVix, ourVix, delta, durationMs: Date.now() - t0, tolerance: 1.0, yahooBlocked: true },
            });
            return items;
          }
        }
      } catch { /* CBOE also failed — fall through to degraded */ }
      items.push({ key: 'accuracy.vix', label: 'VIX 대조 불가', group: 'accuracy', status: 'degraded',
        lastError: `yahoo=${yahooRes.status} cboe_also_failed` });
      return items;
    }
    const yahooData = await yahooRes.json();
    const ourData = await ourRes.json();
    const yahooVix: number | null = yahooData?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
    const ourVix: number | null = (ourData as { vix?: number | null })?.vix ?? null;
    if (yahooVix == null || ourVix == null) {
      items.push({ key: 'accuracy.vix', label: 'Yahoo VIX 대조', group: 'accuracy', status: 'degraded',
        lastError: `yahoo=${yahooVix} ours=${ourVix}` });
    } else {
      const delta = Math.abs(yahooVix - ourVix);
      items.push({
        key: 'accuracy.vix', label: 'Yahoo VIX 대조', group: 'accuracy',
        // ±1pt tolerance: 30min Redis cache drift; ±2pt = degraded but still functional
        status: delta <= 1.0 ? 'ok' : delta <= 2.0 ? 'degraded' : 'error',
        value: `ours ${ourVix.toFixed(2)} vs yahoo ${yahooVix.toFixed(2)} (Δ${delta.toFixed(2)})`,
        source: 'yahoo-direct',
        details: { yahooVix, ourVix, delta, durationMs: Date.now() - t0, tolerance: 1.0 },
      });
    }
  } catch (err) {
    items.push({ key: 'accuracy.vix', label: 'Yahoo VIX 대조', group: 'accuracy', status: 'error',
      lastError: err instanceof Error ? err.message : String(err) });
  }

  return items;
}

async function verifyEarnings(_base: string): Promise<MetricItem[]> {
  // 1) Check env var first — catches unconfigured environments instantly.
  const key = process.env.FINNHUB_KEY?.trim();
  if (!key) {
    return [{
      key: 'earnings.ALL', label: 'Earnings Calendar (Finnhub)', group: 'earnings',
      status: 'degraded', value: 'no API key',
      details: { warning: 'FINNHUB_KEY 미설정 — Finnhub 무료 키 발급 필요 (60 req/min 무료)' },
    }];
  }

  // 2) Ping Finnhub directly instead of /api/earnings.
  //    The internal-fetch approach suffered from Vercel alias eventual consistency:
  //    server-side fetch(base + '/api/earnings') sometimes routed to an older
  //    deployment that lacked FINNHUB_KEY, producing a false-positive 'endpoint
  //    stale' flag that never self-healed. Hitting Finnhub directly avoids the
  //    whole internal-routing problem and is also ~1 network hop cheaper.
  const today = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const t0 = Date.now();
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/calendar/earnings?from=${today}&to=${to}&token=${encodeURIComponent(key)}`,
      { signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'flowvium-metrics-verifier/1.0' }, cache: 'no-store' },
    );
    if (!res.ok) {
      return [{
        key: 'earnings.ALL', label: 'Earnings Calendar (Finnhub)', group: 'earnings',
        status: res.status === 429 ? 'degraded' : 'error',
        value: `HTTP ${res.status}`,
        details: { durationMs: Date.now() - t0 },
      }];
    }
    const d = (await res.json()) as { earningsCalendar?: unknown[] };
    const count = Array.isArray(d.earningsCalendar) ? d.earningsCalendar.length : 0;
    return [{
      key: 'earnings.ALL', label: 'Earnings Calendar (Finnhub)', group: 'earnings',
      status: count > 0 ? 'ok' : 'degraded',
      value: `${count} events`,
      source: 'Finnhub (direct)',
      details: { durationMs: Date.now() - t0 },
    }];
  } catch (err) {
    return [{
      key: 'earnings.ALL', label: 'Earnings Calendar (Finnhub)', group: 'earnings',
      status: 'error',
      lastError: err instanceof Error ? err.message : String(err),
      details: { durationMs: Date.now() - t0 },
    }];
  }
}

async function verifyRedisCaches(redis: Redis): Promise<MetricItem[]> {
  // 각 주요 캐시 키 존재 여부
  const kstDate = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const utcDate = new Date().toISOString().slice(0, 10);
  const keys: Array<{ key: string; label: string }> = [
    { key: 'flowvium:insider-trades:v1', label: 'insider-trades' },
    { key: 'flowvium:ownership-alerts:v1', label: 'ownership-alerts' },
    { key: 'flowvium:nport-holdings:v1', label: 'nport-holdings' },
    { key: 'flowvium:options-flow:v1', label: 'options-flow' },
    { key: 'flowvium:block-trades:v1', label: 'block-trades' },
    { key: 'flowvium:cot-positions:v2', label: 'cot-positions' },
    { key: 'flowvium:korea-flow:v4:1d', label: 'korea-flow' },
    { key: 'flowvium:short-interest:v5', label: 'short-interest' },
    { key: 'flowvium:market-caps:v2', label: 'market-caps' },
    { key: 'flowvium:13f-signals:v1', label: '13f-signals' },
    { key: 'flowvium:13f-ownership:v1', label: '13f-ownership' },
    { key: 'flowvium:latest-updates:v3', label: 'latest-updates' },
    { key: `flowvium:macro-indicators:v13:${kstDate}`, label: `macro-indicators(${kstDate})` },
    { key: `flowvium:fedwatch:v2:${utcDate}`, label: `fedwatch(${utcDate})` },
    { key: `flowvium:credit-balance:v3:${utcDate}`, label: `credit-balance(${utcDate})` },
    { key: 'flowvium:market-movers:v1', label: 'market-movers' },
    { key: 'flowvium:sector-pe:v3', label: 'sector-pe' },
  ];
  const items: MetricItem[] = await Promise.all(keys.map(async ({ key, label }) => {
    try {
      const v = await redis.get(key);
      return {
        key: `cache.${label}`, label: `Cache ${label}`, group: 'cache',
        status: (v != null ? 'ok' : 'error') as MetricItem['status'],
      };
    } catch (err) {
      return {
        key: `cache.${label}`, label: `Cache ${label}`, group: 'cache',
        status: 'error' as const,
        lastError: err instanceof Error ? err.message : String(err),
      };
    }
  }));
  return items;
}

// ── 미커버 엔드포인트 추가 검증 (iter84) ────────────────────────────────────
async function verifyInvestmentStrategy(base: string): Promise<MetricItem[]> {
  const r = await safeJson(base, '/api/investment-strategy', 20000);
  if (!r.ok) {
    return [{ key: 'strategy.ALL', label: 'Investment Strategy API', group: 'strategy',
      status: 'error', lastError: r.error ?? `HTTP ${r.status}` }];
  }
  const d = r.data as {
    stance?: string; thesis?: string; source?: string;
    portfolio?: Array<{ ticker?: string; allocation?: number }>;
    riskLevel?: string;
  };
  const portfolioLen = Array.isArray(d.portfolio) ? d.portfolio.length : 0;
  const hasValidPortfolio = portfolioLen >= 5 &&
    (d.portfolio ?? []).every(p => p.ticker && typeof p.allocation === 'number' && p.allocation > 0);
  const allocSum = hasValidPortfolio
    ? (d.portfolio ?? []).reduce((s, p) => s + (p.allocation ?? 0), 0) : 0;
  const isAI = d.source && d.source !== 'fallback' && d.source !== 'data';
  const isValid = d.stance && ['bullish', 'neutral', 'bearish'].includes(d.stance) &&
    d.thesis && hasValidPortfolio;

  return [{
    key: 'strategy.portfolio',
    label: 'Investment Strategy Portfolio',
    group: 'strategy',
    status: !isValid ? 'error' : isAI ? 'ok' : 'degraded',
    value: isValid ? `${d.stance} ${portfolioLen}pos alloc=${allocSum.toFixed(0)}%` : null,
    source: d.source,
    details: { portfolioLen, allocSum: Math.round(allocSum), stance: d.stance, isAI, riskLevel: d.riskLevel },
    ...(isValid ? {} : { lastError: `stance=${d.stance} portfolio=${portfolioLen} valid=${hasValidPortfolio}` }),
  }];
}

async function verifyMissingEndpoints(base: string): Promise<MetricItem[]> {
  return Promise.all([
    // Daily Brief (AI market summary)
    safeJson(base, '/api/daily-brief').then((r): MetricItem => {
      if (!r.ok) return { key: 'brief.ALL', label: 'Daily Brief API', group: 'brief', status: 'error', lastError: r.error ?? `HTTP ${r.status}` };
      const d = r.data as { market?: unknown; source?: string };
      const hasContent = d.market != null;
      const isAI = d.source && d.source !== 'data' && d.source !== 'fallback';
      return {
        key: 'brief.market', label: 'AI 마켓 브리프', group: 'brief',
        status: hasContent ? (isAI ? 'ok' : 'degraded') : 'error',
        value: hasContent ? (isAI ? `AI(${d.source})` : `fallback(${d.source})`) : null,
        source: String(d.source ?? 'none'),
      };
    }),
    // Flow Analysis (AI capital flow) — Gemini call can take 20-25s; extend timeout
    safeJson(base, '/api/flow-analysis', 30000).then((r): MetricItem => {
      if (!r.ok) return { key: 'flow.analysis', label: 'Flow Analysis API', group: 'flow-analysis', status: 'error', lastError: r.error ?? `HTTP ${r.status}` };
      const d = r.data as { analysis?: unknown; source?: string; stale?: boolean; staleFallback?: boolean };
      // analysis can be a parsed JSON object OR a string — check either
      const hasContent = (typeof d.analysis === 'object' && d.analysis !== null) ||
        (typeof d.analysis === 'string' && (d.analysis as string).length > 20);
      const analysisSize = typeof d.analysis === 'object'
        ? JSON.stringify(d.analysis).length
        : (typeof d.analysis === 'string' ? (d.analysis as string).length : 0);
      const isAI = d.source && d.source !== 'fallback';
      const isStale = d.stale === true || d.staleFallback === true;
      return {
        key: 'flow.analysis', label: 'AI 자금흐름 분석', group: 'flow-analysis',
        status: hasContent ? (isAI ? (isStale ? 'degraded' : 'ok') : 'degraded') : 'error',
        value: hasContent ? `${analysisSize}자${isStale ? ' (stale)' : ''}` : null,
        source: String(d.source ?? 'none'),
      };
    }),
    // Yield Curve historical spread
    safeJson(base, '/api/yield-curve').then((r): MetricItem => {
      if (!r.ok) return { key: 'yc.hist', label: 'Yield Curve History API', group: 'yield-curve-hist', status: 'error', lastError: r.error ?? `HTTP ${r.status}` };
      const d = r.data as { spread2s10s?: unknown[] };
      const points = Array.isArray(d.spread2s10s) ? d.spread2s10s.length : 0;
      return {
        key: 'yc.hist', label: '금리커브 이력 (2s10s)', group: 'yield-curve-hist',
        status: points >= 10 ? 'ok' : 'degraded',
        value: points > 0 ? `${points}pts` : null,
      };
    }),
    // Company News (sample NVDA)
    safeJson(base, '/api/company-news?ticker=NVDA').then((r): MetricItem => {
      if (!r.ok) return { key: 'news.company', label: 'Company News API', group: 'company-news', status: 'error', lastError: r.error ?? `HTTP ${r.status}` };
      const d = r.data as { news?: unknown[]; source?: string };
      const count = Array.isArray(d.news) ? d.news.length : 0;
      return {
        key: 'news.company', label: 'NVDA 기업뉴스', group: 'company-news',
        status: count > 0 ? 'ok' : 'degraded',
        value: count > 0 ? `${count}건` : null,
        source: String(d.source ?? 'none'),
      };
    }),
    // Stock Price (sample SPY)
    safeJson(base, '/api/stock-price/SPY').then((r): MetricItem => {
      if (!r.ok) return { key: 'stock.price', label: 'Stock Price API', group: 'stock-price', status: 'error', lastError: r.error ?? `HTTP ${r.status}` };
      const d = r.data as { price?: number; ticker?: string };
      return {
        key: 'stock.price', label: 'SPY 주가', group: 'stock-price',
        status: typeof d.price === 'number' && d.price > 0 ? 'ok' : 'degraded',
        value: typeof d.price === 'number' ? `$${d.price.toFixed(2)}` : null,
      };
    }),
  ]);
}

// ── 메인 핸들러 ──────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const start = Date.now();
  const base = getBaseUrl(req);
  const redis = createRedis();

  // 모든 검증을 병렬 실행 (확장: per-ticker/sector/maturity 전체 커버리지)
  const [fg, cf, macro, credit, ai, insider, shorts, heatmap, caps, sectorpe, yc, fwDetail, cotDetail, krDetail, additional, earnings, caches, accuracy, vol, comm, strategy, missing] = await Promise.all([
    verifyFearGreed(base).catch((e): MetricItem[] => [{ key: 'fg.ERR', label: 'F&G verify throw', group: 'fear-greed', status: 'error', lastError: String(e) }]),
    verifyCapitalFlows(base).catch((e): MetricItem[] => [{ key: 'cf.ERR', label: 'CF verify throw', group: 'capital-flows', status: 'error', lastError: String(e) }]),
    verifyMacroIndicators(base).catch((e): MetricItem[] => [{ key: 'macro.ERR', label: 'Macro verify throw', group: 'macro', status: 'error', lastError: String(e) }]),
    verifyCreditBalance(base).catch((e): MetricItem[] => [{ key: 'credit.ERR', label: 'Credit verify throw', group: 'credit', status: 'error', lastError: String(e) }]),
    verifyAIProviders().catch((e): MetricItem[] => [{ key: 'ai.ERR', label: 'AI verify throw', group: 'ai', status: 'error', lastError: String(e) }]),
    verifyInsiderStack(base).catch((e): MetricItem[] => [{ key: 'insider.ERR', label: 'Insider verify throw', group: 'insider', status: 'error', lastError: String(e) }]),
    verifyShortInterestDetailed(base).catch((e): MetricItem[] => [{ key: 'short.ERR', label: 'Short Interest verify throw', group: 'short-interest', status: 'error', lastError: String(e) }]),
    verifyMarketHeatmapDetailed(base).catch((e): MetricItem[] => [{ key: 'heatmap.ERR', label: 'Heatmap verify throw', group: 'heatmap', status: 'error', lastError: String(e) }]),
    verifyMarketCapsDetailed(base).catch((e): MetricItem[] => [{ key: 'caps.ERR', label: 'Market Caps verify throw', group: 'market-caps', status: 'error', lastError: String(e) }]),
    verifySectorPE(base).catch((e): MetricItem[] => [{ key: 'sectorpe.ERR', label: 'Sector P/E verify throw', group: 'sector-pe', status: 'error', lastError: String(e) }]),
    verifyYieldCurvePoints(base).catch((e): MetricItem[] => [{ key: 'yc.ERR', label: 'Yield Curve verify throw', group: 'yield-curve', status: 'error', lastError: String(e) }]),
    verifyFedWatchDetailed(base).catch((e): MetricItem[] => [{ key: 'fw.ERR', label: 'FedWatch verify throw', group: 'fedwatch', status: 'error', lastError: String(e) }]),
    verifyCOTDetailed(base).catch((e): MetricItem[] => [{ key: 'cot.ERR', label: 'COT verify throw', group: 'cot', status: 'error', lastError: String(e) }]),
    verifyKoreaFlowDetailed(base).catch((e): MetricItem[] => [{ key: 'kr.ERR', label: 'Korea Flow verify throw', group: 'korea-flow', status: 'error', lastError: String(e) }]),
    verifyAdditionalEndpoints(base).catch((e): MetricItem[] => [{ key: 'market.ERR', label: 'Additional endpoints verify throw', group: 'market', status: 'error', lastError: String(e) }]),
    verifyEarnings(base).catch((e): MetricItem[] => [{ key: 'earnings.ERR', label: 'Earnings verify throw', group: 'earnings', status: 'error', lastError: String(e) }]),
    redis ? verifyRedisCaches(redis) : Promise.resolve([] as MetricItem[]),
    verifyAccuracyStack(base).catch((e): MetricItem[] => [{ key: 'accuracy.ERR', label: 'Accuracy verify throw', group: 'accuracy', status: 'error', lastError: String(e) }]),
    verifyVolatility(base).catch((e): MetricItem[] => [{ key: 'vol.ERR', label: 'Volatility verify throw', group: 'volatility', status: 'error', lastError: String(e) }]),
    verifyCommodityCurve(base).catch((e): MetricItem[] => [{ key: 'comm.ERR', label: 'Commodity verify throw', group: 'commodity', status: 'error', lastError: String(e) }]),
    verifyInvestmentStrategy(base).catch((e): MetricItem[] => [{ key: 'strategy.ERR', label: 'Strategy verify throw', group: 'strategy', status: 'error', lastError: String(e) }]),
    verifyMissingEndpoints(base).catch((e): MetricItem[] => [{ key: 'missing.ERR', label: 'Missing endpoints verify throw', group: 'brief', status: 'error', lastError: String(e) }]),
  ]);

  const items: MetricItem[] = [...fg, ...cf, ...macro, ...credit, ...ai, ...insider, ...shorts, ...heatmap, ...caps, ...sectorpe, ...yc, ...fwDetail, ...cotDetail, ...krDetail, ...additional, ...earnings, ...caches, ...accuracy, ...vol, ...comm, ...strategy, ...missing];

  const summary = {
    ok: items.filter((i) => i.status === 'ok').length,
    degraded: items.filter((i) => i.status === 'degraded').length,
    error: items.filter((i) => i.status === 'error').length,
    // skipped = 의도적으로 비활성 (optional cascade stage, unconfigured paid key 등).
    // overallStatus 계산에서 제외. admin UI 는 '무시' 라벨로 표시.
    skipped: items.filter((i) => i.status === 'skipped').length,
    total: items.length,
  };
  const overallStatus: 'healthy' | 'degraded' | 'error' =
    summary.error > 0 ? 'error' :
    summary.degraded > 0 ? 'degraded' :
    'healthy';

  const snapshot = {
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - start,
    overallStatus,
    summary,
    items,
  };

  if (redis) {
    await loggedRedisSet(redis, 'cron.verify-metrics', SNAPSHOT_KEY, snapshot, { ex: SNAPSHOT_TTL });
    await logMetrics(redis, items, snapshot.checkedAt);
  }

  logger.info('cron.verify-metrics', 'snapshot', {
    overallStatus, ok: summary.ok, degraded: summary.degraded, error: summary.error,
    skipped: summary.skipped, total: summary.total, durationMs: snapshot.durationMs,
  });

  return NextResponse.json(snapshot);
}
