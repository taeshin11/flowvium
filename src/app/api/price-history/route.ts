/**
 * /api/price-history?ticker=SPY&days=30
 *
 * Daily closing prices from Yahoo Finance v8 chart API (free, UA-gated).
 * Previously tried Stooq daily CSV — as of 2026-04-22 Stooq now gates
 * /q/d/l/ behind captcha-issued apikeys (free batch /q/l/ still works but
 * only returns a single snapshot). Yahoo v8 chart supports 5d/1mo/3mo/6mo/1y
 * ranges with no auth.
 *
 * Used by the /report KPI pills to render inline sparklines — shows the
 * 30-day trend behind the single current value.
 *
 * Response: { ticker, points: [{date: 'YYYY-MM-DD', close: number}] }
 *
 * Cache: Redis 1h + module memory 30min.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { logger, loggedRedisSet } from '@/lib/logger';
import { createMemoryCache } from '@/lib/memory-cache';

export const revalidate = 0;

interface PricePoint { date: string; close: number }
interface PriceHistoryPayload { ticker: string; points: PricePoint[]; updatedAt: string }

const CACHE_TTL = 60 * 60;                    // 1h Redis
const MEMORY_CACHE = createMemoryCache<PriceHistoryPayload>('price-history', 30 * 60_000);

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

/**
 * Fetch daily closes from Yahoo Finance v8 chart API.
 * Reason for Yahoo over Stooq: Stooq /q/d/l/ (daily CSV) now requires apikey
 * (2026-04-22 confirmed) — returns captcha page. Yahoo v8 chart is still free
 * and UA-gated only. Vercel egress reachability confirmed separately.
 */
async function fetchYahooDaily(ticker: string, days: number): Promise<PricePoint[]> {
  const rangeMap: Record<number, string> =
    { 5: '5d', 30: '1mo', 90: '3mo', 180: '6mo', 365: '1y' };
  // Pick the smallest range that comfortably covers `days`
  const range = days <= 5 ? '5d' : days <= 30 ? '1mo' : days <= 90 ? '3mo' : days <= 180 ? '6mo' : '1y';
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=${range}`;
  const start = Date.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
      // UA required — v8 rejects default Node fetch UA
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Flowvium/1.0)', Accept: 'application/json' },
    });
    if (!res.ok) {
      logger.warn('price-history', 'yahoo_http_error', { ticker, status: res.status, durationMs: Date.now() - start });
      return [];
    }
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
      // Yahoo timestamps are unix-seconds at regular-market close
      const date = new Date(ts[i] * 1000).toISOString().slice(0, 10);
      rows.push({ date, close: c });
    }
    const tail = rows.slice(-Math.max(2, Math.min(days, 365)));
    logger.info('price-history', 'yahoo_ok', { ticker, range, count: tail.length, available: String(Object.keys(rangeMap).length), durationMs: Date.now() - start });
    return tail;
  } catch (err) {
    logger.error('price-history', 'yahoo_exception', { ticker, error: err, durationMs: Date.now() - start });
    return [];
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  // Allow A-Z / 0-9 / '-' (BRK-B) / '.' (some feeds) / '^' (indices: ^VIX, ^GSPC).
  const ticker = (url.searchParams.get('ticker') ?? 'SPY').toUpperCase().replace(/[^A-Z0-9.^-]/g, '').slice(0, 8);
  const days = Math.max(2, Math.min(parseInt(url.searchParams.get('days') ?? '30', 10) || 30, 365));
  if (!ticker) return NextResponse.json({ error: 'ticker required' }, { status: 400 });

  const redis = createRedis();
  const cacheKey = `flowvium:price-history:v1:${ticker}:${days}`;

  if (redis) {
    try {
      const cached = await redis.get<PriceHistoryPayload>(cacheKey);
      if (cached) return NextResponse.json({ ...cached, cached: true });
    } catch { /* non-fatal */ }
  } else {
    const mem = MEMORY_CACHE.get(`${ticker}:${days}`);
    if (mem) return NextResponse.json({ ...mem, cached: true, cacheLayer: 'memory' });
  }

  const points = await fetchYahooDaily(ticker, days);
  if (points.length === 0) {
    return NextResponse.json({ ticker, points: [], updatedAt: new Date().toISOString(), error: 'no data' }, { status: 502 });
  }
  const payload: PriceHistoryPayload = {
    ticker,
    points,
    updatedAt: new Date().toISOString(),
  };

  if (redis) {
    await loggedRedisSet(redis, 'api.price-history', cacheKey, payload, { ex: CACHE_TTL });
  } else {
    MEMORY_CACHE.set(`${ticker}:${days}`, payload);
  }

  return NextResponse.json({ ...payload, cached: false });
}
