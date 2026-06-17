/**
 * GET /api/insider-kr — KR 임원·주요주주 지분공시 시장 피드 (2026-06-17).
 *
 * scripts/scan-insider-kr.mjs 산출(data/insider-kr-feed.json)을 insider 페이지 korea 탭에 노출.
 *   US Form 4 시장피드(/api/insider-trades)의 KR 대응. 결정론·읽기전용. 36h 신선도 가드.
 *   정적 폴백 금지: 파일 부재 시 빈 배열 + source 명시. (per-ticker 는 /api/insider-kr/[ticker])
 */
import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { resolve } from 'path';

export const dynamic = 'force-dynamic';
const CDN = { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=1800' };

export async function GET() {
  try {
    const raw = JSON.parse(readFileSync(resolve(process.cwd(), 'data/insider-kr-feed.json'), 'utf8'));
    const genMs = Date.parse(raw.generatedAt ?? '');
    const ageH = Number.isFinite(genMs) ? (Date.now() - genMs) / 3.6e6 : Infinity;
    const stale = ageH > 36;
    return NextResponse.json({
      items: raw.feed ?? [],
      asOf: raw.generatedAt ?? null,
      scanned: raw.scanned ?? null,
      withFilings: raw.withFilings ?? null,
      recentDays: raw.recentDays ?? null,
      total: raw.totalRecent ?? (raw.feed?.length ?? 0),
      source: stale ? 'stale' : 'live',
    }, { headers: CDN });
  } catch {
    return NextResponse.json({ items: [], asOf: null, scanned: null, withFilings: null, recentDays: null, total: 0, source: 'empty' }, { headers: CDN });
  }
}
