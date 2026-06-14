/**
 * src/lib/accumulation-detector.mjs — 작전주 "오르기 前" 매집 선행신호 공용 탐지 (2026-06-14).
 *
 * ChatGPT §2-1 "route 와 scanner 가 탐지로직 복제 → drift 위험". manipulation-risk/[ticker] route(TS)
 *   와 scan-accumulation.mjs(node) 가 *동일* 함수를 쓰도록 순수 JS(.mjs)로 단일화. (.d.ts 로 타입 제공)
 *
 * 입력: rows = [{c,v,h,l}] (일봉, 최근이 끝). 출력: 매집 선행신호 + accumScore/coFire(가중·임계 단일소스).
 *   가격 급등(후행) 비의존 — 가격 평탄한데 거래량추세/변동성수축/종가상단이 직전 대비 달라지나.
 */

function median(arr) { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; }
function atrNorm(sl) { return sl.length ? sl.reduce((s, r) => s + (r.h - r.l) / Math.max(r.c, 1e-9), 0) / sl.length : 0; }

/**
 * @param {{c:number,v:number,h:number,l:number}[]} rows
 * @param {{krwPerUsd?:number, isKR?:boolean}} [opts]
 */
export function computeAccumulationSignals(rows, opts = {}) {
  const krwPerUsd = opts.krwPerUsd ?? 1380;
  const isKR = opts.isKR ?? false;
  const n = rows.length;
  const last = rows[n - 1].c;
  const runup5d = n >= 6 ? (last / rows[n - 6].c - 1) * 100 : 0;
  const runup20d = n >= 21 ? (last / rows[n - 21].c - 1) * 100 : 0;

  // 거래량 폭발: 최근 5일 vs 직전 전체
  const recentVol = rows.slice(-5).reduce((s, r) => s + r.v, 0) / Math.min(5, n);
  const priorRows = rows.slice(0, Math.max(1, n - 5));
  const priorVol = priorRows.reduce((s, r) => s + r.v, 0) / priorRows.length;
  const volSpike = priorVol > 0 ? recentVol / priorVol : 1;

  const dollarVols = rows.map((r) => r.c * r.v / (isKR ? krwPerUsd : 1));
  const medDollarVol = median(dollarVols);

  // 매집 선행신호: 최근 10일 vs 직전 30~40일
  const atrRecent = atrNorm(rows.slice(-10)), atrPrior = atrNorm(rows.slice(-30, -10));
  const vol10 = rows.slice(-10).reduce((s, r) => s + r.v, 0) / 10;
  const priorSlice = rows.slice(-40, -10); const vol30 = priorSlice.length ? priorSlice.reduce((s, r) => s + r.v, 0) / priorSlice.length : 0;
  const volTrendUp = vol30 > 0 && vol10 > vol30 * 1.5;          // 거래량 추세 ↑(지속 매집)
  const volContraction = atrPrior > 0 && atrRecent < atrPrior * 0.7;  // 변동성 수축(coiling)
  const closeStrength = rows.slice(-10).filter((r) => (r.h - r.l) > 0 && (r.c - r.l) / (r.h - r.l) > 0.6).length / 10; // 종가 상단
  const priceFlat = runup20d < 12 && runup20d > -15;           // 아직 안 오름
  // 유동성 tiering: $5M 기본·$5~15M 은 거래량추세 있을 때만(저~중유동성 작전 표적)
  const liquidityOk = medDollarVol < 5e6 || (medDollarVol < 1.5e7 && volTrendUp);

  // 점수(ChatGPT §2-3 가중): 단일 1.5× 추세 과탐 방지 — 강한 신호에 더 큰 가중.
  let accumScore = 0; const lead = [];
  if (priceFlat && liquidityOk) {
    if (vol30 > 0 && vol10 / vol30 >= 2.0) { accumScore += 16; lead.push(`거래량 추세 ${(vol10 / vol30).toFixed(1)}× 상승(지속 매집)`); }
    else if (volTrendUp) { accumScore += 9; lead.push(`거래량 추세 ${(vol10 / vol30).toFixed(1)}× 상승`); }
    if (volSpike >= 4.0) accumScore += 12; else if (volSpike >= 2.5) accumScore += 7;
    if (volSpike >= 2.5) lead.push(`거래량 ${volSpike.toFixed(1)}× 급증(가격 평탄)`);
    if (volContraction) { accumScore += 10; lead.push('변동성 수축(coiling) — 돌파 압축'); }
    if (closeStrength >= 0.7) { accumScore += 10; lead.push(`종가 일중 상단 ${Math.round(closeStrength * 100)}%(강한 매수 흡수)`); }
    else if (closeStrength >= 0.6) { accumScore += 6; lead.push(`종가 일중 상단 ${Math.round(closeStrength * 100)}%`); }
  }
  const accumCoFire = [volTrendUp, volSpike >= 2.5, volContraction, closeStrength >= 0.6].filter(Boolean).length;

  return {
    runup5d, runup20d, recentVol, volSpike, medDollarVol,
    vol10, vol30, atrRecent, atrPrior,
    volTrendUp, volContraction, closeStrength, priceFlat, liquidityOk,
    accumScore, accumCoFire, lead,
  };
}

/**
 * 최종 매집 판정(공용 게이트) — 강한 수급/공식 소수계좌면 coFire>=2, 아니면 >=3 + score>=32.
 * @param {ReturnType<typeof computeAccumulationSignals>} sig
 * @param {{strongSmart?:boolean, officialFewAccount?:boolean, isMarkup?:boolean}} [ctx]
 */
export function isAccumulation(sig, ctx = {}) {
  if (ctx.isMarkup || !sig.priceFlat || !sig.liquidityOk) return false;
  const strong = ctx.strongSmart || ctx.officialFewAccount;
  const requiredCoFire = strong ? 2 : 3;
  const minScore = ctx.officialFewAccount ? 24 : 32;
  return sig.accumCoFire >= requiredCoFire && sig.accumScore >= minScore;
}
