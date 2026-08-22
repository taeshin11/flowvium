/**
 * peak-risk-action.mjs — 과열(peak/dump) 신호가 잡힌 종목의 action 을 결정한다.
 *
 * 왜 분리했나(2026-08-22): 결정이 두 군데로 쪼개져 있었고 한쪽이 **산문 정규식**이었다.
 *   ① generate-report-local.mjs 후처리: totalWeight>=4 && RSI>=75 → watch (숫자 판정)
 *   ② applyLocalHarness 6h: riskNote 를 ACTION_DOWNGRADE_PATTERNS_HARNESS 로 스캔 → watch
 *   그런데 ②가 읽는 riskNote 는 ①과 같은 파이프라인의 코드가 쓴 문장이다(:2200).
 *   코드가 쓴 산문을 코드가 정규식으로 되읽고, 그 교정을 **모델의 결함**
 *   (harness_actionCritiqueMismatch)으로 기록해 왔다 — 최근 7일 27건.
 *
 *   더 나쁜 것은 ②의 패턴이 등급별로 고르지 않다는 점이다:
 *     ⚠️ 고점 주의 — 신규 매수 자제   (w2-3) → '고점 주의'·'신규 매수 자제' 로 매칭됨
 *     🟠 고점 경고 — 분할매도 검토    (w4-7) → 매칭되는 단어 없음
 *     🔴 덤핑 고위험 — 즉각 손절라인 점검 (w>=8) → 매칭되는 단어 없음
 *   요약은 상위 2~3개 신호만 담으므로 '과매수' 라벨마저 잘릴 수 있다.
 *   즉 **경미한 과열은 강등되고 심한 과열은 buy 로 남는 역전**이 코드상 가능했다.
 *   (최근 14일 실측으로는 🟠/🔴 발생이 0건이라 실제 발생 이력은 없다 — 잠재 결함이었다.)
 *
 * 규칙: 과열 맵에 들어왔다는 것 자체가 "신규 매수 자제" 신호다(detectPeakDumpRisk 는
 *   totalWeight<2 를 애초에 버린다). 등급이 높을수록 더 느슨해질 수는 없다 → 전부 watch.
 *   판정은 숫자(totalWeight/signals)만 본다. 요약 문구를 바꿔도 결과는 변하지 않는다.
 */

/** RSI 과매수 임계 — 근거 문구를 붙일지 판단하는 데만 쓴다(강등 여부와 무관). */
const RSI_OVERBOUGHT = 75;

/**
 * @param {{totalWeight:number, signals?:Array<{label:string}>}|null|undefined} risk
 * @returns {{action:'watch', reason:string, note:string|null}|null} 과열 정보가 없으면 null
 */
export function peakRiskAction(risk) {
  if (!risk || typeof risk.totalWeight !== 'number') return null;
  const w = risk.totalWeight;
  const tier = w >= 8 ? '덤핑 고위험' : w >= 4 ? '고점 경고' : '고점 주의';
  const rsiSignal = (risk.signals ?? []).find(s => /RSI\s*\d+/.test(s?.label ?? ''));
  const rsiVal = rsiSignal ? parseInt(String(rsiSignal.label).match(/RSI\s*(\d+)/)?.[1] ?? '0', 10) : 0;
  return {
    action: 'watch',
    reason: `${tier}(score ${w})`,
    note: rsiVal >= RSI_OVERBOUGHT ? `RSI ${rsiVal} 과매수 — 진입 대기` : null,
  };
}
