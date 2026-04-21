import { logger, loggedRedisSet } from '@/lib/logger';
/**
 * /api/short-interest
 *
 * Fetches short interest data from Yahoo Finance for all tracked tickers.
 * Combines with EDGAR 13F institutional action to compute a "squeeze score".
 *
 * Redis cache: 4 hours (FINRA/YF data updates twice daily)
 */
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { fetchBatchShortData } from '@/lib/yahoo-finance';
import { institutionalSignals } from '@/data/institutional-signals';
import { createMemoryCache } from '@/lib/memory-cache';

const CACHE_KEY = 'flowvium:short-interest:v1';
const CACHE_TTL = 4 * 60 * 60; // 4 hours
// Redis-less fallback — 30min TTL (short-interest changes twice daily but we
// don't want stale data locked in for 4h on warm instances).
const MEMORY_CACHE = createMemoryCache<unknown[]>('short-interest', 30 * 60_000);
const MEM_KEY = 'entries';

// Tracked tickers — ordered by interest (mid/small caps first)
const TRACKED_TICKERS = [
  'NVDA', 'TSM', 'ASML', 'MU', 'AMAT', 'LRCX', 'KLAC', 'SMCI', 'MRVL',
  'TSLA', 'ALB', 'COIN', 'MRNA', 'REGN', 'LLY',
  'KTOS', 'RTX', 'NOC', 'LHX', 'LMT',
  'FCX', 'DELL', 'ORCL', 'MSFT', 'GOOGL', 'AAPL', 'AMZN', 'META', 'NVDA',
];

export interface ShortEntry {
  ticker: string;
  companyName: string;
  sector: string;
  shortFloatPct: number | null;
  shortRatio: number | null;
  shortChangeMonthly: number | null; // MoM % change in shares short
  instAction: string | null;        // 'accumulating' | 'reducing' | 'new_position' | 'exit' | null
  squeezeScore: number;             // 0–100
}

/** Compute short squeeze score */
function calcSqueezeScore(
  shortFloatPct: number | null,
  shortRatio: number | null,
  shortChangeMoM: number | null,
  instAction: string | null,
): number {
  let score = 0;

  // High short float = more fuel for a squeeze
  if (shortFloatPct != null) {
    if (shortFloatPct > 30) score += 40;
    else if (shortFloatPct > 20) score += 30;
    else if (shortFloatPct > 10) score += 20;
    else if (shortFloatPct > 5) score += 10;
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
        return NextResponse.json({ entries: cached, cached: true });
      }
    } catch (err) { logger.warn('api.short-interest', 'cache_read_error', { error: err }); }
  } else if (!redis && !forceRefresh) {
    const mem = MEMORY_CACHE.get(MEM_KEY);
    if (mem && Array.isArray(mem) && mem.length > 0) {
      return NextResponse.json({ entries: mem, cached: true, cacheLayer: 'memory' });
    }
  }

  // Deduplicate tickers
  const tickers = Array.from(new Set(TRACKED_TICKERS));

  // Fetch short data from Yahoo Finance
  const shortData = await fetchBatchShortData(tickers, 150);
  const shortMap = new Map(shortData.map(d => [d.ticker, d]));

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
    const short = shortMap.get(ticker);
    const instAction = instActionMap.get(ticker) ?? null;
    const sector = instSectorMap.get(ticker) ?? 'other';
    const companyName = instNameMap.get(ticker) ?? ticker;

    return {
      ticker,
      companyName,
      sector,
      shortFloatPct: short?.shortFloatPct ?? null,
      shortRatio: short?.shortRatio ?? null,
      shortChangeMonthly: short?.shortChangeMonthly ?? null,
      instAction,
      squeezeScore: calcSqueezeScore(
        short?.shortFloatPct ?? null,
        short?.shortRatio ?? null,
        short?.shortChangeMonthly ?? null,
        instAction,
      ),
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

  return NextResponse.json({ entries, cached: false });
}
