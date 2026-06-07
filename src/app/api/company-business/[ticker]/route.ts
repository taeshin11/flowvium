/**
 * GET /api/company-business/[ticker]
 *
 * 종목 주력 매출상품(products) + 사업 개요(desc) 반환. data/company-business.json 권위 소스
 *   (build:business 가 companies-batch products[]+description 추출 + KR 대형주 CURATED, 619+).
 *   LLM 생성 아닌 큐레이션 — 환각 없음. companies-batch 정적 프로필 없는 minimal company page
 *   (APH·KR 등 62% 사각지대)에 "주력 사업" 표시용. (2026-06-07 사용자 "모든 company page 가 자세하지 못함")
 */
import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { resolve } from 'path';

export const dynamic = 'force-dynamic';

let CACHE: Record<string, { products?: string; desc?: string }> | null = null;
function load(): Record<string, { products?: string; desc?: string }> {
  if (CACHE) return CACHE;
  try {
    CACHE = JSON.parse(readFileSync(resolve(process.cwd(), 'data/company-business.json'), 'utf8'));
  } catch { CACHE = {}; }
  return CACHE!;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const t = (ticker || '').toUpperCase();
  const db = load();
  // US(AAPL) / KR(005380.KS) / suffix 제거(005380) 순 lookup
  const hit = db[t] || db[ticker] || db[t.replace(/\.(KS|KQ)$/, '')] || db[`${t}.KS`] || db[`${t}.KQ`];
  if (!hit || (!hit.products && !hit.desc)) {
    return NextResponse.json({ ticker: t, products: null, desc: null, source: 'none' });
  }
  return NextResponse.json(
    { ticker: t, products: hit.products ?? null, desc: hit.desc ?? null, source: 'company-business' },
    { headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=43200' } },
  );
}
