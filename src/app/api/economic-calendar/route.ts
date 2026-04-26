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
import { Redis } from '@upstash/redis';
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
  source: 'finnhub' | 'empty';
  updatedAt: string;
}

// FOMC decision dates 2026 — Finnhub free tier doesn't include FOMC rate decisions.
// These are injected as fixed high-impact events so the calendar is never missing
// the most market-moving event of the year.
// Updated 2026-04-26: estimates recalibrated to ZQ futures market consensus.
// Tariff shock → NFP+228K beat → CPI 3.3% → no cuts priced through mid-2026.
// Jun/Jul: 90%/80% hold per FedWatch. Sep: first cut scenario (~32% prob).
// actual field = confirmed outcome for past meetings (FRED DFEDTARU verified).
const FOMC_2026: Array<{ date: string; time: string; prev: number; estimate: number; actual?: number }> = [
  { date: '2026-01-29', time: '19:00:00', prev: 4.25, estimate: 4.25, actual: 4.25 }, // hold confirmed
  { date: '2026-03-19', time: '18:00:00', prev: 4.25, estimate: 4.00, actual: 3.75 }, // 50bp cut (FRED DFEDTARU=3.75)
  { date: '2026-04-29', time: '18:00:00', prev: 3.75, estimate: 3.75 },
  { date: '2026-06-17', time: '18:00:00', prev: 3.75, estimate: 3.75 }, // 90% hold — no cut priced
  { date: '2026-07-29', time: '18:00:00', prev: 3.75, estimate: 3.75 }, // 80% hold
  { date: '2026-09-16', time: '18:00:00', prev: 3.75, estimate: 3.50 }, // first cut scenario (32%)
  { date: '2026-10-28', time: '18:00:00', prev: 3.50, estimate: 3.50 }, // hold after Sep cut
  { date: '2026-12-09', time: '19:00:00', prev: 3.50, estimate: 3.25 }, // second cut possible (50%)
];

function injectFomcEvents(events: EconCalEvent[], from: string, to: string): EconCalEvent[] {
  const fomc = FOMC_2026
    .filter(f => f.date >= from && f.date <= to)
    .map(f => ({
      date: f.date,
      time: f.time,
      country: 'US',
      event: 'FOMC Rate Decision (Fed Funds Target)',
      impact: 'high' as const,
      actual: f.actual ?? null,
      estimate: f.estimate,
      prev: f.prev,
      unit: '%',
    }));
  if (!fomc.length) return events;
  // Skip injection if Finnhub already includes a Fed rate decision (±1 day of each FOMC date)
  const fomcDates = new Set(fomc.map(f => f.date));
  const hasFedRateEvent = events.some(e => {
    if (!fomcDates.has(e.date) && !fomcDates.has(
      new Date(new Date(e.date).getTime() + 86400000).toISOString().slice(0, 10)
    )) return false;
    return /interest rate|rate decision|fed funds|fomc/i.test(e.event);
  });
  if (hasFedRateEvent) return events;  // Finnhub already covers it
  const merged = [...events, ...fomc];
  return merged.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''));
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

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
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

  if (!apiKey) {
    logger.warn('api.economic-calendar', 'no_finnhub_key');
    const empty: EconCalResponse = {
      events: injectFomcEvents([], from, to), from, to, country, cached: false, source: 'empty',
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
      logger.warn('api.economic-calendar', `finnhub_error_${res.status}`);
      const empty: EconCalResponse = {
        events: [], from, to, country, cached: false, source: 'empty',
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
      events: injectFomcEvents(events, from, to), from, to, country, cached: false, source: 'finnhub',
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
