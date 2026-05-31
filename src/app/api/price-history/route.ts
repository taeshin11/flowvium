/**
 * /api/price-history?ticker=SPY&days=30
 *
 * Daily closing prices for sparklines.
 * Source chain: Yahoo Finance v8 → Nasdaq historical API (stocks → etf).
 * Yahoo v8 blocked on Vercel IPs; Nasdaq historical is the reliable fallback.
 *
 * Response: { ticker, points: [{date: 'YYYY-MM-DD', close: number}] }
 * Cache: Redis 1h + module memory 30min.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import type { Redis } from '@upstash/redis';
import { logger, loggedRedisSet } from '@/lib/logger';
import { createMemoryCache } from '@/lib/memory-cache';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const revalidate = 0;

const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=120' };

interface PricePoint { date: string; close: number }
interface PriceHistoryPayload { ticker: string; points: PricePoint[]; source?: string; updatedAt: string }

const CACHE_TTL = 60 * 60;
const MEMORY_CACHE = createMemoryCache<PriceHistoryPayload>('price-history', 30 * 60_000);

const NASDAQ_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function fetchYahooDaily(ticker: string, days: number): Promise<PricePoint[]> {
  const range = days <= 5 ? '5d' : days <= 30 ? '1mo' : days <= 90 ? '3mo' : days <= 180 ? '6mo' : '1y';
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=${range}`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Flowvium/1.0)', Accept: 'application/json' },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ close?: (number|null)[] }> } }> };
    };
    const result = json?.chart?.result?.[0];
    const ts = result?.timestamp ?? [];
    const closes = result?.indicators?.quote?.[0]?.close ?? [];
    if (ts.length === 0 || closes.length === 0) return [];
    const rows: PricePoint[] = [];
    for (let i = 0; i < ts.length; i++) {
      const c = closes[i];
      if (typeof c !== 'number' || isNaN(c)) continue;
      rows.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), close: c });
    }
    return rows.slice(-Math.max(2, Math.min(days, 365)));
  } catch {
    return [];
  }
}

/** Convert Nasdaq date "MM/DD/YYYY" → "YYYY-MM-DD" */
function nasToIso(d: string): string {
  const [m, day, y] = d.split('/');
  return `${y}-${m.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

async function fetchNasdaqDaily(ticker: string, days: number, assetclass: string): Promise<PricePoint[]> {
  const toDate = new Date().toISOString().slice(0, 10);
  const fromDate = new Date(Date.now() - (days + 30) * 86400000).toISOString().slice(0, 10);
  const limit = Math.min(days + 30, 365);
  // API returns newest-first regardless of sortOrder; we reverse to get chronological order
  const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(ticker)}/historical?assetclass=${assetclass}&fromdate=${fromDate}&todate=${toDate}&limit=${limit}&sortColumn=date&sortOrder=DESC&type=Historical`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': NASDAQ_UA },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const data = await res.json() as { data?: { tradesTable?: { rows?: Array<{ date: string; close: string }> } } };
    const rows = data?.data?.tradesTable?.rows ?? [];
    const points = rows
      .map(r => {
        const close = parseFloat((r.close ?? '').replace(/[$,]/g, ''));
        return isNaN(close) ? null : { date: nasToIso(r.date), close };
      })
      .filter((p): p is PricePoint => p !== null)
      .reverse(); // newest-first → oldest-first for sparklines
    return points.slice(-Math.max(2, days));
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  // 2026-06-01: slice(0,8) 가 "005930.KS"(9자) → "005930.K" 절단 → Yahoo 잘못된 심볼 → 502/no-data.
  //   Yahoo v8 chart 는 KR .KS/.KQ 정상 지원(currency KRW). slice 12 로 KR ticker 수용.
  const ticker = (url.searchParams.get('ticker') ?? 'SPY').toUpperCase().replace(/[^A-Z0-9.^-]/g, '').slice(0, 12);
  const days = Math.max(2, Math.min(parseInt(url.searchParams.get('days') ?? '30', 10) || 30, 365));
  if (!ticker) return NextResponse.json({ error: 'ticker required' }, { status: 400 });

  const redis = createRedis();
  const cacheKey = `flowvium:price-history:v2:${ticker}:${days}`;

  if (redis) {
    try {
      const cached = await redis.get<PriceHistoryPayload>(cacheKey);
      if (cached) return NextResponse.json({ ...cached, cached: true }, { headers: CDN_HEADERS });
    } catch { /* non-fatal */ }
  } else {
    const mem = MEMORY_CACHE.get(`${ticker}:${days}`);
    if (mem) return NextResponse.json({ ...mem, cached: true, cacheLayer: 'memory' }, { headers: CDN_HEADERS });
  }

  // Try Yahoo first (may work from some Vercel regions); Nasdaq as reliable fallback
  let points = await fetchYahooDaily(ticker, days);
  let source = 'yahoo';

  if (points.length === 0) {
    // Nasdaq: try stocks then etf assetclass
    points = await fetchNasdaqDaily(ticker, days, 'stocks');
    if (points.length === 0) {
      points = await fetchNasdaqDaily(ticker, days, 'etf');
      if (points.length > 0) source = 'nasdaq-etf';
    } else {
      source = 'nasdaq';
    }
  }

  logger.info('price-history', 'fetched', { ticker, days, count: points.length, source });

  if (points.length === 0) {
    return NextResponse.json({ ticker, points: [], updatedAt: new Date().toISOString(), error: 'no data' }, { status: 502 });
  }

  const payload: PriceHistoryPayload = { ticker, points, source, updatedAt: new Date().toISOString() };

  if (redis) {
    await loggedRedisSet(redis, 'api.price-history', cacheKey, payload, { ex: CACHE_TTL });
  } else {
    MEMORY_CACHE.set(`${ticker}:${days}`, payload);
  }

  return NextResponse.json({ ...payload, cached: false }, { headers: CDN_HEADERS });
}
