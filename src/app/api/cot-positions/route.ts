/**
 * /api/cot-positions
 *
 * CFTC Commitments of Traders — 주간 비상업(투기) 순포지션. 2026-10-16: 공식 데이터 API(publicreporting.cftc.gov,
 * legacy futures-only 6dca-aqww)로 옮겼다. 종전 www.cftc.gov/dea/newcot/FinFutWk.txt 는 어떤 요청에도 403 이었고,
 * 그 파일은 TFF 형식이라 '비상업' 이라 부른 칸이 실제로는 딜러 포지션이었다. 변환은 src/lib/cot-cftc.ts(+test).
 * 화요일 기준 포지션을 금요일 공표. Redis cache: 4h
 */
import { NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import { logger, loggedRedisSet } from '@/lib/logger';
import { rowsToEntries, cotQueryUrl, type CotEntry } from '@/lib/cot-cftc';
export type { CotEntry };
export const dynamic = 'force-dynamic';

export const maxDuration = 30;

const CACHE_KEY = 'flowvium:cot-positions:v3';
const CACHE_TTL = 4 * 60 * 60;
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=14400, stale-while-revalidate=600' };

export async function GET(req: Request) {
  const t0 = Date.now();
  const redis = createRedis();
  const force = new URL(req.url).searchParams.get('refresh') === '1';

  if (redis && !force) {
    try {
      const cached = await redis.get(CACHE_KEY);
      if (cached) {
        logger.info('api.cot-positions', 'cache_hit');
        return NextResponse.json({ ...(cached as object), cached: true, source: 'cached' }, { headers: CDN_HEADERS });
      }
    } catch (err) { logger.warn('api.cot-positions', 'cache_read_error', { error: err }); }
  }

  try {
    const res = await fetch(cotQueryUrl(), {
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      logger.error('api.cot-positions', 'cftc_http_error', { status: res.status });
      return NextResponse.json({ entries: [], error: `CFTC HTTP ${res.status}`, cached: false, source: 'error' }, { status: 502 });
    }

    const rows = await res.json();
    const entries = rowsToEntries(Array.isArray(rows) ? rows : []);

    logger.info('api.cot-positions', 'parsed', { found: entries.length, durationMs: Date.now() - t0 });

    if (entries.length === 0) {
      // Don't cache empty parse results — prevents CDN from serving stale empty data
      logger.warn('api.cot-positions', 'parse_empty', { rows: Array.isArray(rows) ? rows.length : -1 });
      return NextResponse.json({ entries: [], error: 'parse yielded 0 entries', cached: false, source: 'empty' }, { status: 502 });
    }

    const reportDate = entries[0]?.reportDate ?? '';
    const payload = { entries, reportDate, count: entries.length, updatedAt: new Date().toISOString(), cached: false, source: 'live' as const };

    if (redis) {
      await loggedRedisSet(redis, 'api.cot-positions', CACHE_KEY, payload, { ex: CACHE_TTL });
    }
    return NextResponse.json(payload, { headers: CDN_HEADERS });
  } catch (err) {
    logger.error('api.cot-positions', 'fetch_failed', { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ entries: [], error: 'fetch failed', cached: false, source: 'error' }, { status: 502 });
  }
}
