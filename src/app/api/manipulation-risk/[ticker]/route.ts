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
  const rows: { c: number; v: number; h: number; l: number }[] = [];
  const ts: number[] = res?.timestamp ?? [];
  for (let i = 0; i < ts.length; i++) {
    if (q.close?.[i] != null && q.close[i] > 0 && q.volume?.[i] != null) {
      rows.push({ c: q.close[i], v: q.volume[i], h: q.high?.[i] ?? q.close[i], l: q.low?.[i] ?? q.close[i] });
    }
  }
  return rows.length >= 25 ? rows : null;
}

function median(arr: number[]) { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; }

// 2026-06-14 (사용자 "4 시그니처가 최선? 더 나은 방법?"): KR 투자자 수급(Naver, keyless) — 개인/기관/외인
//   순매수. 펌프&덤프 = 세력(기관+외인) 분산매도를 개인 FOMO 가 흡수하는 패턴. 권위 거래소 수급데이터.
async function fetchKrInvestorFlow(code: string): Promise<{ indiv: number; foreign: number; organ: number } | null> {
  try {
    const r = await fetch(`https://m.stock.naver.com/api/stock/${code}/integration`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(7000) });
    if (!r.ok) return null;
    const d = (await r.json())?.dealTrendInfos?.[0];
    if (!d) return null;
    const num = (v: unknown) => { const x = parseFloat(String(v ?? '').replace(/[^\d.\-]/g, '')); return Number.isFinite(x) ? x : 0; };
    return { indiv: num(d.individualPureBuyQuant), foreign: num(d.foreignerPureBuyQuant), organ: num(d.organPureBuyQuant) };
  } catch { return null; }
}

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

  // ── 사전 포착 (pre-pump / 매집 단계) — 사용자 "오르기 전에 판별할 수 없나" ──────────────
  //   마크업(급등) 前 단계: 거래량이 먼저 붙는데 가격은 아직 평탄 + 저유동성 = 조용한 매집 의심.
  //   리딩 인디케이터(가격 급등은 후행). markup 확정 전 *경고* 성격.
  const isMarkup = sRun > 0;           // 이미 급등 진행(후행 — 사용자가 원치 않는 "이미 오른" 케이스)
  let phase: 'markup' | 'accumulation' | 'none' = isMarkup ? 'markup' : 'none';
  // 2026-06-14 (사용자 "이미 오른 게 아니라 *오르기 전 조짐*을 포착하라"): 가격이 아직 평탄한 구간에서
  //   *선행지표* 다중 발화로 매집 단계 조기탐지. 가격 급등(후행)에 의존 안 함.
  //   ① 거래량 추세 상승(누적 매집 — 1일 blip 아닌 지속) ② 변동성 수축(coiling — 돌파 압축)
  //   ③ 종가 일중 상단(매수 흡수) ④ 거래량 급증(가격 평탄). 2개+ 동시발화 = accumulation.
  const atrNorm = (sl: typeof rows) => sl.length ? sl.reduce((s, r) => s + (r.h - r.l) / Math.max(r.c, 1e-9), 0) / sl.length : 0;
  const atrRecent = atrNorm(rows.slice(-10)), atrPrior = atrNorm(rows.slice(-30, -10));
  const vol10 = rows.slice(-10).reduce((s, r) => s + r.v, 0) / 10;
  const priorSlice = rows.slice(-40, -10); const vol30 = priorSlice.length ? priorSlice.reduce((s, r) => s + r.v, 0) / priorSlice.length : 0;
  const volTrendUp = vol30 > 0 && vol10 > vol30 * 1.5;                                   // 거래량 추세 ↑
  const volContraction = atrPrior > 0 && atrRecent < atrPrior * 0.7;                     // 변동성 수축
  const closeStrength = rows.slice(-10).filter(r => (r.h - r.l) > 0 && (r.c - r.l) / (r.h - r.l) > 0.6).length / 10; // 종가 상단 비율
  const priceFlat = runup20d < 12 && runup20d > -15;                                     // 아직 안 오름
  let accumScore = 0; const accumLead: string[] = [];
  if (!isMarkup && priceFlat && medDollarVol < 1.5e7) {                                  // 저~중유동성(작전 표적) + 가격평탄
    if (volTrendUp) { accumScore += 18; accumLead.push(`거래량 추세 ${(vol10 / vol30).toFixed(1)}× 상승(지속 매집)`); }
    if (volSpike >= 2.5) { accumScore += 10; accumLead.push(`거래량 ${volSpike.toFixed(1)}× 급증(가격 평탄)`); }
    if (volContraction) { accumScore += 14; accumLead.push(`변동성 수축(coiling) — 돌파 압축`); }
    if (closeStrength >= 0.6) { accumScore += 12; accumLead.push(`종가 일중 상단 ${Math.round(closeStrength * 100)}%(매수 흡수)`); }
  }
  const accumCoFire = [volTrendUp, volSpike >= 2.5, volContraction, closeStrength >= 0.6].filter(Boolean).length;
  if (!isMarkup && priceFlat && accumCoFire >= 2 && accumScore >= 24) {
    phase = 'accumulation';
    flags.push(`🔍 매집(오르기 前) 선행조짐 ${accumCoFire}개 동시: ${accumLead.join(' · ')} — 급등 전 단계`);
    score = Math.max(score, Math.min(60, accumScore));  // 사전단계는 high 권역까지(severe 는 markup 확정 시만)
  }

  // ── 투자자 수급 분산 신호 (KR, 5번째 시그니처) — 사용자 "더 나은 방법" ────────────────────
  //   펌프&덤프 분산 단계: markup 에서 개인 순매수(FOMO) + 세력(기관+외인) 순매도 = 덤프 임박 흡수.
  //   accumulation 단계: 세력 순매수 + 개인 비관심 = 매집 확인(사전 신호 강화). 권위 거래소 수급.
  let investorFlow: { indiv: number; foreign: number; organ: number } | null = null;
  if (isKR) {
    investorFlow = await fetchKrInvestorFlow(t.replace(/\.(KS|KQ)$/, ''));
    if (investorFlow) {
      const smart = investorFlow.foreign + investorFlow.organ;  // 기관+외인 = 세력 프록시
      if (isMarkup && investorFlow.indiv > 0 && smart < 0) {
        score = Math.min(100, score + 18);
        flags.push('수급 분산: 개인 순매수 흡수 / 기관·외인 순매도 — 펌프&덤프 분산(덤프 임박) 정황');
      } else if (phase === 'accumulation' && smart > 0 && investorFlow.indiv <= 0) {
        score = Math.min(100, score + 10);
        flags.push('매집 확인: 기관·외인 순매수 / 개인 비관심 — 세력 매집 정황(사전)');
      }
    }
  }

  const tier = score >= 75 ? 'severe' : score >= 55 ? 'high' : score >= 30 ? 'elevated' : 'low';

  return NextResponse.json({
    ticker: t,
    score,
    tier,
    phase,        // 'accumulation'(급등 前 매집 의심) | 'markup'(급등 진행) | 'none'
    coFire,
    metrics: {
      runup5dPct: +runup5d.toFixed(1), runup20dPct: +runup20d.toFixed(1),
      volSpikeX: +volSpike.toFixed(1), medDollarVolUsd: Math.round(medDollarVol),
      revYoYPct: f?.revYoYPct ?? null,
      investorFlow,  // {indiv, foreign, organ} 순매수량 (KR) | null
    },
    flags,
    note: isKR ? 'KR: 결정론 4시그니처 + 투자자 수급 분산(개인 vs 기관·외인). KRX 공식 시장경보(투자주의/경고/위험) OTP 연동은 추가 작업 예정.' : null,
    source: isKR ? 'deterministic-yahoo-daily+financials+naver-flow' : 'deterministic-yahoo-daily+financials',
  }, { headers: CDN });
}
