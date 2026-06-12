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
import { UNIVERSE_SEARCH } from '@/data/universe-search';

// 2026-06-12: KR 이름 폴백 — company-names.json 은 SEC(US) 추출이라 KR 미커버 (KT&G name null 사건)
const UNIV_NAME: Record<string, string> = Object.fromEntries(UNIVERSE_SEARCH.map((c) => [c.ticker, c.name]));

export const dynamic = 'force-dynamic';

let CACHE: Record<string, { products?: string; desc?: string }> | null = null;
function load(): Record<string, { products?: string; desc?: string }> {
  if (CACHE) return CACHE;
  try {
    CACHE = JSON.parse(readFileSync(resolve(process.cwd(), 'data/company-business.json'), 'utf8'));
  } catch { CACHE = {}; }
  return CACHE!;
}

// 2026-06-12: 폴백 329종 사실 프로필 (Yahoo assetProfile — build-company-profiles.mjs 권위 소스).
//   "WDAY 부실" 전수조사 후속 — 미큐레이션 종목도 업종/직원수/사업요약 표시.
interface Profile { name?: string | null; sector?: string | null; industry?: string | null; employees?: number | null; website?: string | null; summary?: string | null; asOf?: string }
let PROFILES: Record<string, Profile> | null = null;
function loadProfiles(): Record<string, Profile> {
  if (PROFILES) return PROFILES;
  try {
    PROFILES = JSON.parse(readFileSync(resolve(process.cwd(), 'data/company-profiles.json'), 'utf8'));
  } catch { PROFILES = {}; }
  return PROFILES!;
}

// 회사명 권위 소스 (company-names.json — CPRT 사건 후 SEC 추출)
let NAMES: Record<string, string> | null = null;
function loadNames(): Record<string, string> {
  if (NAMES) return NAMES;
  try {
    NAMES = JSON.parse(readFileSync(resolve(process.cwd(), 'data/company-names.json'), 'utf8'));
  } catch { NAMES = {}; }
  return NAMES!;
}

// 동적 세그먼트(DB company_segments, cron 갱신, cron checkout wipe 안전) — 정적보다 우선.
interface DynSeg { segments: { name: string; amount: number; pct: number; yoyPct?: number | null }[]; asOf: string | null; source: string | null; fetchedAt: string }
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
  // 2026-06-12: 세그먼트별 YoY 동봉 (사용자 "매출이 어느 항목에서 늘었는지") — XBRL 전년 비교치 기반
  const dynProducts = dyn ? dyn.segments.slice(0, 5).map(s => `${s.name} ${s.pct}%${s.yoyPct != null ? ` (YoY ${s.yoyPct > 0 ? '+' : ''}${s.yoyPct}%)` : ''}`).join(' · ') : null;
  const products = dynProducts || hit?.products || null;
  const desc = hit?.desc || null;
  const profile = loadProfiles()[t] ?? null;
  const name = profile?.name ?? loadNames()[t] ?? UNIV_NAME[t] ?? null;
  if (!products && !desc && !profile) {
    return NextResponse.json({ ticker: t, name, products: null, desc: null, profile: null, source: 'none' });
  }
  return NextResponse.json(
    {
      ticker: t, name, products, desc,
      profile,                                          // Yahoo assetProfile 사실 데이터 (폴백 페이지 보강)
      source: dynProducts ? `dynamic:${dyn!.source}` : hit ? 'company-business' : 'profile',
      asOf: dyn?.asOf ?? null,                          // 동적이면 filing date(신선도)
      segments: dyn?.segments ?? null,
    },
    { headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=43200' } },
  );
}
