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
 * @param {{krwPerUsd?:number, isKR?:boolean, liquidityStrictUsd?:number, liquidityLooseUsd?:number}} [opts]
 *   liquidity*: 유동성 게이트 상한(USD ADV). 기본 KR 작전주(저유동성 표적) 기준 $5M/$15M.
 *   US 대형주 풀은 ADV 가 훨씬 커 기본값이면 전부 탈락 → US 스캔은 상한을 높여 mid-cap 매집을 포착.
 */
export function computeAccumulationSignals(rows, opts = {}) {
  const krwPerUsd = opts.krwPerUsd ?? 1380;
  const isKR = opts.isKR ?? false;
  const strictCapUsd = opts.liquidityStrictUsd ?? 5e6;
  const looseCapUsd = opts.liquidityLooseUsd ?? 1.5e7;
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
  // 매집봉(candle 패턴, 2026-06-18 사용자 "매집봉도 없고 부족"): ① 흡수봉=대량거래인데 일중 변동폭 작음(세력이
  //   물량 흡수하며 가격 억제) ② 아래꼬리 매집=장중 저가 찍고 종가 상단 회복(저가 매수받침). open 없이 c/v/h/l 로 계산.
  const recent10 = rows.slice(-10);
  const avgRangePct = median(rows.slice(-40).map((r) => (r.h - r.l) / (r.c || 1)).filter((x) => x > 0));
  const absorptionBars = recent10.filter((r) => {
    const rngPct = (r.h - r.l) / (r.c || 1);
    return vol30 > 0 && r.v > vol30 * 1.8 && avgRangePct > 0 && rngPct < avgRangePct * 0.7;
  }).length;
  const lowerWickBars = recent10.filter((r) => {
    const range = r.h - r.l;
    return range > 0 && (r.c - r.l) / range > 0.7 && (r.h - r.c) / range < 0.25;
  }).length;
  const absorption = absorptionBars >= 2;
  const priceFlat = runup20d < 12 && runup20d > -15;           // 아직 안 오름
  // 유동성 tiering: strictCap 기본·strict~looseCap 은 거래량추세 있을 때만(저~중유동성 작전 표적)
  const liquidityOk = medDollarVol < strictCapUsd || (medDollarVol < looseCapUsd && volTrendUp);

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
    if (absorptionBars >= 3) { accumScore += 14; lead.push(`흡수 매집봉 ${absorptionBars}개(대량거래·가격억제 — 세력 물량흡수)`); }
    else if (absorptionBars >= 2) { accumScore += 9; lead.push(`흡수 매집봉 ${absorptionBars}개(대량거래·변동폭 억제)`); }
    if (lowerWickBars >= 3) { accumScore += 8; lead.push(`아래꼬리 매집 ${lowerWickBars}개(저가 매수받침)`); }
  }
  const accumCoFire = [volTrendUp, volSpike >= 2.5, volContraction, closeStrength >= 0.6, absorption].filter(Boolean).length;

  return {
    runup5d, runup20d, recentVol, volSpike, medDollarVol,
    vol10, vol30, atrRecent, atrPrior,
    volTrendUp, volContraction, closeStrength, priceFlat, liquidityOk,
    absorptionBars, lowerWickBars, absorption,
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

/**
 * 2026-06-14: 2-tier 분류 (사용자 "관찰 목적 살리되 false 작전주 막기"). 'strong'=고확신 매집 의심,
 * 'watch'=관찰(세력매집/공식 corroboration 있는 약신호), null=제외.
 *   5일 급등 가드: runup5d≥15% 면 이미 markup 진입('오르기 前' 아님 — 솔브레인 +21.6% 케이스) → null.
 * @param {ReturnType<typeof computeAccumulationSignals>} sig
 * @param {{strongSmart?:boolean, officialFewAccount?:boolean, isMarkup?:boolean, volumeOnlyWatch?:boolean}} [ctx]
 * @returns {'strong'|'watch'|null}
 */
export function accumulationTier(sig, ctx = {}) {
  if (ctx.isMarkup || !sig.priceFlat || !sig.liquidityOk) return null;
  if (sig.runup5d >= 15) return null;                                  // 단기 급등 = markup 진입(선행 아님)
  if (isAccumulation(sig, ctx)) return 'strong';                       // 고확신(기존 게이트)
  // 관찰: 세력매집(기관·외인 순매수) 또는 공식 소수계좌 corroboration + 최소 동시발화/점수
  const strong = ctx.strongSmart || ctx.officialFewAccount;
  if (strong && sig.accumCoFire >= 2 && sig.accumScore >= 14) return 'watch';
  // 2026-06-17: US 등 투자자수급(Naver)·거래소경보(KRX) corroboration 소스가 없는 시장 — 거래량추세/변동성수축/
  //   종가강도 기술패턴(coFire>=2 & score>=14)만으로 'watch'(관찰 전용). 강한 1.5× 단일 과탐은 score 게이트가 차단.
  if (ctx.volumeOnlyWatch && sig.accumCoFire >= 2 && sig.accumScore >= 14) return 'watch';
  return null;
}
