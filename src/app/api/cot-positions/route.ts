/**
 * /api/cot-positions
 *
 * CFTC Commitments of Traders (COT) — weekly speculator net positioning.
 * Source: https://www.cftc.gov/dea/newcot/FinFutWk.txt
 *   Legacy Futures-Only format, published every Friday for positions as of the prior Tuesday.
 *
 * Key signal: Non-Commercial (speculator) net = Long − Short.
 * Positive net → speculators are net long (bullish bias).
 * Negative net → speculators are net short (bearish bias).
 *
 * Redis cache: 4h
 */
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { logger, loggedRedisSet } from '@/lib/logger';

export const maxDuration = 30;

const CACHE_KEY = 'flowvium:cot-positions:v1';
const CACHE_TTL = 4 * 60 * 60;
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=14400, stale-while-revalidate=600' };
const CFTC_URL = 'https://www.cftc.gov/dea/newcot/FinFutWk.txt';

export interface CotEntry {
  id: string;
  label: string;
  reportDate: string;
  openInterest: number;
  noncommLong: number;
  noncommShort: number;
  netPosition: number;    // noncommLong - noncommShort
  netPctOI: number;       // netPosition / openInterest * 100, rounded to 1dp
  sentiment: 'bullish' | 'bearish' | 'neutral';
}

// Markets to extract — search is case-insensitive partial match against market name field.
// Order matters: first match wins. For Nasdaq, prefer regular E-mini over Micro.
const TARGETS: { id: string; label: string; search: string; searchAlt?: string }[] = [
  { id: 'sp500',    label: 'E-mini S&P 500',   search: 'E-MINI S&P 500'    },
  { id: 'nasdaq',   label: 'Nasdaq-100',        search: 'E-MINI NASDAQ-100 - CHICAGO', searchAlt: 'NASDAQ-100' },
  { id: 'ust10y',   label: '10Y T-Note',        search: 'UST 10Y NOTE'      },
  { id: 'ust2y',    label: '2Y T-Note',         search: 'UST 2Y NOTE'       },
  { id: 'eurusd',   label: 'EUR/USD',           search: 'EURO FX'           },
  { id: 'jpyusd',   label: 'Japanese Yen',      search: 'JAPANESE YEN'      },
  { id: 'vix',      label: 'VIX',               search: 'VIX FUTURES'       },
];

function sentiment(netPctOI: number): CotEntry['sentiment'] {
  if (netPctOI > 15) return 'bullish';
  if (netPctOI < -15) return 'bearish';
  return 'neutral';
}

// Parse one CSV line from the CFTC file (first field may be quoted).
function parseLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      const end = line.indexOf('"', i + 1);
      fields.push(end === -1 ? '' : line.slice(i + 1, end).trim());
      i = end === -1 ? line.length : end + 1;
      if (i < line.length && line[i] === ',') i++;
    } else {
      const end = line.indexOf(',', i);
      if (end === -1) { fields.push(line.slice(i).trim()); break; }
      fields.push(line.slice(i, end).trim());
      i = end + 1;
    }
  }
  return fields;
}

function parseFile(text: string): CotEntry[] {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  // Map: id → first-matched entry
  const found = new Map<string, CotEntry>();

  for (const line of lines) {
    const f = parseLine(line);
    if (f.length < 10) continue;
    const name = f[0].toUpperCase();

    for (const tgt of TARGETS) {
      if (found.has(tgt.id)) continue;
      const primary = name.includes(tgt.search.toUpperCase());
      const alt = tgt.searchAlt ? name.includes(tgt.searchAlt.toUpperCase()) : false;
      if (!primary && !alt) continue;

      const oi = parseInt(f[7] ?? '0', 10);
      const ncLong = parseInt(f[8] ?? '0', 10);
      const ncShort = parseInt(f[9] ?? '0', 10);
      if (isNaN(oi) || isNaN(ncLong) || isNaN(ncShort) || oi <= 0) continue;

      const netPos = ncLong - ncShort;
      const netPct = parseFloat((netPos / oi * 100).toFixed(1));
      // reportDate: field[2] in YYYY-MM-DD format
      const reportDate = f[2] ?? '';

      found.set(tgt.id, {
        id: tgt.id,
        label: tgt.label,
        reportDate,
        openInterest: oi,
        noncommLong: ncLong,
        noncommShort: ncShort,
        netPosition: netPos,
        netPctOI: netPct,
        sentiment: sentiment(netPct),
      });
    }
    if (found.size === TARGETS.length) break;
  }

  // Return in TARGETS order, skip unfound
  return TARGETS.map(t => found.get(t.id)).filter((e): e is CotEntry => e != null);
}

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export async function GET(req: Request) {
  const t0 = Date.now();
  const redis = createRedis();
  const force = new URL(req.url).searchParams.get('refresh') === '1';

  if (redis && !force) {
    try {
      const cached = await redis.get(CACHE_KEY);
      if (cached) {
        logger.info('api.cot-positions', 'cache_hit');
        return NextResponse.json({ ...(cached as object), cached: true }, { headers: CDN_HEADERS });
      }
    } catch (err) { logger.warn('api.cot-positions', 'cache_read_error', { error: err }); }
  }

  try {
    const res = await fetch(CFTC_URL, {
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) {
      logger.error('api.cot-positions', 'cftc_http_error', { status: res.status });
      return NextResponse.json({ entries: [], error: `CFTC HTTP ${res.status}`, cached: false }, { status: 502 });
    }

    const text = await res.text();
    const entries = parseFile(text);

    logger.info('api.cot-positions', 'parsed', { found: entries.length, durationMs: Date.now() - t0 });

    const reportDate = entries[0]?.reportDate ?? '';
    const payload = { entries, reportDate, count: entries.length, updatedAt: new Date().toISOString(), cached: false };

    await loggedRedisSet(redis, 'api.cot-positions', CACHE_KEY, payload, { ex: CACHE_TTL });
    return NextResponse.json(payload, { headers: CDN_HEADERS });
  } catch (err) {
    logger.error('api.cot-positions', 'fetch_failed', { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ entries: [], error: 'fetch failed', cached: false }, { status: 502 });
  }
}
