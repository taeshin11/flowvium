/**
 * GET /api/manipulation-risk/[ticker] — 작전주(펌프&덤프) 의심 결정론 스코어 (2026-06-13, 사용자
 *   "작전주 알아차리는 방법"). 전부 동적·결정론 — 하드코딩 0.
 *
 * 작전주 시그니처 = 동시 발화: ① 단기 급등 ② 거래량 폭발 ③ 저유동성(작전 표적) ④ 펀더멘털 괴리
 *   (급등하는데 실적 근거 없음). 한 신호만으론 약함 — 동시 충족이 핵심.
 * 소스: Yahoo v8 일봉(가격·거래량 라이브) + data/financials.json(매출/마진). 권위 KR 시장경보(KRX)는
 *   anti-bot LOGOUT 으로 직접 fetch 불가 → 추후 별도 우회(현재 미적용, 결정론 스코어가 1차).
 */
import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { resolve } from 'path';

export const dynamic = 'force-dynamic';
const CDN = { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=120' };
const KRW_PER_USD = 1350; // 유동성 tier 통일용 근사 환율 (정밀 불요 — 등급만)

let FIN: Record<string, { revYoYPct: number | null; opMarginPct: number | null; fy: string | null }> | null = null;
function fin(t: string) {
  if (!FIN) { try { FIN = JSON.parse(readFileSync(resolve(process.cwd(), 'data/financials.json'), 'utf8')); } catch { FIN = {}; } }
  return FIN![t] ?? null;
}

async function dailyChart(ticker: string) {
  // 90일 일봉 (가격+거래량). range=3mo 는 일봉 반환 OK (max 만 월봉 함정).
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=3mo`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000), cache: 'no-store' });
  if (!r.ok) return null;
  const res = (await r.json())?.chart?.result?.[0];
  const q = res?.indicators?.quote?.[0] ?? {};
  const closes: number[] = (q.close ?? []).filter((x: number) => x != null && x > 0);
  const rows: { c: number; v: number }[] = [];
  const ts: number[] = res?.timestamp ?? [];
  for (let i = 0; i < ts.length; i++) {
    if (q.close?.[i] != null && q.close[i] > 0 && q.volume?.[i] != null) rows.push({ c: q.close[i], v: q.volume[i] });
  }
  return rows.length >= 25 ? rows : null;
}

function median(arr: number[]) { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; }

export async function GET(_req: NextRequest, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const t = (ticker || '').toUpperCase();
  const isKR = /\.(KS|KQ)$/.test(t);
  const rows = await dailyChart(t);
  if (!rows) return NextResponse.json({ ticker: t, score: null, tier: 'unknown', reason: 'insufficient_data', flags: [] }, { headers: CDN });

  const n = rows.length;
  const last = rows[n - 1].c;
  const runup5d = n >= 6 ? (last / rows[n - 6].c - 1) * 100 : 0;
  const runup20d = n >= 21 ? (last / rows[n - 21].c - 1) * 100 : 0;
  // 거래량 폭발: 최근 5일 평균 / 직전 기간(~55일) 평균
  const recentVol = rows.slice(-5).reduce((s, r) => s + r.v, 0) / Math.min(5, n);
  const priorRows = rows.slice(0, Math.max(1, n - 5));
  const priorVol = priorRows.reduce((s, r) => s + r.v, 0) / priorRows.length;
  const volSpike = priorVol > 0 ? recentVol / priorVol : 1;
  // 유동성: 일 거래대금 중앙값 (USD 환산). 낮을수록 작전 표적.
  const dollarVols = rows.map(r => r.c * r.v / (isKR ? KRW_PER_USD : 1));
  const medDollarVol = median(dollarVols);
  // 펀더멘털 괴리: 급등(20일 +30%↑)인데 매출 역성장/부재
  const f = fin(t);
  const fundamentalGap = runup20d >= 30 && (f == null || (f.revYoYPct != null && f.revYoYPct < 0));

  // ── 결정론 스코어 (0-100): 동시 발화 가중 ───────────────────────────────────
  const flags: string[] = [];
  let score = 0;
  // ① 단기 급등 (max 30)
  let sRun = 0;
  if (runup20d >= 100) sRun = 30; else if (runup20d >= 50) sRun = 22; else if (runup20d >= 30) sRun = 14; else if (runup5d >= 25) sRun = 12;
  if (sRun > 0) flags.push(`급등 20일 ${runup20d >= 0 ? '+' : ''}${runup20d.toFixed(0)}%·5일 ${runup5d >= 0 ? '+' : ''}${runup5d.toFixed(0)}%`);
  // ② 거래량 폭발 (max 30)
  let sVol = 0;
  if (volSpike >= 8) sVol = 30; else if (volSpike >= 4) sVol = 22; else if (volSpike >= 2.5) sVol = 12;
  if (sVol > 0) flags.push(`거래량 폭발 ${volSpike.toFixed(1)}× (최근5일 vs 평소)`);
  // ③ 저유동성 (max 25) — 작전 표적. $1M/일 미만 = 마이크로, $5M 미만 = 소형.
  let sLiq = 0;
  if (medDollarVol < 1e6) sLiq = 25; else if (medDollarVol < 5e6) sLiq = 15; else if (medDollarVol < 2e7) sLiq = 7;
  if (sLiq >= 15) flags.push(`저유동성 일거래대금 $${(medDollarVol / 1e6).toFixed(1)}M (작전 표적군)`);
  // ④ 펀더멘털 괴리 (max 15)
  let sFun = 0;
  if (fundamentalGap) { sFun = 15; flags.push(f == null ? '급등하나 펀더멘털 데이터 부재' : `급등하나 매출 역성장(${f.revYoYPct}%)`); }

  score = sRun + sVol + sLiq + sFun;
  // 핵심: 급등·거래량·저유동성 중 2개+ 동시 발화해야 의미 (단일 신호는 작전주 아님)
  const coFire = [sRun > 0, sVol > 0, sLiq >= 15].filter(Boolean).length;
  if (coFire < 2) score = Math.min(score, 25); // 동시발화 미달 → 경고 등급 이하로 캡

  const tier = score >= 75 ? 'severe' : score >= 55 ? 'high' : score >= 30 ? 'elevated' : 'low';

  return NextResponse.json({
    ticker: t,
    score,
    tier,
    coFire,
    metrics: {
      runup5dPct: +runup5d.toFixed(1), runup20dPct: +runup20d.toFixed(1),
      volSpikeX: +volSpike.toFixed(1), medDollarVolUsd: Math.round(medDollarVol),
      revYoYPct: f?.revYoYPct ?? null,
    },
    flags,
    note: isKR ? 'KR: KRX 시장경보(투자주의/경고/위험) 권위 대조는 anti-bot 차단으로 미적용 — 결정론 스코어' : null,
    source: 'deterministic-yahoo-daily+financials',
  }, { headers: CDN });
}
