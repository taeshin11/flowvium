/**
 * /api/market-movers
 *
 * S&P 500 주요 대형주 50개의 당일 등락률을 정렬해
 * top 5 gainers / top 5 losers 반환.
 *
 * Nasdaq historical API — no auth, works from Vercel IPs (Yahoo Finance blocked).
 * change% = (latestClose - prevClose) / prevClose × 100
 * Redis: flowvium:market-movers:v1 — 15min TTL
 */
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { loggedRedisSet, logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const CACHE_TTL = 15 * 60;
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=120' };
const CACHE_KEY = 'flowvium:market-movers:v1';

const NASDAQ_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

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
  advancers: number;
  decliners: number;
  unchanged: number;
  updatedAt: string;
  cached: boolean;
  source?: string;
}

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

// Determine assetclass for Nasdaq API — BRK-B and others use 'stocks'
function nasdasClass(ticker: string): string {
  return 'stocks';
}

async function fetchQuoteNasdaq(ticker: string): Promise<Mover | null> {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 14 * 86400 * 1000).toISOString().slice(0, 10);
  const assetclass = nasdasClass(ticker);
  const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(ticker)}/historical?assetclass=${assetclass}&fromdate=${from}&todate=${to}&limit=5&sortColumn=date&sortOrder=DESC&type=Historical`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': NASDAQ_UA },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json() as { data?: { tradesTable?: { rows?: Array<{ close: string }> } } };
    const rows = data?.data?.tradesTable?.rows ?? [];
    if (rows.length < 2) return null;
    const latest = parseFloat((rows[0].close ?? '').replace(/[$,]/g, ''));
    const prev = parseFloat((rows[1].close ?? '').replace(/[$,]/g, ''));
    if (isNaN(latest) || isNaN(prev) || prev === 0) return null;
    const change = latest - prev;
    const changePct = Math.round((change / prev) * 10000) / 100;
    return { ticker, price: Math.round(latest * 100) / 100, changePct, change: Math.round(change * 100) / 100 };
  } catch {
    return null;
  }
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

  const t0 = Date.now();
  const movers: Mover[] = [];
  const CONCURRENT = 5;
  const DELAY_MS = 200;

  for (let i = 0; i < WATCH_TICKERS.length; i += CONCURRENT) {
    const batch = WATCH_TICKERS.slice(i, i + CONCURRENT);
    const settled = await Promise.allSettled(batch.map(fetchQuoteNasdaq));
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) movers.push(r.value);
    }
    if (i + CONCURRENT < WATCH_TICKERS.length) {
      await new Promise(res => setTimeout(res, DELAY_MS));
    }
  }

  logger.info('api.market-movers', 'fetched', { count: movers.length, durationMs: Date.now() - t0 });

  movers.sort((a, b) => b.changePct - a.changePct);
  const gainers = movers.filter(m => m.changePct > 0).slice(0, 5);
  const losers = movers.filter(m => m.changePct < 0).slice(-5).reverse();
  const advancers = movers.filter(m => m.changePct > 0).length;
  const decliners = movers.filter(m => m.changePct < 0).length;
  const unchanged = movers.length - advancers - decliners;

  const payload: MarketMoversResponse = {
    gainers, losers, advancers, decliners, unchanged,
    updatedAt: new Date().toISOString(), cached: false, source: 'nasdaq',
  };

  if (redis) {
    await loggedRedisSet(redis, 'api.market-movers', CACHE_KEY, payload, { ex: CACHE_TTL });
  }

  return NextResponse.json(payload, { headers: CDN_HEADERS });
}
