/**
 * GET /api/insider-kr/[ticker]
 *
 * KR 임원·주요주주 지분공시 (DART elestock + majorstock) — US Form 4(/api/insider-trades)의 KR 대응.
 * ticker = 6자리 종목코드(005930) 또는 Yahoo 형식(005930.KS).
 *
 * 응답: { items, corpName, total, source, fetchedAt }
 *   source: dart-live | dart-stale | empty | not-applicable(ETF 등 DART 미제출) | (error 시 502)
 * Redis 캐시 12h(lib 내부). 환경변수: DART_API_KEY.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { fetchKrInsiderFilings } from '@/lib/dart-insider';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=43200, stale-while-revalidate=3600' };

export async function GET(
  _req: NextRequest,
  { params }: { params: { ticker: string } }
) {
  const stockCode = params.ticker.replace(/\.(KS|KQ)$/i, '').trim();

  if (!/^\d{6}$/.test(stockCode)) {
    return NextResponse.json(
      { error: 'invalid_ticker', message: '6자리 숫자 종목코드가 필요합니다', ticker: params.ticker },
      { status: 400 }
    );
  }
  if (!process.env.DART_API_KEY) {
    logger.error('api.insider-kr', 'missing_key', 'DART_API_KEY 환경변수 미설정');
    return NextResponse.json({ error: 'config_error', message: 'DART API key not configured' }, { status: 500 });
  }

  const redis = createRedis();
  try {
    const r = await fetchKrInsiderFilings(stockCode, redis);
    return NextResponse.json(
      { items: r.filings, corpName: r.corpName, ticker: r.ticker, total: r.total, source: r.source, fetchedAt: r.fetchedAt },
      { headers: CDN_HEADERS }
    );
  } catch (err) {
    logger.error('api.insider-kr', 'fetch_failed', String((err as Error)?.message ?? err));
    return NextResponse.json({ error: 'dart_error', items: [], source: 'error', ticker: stockCode }, { status: 502 });
  }
}
