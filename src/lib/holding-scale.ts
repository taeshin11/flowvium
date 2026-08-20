/**
 * holding-scale.mjs — 지분율 단위 정규화. 이 프로젝트의 지분율은 항상 퍼센트(0~100)다.
 *
 * 배경(2026-08-20): Yahoo heldPercentInstitutions 가 예전에는 분수(0.66)였다가 퍼센트(66.49)로
 * 바뀌었는데, stock-supply/route.ts:192 와 StockSupplyModal.tsx:271 이 각자 ×100 을 하고 있었다.
 * 결과적으로 화면에 664,920% 가 떴다. 단위 계약이 어디에도 적혀 있지 않아 두 계층이 서로 다른
 * 가정을 했다. 정규화 지점을 하나로 모으고, 소비처는 다시 곱하지 않는다.
 *
 * 판정: 지분율은 100% 를 넘을 수 없다.
 *   · v <= 1   → 분수로 보고 ×100
 *   · 1 < v <= 100 → 이미 퍼센트. 그대로
 *   · v > 100  → 불가능. null (틀린 값을 만들지 않는다)
 * 한계: 실제 지분율이 1% 미만이면 분수/퍼센트가 모호하다(0.8 이 0.8% 인지 80% 인지).
 *   기관·내부자 지분에서 1% 미만은 드물고, 오차도 절대값으로 작아 이 규칙을 쓴다.
 *   모호 구간은 ambiguous 플래그로 알린다.
 */
export function toPercent(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(Number(v))) return null;
  const n = Number(v);
  if (n < 0) return null;
  if (n > 100) return null;              // 불가능한 값 — 조용히 클램프하지 않는다
  const pct = n <= 1 ? n * 100 : n;
  return parseFloat(pct.toFixed(2));
}

/** 모호 구간(원시값 ≤1) 여부. 소비처가 표기에 반영할 수 있게 알린다. */
export function isAmbiguousScale(v: number | null | undefined): boolean {
  if (v == null || !Number.isFinite(Number(v))) return false;
  return Number(v) > 0 && Number(v) <= 1;
}
