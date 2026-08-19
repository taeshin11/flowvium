/**
 * realized-pnl.mjs — 결과 라벨과 일치하는 성과 측정.
 *
 * 종전(evaluate-recommendations.mjs:159-161)은 라벨과 무관하게 "마지막 종가 − 진입가"로만 쟀다.
 * 그래서 손절이 발동한 뒤 가격이 회복하면 stop_loss 인데 수익이 양수로 기록됐다
 * (38일 out-of-sample 83건 중 stop_loss 41건의 17건). 실제로 손절을 지켰다면 손실이다.
 * 라벨이 '체결된 사건'을 말하면 수익도 그 사건의 가격으로 재야 편향이 없다.
 *
 *   stop_loss      → 손절가 체결로 본다 (보수적. 갭하락이면 실제는 더 나쁠 수 있다 — 낙관 편향은 없다)
 *   hit_target     → 목표가 체결로 본다
 *   still_holding  → 현재가 평가손익
 *   not_entered    → null. 손익이 없다. 0% 로 채우면 평균이 희석된다
 *   그 외/결측     → null. 조용히 0 을 만들지 않는다
 */
export function realizedPnlPct({ outcome, entry, stop, target, lastClose }) {
  const e = Number(entry);
  if (!Number.isFinite(e) || e === 0) return null;
  const pct = (exit) => {
    const x = Number(exit);
    return Number.isFinite(x) ? parseFloat(((x - e) / e * 100).toFixed(2)) : null;
  };
  switch (outcome) {
    case 'stop_loss':     return pct(stop);
    case 'hit_target':    return pct(target);
    case 'still_holding': return pct(lastClose);
    case 'not_entered':   return null;
    default:              return null;
  }
}

/** 종전 방식(현재가 기준). 과거 데이터와 비교·이행 검증용으로 남긴다. */
export function markToMarketPnlPct({ entry, lastClose }) {
  const e = Number(entry), c = Number(lastClose);
  if (!Number.isFinite(e) || e === 0 || !Number.isFinite(c)) return null;
  return parseFloat(((c - e) / e * 100).toFixed(2));
}
