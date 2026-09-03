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

/**
 * 물타기 차단 — 여러 번 밀었는데 첫 추천보다 내려간 종목은 더 사라고 하지 않는다.
 *
 * 2026-09-04. 사용자가 이틀에 걸쳐 짚은 것이 이거였다:
 *   "하우멧 폭락했는데 매수엔진 결함 아니냐" → "둘째 날 셋째 날에 봤으면 손해잖아"
 *   실측: 005490.KS 는 14일 동안 37회(하루 2.6회) 추천됐다. 같은 종목을 매 회차 민다.
 *   HWM 은 19회 추천 중 14회가 그날 산 독자에게 손실이었다.
 *
 * 판정: 최근 30일 N회 이상 + 첫 추천 진입가 대비 -X% 이하.
 *   "여러 번 밀었다"만으로는 부족하다 — TSM 은 8회지만 -0.5% 로 제자리다. 그건 문제가 아니다.
 *   "내려갔다"만으로도 부족하다 — 처음 추천한 종목이 하루 빠진 건 흔한 일이다.
 *   **둘이 겹칠 때**가 물타기다: 논지가 틀렸는데 같은 논지를 반복하는 것.
 *   실측으로 21종목 중 4종목만 걸린다(HWM -9.3% · 483650.KS -14.9% · AMAT -7.4% · 214450.KQ -7.1%).
 *   오른 종목(DE +13.9% · FCX +10.4%)과 제자리(TSM -0.5%)는 건드리지 않는다.
 *
 * @param {Array} items 포트폴리오
 * @param {(ticker:string)=>({count:number, firstEntryMid:number|null}|null)} history 종목별 이력 조회
 * @param {(ticker:string)=>number|null} priceOf 현재가 조회
 */
export function filterAveragingDown(items, history, priceOf, { minCount = 5, maxDrawdownPct = -5 } = {}) {
  const kept = [];
  const blocked = [];
  for (const it of items ?? []) {
    const h = history?.(it?.ticker);
    const now = priceOf?.(it?.ticker);
    if (!h || !h.firstEntryMid || !now || h.count < minCount) { kept.push(it); continue; }
    const drift = (now / h.firstEntryMid - 1) * 100;
    if (drift <= maxDrawdownPct) {
      blocked.push({ ticker: it.ticker, count: h.count, driftPct: Number(drift.toFixed(1)), firstEntryMid: h.firstEntryMid });
      continue;
    }
    kept.push(it);
  }
  return { kept, blocked };
}
