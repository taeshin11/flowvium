/**
 * hook-overlap.mjs — 첫 화면 훅이 제목을 되풀이하나. 머리말 규칙은 hook-overlap.test.mjs.
 * 10/28 쇼츠 첫 화면 관문에서 세 심판 모두 "훅이 제목을 그대로 되풀이해 더하는 게 없다"를 가장 큰 약점으로 짚었다.
 * Mac mini2(사장님 썸네일 기준): 첫 화면 훅은 제목이 말하지 않는 것을 더해야 한다 — 상식 편 대본(lib/evergreen-check)과
 *   뉴스 쇼츠 훅(make-shorts)이 같은 잣대를 쓴다.
 * 낱말 비교는 어간 근사: 한글은 앞 두 글자(내리면·내리는 → 내리), 영문·숫자는 통째로. 한 글자 낱말(왜·싼·꼭)은 뺀다.
 */
// 영문·숫자와 한글을 따로 끊는다 — "PER이" 가 한 덩어리로 'PE' 가 되면 제목의 'PER' 과 안 맞는다(10/28).
const stems = (t) => (String(t ?? '').toLowerCase().match(/[0-9a-z]+|[가-힣]+/g) ?? []).filter((w) => w.length >= 2)
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

/** 문장(첫 대사)이 제목을 다시 말하나 — 제목 낱말 셋 이상, 절반 이상을 다시 쓰면 되풀이. 문장은 길어 훅보다 제목 쪽 비율로 본다.
 *  10/28 Mac mini2: 첫 자막(=첫 대사)도 제목을 되풀이하면 안 된다(심판들이 첫 화면 아래 자막도 짚었다). */
export function restatesTitle(text, title) {
  const t = [...new Set(stems(title))];
  if (!t.length) return false;
  const have = new Set(stems(text));
  const same = t.filter((w) => have.has(w)).length;
  return same >= 3 && same / t.length >= 0.5;
}
