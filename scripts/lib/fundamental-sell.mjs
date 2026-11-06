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

/**
 * 사유 글로만 펀더멘털이 된 매도(룰은 펀더멘털 아님)의 '마진 악화' 가 재무 데이터와 맞나. 2026-11-07 V 사건.
 *   정합 게이트는 데이터(fund_margin_decline: 전년 대비 decline_pp_gte 이상 하락)로 매수를 막는다.
 *   데이터상 그만큼 안 떨어졌으면 게이트가 매수를 통과시킨 게 맞고, 틀린 쪽은 매도 사유 글이다.
 * @returns {{unsupported: boolean|null, cur?: number, prev?: number}} null = 데이터 없음(판단 안 함)
 */
export function marginClaimUnsupported({ sellType, ids, fin, rule }) {
  if (ids?.has(sellType)) return { unsupported: false };
  const cur = fin?.latestAnnual?.operatingMarginPct ?? fin?.annuals?.[0]?.operatingMarginPct;
  const prev = fin?.annuals?.[1]?.operatingMarginPct;
  if (typeof cur !== 'number' || typeof prev !== 'number') return { unsupported: null };
  const need = rule?.condition?.decline_pp_gte ?? 2;
  return { unsupported: prev - cur < need, cur, prev };
}
