/**
 * fundamental-sell.mjs — 매도 기록 한 줄이 '펀더멘털 매도' 인가. 근거·규칙은 fundamental-sell.test.mjs 머리말.
 * 쓰는 곳: audit-coverage [5b](기존 펀더멘털 매도를 무시한 매수 = 정합 게이트 우회).
 */

/** sell-rules-tuned.json 에서 category==='fundamental' 인 룰 id. */
export function fundamentalSellIds(sellRules) {
  return new Set((sellRules?.rules ?? []).filter((r) => r.category === 'fundamental').map((r) => r.id));
}

// 정합 게이트가 막는 신호 = 영업이익률(op margin) 악화. '악화' 단독은 매크로·모멘텀·수급·추세에도 쓰인다.
const MARGIN_DECLINE = /(margin|마진|이익률)[^.,;]{0,12}악화/i;

export function isFundamentalSell(sellType, rationale, ids) {
  if (ids?.has(sellType)) return true;
  return MARGIN_DECLINE.test(String(rationale ?? ''));
}
