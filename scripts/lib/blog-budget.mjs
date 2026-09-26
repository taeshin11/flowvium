/**
 * blog-budget.mjs — 쇼츠 묶음 글(make-shorts-blog)의 시간 예산. 2026-09-26.
 * 글이 될 만큼(MIN_ITEMS=2) 모였고 예산을 넘었으면 더 담지 않는다. 1편뿐이면 예산을 넘어도 계속 — 글이 안 되니까.
 * 근거는 blog-budget.test.mjs 머리말(9/24 timeout 4회, 450·475초).
 */
export const MIN_ITEMS = 2;
export function shouldStopAdding({ elapsedMs, budgetMs, included }) {
  return included >= MIN_ITEMS && elapsedMs >= budgetMs;
}
