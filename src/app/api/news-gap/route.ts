/**
 * /api/news-gap — 라이브 news-gap (기관활동 vs 미디어) 데이터.
 *   2026-06-04: 클라이언트 페이지(Company/Compare/Signals)가 정적 @/data/news-gap 대신 이 엔드포인트로
 *   라이브 데이터를 받도록 신설. getNewsGapData = 라이브 13F(동적 종목셋) + Alpha Vantage 미디어.
 */
import { NextResponse } from 'next/server';
import { getNewsGapData } from '@/lib/news-gap-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;
const CDN = { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=300' };

export async function GET() {
  const data = await getNewsGapData();
  return NextResponse.json(data, { headers: CDN });
}
