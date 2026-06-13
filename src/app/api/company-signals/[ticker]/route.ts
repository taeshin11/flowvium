/**
 * GET /api/company-signals/[ticker] — 종목별 시그널 통합 (2026-06-13, 사용자 "각 종목 페이지에
 *   옵션 UOA·거래량 버스트·공급계약·수주잔고 다 있어야").
 *
 * 소스 (전부 무료·결정론, 보고서 엔진과 동일):
 *   - UOA: Redis flowvium:iv:v1:{ticker} 의 unusual[] (iv-screener/prewarm 산출)
 *   - 버스트: Yahoo 5분봉 거래량 이상치 라이브 계산 (1콜)
 *   - 공급계약: Redis supply-chain-signals 캐시에서 ticker 필터 (DART KR / SEC US, 금액·매출대비%)
 *   - 수주잔고: data/backlog.json (US SEC RPO 레벨+YoY). KR 은 표준태그 부재 → 계약 flow 로 대체 표기.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import { readFileSync } from 'fs';
import { resolve } from 'path';

export const dynamic = 'force-dynamic';
const CDN = { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=120' };

let BACKLOG: Record<string, { rpoUsd: number; rpoYoYPct: number | null; end: string; tag: string }> | null = null;
function backlog(t: string) {
  if (!BACKLOG) { try { BACKLOG = JSON.parse(readFileSync(resolve(process.cwd(), 'data/backlog.json'), 'utf8')); } catch { BACKLOG = {}; } }
  return BACKLOG![t] ?? null;
}

async function liveBurst(ticker: string) {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=5m&range=1d`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(7000), cache: 'no-store' });
    if (!r.ok) return null;
    const res = (await r.json())?.chart?.result?.[0];
    const ts: number[] = res?.timestamp ?? [];
    const q = res?.indicators?.quote?.[0] ?? {};
    const vols: number[] = q.volume ?? [];
    let best = null;
    for (let i = 0; i < ts.length; i++) {
      const v = vols[i], close = q.close?.[i], open = q.open?.[i];
      if (!v || !close) continue;
      const prior = vols.slice(Math.max(0, i - 20), i).filter((x: number) => x > 0);
      if (prior.length < 4) continue;
      const avg = prior.reduce((s: number, x: number) => s + x, 0) / prior.length;
      const notional = v * close;
      if (v >= avg * 4 && notional >= 3e6 && (!best || notional > best.notional)) {
        best = { time: new Date(ts[i] * 1000).toISOString(), price: Math.round(close * 100) / 100, volume: v, notional: Math.round(notional), dir: open != null && close >= open ? 'up' : 'down' };
      }
    }
    return best;
  } catch { return null; }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const t = (ticker || '').toUpperCase();
  const isKR = /\.(KS|KQ)$/.test(t);
  const redis = createRedis();

  // UOA — iv 캐시의 unusual[]
  let uoa: Array<{ optionType: string; strike: number; expiry: string; volOiRatio: number; premiumUsd: number | null }> = [];
  if (redis) {
    try {
      const iv = await redis.get<{ unusual?: typeof uoa }>(`flowvium:iv:v1:${t}`);
      if (Array.isArray(iv?.unusual)) uoa = iv!.unusual!.slice(0, 5);
    } catch { /* none */ }
  }

  // 공급계약 — supply-chain 캐시에서 ticker 필터
  let contract = null;
  if (redis) {
    try {
      const sc = await redis.get<Array<{ ticker: string; signalType: string; summary?: string; contractAmountWon?: number; contractRevenuePct?: number; date?: string }>>('flowvium:supply-chain-signals:v1');
      const hit = (sc ?? []).find(s => s.ticker === t && (s.signalType === 'contract_win' || s.signalType === 'contract_loss'));
      if (hit) contract = { type: hit.signalType, summary: hit.summary, amountWon: hit.contractAmountWon ?? null, revenuePct: hit.contractRevenuePct ?? null, date: hit.date ?? null };
    } catch { /* none */ }
  }

  const [burst] = await Promise.all([liveBurst(t)]);

  return NextResponse.json({
    ticker: t,
    uoa,
    burst,
    contract,
    backlog: backlog(t),  // US RPO; KR null (계약 flow 로 대체)
    backlogNote: isKR && !contract ? 'KR 은 표준 수주잔고 공시 부재 — 신규 공급계약(있을 시)으로 대체' : null,
  }, { headers: CDN });
}
