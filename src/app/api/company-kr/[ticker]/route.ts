/**
 * GET /api/company-kr/[ticker]
 *
 * 한국 주식 DART 재무제표 엔드포인트.
 * ticker = 6자리 종목코드 (예: 005930) 또는 Yahoo Finance 형식 (005930.KS)
 *
 * Redis 캐시 24h. 환경변수: DART_API_KEY, UPSTASH_REDIS_REST_URL/TOKEN
 */
import { NextRequest, NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import { loggedRedisSet, logger } from '@/lib/logger';
import { fetchDartFinancials } from '@/lib/dart-financials';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CDN_HEADERS = {
  'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600',
};

export async function GET(
  _req: NextRequest,
  { params }: { params: { ticker: string } }
) {
  // 종목코드 정규화: "005930.KS" → "005930"
  const stockCode = params.ticker.replace(/\.(KS|KQ)$/i, '').trim();

  if (!/^\d{6}$/.test(stockCode)) {
    return NextResponse.json(
      { error: 'invalid_ticker', message: '6자리 숫자 종목코드가 필요합니다', ticker: params.ticker },
      { status: 400 }
    );
  }

  if (!process.env.DART_API_KEY) {
    logger.error('dart.api', 'missing_key', 'DART_API_KEY 환경변수 미설정');
    return NextResponse.json({ error: 'config_error', message: 'DART API key not configured' }, { status: 500 });
  }

  const redis = createRedis();

  try {
    const data = await fetchDartFinancials(stockCode, redis);

    if (!data) {
      return NextResponse.json(
        { error: 'not_found', message: 'DART에서 재무 데이터를 찾을 수 없습니다', stockCode },
        { status: 404 }
      );
    }

    // fetchDartFinancials 내부에서 Redis 캐싱 처리됨 (24h)
    // cached=true면 이미 Redis에 있으므로 재저장 불필요
    if (!data.cached && redis) {
      await loggedRedisSet(
        redis,
        'api.company-kr',
        `flowvium:dart:financials:v2:${stockCode}`,
        data,
        { ex: 24 * 3600 }
      );
    }

    return NextResponse.json(data, { headers: CDN_HEADERS });
  } catch (err) {
    logger.error('dart.api', 'fetch_error', { stockCode, error: err });
    return NextResponse.json(
      { error: 'fetch_failed', message: 'DART API 요청 실패', stockCode },
      { status: 500 }
    );
  }
}
