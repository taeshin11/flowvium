/**
 * hook-overlap.mjs — 첫 화면 훅이 제목을 되풀이하나. 머리말 규칙은 hook-overlap.test.mjs.
 * 10/28 쇼츠 첫 화면 관문에서 세 심판 모두 "훅이 제목을 그대로 되풀이해 더하는 게 없다"를 가장 큰 약점으로 짚었다.
 * Mac mini2(사장님 썸네일 기준): 첫 화면 훅은 제목이 말하지 않는 것을 더해야 한다 — 상식 편 대본(lib/evergreen-check)과
 *   뉴스 쇼츠 훅(make-shorts)이 같은 잣대를 쓴다.
 * 낱말 비교는 어간 근사: 한글은 앞 두 글자(내리면·내리는 → 내리), 영문·숫자는 통째로. 한 글자 낱말(왜·싼·꼭)은 뺀다.
 */
const stems = (t) => String(t ?? '').toLowerCase().split(/[^0-9a-z가-힣]+/).filter((w) => w.length >= 2)
  .map((w) => (/[가-힣]/.test(w) ? w.slice(0, 2) : w));

/** 훅 낱말 중 제목에도 있는 비율(0~1). */
export function hookOverlap(hook, title) {
  const h = stems(hook);
  if (!h.length) return 0;
  const t = new Set(stems(title));
  return h.filter((w) => t.has(w)).length / h.length;
}

/** 훅이 제목을 되풀이하나 — 낱말 둘 이상이 겹치고 그 비율이 0.6 이상. 주제어 하나 겹침은 괜찮다(주제는 같아야 한다). */
export function repeatsTitle(hook, title) {
  const h = stems(hook);
  const t = new Set(stems(title));
  const same = h.filter((w) => t.has(w)).length;
  return same >= 2 && same / Math.max(1, h.length) >= 0.6;
}
