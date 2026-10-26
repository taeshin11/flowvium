/**
 * naver-blog.mjs — 네이버 블로그 게시(scripts/naver-blog-post.mjs)의 순수 부분. 2026-10-26 신설.
 *   브라우저를 띄우지 않고 시험할 수 있게 떼어 둔다(naver-blog.test.mjs).
 */
import { join } from 'path';

export const NAVER_CATEGORY = 'AI주식분석';

/** 네이버 편집기는 붙여 넣은 문단 사이에 여백을 두지 않는다 — 덩어리 뒤에 빈 줄을 넣어 읽히게 한다. */
export function naverHtml(html) {
  return html
    .replace(/(<\/(?:p|ul|table|blockquote)>)/g, '$1<p><br></p>')
    .replace(/<p><br><\/p>(?:<p><br><\/p>)+/g, '<p><br></p>');
}

/** 태그는 블로그 안 분류·검색용. 날짜가 아니라 주제로 붙인다(Blogger 라벨과 같은 기준). */
export function tagsFor(key, md) {
  return [NAVER_CATEGORY, '주식', key.startsWith('analysis/') ? '추천성적' : '증시브리핑',
    ...(/코스피|코스닥|한국 종목/.test(md) ? ['국내증시'] : []),
    ...(/나스닥|S&P ?500|미국 종목/.test(md) ? ['미국증시'] : []), '플로비움'];
}

/**
 * 올릴 글을 고른다. 하루 글은 **오늘** 아침 글 하나뿐 — 없으면 지난 글을 끌어오지 않는다.
 * 분석 글(analysis/)은 제목이 따로 있는 별도 글이라 안 올린 것을 모두 올린다.
 * @returns {{file:string,key:string}[]}
 */
export function pickFiles({ dir, today, exists, daily = false, wantAnalysis = false, analysis = [], ledger = {}, force = false }) {
  const out = [];
  if (daily) {
    const f = join(dir, `${today}-morning.md`);
    if (exists(f)) out.push({ file: f, key: `${today}-morning.md` });
  }
  if (wantAnalysis) for (const n of [...analysis].sort()) out.push({ file: join(dir, 'analysis', n), key: `analysis/${n}` });
  return out.filter((x) => force || !ledger[x.key]?.url);
}
