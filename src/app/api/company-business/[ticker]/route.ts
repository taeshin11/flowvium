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
import Database from 'better-sqlite3';

export const dynamic = 'force-dynamic';

let CACHE: Record<string, { products?: string; desc?: string }> | null = null;
function load(): Record<string, { products?: string; desc?: string }> {
  if (CACHE) return CACHE;
  try {
    CACHE = JSON.parse(readFileSync(resolve(process.cwd(), 'data/company-business.json'), 'utf8'));
  } catch { CACHE = {}; }
  return CACHE!;
}

// 동적 세그먼트(DB company_segments, cron 갱신, cron checkout wipe 안전) — 정적보다 우선.
interface DynSeg { segments: { name: string; amount: number; pct: number }[]; asOf: string | null; source: string | null; fetchedAt: string }
function dbSegments(ticker: string): DynSeg | null {
  let db: Database.Database | null = null;
  try {
    db = new Database(resolve(process.cwd(), 'data/flowvium.db'), { readonly: true, fileMustExist: true });
    const r = db.prepare('SELECT segments_json, as_of, source, fetched_at FROM company_segments WHERE ticker = ?').get(ticker.toUpperCase()) as
      { segments_json: string; as_of: string | null; source: string | null; fetched_at: string } | undefined;
    if (!r) return null;
    return { segments: JSON.parse(r.segments_json), asOf: r.as_of, source: r.source, fetchedAt: r.fetched_at };
  } catch { return null; }
  finally { try { db?.close(); } catch { /* */ } }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const t = (ticker || '').toUpperCase();
  const db = load();
  // US(AAPL) / KR(005380.KS) / suffix 제거(005380) 순 lookup
  const hit = db[t] || db[ticker] || db[t.replace(/\.(KS|KQ)$/, '')] || db[`${t}.KS`] || db[`${t}.KQ`];
  // 동적 세그먼트(DB) — 있으면 정적 products 대신 동적 비중%(as-of) 우선.
  const dyn = dbSegments(t);
  const dynProducts = dyn ? dyn.segments.slice(0, 5).map(s => `${s.name} ${s.pct}%`).join(' · ') : null;
  const products = dynProducts || hit?.products || null;
  const desc = hit?.desc || null;
  if (!products && !desc) {
    return NextResponse.json({ ticker: t, products: null, desc: null, source: 'none' });
  }
  return NextResponse.json(
    {
      ticker: t, products, desc,
      source: dynProducts ? `dynamic:${dyn!.source}` : 'company-business',
      asOf: dyn?.asOf ?? null,                          // 동적이면 filing date(신선도)
      segments: dyn?.segments ?? null,
    },
    { headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=43200' } },
  );
}
