/**
 * GET /api/market-alerts — KRX 시장경보(투자주의/경고/위험) 라이브 (2026-06-14, 사용자 "KRX 소수계좌
 *   거래집중 뚫어봐"). KIND investattentwarnrisky.do 크랙 → src/lib/market-alerts.ts.
 *
 * '소수지점/계좌' 사유(fewAccount=true) = 거래소 공식 surveillance 의 **오르기 前 작전주 선행 flag**.
 * 캐시 3h. miss 폴백 [](정적 데이터 폴백 금지 — 시계열 surveillance). source 필드로 live/cache/empty 구분.
 *
 * 쿼리: ?fewAccount=1 (소수계좌 거래집중만) | ?category=caution|warning|risk | ?ticker=005250.KS (해당 종목 경보).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import { getMarketAlerts, type AlertCategory } from '@/lib/market-alerts';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;
const CDN = { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=1800' };

export async function GET(req: NextRequest) {
  const redis = createRedis();
  const sp = req.nextUrl.searchParams;
  const onlyFewAccount = sp.get('fewAccount') === '1';
  const category = sp.get('category') as AlertCategory | null;
  const ticker = (sp.get('ticker') || '').toUpperCase() || null;

  const { alerts, source, asOf } = await getMarketAlerts(redis);
  let filtered = alerts;
  if (onlyFewAccount) filtered = filtered.filter((a) => a.fewAccount);
  if (category) filtered = filtered.filter((a) => a.category === category);
  if (ticker) filtered = filtered.filter((a) => a.ticker === ticker);

  const counts = {
    caution: alerts.filter((a) => a.category === 'caution').length,
    warning: alerts.filter((a) => a.category === 'warning').length,
    risk: alerts.filter((a) => a.category === 'risk').length,
    fewAccount: alerts.filter((a) => a.fewAccount).length,
  };

  return NextResponse.json({ alerts: filtered, counts, source, asOf }, { headers: CDN });
}
