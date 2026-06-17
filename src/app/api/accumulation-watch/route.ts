/**
 * GET /api/accumulation-watch[?market=us] — 작전주 "오르기 前" 매집 워치리스트 (2026-06-14).
 *
 * scripts/scan-accumulation.mjs 산출(data/accumulation-watchlist.json — KOSDAQ 매집 선행조짐 +
 *   KRX 공식 소수계좌 거래집중 교차검증)을 페이지/보고서에 노출. 결정론·읽기전용. 36h 신선도 가드.
 *   "추천 아님 — 관찰 우선"(action=watch_only). 정적 폴백 금지: 파일 부재 시 빈 배열 + source 명시.
 *   2026-06-17: ?market=us → data/accumulation-watchlist-us.json (US 거래량 기반 매집). KR 기본.
 */
import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { resolve } from 'path';

export const dynamic = 'force-dynamic';
const CDN = { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=900' };

export async function GET(req: Request) {
  const market = new URL(req.url).searchParams.get('market') === 'us' ? 'us' : 'kr';
  const file = market === 'us' ? 'data/accumulation-watchlist-us.json' : 'data/accumulation-watchlist.json';
  const defaultUniverse = market === 'us' ? 'US' : 'KOSDAQ';
  try {
    const raw = JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8'));
    const genMs = Date.parse(raw.generatedAt ?? '');
    const ageH = Number.isFinite(genMs) ? (Date.now() - genMs) / 3.6e6 : Infinity;
    const stale = ageH > 36;
    const items = (raw.watchlist ?? []).slice(0, 12).map((w: Record<string, unknown>) => ({
      ticker: w.ticker, name: w.name, phase: 'pre_pump_accumulation', score: w.score,
      signals: w.lead ?? [], official: w.official ?? null, runup20dPct: w.runup20dPct ?? null,
      action: 'watch_only',
    }));
    return NextResponse.json({
      items, asOf: raw.generatedAt ?? null, universe: raw.universe ?? defaultUniverse,
      scanned: raw.scanned ?? null, officialFewAccount: raw.officialFewAccount ?? 0,
      source: stale ? 'stale' : 'live',
    }, { headers: CDN });
  } catch {
    return NextResponse.json({ items: [], asOf: null, universe: defaultUniverse, scanned: null, officialFewAccount: 0, source: 'empty' }, { headers: CDN });
  }
}
