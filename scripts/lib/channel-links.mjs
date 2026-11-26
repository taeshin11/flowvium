/**
 * channel-links.mjs — 채널 프로필 링크를 어떤 순서로 다시 쓸지 정한다. 근거는 channel-links.test.mjs 머리말.
 * @param {{title:string,url:string}[]} rows 지금 Studio 링크 칸 순서
 * @param {string} match 맨 앞으로 올릴 링크 주소의 일부(예: 'aisviagent.com')
 * @returns {{changed:boolean, order:{title:string,url:string}[], why?:string}}
 */
export function planLinkFirst(rows, match) {
  const list = (rows ?? []).map((r) => ({ title: String(r.title ?? ''), url: String(r.url ?? '') }));
  const k = list.findIndex((r) => r.url.includes(match));
  if (k < 0) return { changed: false, order: list, why: `'${match}' 링크가 없다` };
  if (k === 0) return { changed: false, order: list, why: '이미 첫 링크다' };
  return { changed: true, order: [list[k], ...list.filter((_, i) => i !== k)] };
}
