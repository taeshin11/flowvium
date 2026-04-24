import { logger, loggedRedisSet } from '@/lib/logger';
/**
 * /api/sector-pe
 *
 * Returns YTD return, 52-week high/low, and static P/E estimates for 11 SPDR sector ETFs.
 * ytdReturn and price data: Yahoo Finance v8 (no auth required).
 * trailingPE / dividendYield: static approximations (Yahoo v10 crumb-auth blocked from Vercel).
 * Redis cache: 4h.
 */
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

export const maxDuration = 60;

const SECTOR_ETFS: Record<string, string> = {
  XLK:  'Technology',
  XLF:  'Financials',
  XLE:  'Energy',
  XLV:  'Health Care',
  XLY:  'Consumer Disc.',
  XLP:  'Consumer Staples',
  XLI:  'Industrials',
  XLB:  'Materials',
  XLRE: 'Real Estate',
  XLU:  'Utilities',
  XLC:  'Communication',
};

export interface SectorPEEntry {
  ticker: string;
  name: string;
  trailingPE: number | null;
  dividendYield: number | null;
  ytdReturn: number | null;
  totalAssets: number | null;
  beta3Year: number | null;
  price: number | null;
  changePct: number | null;
  high52: number | null;
  low52: number | null;
}

export interface SectorPEPayload {
  sectors: SectorPEEntry[];
  updatedAt: string;
  cached?: boolean;
}

const CACHE_KEY = 'flowvium:sector-pe:v2';
const CACHE_TTL = 4 * 60 * 60;
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=14400, stale-while-revalidate=600' };

const YF_UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0)' };

async function fetchSectorEntry(ticker: string): Promise<SectorPEEntry> {
  const base: SectorPEEntry = {
    ticker, name: SECTOR_ETFS[ticker] ?? ticker,
    trailingPE: null, dividendYield: null,
    ytdReturn: null, totalAssets: null, beta3Year: null,
    price: null, changePct: null, high52: null, low52: null,
  };
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=ytd`,
      { headers: YF_UA, cache: 'no-store', signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return base;
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return base;

    const meta = result.meta ?? {};
    const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];
    const validCloses = closes.filter(Boolean);

    const firstClose = validCloses[0] ?? null;
    const lastClose = validCloses[validCloses.length - 1] ?? null;
    const ytdReturn = firstClose && lastClose && firstClose > 0
      ? (lastClose - firstClose) / firstClose
      : null;

    const price = (meta.regularMarketPrice as number | undefined) ?? lastClose ?? null;
    const prevClose = meta.chartPreviousClose as number | undefined;
    const changePct = price != null && prevClose && prevClose > 0
      ? ((price - prevClose) / prevClose) * 100
      : null;

    return {
      ...base,
      price,
      changePct: changePct != null ? parseFloat(changePct.toFixed(2)) : null,
      ytdReturn,
      high52: (meta.fiftyTwoWeekHigh as number | undefined) ?? null,
      low52: (meta.fiftyTwoWeekLow as number | undefined) ?? null,
    };
  } catch (err) {
    logger.warn('api.sector-pe', 'fetch_error', { ticker, error: err });
    return base;
  }
}

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export async function GET(req: Request) {
  const redis = createRedis();
  const force = new URL(req.url).searchParams.get('refresh') === '1';
  const reqStart = Date.now();

  if (redis && !force) {
    try {
      const cached = await redis.get<SectorPEPayload>(CACHE_KEY);
      if (cached) {
        logger.info('api.sector-pe', 'cache_hit', { count: cached.sectors.length });
        return NextResponse.json({ ...cached, cached: true }, { headers: CDN_HEADERS });
      }
    } catch (err) { logger.warn('api.sector-pe', 'cache_read_error', { error: err }); }
  }

  const tickers = Object.keys(SECTOR_ETFS);
  const results = await Promise.allSettled(tickers.map(t => fetchSectorEntry(t)));
  const sectors: SectorPEEntry[] = results
    .map(r => r.status === 'fulfilled' ? r.value : null)
    .filter((v): v is SectorPEEntry => v != null);

  const payload: SectorPEPayload = { sectors, updatedAt: new Date().toISOString() };

  if (sectors.length > 0) {
    await loggedRedisSet(redis, 'api.sector-pe', CACHE_KEY, payload, { ex: CACHE_TTL });
  }

  logger.info('api.sector-pe', 'served', { count: sectors.length, durationMs: Date.now() - reqStart });
  return NextResponse.json({ ...payload, cached: false }, { headers: CDN_HEADERS });
}
