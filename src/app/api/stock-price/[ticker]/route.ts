import { NextResponse } from 'next/server';
import { createMemoryCache } from '@/lib/memory-cache';
import { Redis } from '@upstash/redis';
import { logger, loggedRedisSet } from '@/lib/logger';
import { YAHOO_HEADERS } from '@/lib/yahoo-finance';

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 min memory
const REDIS_TTL = 60 * 60;            // 1h Redis
const mem = createMemoryCache<object>('stock-price', CACHE_TTL_MS);
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=60' };

export const dynamic = 'force-dynamic';

// Twelve Data quote fallback — free tier 800 req/day, different IP path from Yahoo
async function fetchPriceTwelve(sym: string): Promise<{ price: number; change: number | null; changePct: number | null; volume: number | null } | null> {
  const apiKey = process.env.TWELVE_DATA_KEY?.trim();
  if (!apiKey) return null;
  const res = await fetch(
    `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(sym)}&apikey=${encodeURIComponent(apiKey)}`,
    { signal: AbortSignal.timeout(8000), cache: 'no-store' }
  );
  if (!res.ok) return null;
  const d = await res.json() as { close?: string; change?: string; percent_change?: string; volume?: string; status?: string };
  if (d.status === 'error') return null;
  const price = parseFloat(d.close ?? '');
  if (isNaN(price) || price <= 0) return null;
  const change = parseFloat(d.change ?? '');
  const changePct = parseFloat(d.percent_change ?? '');
  const volume = parseFloat(d.volume ?? '');
  return {
    price: parseFloat(price.toFixed(2)),
    change: isNaN(change) ? null : parseFloat(change.toFixed(2)),
    changePct: isNaN(changePct) ? null : parseFloat(changePct.toFixed(2)),
    volume: isNaN(volume) ? null : Math.round(volume),
  };
}

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

function staleKey(sym: string): string {
  return `flowvium:stock-price:stale:${sym}`;
}

export async function GET(_req: Request, { params }: { params: { ticker: string } }) {
  const sym = params.ticker.toUpperCase();

  const cached = mem.get(sym);
  if (cached) return NextResponse.json({ ...cached, cached: true }, { headers: CDN_HEADERS });

  const redis = createRedis();

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=5d`;
    const res = await fetch(url, {
      headers: YAHOO_HEADERS,
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);

    const data = await res.json();
    const chartResult = data?.chart?.result?.[0];
    const meta = chartResult?.meta;
    if (!meta) throw new Error('No meta data');

    const price: number | null = meta.regularMarketPrice ?? null;
    const allCloses: (number | null)[] = chartResult?.indicators?.quote?.[0]?.close ?? [];
    const validCloses = allCloses.filter((c): c is number => c != null && !isNaN(c));
    const prevClose: number | null = validCloses.length >= 2 ? validCloses[validCloses.length - 2] : null;
    const change = price != null && prevClose != null ? parseFloat((price - prevClose).toFixed(2)) : null;
    const changePct = price != null && prevClose != null && prevClose > 0
      ? parseFloat(((price - prevClose) / prevClose * 100).toFixed(2))
      : null;

    const volume: number | null = typeof meta.regularMarketVolume === 'number' ? meta.regularMarketVolume : null;
    const dayHigh: number | null = meta.regularMarketDayHigh ?? null;
    const dayLow: number | null = meta.regularMarketDayLow ?? null;
    const week52High: number | null = meta.fiftyTwoWeekHigh ?? null;
    const week52Low: number | null = meta.fiftyTwoWeekLow ?? null;

    const result = {
      ticker: sym,
      price,
      prevClose,
      change,
      changePct,
      volume,
      dayHigh,
      dayLow,
      week52High,
      week52Low,
      currency: meta.currency ?? 'USD',
      marketState: meta.marketState ?? null,
      updatedAt: new Date().toISOString(),
      cached: false,
    };

    mem.set(sym, result);
    if (redis) {
      await loggedRedisSet(redis, 'stock-price', `flowvium:stock-price:v1:${sym}`, result, { ex: REDIS_TTL });
      await loggedRedisSet(redis, 'stock-price', staleKey(sym), result, {});
    }
    return NextResponse.json(result, { headers: CDN_HEADERS });
  } catch (e) {
    // Yahoo blocked or unreachable — try stale cache before returning error
    if (redis) {
      try {
        const stale = await redis.get(staleKey(sym));
        if (stale) {
          logger.info('stock-price', 'stale_fallback', { sym, error: String(e) });
          mem.set(sym, stale as object);
          return NextResponse.json({ ...(stale as object), cached: true, stale: true }, { headers: CDN_HEADERS });
        }
      } catch { /* non-fatal */ }
    }
    // Twelve Data fallback — different infrastructure, not Yahoo-blocked
    try {
      const td = await fetchPriceTwelve(sym);
      if (td) {
        logger.info('stock-price', 'twelve_fallback', { sym, price: td.price });
        const result = {
          ticker: sym, price: td.price, prevClose: null, change: td.change, changePct: td.changePct,
          volume: td.volume, dayHigh: null, dayLow: null, week52High: null, week52Low: null,
          currency: 'USD', marketState: null, updatedAt: new Date().toISOString(), cached: false, source: 'twelve',
        };
        mem.set(sym, result);
        if (redis) {
          await loggedRedisSet(redis, 'stock-price', `flowvium:stock-price:v1:${sym}`, result, { ex: REDIS_TTL });
          await loggedRedisSet(redis, 'stock-price', staleKey(sym), result, {});
        }
        return NextResponse.json(result, { headers: CDN_HEADERS });
      }
    } catch (te) { logger.warn('stock-price', 'twelve_failed', { sym, error: String(te) }); }
    logger.warn('stock-price', 'fetch_failed', { sym, error: String(e) });
    return NextResponse.json(
      { ticker: sym, price: null, change: null, changePct: null, error: 'unavailable', cached: false },
      { status: 200, headers: CDN_HEADERS }
    );
  }
}
