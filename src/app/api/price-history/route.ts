/**
 * /api/price-history?ticker=SPY&days=30
 *
 * Daily closing prices from Stooq (free CSV, no auth). Used by the /report
 * KPI pills to render inline sparklines — shows the 30-day trend behind
 * the single current value.
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

async function fetchStooqDaily(ticker: string, days: number): Promise<PricePoint[]> {
  const sym = `${ticker.toLowerCase()}.us`;
  const url = `https://stooq.com/q/d/l/?s=${sym}&i=d`;
  const start = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000), cache: 'no-store' });
    if (!res.ok) {
      logger.warn('price-history', 'http_error', { ticker, status: res.status });
      return [];
    }
    const csv = await res.text();
    const lines = csv.trim().split('\n');
    if (lines.length < 2) return [];
    // Header: Date,Open,High,Low,Close,Volume
    const rows: PricePoint[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols.length < 5) continue;
      const date = cols[0];
      const close = parseFloat(cols[4]);
      if (!date || isNaN(close)) continue;
      rows.push({ date, close });
    }
    // Take last N days (CSV is oldest-first)
    const tail = rows.slice(-Math.max(2, Math.min(days, 365)));
    logger.info('price-history', 'fetched', { ticker, count: tail.length, durationMs: Date.now() - start });
    return tail;
  } catch (err) {
    logger.error('price-history', 'fetch_exception', { ticker, error: err, durationMs: Date.now() - start });
    return [];
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const ticker = (url.searchParams.get('ticker') ?? 'SPY').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 8);
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

  const points = await fetchStooqDaily(ticker, days);
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
