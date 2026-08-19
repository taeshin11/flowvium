/**
 * stop-floor.mjs — 손절폭 하한 계산. 발동 판정과 같은 지표(장중 True Range)를 쓴다.
 *
 * 종전(generate-report-local.mjs applyVolatilityStopFloor)은 종가-종가 변동성으로 하한을 잡았다.
 * 발동은 장중 저가로 판정하는데 하한은 종가끼리 재니 지표가 어긋났다. 실측 ATR/ccVol 비율이
 * 1.3~2.0배라 하한이 그만큼 좁게 잡혔고, KR 20건 중 19건이 노이즈 구간에서 손절됐다.
 *
 * 값은 data/portfolio-policy.json 의 stop 절을 쓴다. 여기에 숫자를 박지 않는다.
 */
import { loadPolicy } from './portfolio-policy.mjs';

export function loadStopConfig() { return loadPolicy().stop; }

/**
 * 손절폭 하한(%). atrPct 를 우선 쓰고, 없으면 ccVolPct 를 쓰되 장중 범위 과소평가를 보정한다.
 * 둘 다 없으면 null — 임의 기본값을 만들지 않는다.
 */
export function stopFloorPct({ atrPct, ccVolPct }) {
  const c = loadStopConfig();
  let basis = null;
  if (atrPct != null && Number.isFinite(Number(atrPct))) basis = Number(atrPct);
  else if (ccVolPct != null && Number.isFinite(Number(ccVolPct))) {
    // ccVol 은 장중 범위를 못 본다. 실측 ATR/ccVol 중앙값(약 1.5배)으로 보정해 같은 축으로 옮긴다.
    // ATR 을 구할 수 있으면 이 경로를 타지 않는 것이 옳다 — 어디까지나 차선이다.
    basis = Number(ccVolPct) * (c.ccToTrueRangeRatio ?? 1.5);
  }
  if (basis == null) return null;
  return Math.min(c.maxPct, Math.max(c.minPct, basis * c.atrMultiple));
}

/**
 * 이 종목이 현재 위험 틀에 들어오는가.
 * 필요한 손절폭(ATR×배수)이 상한(maxPct)을 넘으면, 손절을 상한으로 '조용히 자르는' 것은
 * 노이즈 손절을 그대로 받아들이는 것과 같다. 그 경우는 손절을 넓힐 게 아니라
 * 포지션을 잡지 않거나 크기를 줄여야 한다. 잘랐다는 사실을 숨기지 않고 돌려준다.
 *   실측: 082920.KQ ATR 9.42% → 필요 23.6% vs 상한 15% → 위험 틀 밖.
 */
export function riskFitAssessment({ atrPct, ccVolPct }) {
  const c = loadStopConfig();
  const basis = (atrPct != null && Number.isFinite(Number(atrPct))) ? Number(atrPct)
    : (ccVolPct != null && Number.isFinite(Number(ccVolPct))) ? Number(ccVolPct) * (c.ccToTrueRangeRatio ?? 1.5)
    : null;
  if (basis == null) return null;
  const required = basis * c.atrMultiple;
  return {
    requiredPct: +required.toFixed(2),
    cappedPct: Math.min(c.maxPct, Math.max(c.minPct, required)),
    withinRiskFrame: required <= c.maxPct,
    reason: required > c.maxPct
      ? `필요 손절폭 ${required.toFixed(1)}% > 상한 ${c.maxPct}% — 손절을 넓혀도 노이즈를 못 벗어난다. 진입 보류 또는 축소 대상`
      : null,
  };
}

/**
 * 현재 손절폭이 하한보다 좁아 확장이 필요한가.
 * 종전의 `distPct >= floor*0.75` 우회(플로어의 75%면 존중)는 두지 않는다 —
 * 그 우회가 082920.KQ(-7.0% vs floor 9.3%)를 통과시켰다. 존중하려면 근거가 필요하고,
 * 근거는 '지지선 스톱'이지 '하한의 75%'가 아니다. 지지선 스톱은 호출측이 별도로 판단한다.
 */
export function shouldWiden({ stopDistPct, atrPct, ccVolPct }) {
  const floor = stopFloorPct({ atrPct, ccVolPct });
  if (floor == null || stopDistPct == null) return null;
  return Number(stopDistPct) < floor;
}
