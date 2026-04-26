import { logger, loggedRedisSet } from '@/lib/logger';
/**
 * /api/short-interest
 *
 * Returns tracked tickers with EDGAR 13F institutional action, FINRA daily short
 * volume ratio (free, no auth), Yahoo v10 short float %, and squeeze score.
 *
 * shortVolPct = FINRA daily ShortVolume / TotalVolume × 100
 * shortFloatPct = Yahoo v10 defaultKeyStatistics.shortPercentOfFloat (crumb auth,
 *   same key as sector-pe — confirmed working from Vercel IPs as of iter186)
 *
 * Redis cache: 4 hours
 */
import { NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import type { Redis } from '@upstash/redis';
import { institutionalSignals } from '@/data/institutional-signals';
import { createMemoryCache } from '@/lib/memory-cache';
export const dynamic = 'force-dynamic';

export const maxDuration = 60;

const CACHE_KEY = 'flowvium:short-interest:v5';
const CACHE_TTL = 4 * 60 * 60; // 4 hours
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=14400, stale-while-revalidate=600' };
// Redis-less fallback — 30min TTL (short-interest changes twice daily but we
// don't want stale data locked in for 4h on warm instances).
const MEMORY_CACHE = createMemoryCache<unknown[]>('short-interest', 30 * 60_000);
const MEM_KEY = 'entries';

// Yahoo crumb — shared with sector-pe (same CRUMB_KEY)
const CRUMB_KEY = 'flowvium:yahoo:crumb:v1';
const CRUMB_TTL = 22 * 60 * 60; // match sector-pe — crumbs last ~24h
const YF_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

async function getYahooCrumb(redis: Redis | null): Promise<{ crumb: string; cookie: string } | null> {
  if (redis) {
    try {
      const cached = await redis.get<{ crumb: string; cookie: string }>(CRUMB_KEY);
      if (cached?.crumb) return cached;
    } catch { /* non-fatal */ }
  }
  try {
    const homeRes = await fetch('https://finance.yahoo.com/', {
      headers: { 'User-Agent': YF_UA, 'Accept': 'text/html' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!homeRes.ok) return null;
    // Use getSetCookie() (same as sector-pe) to correctly parse multiple Set-Cookie headers.
    // headers.get('set-cookie') returns a comma-concatenated string of full Set-Cookie values
    // (including Path=, Domain=, etc.) which is invalid as a Cookie request header.
    const rawCookies = homeRes.headers.getSetCookie?.() ?? [];
    const cookie = rawCookies
      .map(c => c.split(';')[0])
      .filter(c => c.startsWith('A1=') || c.startsWith('A3=') || c.startsWith('A1S='))
      .join('; ');
    if (!cookie) return null;
    const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': YF_UA, 'Cookie': cookie },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!crumbRes.ok) return null;
    const crumb = (await crumbRes.text()).trim();
    if (!crumb || crumb.startsWith('{')) return null;
    const result = { crumb, cookie };
    await loggedRedisSet(redis, 'api.short-interest', CRUMB_KEY, result, { ex: CRUMB_TTL });
    return result;
  } catch (e) {
    logger.warn('api.short-interest', 'crumb_failed', { error: String(e) });
    return null;
  }
}

/** Fetch shortPercentOfFloat + shortRatio from Yahoo v10 defaultKeyStatistics.
 *  Both fields live in the same module — no extra request cost. */
async function fetchYahooShortData(
  tickers: string[],
  crumb: string,
  cookie: string,
): Promise<{ floatMap: Map<string, number>; ratioMap: Map<string, number> }> {
  const floatMap = new Map<string, number>();
  const ratioMap = new Map<string, number>();
  const CONCURRENT = 6;

  function rawVal(field: unknown): number | null {
    if (field && typeof field === 'object' && 'raw' in (field as object)) {
      const v = (field as { raw: unknown }).raw;
      return typeof v === 'number' ? v : null;
    }
    return typeof field === 'number' ? field : null;
  }

  for (let i = 0; i < tickers.length; i += CONCURRENT) {
    const batch = tickers.slice(i, i + CONCURRENT);
    const settled = await Promise.allSettled(
      batch.map(async ticker => {
        const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=defaultKeyStatistics&crumb=${encodeURIComponent(crumb)}`;
        const res = await fetch(url, {
          headers: { 'User-Agent': YF_UA, 'Cookie': cookie },
          cache: 'no-store',
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return null;
        const json = await res.json();
        const ks = json?.quoteSummary?.result?.[0]?.defaultKeyStatistics ?? {};
        const floatRaw = rawVal(ks?.shortPercentOfFloat);
        const ratioRaw = rawVal(ks?.shortRatio);
        return {
          ticker,
          pct: floatRaw !== null ? parseFloat((floatRaw * 100).toFixed(1)) : null,
          ratio: ratioRaw !== null ? parseFloat(ratioRaw.toFixed(2)) : null,
        };
      })
    );
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) {
        const { ticker, pct, ratio } = r.value;
        if (pct !== null) floatMap.set(ticker, pct);
        if (ratio !== null) ratioMap.set(ticker, ratio);
      }
    }
    if (i + CONCURRENT < tickers.length) await new Promise(res => setTimeout(res, 150));
  }
  logger.info('api.short-interest', 'yahoo_short_data_ok', { floatFetched: floatMap.size, ratioFetched: ratioMap.size, of: tickers.length });
  return { floatMap, ratioMap };
}

// Tracked tickers — ordered by interest
const TRACKED_TICKERS = [
  // Semiconductors
  'NVDA', 'AMD', 'ARM', 'TSM', 'ASML', 'MU', 'AMAT', 'LRCX', 'KLAC', 'SMCI', 'MRVL',
  // EV & Battery
  'TSLA', 'ALB', 'RIVN',
  // Crypto
  'COIN', 'MSTR',
  // Pharma/Biotech
  'MRNA', 'REGN', 'LLY',
  // Defense & AI
  'KTOS', 'PLTR', 'RTX', 'NOC', 'LHX', 'LMT',
  // Commodities
  'FCX',
  // Tech platforms
  'DELL', 'ORCL', 'MSFT', 'GOOGL', 'AAPL', 'AMZN', 'META',
];

export interface ShortEntry {
  ticker: string;
  companyName: string;
  sector: string;
  shortFloatPct: number | null;      // Yahoo v10 defaultKeyStatistics.shortPercentOfFloat (live)
  shortVolPct: number | null;        // FINRA daily: ShortVolume / TotalVolume × 100
  shortRatio: number | null;         // DaysToCover from FINRA monthly short interest file
  shortChangeMonthly: number | null;
  instAction: string | null;
  trailingPE: number | null;         // Finnhub peBasicExclExtraTTM (TTM P/E)
  squeezeScore: number;
}

/** Compute short squeeze score.
 * shortFloatPct: Yahoo v10 defaultKeyStatistics (up to 40pts — iter186 fix)
 * shortRatio (DTC): Yahoo v10 defaultKeyStatistics.shortRatio (same crumb request as shortFloatPct)
 * shortChangeMoM: always null (requires bi-monthly FINRA + float data)
 */
function calcSqueezeScore(
  shortFloatPct: number | null,
  shortVolPct: number | null,
  instAction: string | null,
): number {
  let score = 0;

  if (shortFloatPct != null) {
    if (shortFloatPct > 30) score += 40;
    else if (shortFloatPct > 20) score += 30;
    else if (shortFloatPct > 10) score += 20;
    else if (shortFloatPct > 5) score += 10;
  }

  // Normal range 40-55%; > 60% indicates unusual short-side pressure
  if (shortVolPct != null) {
    if (shortVolPct > 60) score += 25;
    else if (shortVolPct > 55) score += 15;
    else if (shortVolPct > 50) score += 8;
    else if (shortVolPct > 45) score += 3;
  }

  if (instAction === 'accumulating') score += 20;
  if (instAction === 'new_position') score += 15;

  return Math.min(100, score);
}

/** Fetch FINRA consolidated short volume for given tickers (previous trading day) */
async function fetchFinraShortVol(tickers: Set<string>): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const now = new Date();

  for (let daysBack = 1; daysBack <= 5; daysBack++) {
    const d = new Date(now);
    d.setDate(d.getDate() - daysBack);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue; // skip weekends

    const yyyymmdd = d.toISOString().slice(0, 10).replace(/-/g, '');
    const url = `https://cdn.finra.org/equity/regsho/daily/CNMSshvol${yyyymmdd}.txt`;

    try {
      const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;

      const text = await res.text();
      for (const line of text.split('\n')) {
        const parts = line.split('|');
        if (parts.length < 5) continue;
        const sym = parts[1];
        if (!tickers.has(sym)) continue;
        const shortVol = parseFloat(parts[2]);
        const totalVol = parseFloat(parts[4]);
        if (!isNaN(shortVol) && !isNaN(totalVol) && totalVol > 0) {
          map.set(sym, parseFloat(((shortVol / totalVol) * 100).toFixed(1)));
        }
      }
      if (map.size > 0) {
        logger.info('api.short-interest', 'finra_ok', { date: yyyymmdd, matched: map.size, of: tickers.size });
        break;
      }
    } catch (e) {
      logger.warn('api.short-interest', 'finra_fetch_error', { daysBack, error: e });
    }
  }
  return map;
}

/** Fetch trailing P/E from Finnhub metric endpoint (one request per ticker) */
async function fetchFinnhubPE(tickers: string[]): Promise<Map<string, number>> {
  const key = process.env.FINNHUB_KEY?.trim();
  if (!key) return new Map();

  const map = new Map<string, number>();
  const results = await Promise.allSettled(
    tickers.map(ticker =>
      fetch(
        `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(ticker)}&metric=all&token=${encodeURIComponent(key)}`,
        { cache: 'no-store', signal: AbortSignal.timeout(8000) }
      )
        .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
        .then((data: { metric?: Record<string, number | null> }) => ({
          ticker,
          pe: data?.metric?.peBasicExclExtraTTM ?? data?.metric?.peNormalizedAnnual ?? null,
        }))
    )
  );

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.pe != null && typeof r.value.pe === 'number' && r.value.pe > 0 && r.value.pe < 10000) {
      map.set(r.value.ticker, parseFloat(r.value.pe.toFixed(1)));
    }
  }

  logger.info('api.short-interest', 'finnhub_pe_ok', { fetched: map.size, of: tickers.length });
  return map;
}

export async function GET(req: Request) {
  const reqStart = Date.now();
  const redis = createRedis();
  const forceRefresh = new URL(req.url).searchParams.get('refresh') === '1';

  // Try cache
  if (redis && !forceRefresh) {
    try {
      const cached = await redis.get(CACHE_KEY);
      if (cached) {
        logger.info('api.short-interest', 'cache_hit', { cachedEntries: Array.isArray(cached) ? cached.length : -1 });
        return NextResponse.json({ entries: cached, cached: true }, { headers: CDN_HEADERS });
      }
    } catch (err) { logger.warn('api.short-interest', 'cache_read_error', { error: err }); }
  } else if (!redis && !forceRefresh) {
    const mem = MEMORY_CACHE.get(MEM_KEY);
    if (mem && Array.isArray(mem) && mem.length > 0) {
      return NextResponse.json({ entries: mem, cached: true, cacheLayer: 'memory' }, { headers: CDN_HEADERS });
    }
  }

  // Deduplicate tickers
  const tickers = Array.from(new Set(TRACKED_TICKERS));
  const tickerSet = new Set(tickers);

  // Fetch FINRA short vol, Finnhub P/E, 13f-signals, and Yahoo shortFloat in parallel.
  // Yahoo path: crumb (shared with sector-pe) → v10 quoteSummary per ticker.
  // DTC (FINRA monthly): cdn.finra.org 403 from Vercel IPs; no free alternative — iter86
  const [finraMap, peMap, redisSignals, shortDataResult] = await Promise.allSettled([
    fetchFinraShortVol(tickerSet),
    fetchFinnhubPE(tickers),
    redis ? redis.get<typeof institutionalSignals>('flowvium:13f-signals:v1') : Promise.resolve(null),
    getYahooCrumb(redis).then(c =>
      c ? fetchYahooShortData(tickers, c.crumb, c.cookie)
        : { floatMap: new Map<string, number>(), ratioMap: new Map<string, number>() }
    ),
  ]);
  const shortVolMap = finraMap.status === 'fulfilled' ? finraMap.value : new Map<string, number>();
  const trailingPEMap = peMap.status === 'fulfilled' ? peMap.value : new Map<string, number>();
  const liveRaw = redisSignals.status === 'fulfilled' ? redisSignals.value : null;
  const shortFloatMap = shortDataResult.status === 'fulfilled' ? shortDataResult.value.floatMap : new Map<string, number>();
  const shortRatioMap = shortDataResult.status === 'fulfilled' ? shortDataResult.value.ratioMap : new Map<string, number>();
  const liveSignals = (Array.isArray(liveRaw) && liveRaw.length > 0)
    ? liveRaw as typeof institutionalSignals
    : institutionalSignals;

  // Latest action per ticker (most recent filing date) — O(n) single pass
  const instActionMap = new Map<string, string>();
  const instSectorMap = new Map<string, string>();
  const instNameMap = new Map<string, string>();
  const instFilingDateMap = new Map<string, string>();

  for (const sig of liveSignals) {
    const existingDate = instFilingDateMap.get(sig.ticker) ?? '';
    if (sig.filingDate > existingDate) {
      instActionMap.set(sig.ticker, sig.action);
      instSectorMap.set(sig.ticker, sig.sector);
      instNameMap.set(sig.ticker, sig.companyName);
      instFilingDateMap.set(sig.ticker, sig.filingDate);
    }
  }

  const entries: ShortEntry[] = tickers.map(ticker => {
    const instAction = instActionMap.get(ticker) ?? null;
    const sector = instSectorMap.get(ticker) ?? 'other';
    const companyName = instNameMap.get(ticker) ?? ticker;

    const shortVolPct = shortVolMap.get(ticker) ?? null;
    const shortFloatPct = shortFloatMap.get(ticker) ?? null;
    const shortRatio = shortRatioMap.get(ticker) ?? null;
    const trailingPE = trailingPEMap.get(ticker) ?? null;
    return {
      ticker,
      companyName,
      sector,
      shortFloatPct,
      shortVolPct,
      shortRatio,
      shortChangeMonthly: null,
      instAction,
      trailingPE,
      squeezeScore: calcSqueezeScore(shortFloatPct, shortVolPct, instAction),
    };
  });

  // Sort: highest squeeze score first
  entries.sort((a, b) => b.squeezeScore - a.squeezeScore);

  await loggedRedisSet(redis, 'api.short-interest', CACHE_KEY, entries, { ex: CACHE_TTL });
  if (!redis && entries.length > 0) MEMORY_CACHE.set(MEM_KEY, entries);
  logger.info('api.short-interest', 'served', {
    tickers: tickers.length,
    entries: entries.length,
    topScore: entries[0]?.squeezeScore ?? 0,
    durationMs: Date.now() - reqStart,
  });

  return NextResponse.json({ entries, cached: false }, { headers: CDN_HEADERS });
}
