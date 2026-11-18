/**
 * blog-video.mjs — 증시 블로그 글에 걸 우리 쇼츠를 고른다. 근거는 blog-video.test.mjs 머리말.
 */
// 증시 글과 이어지는 쇼츠 주제(shorts_published.topic). 정치·사건 편은 증시 글에 걸지 않는다.
export const BLOG_TOPICS = Object.freeze(['증시·금리·환율', '기업·산업', '주식 상식', '부동산']);

/** rows: shorts_published 행(내린 편 제외). before 가 있으면 그 시각 이전 편만. 증시 쪽 최신 → 없으면 아무 최신. */
export function pickBlogShort(rows, { before = null } = {}) {
  const cand = (rows ?? []).filter((r) => r?.video_id && (!before || String(r.published_at) <= String(before)))
    .sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));
  return cand.find((r) => BLOG_TOPICS.includes(r.topic)) ?? cand[0] ?? null;
}

/** 글 끝 '최근 영상' 줄의 영상을 바꾼다(이미 올린 글을 보강할 때 본문 중간 썸네일과 끝 링크를 같은 영상으로). */
export function relinkVideo(md, videoId) {
  if (!videoId) return md;
  return String(md).replace(/(최근 영상:\s*https:\/\/www\.youtube\.com\/watch\?v=)[\w-]{11}/, `$1${videoId}`);
}
