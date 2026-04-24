import { logger, loggedRedisSet } from '@/lib/logger';
/**
 * /api/short-interest
 *
 * Returns tracked tickers with EDGAR 13F institutional action, FINRA daily short
 * volume ratio (free, no auth), and squeeze score.
 *
 * shortVolPct = FINRA daily ShortVolume / TotalVolume × 100 (not the same as
 * shortFloatPct which requires bi-monthly FINRA/SEC short interest reports + float
 * data — those still null since Yahoo v10 crumb fails from Vercel IPs).
 *
 * Redis cache: 4 hours
 */
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { institutionalSignals } from '@/data/institutional-signals';
import { createMemoryCache } from '@/lib/memory-cache';

export const maxDuration = 60;

const CACHE_KEY = 'flowvium:short-interest:v4';
const CACHE_TTL = 4 * 60 * 60; // 4 hours
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=14400, stale-while-revalidate=600' };
// Redis-less fallback — 30min TTL (short-interest changes twice daily but we
// don't want stale data locked in for 4h on warm instances).
const MEMORY_CACHE = createMemoryCache<unknown[]>('short-interest', 30 * 60_000);
const MEM_KEY = 'entries';

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
  shortFloatPct: number | null;      // null — Yahoo v10 crumb blocked from Vercel
  shortVolPct: number | null;        // FINRA daily: ShortVolume / TotalVolume × 100
  shortRatio: number | null;
  shortChangeMonthly: number | null;
  instAction: string | null;
  trailingPE: number | null;         // Finnhub peBasicExclExtraTTM (TTM P/E)
  squeezeScore: number;
}

/** Compute short squeeze score */
function calcSqueezeScore(
  shortFloatPct: number | null,
  shortVolPct: number | null,
  shortRatio: number | null,
  shortChangeMoM: number | null,
  instAction: string | null,
): number {
  let score = 0;

  // High short float % = most reliable squeeze fuel (bi-monthly FINRA data)
  if (shortFloatPct != null) {
    if (shortFloatPct > 30) score += 40;
    else if (shortFloatPct > 20) score += 30;
    else if (shortFloatPct > 10) score += 20;
    else if (shortFloatPct > 5) score += 10;
  }

  // Daily short volume ratio (FINRA) — noisier signal, lower weight
  // Normal range 40-55%; > 60% indicates unusual short-side pressure
  if (shortVolPct != null) {
    if (shortVolPct > 60) score += 25;
    else if (shortVolPct > 55) score += 15;
    else if (shortVolPct > 50) score += 8;
    else if (shortVolPct > 45) score += 3;
  }

  // High days-to-cover = shorts trapped longer
  if (shortRatio != null) {
    if (shortRatio > 10) score += 25;
    else if (shortRatio > 5) score += 15;
    else if (shortRatio > 2) score += 8;
  }

  // MoM short interest increasing = building pressure
  if (shortChangeMoM != null && shortChangeMoM > 10) score += 10;

  // Institutional accumulation = opposing force
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

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
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

  // Fetch FINRA short volume and Finnhub P/E in parallel
  const [finraMap, peMap] = await Promise.allSettled([
    fetchFinraShortVol(tickerSet),
    fetchFinnhubPE(tickers),
  ]);
  const shortVolMap = finraMap.status === 'fulfilled' ? finraMap.value : new Map<string, number>();
  const trailingPEMap = peMap.status === 'fulfilled' ? peMap.value : new Map<string, number>();

  // Build latest institutional action per ticker from static + EDGAR data
  let liveSignals = institutionalSignals;
  if (redis) {
    try {
      const live = await redis.get('flowvium:13f-signals:v1');
      if (Array.isArray(live) && live.length > 0) liveSignals = live as typeof institutionalSignals;
    } catch { /* use static */ }
  }

  // Latest action per ticker (most recent filing date)
  const instActionMap = new Map<string, string>();
  const instSectorMap = new Map<string, string>();
  const instNameMap = new Map<string, string>();

  for (const sig of liveSignals) {
    const existing = instActionMap.get(sig.ticker);
    if (!existing || sig.filingDate > (liveSignals.find(s => s.ticker === sig.ticker && s.action === existing)?.filingDate ?? '')) {
      instActionMap.set(sig.ticker, sig.action);
      instSectorMap.set(sig.ticker, sig.sector);
      instNameMap.set(sig.ticker, sig.companyName);
    }
  }

  const entries: ShortEntry[] = tickers.map(ticker => {
    const instAction = instActionMap.get(ticker) ?? null;
    const sector = instSectorMap.get(ticker) ?? 'other';
    const companyName = instNameMap.get(ticker) ?? ticker;

    const shortVolPct = shortVolMap.get(ticker) ?? null;
    const trailingPE = trailingPEMap.get(ticker) ?? null;
    return {
      ticker,
      companyName,
      sector,
      shortFloatPct: null,
      shortVolPct,
      shortRatio: null,
      shortChangeMonthly: null,
      instAction,
      trailingPE,
      squeezeScore: calcSqueezeScore(null, shortVolPct, null, null, instAction),
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
