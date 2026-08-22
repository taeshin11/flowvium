/**
 * diff-fragment.mjs — 교정 전/후 문자열에서 **실제로 달라진 구간**만 뽑는다.
 *
 * 왜 필요한가(2026-08-22): 내러티브 sanitizer 의 학습 적재가
 *   `before.slice(0, 80)` / `after.slice(0, 80)` 로 기록했다. 교정은 대개 문장 뒤쪽에서
 *   일어나므로 앞 80자는 서로 같고, 결과적으로 **멀쩡한 문장을 가리키며
 *   "이 garble 반복 금지"** 를 다음 보고서 프롬프트에 주입했다(최근 7일 주입 251회).
 *   설계 의도는 옳았다 — 자르는 위치가 틀렸을 뿐이다.
 *
 * 공통 접두/접미를 걷어내고 가운데(=바뀐 곳)만 남긴다. 문자 단위라 한국어에도 그대로 쓴다.
 */

/**
 * @param {string} before 교정 전
 * @param {string} after  교정 후
 * @param {{max?:number, ctx?:number}} opts max: 각 조각 최대 길이, ctx: 앞뒤 문맥 글자수
 * @returns {{before:string, after:string}|null} 차이가 없으면 null
 */
export function diffFragment(before, after, opts = {}) {
  const { max = 80, ctx = 12 } = opts;
  const b = String(before ?? '');
  const a = String(after ?? '');
  if (b === a) return null;

  // 공통 접두
  let s = 0;
  const lim = Math.min(b.length, a.length);
  while (s < lim && b[s] === a[s]) s++;
  // 공통 접미 (접두와 겹치지 않게)
  let e = 0;
  while (e < lim - s && b[b.length - 1 - e] === a[a.length - 1 - e]) e++;

  const from = Math.max(0, s - ctx);
  const cut = (str) => {
    const frag = str.slice(from, str.length - e + ctx);
    return frag.length <= max ? frag : `${frag.slice(0, max - 1)}…`;
  };
  return { before: cut(b), after: cut(a) };
}
