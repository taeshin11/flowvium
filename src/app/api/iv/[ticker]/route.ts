/**
 * /api/iv/[ticker]
 *
 * 종목별 옵션 내재변동성 (IV) 요약. Bloomberg-style 계산:
 *   1. Yahoo v7/finance/options 풀 체인 fetch (크럼 인증 — sector-pe 공유 키)
 *   2. 콜-풋 패리티로 expiry 별 forward + implied rate 추출 (r, q 가정 X)
 *   3. Brent 로 Black-76 IV 역산 + stale/noisy 필터
 *   4. 30d/90d ATM IV (variance-space 시간가중 보간) + 25Δ skew + term slope
 *
 * 응답 필드:
 *   - atmIv30d / atmIv90d : 소수 (0.30 = 30%)
 *   - termSlope          : (90d - 30d) — 양수 contango, 음수 backwardation
 *   - skew25d            : σ(25Δ put) - σ(25Δ call) — 양수 = downside fear
 *   - qualityScore       : 0-100 (체인 데이터 품질)
 *   - source             : 'live' | 'cached' | 'error'  (정적 폴백 절대 사용 안 함)
 *
 * Redis 캐시: 4h (장중 5-10% 변동, 하지만 cron 빈도 고려해 적절선).
 * Yahoo 차단 시 stale 캐시 또는 error 응답 — 정적 IV 절대 금지.
 */
import { NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import { loggedRedisSet, logger } from '@/lib/logger';
import { fetchYahooOptionChain } from '@/lib/options/yahoo-chain';
import { summarizeIv, type IvSummary } from '@/lib/options/iv-summary';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const CACHE_TTL = 4 * 60 * 60; // 4h
const STALE_TTL = 24 * 60 * 60; // 24h stale
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=14400, stale-while-revalidate=600' };
const SOURCE = 'api.iv';

type IvResponse = Omit<IvSummary, 'source'> & {
  source: 'live' | 'cached' | 'error';
  cached?: boolean;
  stale?: boolean;
};

export async function GET(req: Request, { params }: { params: { ticker: string } }) {
  const ticker = params.ticker.toUpperCase();
  if (!/^[A-Z0-9.\-^]{1,10}$/.test(ticker)) {
    return NextResponse.json({ source: 'error', errorReason: 'invalid_ticker' }, { status: 400 });
  }
  const force = new URL(req.url).searchParams.get('refresh') === '1';
  const redis = createRedis();
  const cacheKey = `flowvium:iv:v1:${ticker}`;
  const staleKey = `flowvium:iv:v1:stale:${ticker}`;

  if (redis && !force) {
    try {
      const cached = await redis.get<IvSummary>(cacheKey);
      if (cached) {
        logger.info(SOURCE, 'cache_hit', { ticker });
        const resp: IvResponse = { ...cached, source: 'cached', cached: true };
        return NextResponse.json(resp, { headers: CDN_HEADERS });
      }
    } catch (err) {
      logger.warn(SOURCE, 'cache_read_error', { ticker, error: String(err) });
    }
  }

  const start = Date.now();
  const chain = await fetchYahooOptionChain(ticker);
  const summary = summarizeIv(chain);
  logger.info(SOURCE, 'computed', {
    ticker,
    durationMs: Date.now() - start,
    expiries: summary.expiriesUsed,
    contracts: summary.contractsUsed,
    quality: summary.qualityScore,
    atm30: summary.atmIv30d,
    source: summary.source,
  });

  if (summary.source === 'live' && summary.atmIv30d != null) {
    if (redis) {
      await loggedRedisSet(redis, SOURCE, cacheKey, summary, { ex: CACHE_TTL });
      await loggedRedisSet(redis, SOURCE, staleKey, summary, { ex: STALE_TTL });
    }
    const resp: IvResponse = { ...summary, source: 'live' };
    return NextResponse.json(resp, { headers: CDN_HEADERS });
  }

  // Live 실패 → stale 폴백 (정적 폴백 절대 사용 X — 시계열 시장 데이터)
  if (redis) {
    try {
      const stale = await redis.get<IvSummary>(staleKey);
      if (stale && stale.atmIv30d != null) {
        const resp: IvResponse = { ...stale, source: 'cached', cached: true, stale: true };
        return NextResponse.json(resp, { headers: CDN_HEADERS });
      }
    } catch { /* non-fatal */ }
  }

  const errResp: IvResponse = { ...summary, source: 'error' };
  return NextResponse.json(errResp, { status: 200, headers: CDN_HEADERS });
}
