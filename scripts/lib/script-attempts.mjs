/**
 * script-attempts.mjs — 쇼츠 대본 시도들 중 쓸 것을 고른다. 근거·규칙은 script-attempts.test.mjs 머리말.
 */
// 내용 규칙 — 어기면 덜 어겼어도 고르지 않는다. madeUp 은 루프 뒤에서 그 낱말을 걷어낼 수 있어 차선으로는 쓴다.
export const CONTENT_RULES = Object.freeze(['unattributed', 'madeUp']);
// 쓸 수 없는 시도(장면이 모자람) — 다른 시도가 있으면 고르지 않는다(루프 뒤 '장면 2개 미만이면 접는다' 와 같은 기준).
const UNUSABLE = ['tooFew'];
// 차선으로도 내지 않는다 — 셋 다 이러면 null(이슈를 접고 다른 이슈로). 낙인: 남의 공격 표현을 제 말처럼 띄운다.
//   noSave: 2026-11-25 Mac mini2 — 5원칙(저장 요소)을 어긴 편은 피드 평가를 깎는다. 사진 부족 때처럼 건너뛴다.
export const REJECT_RULES = Object.freeze(['unattributed', 'noSave']);

/** 시도 하나의 검사 결과 → 어긴 규칙 이름(make-shorts 로그 순서). */
export function brokenRules(f) {
  const out = [];
  if (f.scenes < 2) out.push('tooFew');
  if (f.chars < f.minChars) out.push('short');
  if (f.plain) out.push('plain');
  if (f.dupHooks) out.push('dupHooks');
  if (f.echoTitle) out.push('echoTitle');
  if (f.noSubject) out.push('noSubject');
  if (f.firstLong) out.push('firstLong');
  if (f.noSave) out.push('noSave');
  if (f.dupSays) out.push('dupSays');
  if (f.sameEnding) out.push('sameEnding');
  if (f.unattributed) out.push('unattributed');
  if (f.leftovers) out.push('leftovers');
  if (f.madeUp) out.push('madeUp');
  return out;
}

const fewest = (list) => list.reduce((best, x) => (!best || x.broke.length <= best.broke.length ? x : best), null);

/** attempts: [{ broke: string[], ... }] 시도 순서대로. 고를 게 없으면 null. */
export function pickAttempt(attempts) {
  const usable = (attempts ?? []).filter((x) => !x.broke.some((r) => UNUSABLE.includes(r)));
  const clean = usable.filter((x) => !x.broke.some((r) => CONTENT_RULES.includes(r) || REJECT_RULES.includes(r)));
  if (clean.length) return fewest(clean);
  // 차선: 소속만 어긴 시도 — 낙인·저장 요소 없음(REJECT_RULES)이 있으면 안 된다.
  return fewest(usable.filter((x) => !x.broke.some((r) => REJECT_RULES.includes(r)))) ?? null;
}
