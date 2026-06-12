/**
 * /api/economic-calendar
 *
 * Finnhub 경제 캘린더 (무료 티어) — 정적 데이터 대체용 live API.
 * Finnhub impact: "3"=high / "2"=medium / "1"=low
 *
 * ?from=YYYY-MM-DD  (기본: 오늘)
 * ?to=YYYY-MM-DD    (기본: 오늘+14일)
 * ?country=US       (기본: US — 쉼표 구분 복수 가능)
 *
 * Redis: flowvium:econ-cal:v2:{from}:{to}:{country} — 4h TTL
 */
import { NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import type { Redis } from '@upstash/redis';
import { logger, loggedRedisSet } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const CACHE_TTL = 4 * 60 * 60; // 4h
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=14400, stale-while-revalidate=1800' };

export interface EconCalEvent {
  date: string;           // YYYY-MM-DD
  time: string | null;    // "08:30:00" UTC
  country: string;        // "US"
  event: string;          // "Nonfarm Payrolls"
  impact: 'high' | 'medium' | 'low';
  actual: number | null;
  estimate: number | null;
  prev: number | null;
  unit: string | null;
}

export interface EconCalResponse {
  events: EconCalEvent[];
  from: string;
  to: string;
  country: string;
  cached: boolean;
  source: 'finnhub' | 'fred-schedule' | 'empty';
  updatedAt: string;
}

// FOMC decision dates 2026 — dates and estimates only (NO hardcoded actuals).
// Actual rates are fetched live from FRED DFEDTARU series via fetchFredActualRate().
// Estimates are ZQ futures consensus — updated when market consensus shifts significantly.
const FOMC_2026: Array<{ date: string; time: string; prev: number; estimate: number }> = [
  { date: '2026-01-29', time: '19:00:00', prev: 4.25, estimate: 4.25 },
  { date: '2026-03-19', time: '18:00:00', prev: 4.25, estimate: 4.00 },
  { date: '2026-04-29', time: '18:00:00', prev: 3.75, estimate: 3.75 },
  { date: '2026-06-17', time: '18:00:00', prev: 3.75, estimate: 3.75 },
  { date: '2026-07-29', time: '18:00:00', prev: 3.75, estimate: 3.75 },
  { date: '2026-09-16', time: '18:00:00', prev: 3.75, estimate: 3.50 },
  { date: '2026-10-28', time: '18:00:00', prev: 3.50, estimate: 3.50 },
  { date: '2026-12-09', time: '19:00:00', prev: 3.50, estimate: 3.25 },
];

// FRED DFEDTARU: 실제 금리 상한 (Federal Funds Target Rate Upper) 조회
// 과거 FOMC 회의 결과를 live로 확인 — 하드코딩 actual 대신 사용
async function fetchFredActualRate(): Promise<number | null> {
  const fredKey = process.env.FRED_API_KEY?.trim();
  if (!fredKey) return null;
  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=DFEDTARU&api_key=${fredKey}&sort_order=desc&limit=1&file_type=json`;
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const d = await res.json() as { observations?: Array<{ value: string }> };
    const val = parseFloat(d?.observations?.[0]?.value ?? '');
    return isNaN(val) ? null : val;
  } catch { return null; }
}

// 2026-06-12: Finnhub 이 economic calendar 를 유료화(키 유효한데 이 endpoint 만 401, earnings 는 정상)
//   → FRED release/dates API(무료, 보유 키)로 주요 지표 발표 *일정* 폴백. actual/estimate 는 없지만
//   "언제 무엇이 나오나"는 결정론 제공 — 빈 캘린더보다 훨씬 낫다. curl 검증: GDP 6/25, 소매판매 6/17.
const FRED_RELEASES: Array<{ id: number; event: string }> = [
  { id: 10, event: 'CPI (Consumer Price Index)' },
  { id: 46, event: 'PPI (Producer Price Index)' },
  { id: 50, event: 'Employment Situation (Nonfarm Payrolls)' },
  { id: 53, event: 'GDP' },
  { id: 9, event: 'Advance Retail Sales' },
];
async function fetchFredReleaseEvents(from: string, to: string): Promise<EconCalEvent[]> {
  const fredKey = process.env.FRED_API_KEY?.trim();
  if (!fredKey) return [];
  const out: EconCalEvent[] = [];
  await Promise.all(FRED_RELEASES.map(async ({ id, event }) => {
    try {
      const u = `https://api.stlouisfed.org/fred/release/dates?release_id=${id}&api_key=${fredKey}&file_type=json&include_release_dates_with_no_data=true&realtime_start=${from}&realtime_end=${to}&sort_order=asc&limit=10`;
      const res = await fetch(u, { cache: 'no-store', signal: AbortSignal.timeout(6000) });
      if (!res.ok) return;
      const d = await res.json() as { release_dates?: Array<{ date: string }> };
      for (const rd of d.release_dates ?? []) {
        if (rd.date >= from && rd.date <= to) {
          out.push({ date: rd.date, time: null, country: 'US', event, impact: 'high', actual: null, estimate: null, prev: null, unit: null });
        }
      }
    } catch { /* 폴백 실패 — FOMC 주입만으로 진행 */ }
  }));
  return out;
}

function injectFomcEvents(events: EconCalEvent[], from: string, to: string, currentRate: number | null): EconCalEvent[] {
  const today = new Date().toISOString().slice(0, 10);
  const fomc = FOMC_2026
    .filter(f => f.date >= from && f.date <= to)
    .map(f => ({
      date: f.date,
      time: f.time,
      country: 'US',
      event: 'FOMC Rate Decision (Fed Funds Target)',
      impact: 'high' as const,
      // past meeting: use FRED live rate as actual; future: null
      actual: f.date < today ? currentRate : null,
      estimate: f.estimate,
      prev: f.prev,
      unit: '%',
    }));
  if (!fomc.length) return events;
  // Skip injection only for individual FOMC dates already covered by Finnhub (±1 day)
  const coveredDates = new Set(
    fomc.filter(f => events.some(e => {
      const eDatePlus1 = new Date(new Date(e.date).getTime() + 86400000).toISOString().slice(0, 10);
      return (e.date === f.date || eDatePlus1 === f.date) &&
        /interest rate|rate decision|fed funds|fomc/i.test(e.event);
    })).map(f => f.date)
  );
  const toInject = fomc.filter(f => !coveredDates.has(f.date));
  if (!toInject.length) return events;
  return [...events, ...toInject].sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''));
}

function mapImpact(raw: string | number | null): EconCalEvent['impact'] {
  if (raw === 'high' || raw === 3) return 'high';
  if (raw === 'medium' || raw === 2) return 'medium';
  // Finnhub returns string labels; numeric fallback for alternate API
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? '1'), 10);
  if (n >= 3) return 'high';
  if (n === 2) return 'medium';
  return 'low';
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const kstNow = new Date(Date.now() + 9 * 3600 * 1000);
  const today = kstNow.toISOString().slice(0, 10);
  const defaultTo = new Date(kstNow.getTime() + 14 * 86400000).toISOString().slice(0, 10);

  const from = url.searchParams.get('from') ?? today;
  const to   = url.searchParams.get('to')   ?? defaultTo;
  const country = (url.searchParams.get('country') ?? 'US').toUpperCase();

  const spanDays = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000);
  if (isNaN(spanDays) || spanDays < 0 || spanDays > 30) {
    return NextResponse.json({ error: 'Invalid range. Max 30 days.' }, { status: 400 });
  }

  const apiKey = process.env.FINNHUB_KEY?.trim();
  const redis = createRedis();
  const cacheKey = `flowvium:econ-cal:v2:${from}:${to}:${country}`;

  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return NextResponse.json({ ...(cached as object), cached: true }, { headers: CDN_HEADERS });
      }
    } catch { /* non-fatal */ }
  }

  // FRED 실제 금리 조회 (FOMC actual 필드에 사용)
  const currentRate = await fetchFredActualRate().catch(() => null);

  if (!apiKey) {
    logger.warn('api.economic-calendar', 'no_finnhub_key');
    const fredEvents = await fetchFredReleaseEvents(from, to);
    const empty: EconCalResponse = {
      events: injectFomcEvents(fredEvents, from, to, currentRate), from, to, country, cached: false, source: 'empty',
      updatedAt: new Date().toISOString(),
    };
    return NextResponse.json(empty, { headers: CDN_HEADERS });
  }

  try {
    const finnhubUrl =
      `https://finnhub.io/api/v1/calendar/economic?from=${from}&to=${to}&token=${encodeURIComponent(apiKey)}`;
    const res = await fetch(finnhubUrl, {
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });

    if (!res.ok) {
      // 2026-06-12: Finnhub 401(키 만료) 동안 캘린더 전체가 빈 화면이던 결함 — 에러 경로도
      //   FOMC 결정론 일정(+FRED 실금리)은 주입 (no-key 경로와 동일 graceful degradation).
      logger.warn('api.economic-calendar', `finnhub_error_${res.status}`);
      const fredEvents = await fetchFredReleaseEvents(from, to);
      const empty: EconCalResponse = {
        events: injectFomcEvents(fredEvents, from, to, currentRate), from, to, country, cached: false, source: 'fred-schedule',
        updatedAt: new Date().toISOString(),
      };
      return NextResponse.json(empty, { headers: CDN_HEADERS });
    }

    const raw = await res.json() as {
      economicCalendar?: Array<{
        actual?: number | null;
        country?: string;
        estimate?: number | null;
        event?: string;
        impact?: string | number;
        prev?: number | null;
        time?: string;
        unit?: string;
      }>;
    };

    const countries = country.split(',').map(c => c.trim().toUpperCase());
    const events: EconCalEvent[] = (raw.economicCalendar ?? [])
      .filter(e => countries.includes((e.country ?? '').toUpperCase()))
      .map(e => {
        const dt = e.time ?? '';
        const date = dt.slice(0, 10);
        const time = dt.length >= 19 ? dt.slice(11, 19) : null;
        return {
          date,
          time,
          country: (e.country ?? 'US').toUpperCase(),
          event: e.event ?? '',
          impact: mapImpact(e.impact ?? null),
          actual: e.actual ?? null,
          estimate: e.estimate ?? null,
          prev: e.prev ?? null,
          unit: e.unit ?? null,
        };
      })
      .filter(e => e.date >= from && e.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''));

    const payload: EconCalResponse = {
      events: injectFomcEvents(events, from, to, currentRate), from, to, country, cached: false, source: 'finnhub',
      updatedAt: new Date().toISOString(),
    };

    if (redis) {
      await loggedRedisSet(redis, 'api.economic-calendar', cacheKey, payload, { ex: CACHE_TTL });
    }

    return NextResponse.json(payload, { headers: CDN_HEADERS });
  } catch (err) {
    logger.error('api.economic-calendar', 'fetch_failed', { err: String(err) });
    const empty: EconCalResponse = {
      events: [], from, to, country, cached: false, source: 'empty',
      updatedAt: new Date().toISOString(),
    };
    return NextResponse.json(empty, { headers: CDN_HEADERS });
  }
}
