/**
 * funnel-hard-veto.mjs — 최종 심판의 hard 매도신호 목록과, 그걸 후보 깔때기에서 미리 보는 함수. 2026-10-02.
 *
 * 최종 심판(generate-report-local 경합심사)은 이 목록의 룰이 하나라도 걸리면 점수와 상관없이 매수를 떨군다.
 * 깔때기(buildBuyCandidates Stage 2)가 이걸 모르면 어차피 떨어질 종목이 top30 자리를 먹는다.
 *   (10/02 오후판: KR 9종 전원·US 3종이 데드크로스/200MA 이탈로 탈락 → 발간 2종) — funnel-hard-veto.test.mjs
 */
export const HARD_SELL_IDS = new Set(['price_stop_breach', 'tech_dead_cross', 'tech_200ma_breach', 'fund_margin_decline', 'micro_insider_selling', 'micro_supply_contract_loss']);

/** ctx 로 판정 가능한 hard 룰 중 처음 걸린 것 {id, reason}, 없으면 null. 값이 없는 룰은 안 걸린다. */
export function finalGateHardVeto(ctx, sellRules, evaluateSellRule) {
  for (const rule of sellRules ?? []) {
    if (!HARD_SELL_IDS.has(rule.id)) continue;
    const reason = evaluateSellRule(rule, ctx);
    if (reason) return { id: rule.id, reason };
  }
  return null;
}
