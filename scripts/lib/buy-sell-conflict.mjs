/**
 * buy-sell-conflict.mjs — 매도 경고가 살아 있는 종목을 매수 목록에서 걷어낸다.
 *
 * 사용자(2026-09-03): "하우멧 에어로스페이스 폭락했는데 매수엔진의 결함아니냐?"
 *   조사 결과 매수 종목 선정 자체보다, **두 엔진이 서로를 안 본다**는 게 문제였다.
 *   매도가 "긴급 — 추세 붕괴, 손절선 접근"이라고 한 종목을 이틀 뒤 "확신 high 매수"로 냈다.
 *   전수: 매도 7일 이내 재매수 766건, 그중 high 매도 직후가 324건.
 *
 * 왜 '전부 차단'이 아니라 긴급도로 나누나:
 *   매도 추천에는 두 종류가 섞여 있다 —
 *     ① "목표가 95% 도달, 수익 확정"  → 차익 실현이다. 그 종목이 나쁘다는 뜻이 아니다.
 *     ② "50MA 이탈, RSI 32, 추세 붕괴, 손절선 접근" → 위험 신호다.
 *   ②만 막아야 한다. ①까지 막으면 잘 오른 종목을 영영 못 산다.
 *   긴급도 high 가 ②에 대응한다(실측: high 문구는 전부 손절·추세붕괴 계열이었다).
 *   medium 은 막지 않되 **경고를 붙여** 보고서에 드러낸다 — 조용히 넘기면 같은 일이 반복된다.
 */

/** high 매도 경고가 살아 있으면 매수에서 뺀다. medium 이면 표시만 남긴다. */
export function filterConflicts(items, sellMap, { blockUrgency = 'high' } = {}) {
  const kept = [];
  const blocked = [];
  const flagged = [];
  for (const it of items ?? []) {
    const s = sellMap?.get?.(it?.ticker);
    if (!s) { kept.push(it); continue; }
    if (String(s.urgency).toLowerCase() === String(blockUrgency).toLowerCase()) {
      blocked.push({ ticker: it.ticker, urgency: s.urgency, at: s.at, rationale: s.rationale });
      continue;
    }
    flagged.push({ ticker: it.ticker, urgency: s.urgency, at: s.at });
    kept.push({ ...it, sellWarning: { urgency: s.urgency, at: s.at, rationale: s.rationale } });
  }
  return { kept, blocked, flagged };
}
