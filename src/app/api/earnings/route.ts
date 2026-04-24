/**
 * /api/earnings
 *
 * Finnhub 실적 캘린더 (무료 티어 60 req/min).
 * 블룸버그 EE (Earnings Events) 함수 대응.
 *
 * 쿼리:
 *   ?from=YYYY-MM-DD  (기본: 오늘)
 *   ?to=YYYY-MM-DD    (기본: 오늘+14일)
 *
 * 환경변수: FINNHUB_KEY
 *
 * Redis cache: `flowvium:earnings:v2:{from}:{to}` — 2h
 */
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { logger, loggedRedisSet } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CACHE_TTL = 2 * 60 * 60; // 2h
const ALLOWED_SPAN_DAYS = 30;
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=7200, stale-while-revalidate=300' };

interface FinnhubEarning {
  date: string;
  symbol: string;
  epsActual: number | null;
  epsEstimate: number | null;
  hour: 'bmo' | 'amc' | 'dmh' | '' | null;  // before-market-open / after-market-close / during-market-hours
  quarter: number;
  revenueActual: number | null;
  revenueEstimate: number | null;
  year: number;
}

export interface EarningRow extends FinnhubEarning {
  /** EPS surprise % (actual vs estimate) — 발표 후에만 계산 */
  epsSurprise: number | null;
  /** 매출 surprise % */
  revenueSurprise: number | null;
  /** 'pre' | 'after' | 'during' | null — hour를 알기 쉬운 레이블로 */
  session: 'pre' | 'after' | 'during' | null;
}

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

function hourToSession(h: FinnhubEarning['hour']): EarningRow['session'] {
  if (h === 'bmo') return 'pre';
  if (h === 'amc') return 'after';
  if (h === 'dmh') return 'during';
  return null;
}

function enrichRow(e: FinnhubEarning): EarningRow {
  // Guard: |estimate| < 0.01 produces misleading extreme % (e.g. INTC +3052% when estimate=$0.009)
  const epsSurprise =
    e.epsActual != null && e.epsEstimate != null && Math.abs(e.epsEstimate) >= 0.01
      ? Math.max(-999, Math.min(999, Math.round(((e.epsActual - e.epsEstimate) / Math.abs(e.epsEstimate)) * 1000) / 10))
      : null;
  const revenueSurprise =
    e.revenueActual != null && e.revenueEstimate != null && e.revenueEstimate !== 0
      ? Math.max(-999, Math.min(999, Math.round(((e.revenueActual - e.revenueEstimate) / Math.abs(e.revenueEstimate)) * 1000) / 10))
      : null;
  return { ...e, epsSurprise, revenueSurprise, session: hourToSession(e.hour) };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const today = new Date().toISOString().slice(0, 10);
  const defaultTo = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

  const from = url.searchParams.get('from') ?? today;
  const to = url.searchParams.get('to') ?? defaultTo;

  // 범위 검증 (최대 30일)
  const spanDays = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000);
  if (isNaN(spanDays) || spanDays < 0 || spanDays > ALLOWED_SPAN_DAYS) {
    return NextResponse.json({ error: `Invalid range. Max ${ALLOWED_SPAN_DAYS} days.` }, { status: 400 });
  }

  const key = process.env.FINNHUB_KEY?.trim();
  const redis = createRedis();
  const cacheKey = `flowvium:earnings:v2:${from}:${to}`;

  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return NextResponse.json({ ...(cached as object), cached: true }, { headers: CDN_HEADERS });
    } catch { /* non-fatal */ }
  }

  if (!key) {
    logger.warn('api.earnings', 'no_finnhub_key');
    return NextResponse.json({
      earnings: [],
      from, to,
      warning: 'FINNHUB_KEY 미설정 — 실적 캘린더를 표시하려면 Finnhub 무료 키 발급 필요 (60 req/min 무료)',
      cached: false,
    });
  }

  const t0 = Date.now();
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${encodeURIComponent(key)}`,
      { signal: AbortSignal.timeout(12000), cache: 'no-store' }
    );
    if (!res.ok) {
      logger.error('api.earnings', 'finnhub_http_error', { status: res.status, durationMs: Date.now() - t0 });
      return NextResponse.json({ earnings: [], from, to, error: `Finnhub HTTP ${res.status}`, cached: false }, { status: 502 });
    }
    const data = await res.json() as { earningsCalendar?: FinnhubEarning[] };
    const raw = data.earningsCalendar ?? [];
    const enriched = raw.map(enrichRow)
      .sort((a, b) => a.date.localeCompare(b.date));

    logger.info('api.earnings', 'finnhub_ok', { from, to, count: enriched.length, durationMs: Date.now() - t0 });

    const payload = {
      earnings: enriched,
      from, to,
      count: enriched.length,
      updatedAt: new Date().toISOString(),
      source: 'Finnhub',
      cached: false,
    };

    if (redis) {
      await loggedRedisSet(redis, 'api.earnings', cacheKey, payload, { ex: CACHE_TTL });
    }
    return NextResponse.json(payload, { headers: CDN_HEADERS });
  } catch (err) {
    logger.error('api.earnings', 'fetch_failed', { error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - t0 });
    return NextResponse.json({ earnings: [], from, to, error: 'fetch failed', cached: false }, { status: 502 });
  }
}
