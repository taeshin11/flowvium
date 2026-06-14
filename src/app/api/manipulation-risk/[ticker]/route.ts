/**
 * GET /api/manipulation-risk/[ticker] — 작전주(펌프&덤프) 의심 결정론 스코어 (2026-06-13, 사용자
 *   "작전주 알아차리는 방법"). 전부 동적·결정론 — 하드코딩 0.
 *
 * 작전주 시그니처 = 동시 발화: ① 단기 급등 ② 거래량 폭발 ③ 저유동성(작전 표적) ④ 펀더멘털 괴리
 *   (급등하는데 실적 근거 없음). 한 신호만으론 약함 — 동시 충족이 핵심.
 * 소스: Yahoo v8 일봉(가격·거래량 라이브) + data/financials.json(매출/마진) + 거래소 공식 시장경보
 *   (KIND 라이브, src/lib/market-alerts — '소수지점/계좌'=소수계좌 거래집중 선행 flag). data.krx getJsonData
 *   는 anti-bot LOGOUT 이나 KIND investattentwarnrisky.do 로 우회 성공(2026-06-14).
 */
import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRedis } from '@/lib/redis';
import { peekMarketAlerts, fetchMarketAlertsRaw, type MarketAlert } from '@/lib/market-alerts';
import { peekUsMarketAlerts, fetchUsMarketAlertsRaw, type UsMarketAlert } from '@/lib/us-market-alerts';

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
async function fetchKrInvestorFlow(code: string): Promise<{ indiv: number; foreign: number; organ: number; name: string | null } | null> {
  try {
    const r = await fetch(`https://m.stock.naver.com/api/stock/${code}/integration`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(7000) });
    if (!r.ok) return null;
    const j = await r.json();
    const name = (j?.stockName ?? j?.stockNameEng ?? null) as string | null;
    const d = j?.dealTrendInfos?.[0];
    const num = (v: unknown) => { const x = parseFloat(String(v ?? '').replace(/[^\d.\-]/g, '')); return Number.isFinite(x) ? x : 0; };
    if (!d) return name ? { indiv: 0, foreign: 0, organ: 0, name } : null;
    return { indiv: num(d.individualPureBuyQuant), foreign: num(d.foreignerPureBuyQuant), organ: num(d.organPureBuyQuant), name };
  } catch { return null; }
}

// 2026-06-14 (사용자 "KRX 소수계좌 거래집중 뚫어봐"): 거래소 공식 시장경보(투자주의/경고/위험) 매칭.
//   '소수지점/계좌' 투자주의 = 오르기 前 작전주 선행 surveillance flag. 캐시 우선(핫패스 cold 회피),
//   miss 시 이름 매칭용 경량 raw fetch. 권위 거래소 데이터로 결정론 스코어를 ground-truth 보강.
async function matchSurveillance(ticker: string, name: string | null): Promise<MarketAlert | null> {
  try {
    const redis = createRedis();
    const peek = await peekMarketAlerts(redis);
    if (peek?.alerts?.length) {
      return peek.alerts.find((a) => a.ticker === ticker) ?? (name ? peek.alerts.find((a) => a.name === name) ?? null : null);
    }
    if (!name) return null;
    const raw = await fetchMarketAlertsRaw(10);   // 캐시 miss: 경량 raw(ticker 미해소) → 이름 매칭
    return raw.find((a) => a.name === name) ?? null;
  } catch { return null; }
}

// 2026-06-14: US 공식 surveillance(SEC 거래정지/Reg SHO/거래소 halts) 매칭. KRX 소수계좌의 US 대응.
async function matchUsSurveillance(ticker: string): Promise<UsMarketAlert | null> {
  try {
    const redis = createRedis();
    const peek = await peekUsMarketAlerts(redis);
    const list = peek?.alerts ?? await fetchUsMarketAlertsRaw();
    return list.find((a) => a.ticker === ticker) ?? null;
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
  // 펀더멘털 괴리: 급등(20일 +30%↑)인데 매출 *역성장*. 2026-06-14(ChatGPT §2-4): "데이터 부재"≠"괴리".
  //   f==null 을 full penalty 로 쓰면 microcap/KR 소형주 false positive ↑ → 괴리는 실데이터 역성장만.
  const f = fin(t);
  const fundamentalUnknown = f == null;
  const fundamentalGap = runup20d >= 30 && f != null && f.revYoYPct != null && f.revYoYPct < 0;

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
  // ④ 펀더멘털 괴리 (max 15) — 실데이터 역성장만 full. 부재는 confidence penalty(5)만.
  let sFun = 0;
  if (fundamentalGap) { sFun = 15; flags.push(`급등하나 매출 역성장(${f!.revYoYPct}%)`); }
  else if (runup20d >= 50 && fundamentalUnknown) { sFun = 5; flags.push('급등하나 재무 데이터 미확인 — 펀더 괴리 단정 불가'); }

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
  // 2026-06-14(ChatGPT §2-1~2-3): 유동성 tiering($5M 기본·$5~15M 은 거래량추세 있을 때만) + per-signal
  //   점수 하향(1.5× 추세 단독 과탐 방지) + 기본 coFire>=3 고정밀. 공식 소수계좌(가격평탄)일 때만 >=2 허용(후단).
  const liquidityOk = medDollarVol < 5e6 || (medDollarVol < 1.5e7 && volTrendUp);
  let accumScore = 0; const accumLead: string[] = [];
  if (!isMarkup && priceFlat && liquidityOk) {
    if (vol30 > 0 && vol10 / vol30 >= 2.0) { accumScore += 16; accumLead.push(`거래량 추세 ${(vol10 / vol30).toFixed(1)}× 상승(지속 매집)`); }
    else if (volTrendUp) { accumScore += 9; accumLead.push(`거래량 추세 ${(vol10 / vol30).toFixed(1)}× 상승`); }
    if (volSpike >= 4.0) accumScore += 12; else if (volSpike >= 2.5) accumScore += 7;
    if (volSpike >= 2.5) accumLead.push(`거래량 ${volSpike.toFixed(1)}× 급증(가격 평탄)`);
    if (volContraction) { accumScore += 10; accumLead.push(`변동성 수축(coiling) — 돌파 압축`); }
    if (closeStrength >= 0.7) { accumScore += 10; accumLead.push(`종가 일중 상단 ${Math.round(closeStrength * 100)}%(강한 매수 흡수)`); }
    else if (closeStrength >= 0.6) { accumScore += 6; accumLead.push(`종가 일중 상단 ${Math.round(closeStrength * 100)}%`); }
  }
  const accumCoFire = [volTrendUp, volSpike >= 2.5, volContraction, closeStrength >= 0.6].filter(Boolean).length;
  if (!isMarkup && priceFlat && liquidityOk && accumCoFire >= 3 && accumScore >= 32) {
    phase = 'accumulation';
    flags.push(`🔍 매집(오르기 前) 선행조짐 ${accumCoFire}개 동시: ${accumLead.join(' · ')} — 급등 前 단계`);
    score = Math.max(score, Math.min(60, accumScore));  // 사전단계는 high 권역까지(severe 는 markup 확정 시만)
  }

  // ── 투자자 수급 분산 신호 (KR, 5번째 시그니처) — 사용자 "더 나은 방법" ────────────────────
  //   펌프&덤프 분산 단계: markup 에서 개인 순매수(FOMO) + 세력(기관+외인) 순매도 = 덤프 임박 흡수.
  //   accumulation 단계: 세력 순매수 + 개인 비관심 = 매집 확인(사전 신호 강화). 권위 거래소 수급.
  let investorFlow: { indiv: number; foreign: number; organ: number; name: string | null } | null = null;
  let krName: string | null = null;
  // 2026-06-14(ChatGPT §4): 방향만으론 1주 순매수도 발화 → 최근 거래량 대비 *규모*로 정규화 + 가격위치 결합.
  //   고점 실패(장중 고점 만들고 하단 마감) = 분배 보조 신호.
  const highCloseFailure = rows.slice(-5).filter(r => ((r.c - r.l) / Math.max(r.h - r.l, 1e-9)) < 0.35).length / 5;
  if (isKR) {
    investorFlow = await fetchKrInvestorFlow(t.replace(/\.(KS|KQ)$/, ''));
    if (investorFlow) {
      krName = investorFlow.name;
      const recentVol5 = rows.slice(-5).reduce((s, r) => s + r.v, 0) / 5;
      const smartRatio = (investorFlow.foreign + investorFlow.organ) / Math.max(recentVol5, 1);  // 세력 순매수 규모/거래량
      const retailRatio = investorFlow.indiv / Math.max(recentVol5, 1);
      if (isMarkup && retailRatio >= 0.05 && smartRatio <= -0.03 && highCloseFailure >= 0.4) {
        score = Math.min(100, score + 15);
        flags.push('수급 분산: 개인 순매수 흡수(규모) / 기관·외인 순매도 + 고점 실패 — 덤프 임박 정황');
      } else if (phase === 'accumulation' && smartRatio >= 0.03 && retailRatio <= 0 && closeStrength >= 0.6) {
        score = Math.min(100, score + 8);
        flags.push('매집 확인: 기관·외인 순매수 규모(거래량 3%+) / 개인 부재 — 세력 매집 정황(사전)');
      }
    }
  }

  // ── 거래소 공식 시장경보 매칭 (KR, 권위 surveillance) — 사용자 "KRX 소수계좌 거래집중 뚫어봐" ──────
  //   '소수지점/계좌' 투자주의 = 거래소가 직접 집계한 소수계좌 거래집중 → 작전주 *선행*(오르기 前) flag.
  //   투자경고/위험 = 이미 급등 진행(후행) 위험 flag. 결정론 스코어를 공식 데이터로 ground-truth 보강.
  // 2026-06-14(ChatGPT §1, 사용자 "무조건 사전 감지"): 공식 surveillance 를 leading(사전) vs lagging(이미/확인)
  //   로 분리. 진짜 leading = 소수계좌 거래집중 + 가격 아직 평탄. '15일간 상승·관여 과다'·투자경고/위험·
  //   halt·SEC정지·RegSHO 는 전부 lagging(이미 진행/사후 확인). 가격위치(runup20d)로 phase 결정.
  let surveillance: { region: string; category: string; type?: string; reason: string | null; reasonCode?: string | null; fewAccount: boolean; designatedDate: string | null; leadLag: 'leading' | 'lagging' } | null = null;
  if (isKR) {
    const alert = await matchSurveillance(t, krName);
    if (alert) {
      const r = alert.reason ?? '';
      const risenContext = isMarkup || runup20d >= 25 || /15일간\s*상승|상승종목|관여\s*과다/.test(r);  // 이미 상승 후 맥락
      const base = { region: 'KR', category: alert.category, reason: alert.reason, fewAccount: alert.fewAccount, designatedDate: alert.designatedDate };
      if (alert.category === 'risk') {
        score = Math.max(score, 90); phase = 'markup';
        surveillance = { ...base, leadLag: 'lagging' };
        flags.push(`🔴 거래소 투자위험 — 매매정지 가능 최고위험(이미 진행·후행)${alert.designatedDate ? ` [${alert.designatedDate}]` : ''}`);
      } else if (alert.category === 'warning') {
        score = Math.max(score, 75); phase = 'markup';
        surveillance = { ...base, leadLag: 'lagging' };
        flags.push(`🔴 거래소 투자경고 — 이미 급등 진행(과열·후행)${alert.designatedDate ? ` [${alert.designatedDate}]` : ''}`);
      } else if (alert.fewAccount && !risenContext && priceFlat) {
        // ★ 진짜 사전(leading): 소수계좌 거래집중 + 가격 아직 평탄 → 매집 phase 확정(coFire>=2 허용)
        score = Math.max(score, 58); if (phase !== 'markup') phase = 'accumulation';
        surveillance = { ...base, leadLag: 'leading' };
        flags.push(`🚨 거래소 소수계좌 거래집중 + 가격 평탄 — 작전주 *사전*(오르기 前) 공식 flag${alert.designatedDate ? ` [${alert.designatedDate}]` : ''}`);
      } else if (alert.fewAccount) {
        // 이미 상승 후 소수계좌/관여 과다 → 후행(markup·분배 경계)
        score = Math.max(score, 58); phase = 'markup';
        surveillance = { ...base, leadLag: 'lagging' };
        flags.push(`⚠️ 거래소 소수계좌/매매관여 과다 — 이미 상승 후(후행·분배 경계)${alert.designatedDate ? ` [${alert.designatedDate}]` : ''}`);
      } else {
        // 일반 투자주의(종가급변 등) — 약한 보강만(+8)
        score = Math.min(100, score + 8);
        surveillance = { ...base, leadLag: 'lagging' };
        flags.push(`⚠️ 거래소 투자주의: ${alert.reason || '사유 미상'}${alert.designatedDate ? ` [${alert.designatedDate}]` : ''}`);
      }
    }
  } else {
    // US 공식 surveillance — 전부 lagging(이미 조치/사후 확인). halt code 별 재분류(LUDP/T5=변동성 후행).
    const ua = await matchUsSurveillance(t);
    if (ua) {
      const code = (ua.reasonCode ?? '').toUpperCase();
      const base = { region: 'US', category: ua.category, type: ua.type, reason: ua.reason, reasonCode: ua.reasonCode ?? null, fewAccount: false, designatedDate: ua.date, leadLag: 'lagging' as const };
      if (ua.type === 'sec_suspension') {
        // 활성(≤14일)=95, 사후(≤40)=78, 과거(≤90)=55 — 오래된 정지는 점수 감쇠(§1-3)
        const ageDays = ua.date ? (Date.now() - Date.parse(ua.date)) / 864e5 : 999;
        const sScore = ageDays <= 14 ? 95 : ageDays <= 40 ? 78 : 55;
        score = Math.max(score, sScore); phase = 'markup';
        surveillance = base;
        flags.push(`🔴 SEC 거래정지 — 사기·조작 의심 공식 정지(${ageDays <= 14 ? '활성' : '과거'}·후행)${ua.date ? ` [${ua.date}]` : ''}`);
      } else if (ua.type === 'halt') {
        let hScore = 38;
        if (['H10', 'H11'].includes(code)) hScore = 90;
        else if (['T12', 'H4', 'H9', 'D'].includes(code)) hScore = 70;
        else if (['T1', 'T2', 'T6'].includes(code)) hScore = 40;
        else if (['LUDP', 'LUDS', 'T5', 'M'].includes(code)) hScore = 40;       // 변동성 pause = 이미 급변 후
        else if (/^MWC/.test(code)) hScore = 0;                                  // 시장전체 서킷 — 개별 작전주 제외
        if (hScore > 0) {
          score = Math.max(score, hScore); if (hScore >= 45) phase = 'markup';
          surveillance = base;
          flags.push(`${hScore >= 70 ? '🔴' : '⚠️'} 거래소 ${ua.reason} — 이미 급변/조치(후행)${ua.date ? ` [${ua.date}]` : ''}`);
        }
      } else if (ua.type === 'reg_sho_threshold') {
        // FTD 지속 = 후행/확인(정상 사유도 있음). 저유동성+급등 겹칠 때만 약가중.
        let add = 6; if (isMarkup && medDollarVol < 5e6) add += 4;
        score = Math.min(100, score + add);
        surveillance = base;
        flags.push(`⚠️ Reg SHO 결제실패(FTD) 지속 — 공매도/조작 확인(후행)${ua.date ? ` [${ua.date}]` : ''}`);
      }
    }
  }

  // 사전 감지 여부: 매집 phase 또는 leading surveillance 만 "사전". 나머지는 이미 진행/사후.
  const preDetection = phase === 'accumulation' || surveillance?.leadLag === 'leading';
  const tier = score >= 75 ? 'severe' : score >= 55 ? 'high' : score >= 30 ? 'elevated' : 'low';

  return NextResponse.json({
    ticker: t,
    score,
    tier,
    phase,            // 'accumulation'(급등 前 매집 의심·사전) | 'markup'(이미 급등 진행) | 'none'
    preDetection,     // true = 오르기 前 사전 감지 / false = 이미 진행·사후 확인 (사용자 핵심 구분)
    coFire,
    metrics: {
      runup5dPct: +runup5d.toFixed(1), runup20dPct: +runup20d.toFixed(1),
      volSpikeX: +volSpike.toFixed(1), medDollarVolUsd: Math.round(medDollarVol),
      revYoYPct: f?.revYoYPct ?? null,
      investorFlow: investorFlow ? { indiv: investorFlow.indiv, foreign: investorFlow.foreign, organ: investorFlow.organ } : null,
    },
    surveillance,   // 거래소 공식 시장경보 {category, reason, fewAccount, designatedDate} (KR) | null
    flags,
    note: isKR ? 'KR: 결정론 4시그니처 + 투자자 수급 분산(개인 vs 기관·외인) + 거래소 공식 시장경보(투자주의/경고/위험·소수계좌 거래집중, KIND 라이브).'
      : 'US: 결정론 4시그니처 + 매집 선행 + 공식 surveillance(SEC 거래정지·Reg SHO 결제실패·거래소 halts).',
    source: isKR ? 'deterministic-yahoo-daily+financials+naver-flow+krx-market-alert' : 'deterministic-yahoo-daily+financials+us-surveillance',
  }, { headers: CDN });
}
