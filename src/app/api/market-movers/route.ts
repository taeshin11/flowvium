/**
 * /api/market-movers
 *
 * S&P 500 주요 대형주 50개의 당일 등락률을 정렬해
 * top 5 gainers / top 5 losers 반환.
 *
 * Yahoo Finance v7 batch (60req/min limit 없음).
 * Redis: flowvium:market-movers:v1 — 15min TTL
 */
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { loggedRedisSet } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const CACHE_TTL = 15 * 60;
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=120' };
const YHDR = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
const CACHE_KEY = 'flowvium:market-movers:v1';

// Major S&P 500 stocks — top 50 by market cap
const WATCH_TICKERS = [
  'AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','BRK-B','AVGO','JPM',
  'LLY','UNH','V','XOM','MA','JNJ','PG','COST','HD','ABBV',
  'BAC','MRK','CRM','ORCL','CVX','AMD','NFLX','ADBE','NOW','KO',
  'PEP','TMO','WMT','WFC','GS','BX','QCOM','ISRG','TXN','DHR',
  'MS','RTX','AMGN','CAT','INTU','PLTR','PANW','AMAT','INTC','COIN',
];

export interface Mover {
  ticker: string;
  price: number;
  changePct: number;
  change: number;
}

export interface MarketMoversResponse {
  gainers: Mover[];
  losers: Mover[];
  updatedAt: string;
  cached: boolean;
}

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export async function GET() {
  const redis = createRedis();

  if (redis) {
    try {
      const cached = await redis.get(CACHE_KEY);
      if (cached) {
        return NextResponse.json({ ...(cached as object), cached: true }, { headers: CDN_HEADERS });
      }
    } catch { /* non-fatal */ }
  }

  try {
    const res = await fetch(
      `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${WATCH_TICKERS.join(',')}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent`,
      { headers: YHDR, signal: AbortSignal.timeout(12000), cache: 'no-store' },
    );

    if (!res.ok) {
      return NextResponse.json({ gainers: [], losers: [], updatedAt: new Date().toISOString(), cached: false }, { headers: CDN_HEADERS });
    }

    const data = await res.json() as {
      quoteResponse?: {
        result?: Array<{
          symbol?: string;
          regularMarketPrice?: number | null;
          regularMarketChange?: number | null;
          regularMarketChangePercent?: number | null;
        }>;
      };
    };

    const quotes = data?.quoteResponse?.result ?? [];
    const movers: Mover[] = quotes
      .filter(q => q.symbol && q.regularMarketChangePercent != null && q.regularMarketPrice != null)
      .map(q => ({
        ticker: q.symbol!,
        price: Math.round(q.regularMarketPrice! * 100) / 100,
        changePct: Math.round(q.regularMarketChangePercent! * 100) / 100,
        change: Math.round((q.regularMarketChange ?? 0) * 100) / 100,
      }));

    movers.sort((a, b) => b.changePct - a.changePct);
    const gainers = movers.filter(m => m.changePct > 0).slice(0, 5);
    const losers = movers.filter(m => m.changePct < 0).slice(-5).reverse();

    const payload: MarketMoversResponse = {
      gainers, losers, updatedAt: new Date().toISOString(), cached: false,
    };

    if (redis) {
      await loggedRedisSet(redis, 'api.market-movers', CACHE_KEY, payload, { ex: CACHE_TTL });
    }

    return NextResponse.json(payload, { headers: CDN_HEADERS });
  } catch {
    return NextResponse.json({ gainers: [], losers: [], updatedAt: new Date().toISOString(), cached: false }, { headers: CDN_HEADERS });
  }
}
