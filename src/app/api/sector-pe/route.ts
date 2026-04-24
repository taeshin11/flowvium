import { logger, loggedRedisSet } from '@/lib/logger';
/**
 * /api/sector-pe
 *
 * Returns YTD return, 52-week high/low, P/E, dividend yield for 11 SPDR sector ETFs.
 * ytdReturn and price data: Yahoo Finance v8 (no auth required).
 * trailingPE / dividendYield: Yahoo Finance v10 via crumb flow.
 * Static fallback values (2026-04-25) used when crumb fetch fails (e.g., blocked IPs).
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

const CACHE_KEY = 'flowvium:sector-pe:v3';
const CRUMB_KEY = 'flowvium:yahoo:crumb:v1';
const CACHE_TTL = 4 * 60 * 60;
const CRUMB_TTL = 22 * 60 * 60; // crumbs last ~24h
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=14400, stale-while-revalidate=600' };

const YF_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// Static fallback fundamental data (verified 2026-04-25)
const STATIC_FUNDAMENTALS: Record<string, { trailingPE: number; dividendYield: number | null; totalAssets: number; beta3Year: number | null }> = {
  XLK:  { trailingPE: 38.09, dividendYield: 0.0071, totalAssets: 84198424576, beta3Year: 1.11 },
  XLF:  { trailingPE: 17.34, dividendYield: 0.0112, totalAssets: 47790944256, beta3Year: 0.92 },
  XLE:  { trailingPE: 21.92, dividendYield: 0.0379, totalAssets: 43603132416, beta3Year: 0.23 },
  XLV:  { trailingPE: 25.40, dividendYield: 0.0124, totalAssets: 38603882496, beta3Year: 0.71 },
  XLY:  { trailingPE: 32.01, dividendYield: 0.0099, totalAssets: 21445781504, beta3Year: 1.25 },
  XLP:  { trailingPE: 26.21, dividendYield: 0.0207, totalAssets: 15480581120, beta3Year: 0.66 },
  XLI:  { trailingPE: 31.09, dividendYield: 0.0071, totalAssets: 28334837760, beta3Year: 1.24 },
  XLB:  { trailingPE: 27.13, dividendYield: 0.0268, totalAssets: 6540082688,  beta3Year: 1.09 },
  XLRE: { trailingPE: 33.48, dividendYield: 0.0350, totalAssets: 7306239488,  beta3Year: 1.09 },
  XLU:  { trailingPE: 22.66, dividendYield: 0.0423, totalAssets: 24418902016, beta3Year: 0.67 },
  XLC:  { trailingPE: 18.71, dividendYield: 0.0080, totalAssets: 24108154880, beta3Year: 0.92 },
};

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

// Acquire Yahoo Finance crumb: fetch homepage cookie then getcrumb endpoint.
// Crumb persists ~24h; stored in Redis to avoid per-request overhead.
async function getYahooCrumb(redis: Redis | null): Promise<{ crumb: string; cookie: string } | null> {
  // 1. Try cached crumb
  if (redis) {
    try {
      const cached = await redis.get<{ crumb: string; cookie: string }>(CRUMB_KEY);
      if (cached?.crumb) return cached;
    } catch { /* non-fatal */ }
  }

  // 2. Acquire fresh crumb
  try {
    // Step A: get session cookie from Yahoo Finance
    const homeRes = await fetch('https://finance.yahoo.com/', {
      headers: { 'User-Agent': YF_UA, 'Accept': 'text/html' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!homeRes.ok) return null;

    const rawCookies = homeRes.headers.getSetCookie?.() ?? [];
    const cookie = rawCookies
      .map(c => c.split(';')[0])
      .filter(c => c.startsWith('A1=') || c.startsWith('A3=') || c.startsWith('A1S='))
      .join('; ');
    if (!cookie) return null;

    // Step B: get crumb using the session cookie
    const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': YF_UA, 'Cookie': cookie },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!crumbRes.ok) return null;
    const crumb = (await crumbRes.text()).trim();
    if (!crumb || crumb.startsWith('{')) return null;

    const result = { crumb, cookie };
    if (redis) {
      await loggedRedisSet(redis, 'api.sector-pe', CRUMB_KEY, result, { ex: CRUMB_TTL });
    }
    return result;
  } catch (e) {
    logger.warn('api.sector-pe', 'crumb_acquire_failed', { error: String(e) });
    return null;
  }
}

// Fetch P/E, dividend yield, totalAssets, beta via Yahoo Finance v10 quoteSummary.
async function fetchFundamentals(
  ticker: string,
  crumb: string,
  cookie: string,
): Promise<{ trailingPE: number | null; dividendYield: number | null; totalAssets: number | null; beta3Year: number | null }> {
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=summaryDetail,defaultKeyStatistics&crumb=${encodeURIComponent(crumb)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': YF_UA, 'Cookie': cookie },
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`quoteSummary HTTP ${res.status}`);
  const json = await res.json();
  const result = json?.quoteSummary?.result?.[0];
  if (!result) throw new Error('empty quoteSummary result');

  const sd = result.summaryDetail ?? {};
  const ks = result.defaultKeyStatistics ?? {};

  const rawGet = (obj: Record<string, unknown>, key: string): number | null => {
    const v = obj[key];
    if (v && typeof v === 'object' && 'raw' in (v as object)) {
      const raw = (v as { raw: unknown }).raw;
      return typeof raw === 'number' ? raw : null;
    }
    return null;
  };

  const trailingPE = rawGet(sd, 'trailingPE');
  // ETFs use trailingAnnualDividendYield (dividendYield is empty for ETFs)
  const dividendYield = rawGet(sd, 'trailingAnnualDividendYield');
  const totalAssets = rawGet(ks, 'totalAssets') ?? rawGet(sd, 'totalAssets');
  const beta3Year = rawGet(ks, 'beta3Year');

  return { trailingPE, dividendYield, totalAssets, beta3Year };
}

async function fetchSectorEntry(
  ticker: string,
  crumb: string | null,
  cookie: string | null,
): Promise<SectorPEEntry> {
  const staticFundamentals = STATIC_FUNDAMENTALS[ticker] ?? null;
  const base: SectorPEEntry = {
    ticker, name: SECTOR_ETFS[ticker] ?? ticker,
    trailingPE: staticFundamentals?.trailingPE ?? null,
    dividendYield: staticFundamentals?.dividendYield ?? null,
    ytdReturn: null, totalAssets: staticFundamentals?.totalAssets ?? null,
    beta3Year: staticFundamentals?.beta3Year ?? null,
    price: null, changePct: null, high52: null, low52: null,
  };

  try {
    const [chartRes, fundRes] = await Promise.allSettled([
      // Price / YTD data
      fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=ytd`, {
        headers: { 'User-Agent': YF_UA },
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      }),
      // Fundamental data (P/E, dividends) — only attempt if crumb available
      crumb && cookie
        ? fetchFundamentals(ticker, crumb, cookie)
        : Promise.reject(new Error('no crumb')),
    ]);

    // Apply chart data
    if (chartRes.status === 'fulfilled' && chartRes.value.ok) {
      const json = await chartRes.value.json();
      const result = json?.chart?.result?.[0];
      if (result) {
        const meta = result.meta ?? {};
        const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];
        const validCloses = closes.filter(Boolean);

        const firstClose = validCloses[0] ?? null;
        const lastClose = validCloses[validCloses.length - 1] ?? null;
        const ytdReturn = firstClose && lastClose && firstClose > 0
          ? (lastClose - firstClose) / firstClose : null;

        const price = (meta.regularMarketPrice as number | undefined) ?? lastClose ?? null;
        const prevDayClose = validCloses.length >= 2 ? validCloses[validCloses.length - 2] : null;
        const changePct = price != null && prevDayClose && prevDayClose > 0
          ? ((price - prevDayClose) / prevDayClose) * 100 : null;

        base.price = price;
        base.changePct = changePct != null ? parseFloat(changePct.toFixed(2)) : null;
        base.ytdReturn = ytdReturn;
        base.high52 = (meta.fiftyTwoWeekHigh as number | undefined) ?? null;
        base.low52 = (meta.fiftyTwoWeekLow as number | undefined) ?? null;
      }
    }

    // Apply dynamic fundamentals (override static fallback if fetch succeeded)
    if (fundRes.status === 'fulfilled') {
      const f = fundRes.value;
      if (f.trailingPE != null) base.trailingPE = parseFloat(f.trailingPE.toFixed(2));
      if (f.dividendYield != null) base.dividendYield = f.dividendYield;
      if (f.totalAssets != null) base.totalAssets = f.totalAssets;
      if (f.beta3Year != null) base.beta3Year = f.beta3Year;
    } else {
      logger.warn('api.sector-pe', 'fundamentals_fallback', { ticker, reason: String((fundRes as PromiseRejectedResult).reason) });
    }
  } catch (err) {
    logger.warn('api.sector-pe', 'fetch_error', { ticker, error: err });
  }

  return base;
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

  // Acquire crumb once for all 11 tickers
  const crumbResult = await getYahooCrumb(redis);
  const crumb = crumbResult?.crumb ?? null;
  const cookie = crumbResult?.cookie ?? null;
  logger.info('api.sector-pe', 'crumb_status', { hascrumb: crumb != null });

  const tickers = Object.keys(SECTOR_ETFS);
  const results = await Promise.allSettled(tickers.map(t => fetchSectorEntry(t, crumb, cookie)));
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
