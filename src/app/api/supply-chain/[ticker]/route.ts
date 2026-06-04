/**
 * /api/supply-chain/[ticker] — 동적 grounded 공급망 (SEC 10-K 추출, 인용 검증).
 *   US 티커만 (KR 은 후속 DART 단계). Redis 30d 캐시 (관계는 연 단위로만 변함).
 */
import { NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import { loggedRedisSet, logger } from '@/lib/logger';
import { extractSupplyChainUS } from '@/lib/supply-chain-extract';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;
const CACHE_TTL = 30 * 24 * 3600; // 30d
const CDN = { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600' };

export async function GET(req: Request, { params }: { params: { ticker: string } }) {
  const ticker = (params.ticker || '').trim().toUpperCase();
  if (!ticker || /\.(KS|KQ)$/i.test(ticker) || /^\d{6}$/.test(ticker)) {
    return NextResponse.json({ ticker, relationships: [], source: 'none', note: 'US tickers only (KR: DART 후속)' }, { headers: CDN });
  }
  const redis = createRedis();
  const key = `flowvium:supply-chain:v1:${ticker}`;
  if (redis) {
    try {
      const cached = await redis.get(key);
      if (cached) return NextResponse.json({ ...(cached as object), cached: true }, { headers: CDN });
    } catch { /* non-fatal */ }
  }
  const result = await extractSupplyChainUS(ticker);
  // 관계 0건이어도 캐시(반복 LLM 비용 방지) — 단 추출 자체 에러('none'+error)는 짧게.
  if (redis && result.source !== 'none') {
    try { await loggedRedisSet(redis, 'api.supply-chain', key, result, { ex: CACHE_TTL }); } catch { /* */ }
  }
  logger.info('api.supply-chain', 'served', { ticker, count: result.relationships.length, source: result.source });
  return NextResponse.json({ ...result, cached: false }, { headers: CDN });
}
