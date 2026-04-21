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

export const dynamic = 'force-dynamic';

const SNAPSHOT_KEY = 'flowvium:metrics-health:v1';
const SNAPSHOT_TTL = 2 * 60 * 60; // 2h — 크론 30분 주기 대비 넉넉히

interface MetricItem {
  key: string;              // 고유 식별자 (e.g. 'fg.country.us')
  label: string;            // 사람이 읽을 이름
  group: string;            // 'fear-greed' | 'capital-flows' | 'macro' | ...
  status: 'ok' | 'degraded' | 'error';
  value?: number | string | null;
  source?: string;          // 'cnn' | 'composite' | 'yahoo' | 'fred' | ...
  details?: Record<string, unknown>;
  lastError?: string;
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
    const status: MetricItem['status'] =
      score == null ? 'error' :
      quality === 'insufficient' ? 'error' :
      quality === 'partial' ? 'degraded' :
      'ok';
    items.push({
      key: `fg.asset.${id}`,
      label: `F&G ${entry.label ?? id}`,
      group: 'fear-greed',
      status, value: score,
      source: entry.source as string | undefined,
      details: { level: entry.level, dataQuality: quality },
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
  // 실제 스키마: { ticker, label, flag, ret1w, ret4w, ret13w } — 플랫 필드
  const data = r.data as { assets?: Array<{ ticker: string; label?: string; ret1w?: number|null; ret4w?: number|null; ret13w?: number|null }>; dataSource?: string };
  const items: MetricItem[] = [];
  for (const a of data.assets ?? []) {
    const vals = [a.ret1w, a.ret4w, a.ret13w];
    const nulls = vals.filter((v) => v == null).length;
    const status: MetricItem['status'] =
      nulls === 3 ? 'error' :
      nulls > 0 ? 'degraded' : 'ok';
    items.push({
      key: `cf.${a.ticker}`,
      label: `CF ${a.label ?? a.ticker}`,
      group: 'capital-flows',
      status,
      value: a.ret4w != null ? `${a.ret4w}%(4w)` : null,
      source: data.dataSource,
      details: { ret1w: a.ret1w, ret4w: a.ret4w, ret13w: a.ret13w },
    });
  }
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
    // actual이 없으면(미발표) degraded, 없고 예상치도 없으면 error
    const hasActual = ind.actual != null && ind.actual !== '';
    const hasForecast = ind.forecast != null && ind.forecast !== '';
    const status: MetricItem['status'] = hasActual ? 'ok' : hasForecast ? 'degraded' : 'error';
    items.push({
      key: `macro.${String(ind.name).replace(/\s+/g, '_').toLowerCase()}`,
      label: `Macro ${ind.name}`,
      group: 'macro',
      status,
      value: hasActual ? String(ind.actual) : hasForecast ? `예상 ${ind.forecast}` : null,
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

async function verifyFedWatch(base: string): Promise<MetricItem[]> {
  const r = await safeJson(base, '/api/fedwatch');
  if (!r.ok) {
    return [{
      key: 'fedwatch.ALL', label: 'FedWatch', group: 'fedwatch',
      status: 'error', lastError: r.error ?? `HTTP ${r.status}`,
    }];
  }
  // 실제 스키마: currentRateMid/currentTargetLow/High + meetings[] + yearEndImpliedRate
  const data = r.data as { currentRateMid?: string|number; meetings?: unknown[]; yearEndImpliedRate?: string|number };
  const meetings = Array.isArray(data.meetings) ? data.meetings : [];
  return [
    {
      key: 'fedwatch.current', label: 'FedWatch 현재기준금리', group: 'fedwatch',
      status: data.currentRateMid != null ? 'ok' : 'error',
      value: data.currentRateMid != null ? `${data.currentRateMid}%` : null,
      source: 'CME FedWatch',
    },
    {
      key: 'fedwatch.meetings', label: `FedWatch FOMC 확률(${meetings.length} meetings)`, group: 'fedwatch',
      status: meetings.length > 0 ? 'ok' : 'degraded',
      value: meetings.length,
      source: 'CME FedWatch',
    },
    {
      key: 'fedwatch.yearEnd', label: 'FedWatch 연말 예상금리', group: 'fedwatch',
      status: data.yearEndImpliedRate != null ? 'ok' : 'degraded',
      value: data.yearEndImpliedRate != null ? `${data.yearEndImpliedRate}%` : null,
    },
  ];
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

async function verifyRedisCaches(redis: Redis): Promise<MetricItem[]> {
  // 각 주요 캐시 키 존재 여부
  const kstDate = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const hour = new Date().toISOString().slice(0, 13);
  const keys: Array<{ key: string; label: string }> = [
    { key: 'flowvium:insider-trades:v1', label: 'insider-trades' },
    { key: 'flowvium:ownership-alerts:v1', label: 'ownership-alerts' },
    { key: 'flowvium:nport-holdings:v1', label: 'nport-holdings' },
    { key: 'flowvium:options-flow:v1', label: 'options-flow' },
    { key: 'flowvium:block-trades:v1', label: 'block-trades' },
    { key: 'flowvium:korea-flow:v1', label: 'korea-flow' },
    { key: 'flowvium:short-interest:v1', label: 'short-interest' },
    { key: 'flowvium:market-caps:v1', label: 'market-caps' },
    { key: 'flowvium:13f-signals:v1', label: '13f-signals' },
    { key: 'flowvium:13f-ownership:v1', label: '13f-ownership' },
    { key: 'flowvium:latest-updates:v2', label: 'latest-updates' },
    { key: `flowvium:macro-indicators:v4:${kstDate}`, label: `macro-indicators(${kstDate})` },
    { key: `flowvium:fedwatch:v1:${hour}`, label: `fedwatch(${hour}Z)` },
    { key: `flowvium:credit-balance:v2:${kstDate}`, label: `credit-balance(${kstDate})` },
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

// ── 메인 핸들러 ──────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const start = Date.now();
  const base = getBaseUrl(req);
  const redis = createRedis();

  // 모든 검증을 병렬 실행
  const [fg, cf, macro, fw, credit, caches] = await Promise.all([
    verifyFearGreed(base).catch((e): MetricItem[] => [{ key: 'fg.ERR', label: 'F&G verify throw', group: 'fear-greed', status: 'error', lastError: String(e) }]),
    verifyCapitalFlows(base).catch((e): MetricItem[] => [{ key: 'cf.ERR', label: 'CF verify throw', group: 'capital-flows', status: 'error', lastError: String(e) }]),
    verifyMacroIndicators(base).catch((e): MetricItem[] => [{ key: 'macro.ERR', label: 'Macro verify throw', group: 'macro', status: 'error', lastError: String(e) }]),
    verifyFedWatch(base).catch((e): MetricItem[] => [{ key: 'fw.ERR', label: 'FW verify throw', group: 'fedwatch', status: 'error', lastError: String(e) }]),
    verifyCreditBalance(base).catch((e): MetricItem[] => [{ key: 'credit.ERR', label: 'Credit verify throw', group: 'credit', status: 'error', lastError: String(e) }]),
    redis ? verifyRedisCaches(redis) : Promise.resolve([] as MetricItem[]),
  ]);

  const items: MetricItem[] = [...fg, ...cf, ...macro, ...fw, ...credit, ...caches];

  const summary = {
    ok: items.filter((i) => i.status === 'ok').length,
    degraded: items.filter((i) => i.status === 'degraded').length,
    error: items.filter((i) => i.status === 'error').length,
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
  }

  logger.info('cron.verify-metrics', 'snapshot', {
    overallStatus, ok: summary.ok, degraded: summary.degraded, error: summary.error,
    total: summary.total, durationMs: snapshot.durationMs,
  });

  return NextResponse.json(snapshot);
}
