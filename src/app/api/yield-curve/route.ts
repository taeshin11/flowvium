import { logger, loggedRedisSet } from '@/lib/logger';
/**
 * /api/yield-curve
 *
 * US Treasury yield curve + historical spread time series.
 * Source: FRED free CSV (no API key required).
 *
 * Returns:
 *   - today/weekAgo/monthAgo/quarterAgo curves (9 maturities)
 *   - spread2s10s and spread3m10y daily series (last 180 days)
 * Cache: Redis 1h | memory 30min
 */
import { NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import type { Redis } from '@upstash/redis';
import { createMemoryCache } from '@/lib/memory-cache';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CACHE_TTL = 60 * 60;  // 1h Redis
const MEM_CACHE = createMemoryCache<YieldCurveData>('yield-curve', 30 * 60_000);
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=120' };

const FRED_HEADERS = { 'User-Agent': 'Flowvium (taeshinkim11@gmail.com)', 'Accept': 'text/csv' };

const SERIES: { label: string; id: string; years: number }[] = [
  { label: '1M',  id: 'DGS1MO',  years: 1/12 },
  { label: '3M',  id: 'DGS3MO',  years: 0.25 },
  { label: '6M',  id: 'DGS6MO',  years: 0.5  },
  { label: '1Y',  id: 'DGS1',    years: 1    },
  { label: '2Y',  id: 'DGS2',    years: 2    },
  { label: '5Y',  id: 'DGS5',    years: 5    },
  { label: '10Y', id: 'DGS10',   years: 10   },
  { label: '20Y', id: 'DGS20',   years: 20   },
  { label: '30Y', id: 'DGS30',   years: 30   },
];

// TIPS real yield series (5 maturities, 5Y–30Y)
const TIPS_SERIES: { label: string; id: string; years: number }[] = [
  { label: '5Y',  id: 'DFII5',  years: 5  },
  { label: '7Y',  id: 'DFII7',  years: 7  },
  { label: '10Y', id: 'DFII10', years: 10 },
  { label: '20Y', id: 'DFII20', years: 20 },
  { label: '30Y', id: 'DFII30', years: 30 },
];

// Explicit FRED breakeven series (daily, 5Y and 10Y)
const BEI_SERIES: { label: string; id: string }[] = [
  { label: '5Y',  id: 'T5YIE'  },
  { label: '10Y', id: 'T10YIE' },
];

export interface YieldPoint {
  label: string;
  years: number;
  value: number | null;
}

export interface SpreadPoint {
  date: string;
  value: number;
}

export interface YieldCurveData {
  today: YieldPoint[];
  weekAgo: YieldPoint[];
  monthAgo: YieldPoint[];
  quarterAgo: YieldPoint[];
  spread2s10s: SpreadPoint[];
  spread3m10y: SpreadPoint[];
  spread2s10sCurrent: number | null;
  spread3m10yCurrent: number | null;
  inverted: boolean;
  // TIPS real yield curve (latest date)
  tipsToday: YieldPoint[];
  // Breakeven inflation time series (90 days)
  bei5y: SpreadPoint[];
  bei10y: SpreadPoint[];
  bei5yCurrent: number | null;
  bei10yCurrent: number | null;
  dataDate: string | null;
  updatedAt: string;
  cached: boolean;
  source: 'fred' | 'fred-stale' | 'empty';
}

function parseFredCsv(csv: string): Map<string, number> {
  const map = new Map<string, number>();
  const lines = csv.trim().split('\n');
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 2) continue;
    const date = parts[0].trim();
    const val = parts[1].trim();
    if (val && val !== '.' && val !== 'NA') {
      const n = parseFloat(val);
      if (!isNaN(n)) map.set(date, n);
    }
  }
  return map;
}

function closestValueOnOrBefore(map: Map<string, number>, targetDate: string, windowDays = 7): number | null {
  const target = new Date(targetDate);
  for (let d = 0; d <= windowDays; d++) {
    const date = new Date(target);
    date.setDate(date.getDate() - d);
    const key = date.toISOString().slice(0, 10);
    if (map.has(key)) return map.get(key)!;
  }
  return null;
}

async function fetchSeries(id: string, cosd: string, coed: string): Promise<Map<string, number>> {
  try {
    const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${cosd}&coed=${coed}`;
    const res = await fetch(url, { headers: FRED_HEADERS, cache: 'no-store', signal: AbortSignal.timeout(12000) });
    if (!res.ok) {
      logger.warn('yield-curve', 'fred_http_error', { id, status: res.status });
      return new Map();
    }
    return parseFredCsv(await res.text());
  } catch (err) {
    logger.error('yield-curve', 'fred_fetch_error', { id, error: err });
    return new Map();
  }
}

export async function GET() {
  const cacheKey = 'flowvium:yield-curve:v2';
  const redis = createRedis();

  const mem = MEM_CACHE.get('us');
  if (mem) return NextResponse.json({ ...mem, cached: true, cacheLayer: 'memory' }, { headers: CDN_HEADERS });

  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return NextResponse.json({ ...(cached as object), cached: true }, { headers: CDN_HEADERS });
    } catch { /* non-fatal */ }
  }

  // Date window: last 200 days (covers ~130 trading days + some buffer)
  const today = new Date();
  const coed = today.toISOString().slice(0, 10);
  const cosd = new Date(today.getTime() - 200 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const start = Date.now();
  const [maps, tipsMaps, beiMaps] = await Promise.all([
    Promise.all(SERIES.map(s => fetchSeries(s.id, cosd, coed))),
    Promise.all(TIPS_SERIES.map(s => fetchSeries(s.id, cosd, coed))),
    Promise.all(BEI_SERIES.map(s => fetchSeries(s.id, cosd, coed))),
  ]);
  logger.info('yield-curve', 'fetched', { series: SERIES.length + TIPS_SERIES.length + BEI_SERIES.length, durationMs: Date.now() - start });

  const seriesMaps = Object.fromEntries(SERIES.map((s, i) => [s.label, maps[i]]));

  // Latest trading date (most recent date with DGS10 data)
  const dgs10Map = seriesMaps['10Y'];
  const allDates = Array.from(dgs10Map.keys()).sort();
  const latestDate = allDates[allDates.length - 1] ?? null;

  const weekAgoDate = latestDate
    ? new Date(new Date(latestDate).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    : null;
  const monthAgoDate = latestDate
    ? new Date(new Date(latestDate).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    : null;
  const quarterAgoDate = latestDate
    ? new Date(new Date(latestDate).getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    : null;

  function buildCurve(refDate: string | null): YieldPoint[] {
    return SERIES.map(s => ({
      label: s.label,
      years: s.years,
      value: refDate ? closestValueOnOrBefore(seriesMaps[s.label], refDate) : null,
    }));
  }

  const todayCurve = buildCurve(latestDate);
  const weekAgoCurve = buildCurve(weekAgoDate);
  const monthAgoCurve = buildCurve(monthAgoDate);
  const quarterAgoCurve = buildCurve(quarterAgoDate);

  // Build spread time series over all available dates
  const dgs2Map = seriesMaps['2Y'];
  const dgs3mMap = seriesMaps['3M'];
  const spread2s10s: SpreadPoint[] = [];
  const spread3m10y: SpreadPoint[] = [];

  for (const date of allDates) {
    const v10 = dgs10Map.get(date);
    const v2 = dgs2Map.get(date);
    const v3m = dgs3mMap.get(date);
    if (v10 != null && v2 != null) spread2s10s.push({ date, value: parseFloat((v10 - v2).toFixed(3)) });
    if (v10 != null && v3m != null) spread3m10y.push({ date, value: parseFloat((v10 - v3m).toFixed(3)) });
  }

  const last10y = latestDate ? dgs10Map.get(latestDate) ?? null : null;
  const last2y  = latestDate ? closestValueOnOrBefore(dgs2Map, latestDate) : null;
  const last3m  = latestDate ? closestValueOnOrBefore(dgs3mMap, latestDate) : null;
  const sp2s10s = last10y != null && last2y != null ? parseFloat((last10y - last2y).toFixed(3)) : null;
  const sp3m10y = last10y != null && last3m != null ? parseFloat((last10y - last3m).toFixed(3)) : null;

  // TIPS curve for latest date
  const tipsMapsById = Object.fromEntries(TIPS_SERIES.map((s, i) => [s.label, tipsMaps[i]]));
  const tipsToday: YieldPoint[] = TIPS_SERIES.map(s => ({
    label: s.label,
    years: s.years,
    value: latestDate ? closestValueOnOrBefore(tipsMapsById[s.label], latestDate) : null,
  }));

  // Breakeven inflation time series (last 90 days)
  const bei5yMap = beiMaps[0];
  const bei10yMap = beiMaps[1];
  const beiDates = Array.from(bei10yMap.keys()).sort();
  const bei5ySlice = beiDates.slice(-90).flatMap(d => {
    const v = bei5yMap.get(d);
    return v != null ? [{ date: d, value: parseFloat(v.toFixed(3)) }] : [];
  });
  const bei10ySlice = beiDates.slice(-90).flatMap(d => {
    const v = bei10yMap.get(d);
    return v != null ? [{ date: d, value: parseFloat(v.toFixed(3)) }] : [];
  });
  const bei5yCurrent = latestDate ? closestValueOnOrBefore(bei5yMap, latestDate) : null;
  const bei10yCurrent = latestDate ? closestValueOnOrBefore(bei10yMap, latestDate) : null;

  // source 결정: latestDate 가 7일 이상 stale 이면 'fred-stale', 데이터 없으면 'empty'
  const dataAgeDays = latestDate
    ? Math.floor((Date.now() - new Date(latestDate).getTime()) / (24 * 60 * 60 * 1000))
    : null;
  const source: YieldCurveData['source'] =
    !latestDate ? 'empty' : (dataAgeDays !== null && dataAgeDays > 7) ? 'fred-stale' : 'fred';

  const data: YieldCurveData = {
    today: todayCurve,
    weekAgo: weekAgoCurve,
    monthAgo: monthAgoCurve,
    quarterAgo: quarterAgoCurve,
    spread2s10s,
    spread3m10y,
    spread2s10sCurrent: sp2s10s,
    spread3m10yCurrent: sp3m10y,
    inverted: sp2s10s != null && sp2s10s < 0,
    tipsToday,
    bei5y: bei5ySlice,
    bei10y: bei10ySlice,
    bei5yCurrent,
    bei10yCurrent,
    dataDate: latestDate,
    updatedAt: new Date().toISOString(),
    cached: false,
    source,
  };

  if (redis) {
    try {
      await loggedRedisSet(redis, 'api.yield-curve', cacheKey, data, { ex: CACHE_TTL });
    } catch (err) {
      logger.error('yield-curve', 'redis_save_error', { error: err });
    }
  } else {
    MEM_CACHE.set('us', data);
  }

  return NextResponse.json(data, { headers: CDN_HEADERS });
}
