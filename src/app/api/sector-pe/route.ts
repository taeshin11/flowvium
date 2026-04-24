import { logger, loggedRedisSet } from '@/lib/logger';
/**
 * /api/sector-pe
 *
 * Returns trailing P/E, dividend yield, and YTD return for 11 SPDR sector ETFs.
 * Data: Yahoo Finance v10 quoteSummary (summaryDetail + defaultKeyStatistics), crumb-authenticated.
 * Redis cache: 24h.
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
  dividendYield: number | null;  // 0-1 fraction
  ytdReturn: number | null;      // 0-1 fraction
  totalAssets: number | null;    // USD
  beta3Year: number | null;
}

export interface SectorPEPayload {
  sectors: SectorPEEntry[];
  updatedAt: string;
  cached?: boolean;
}

const CACHE_KEY = 'flowvium:sector-pe:v1';
const CACHE_TTL = 24 * 60 * 60;

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
};

interface YFCreds { cookie: string; crumb: string; fetchedAt: number; }
let yfCreds: YFCreds | null = null;
const CRUMB_TTL_MS = 55 * 60 * 1000;

function parseCookies(res: Response): string {
  const raw = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.()
    ?? res.headers.get('set-cookie')?.split(/,(?=\s*[A-Za-z0-9_-]+=)/)
    ?? [];
  return raw.map(l => l.split(';')[0]?.trim()).filter(Boolean).join('; ');
}

async function getCreds(force = false): Promise<YFCreds | null> {
  if (!force && yfCreds && Date.now() - yfCreds.fetchedAt < CRUMB_TTL_MS) return yfCreds;
  try {
    const seed = await fetch('https://fc.yahoo.com', { headers: YF_HEADERS, redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(8000) });
    const cookie = parseCookies(seed);
    if (!cookie) return null;
    const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { ...YF_HEADERS, Cookie: cookie }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!crumbRes.ok) return null;
    const crumb = (await crumbRes.text()).trim();
    if (!crumb || crumb.length > 64 || crumb.includes('<')) return null;
    yfCreds = { cookie, crumb, fetchedAt: Date.now() };
    return yfCreds;
  } catch { return null; }
}

async function fetchSectorData(ticker: string, creds: YFCreds): Promise<SectorPEEntry | null> {
  const crumbEnc = encodeURIComponent(creds.crumb);
  try {
    const [sumRes, statsRes] = await Promise.allSettled([
      fetch(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=summaryDetail&crumb=${crumbEnc}`, { headers: { ...YF_HEADERS, Cookie: creds.cookie }, cache: 'no-store', signal: AbortSignal.timeout(10000) }),
      fetch(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=defaultKeyStatistics&crumb=${crumbEnc}`, { headers: { ...YF_HEADERS, Cookie: creds.cookie }, cache: 'no-store', signal: AbortSignal.timeout(10000) }),
    ]);

    let trailingPE: number | null = null;
    if (sumRes.status === 'fulfilled' && sumRes.value.ok) {
      const j = await sumRes.value.json();
      const sd = j?.quoteSummary?.result?.[0]?.summaryDetail;
      trailingPE = sd?.trailingPE?.raw ?? null;
    }

    let dividendYield: number | null = null;
    let ytdReturn: number | null = null;
    let totalAssets: number | null = null;
    let beta3Year: number | null = null;
    if (statsRes.status === 'fulfilled' && statsRes.value.ok) {
      const j = await statsRes.value.json();
      const ks = j?.quoteSummary?.result?.[0]?.defaultKeyStatistics;
      dividendYield = ks?.yield?.raw ?? null;
      ytdReturn = ks?.ytdReturn?.raw ?? null;
      totalAssets = ks?.totalAssets?.raw ?? null;
      beta3Year = ks?.beta3Year?.raw ?? null;
    }

    return { ticker, name: SECTOR_ETFS[ticker] ?? ticker, trailingPE, dividendYield, ytdReturn, totalAssets, beta3Year };
  } catch { return null; }
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
        return NextResponse.json({ ...cached, cached: true });
      }
    } catch (err) { logger.warn('api.sector-pe', 'cache_read_error', { error: err }); }
  }

  const creds = await getCreds();
  if (!creds) {
    logger.warn('api.sector-pe', 'no_creds');
    return NextResponse.json({ error: 'auth_failed' }, { status: 502 });
  }

  const tickers = Object.keys(SECTOR_ETFS);
  const results = await Promise.allSettled(tickers.map(t => fetchSectorData(t, creds)));
  const sectors: SectorPEEntry[] = results
    .filter((r): r is PromiseFulfilledResult<SectorPEEntry> => r.status === 'fulfilled' && r.value != null)
    .map(r => r.value);

  const payload: SectorPEPayload = { sectors, updatedAt: new Date().toISOString() };
  await loggedRedisSet(redis, 'api.sector-pe', CACHE_KEY, payload, { ex: CACHE_TTL });

  logger.info('api.sector-pe', 'served', { count: sectors.length, durationMs: Date.now() - reqStart });
  return NextResponse.json({ ...payload, cached: false });
}
