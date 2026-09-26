/**
 * yt-post-text.mjs — 매일 게시물 글·대상 영상 고르기(순수). 2026-09-27. 근거는 yt-post-text.test.mjs 머리말.
 */
export function buildPostText({ title, videoId }) {
  const t = String(title ?? '').replace(/\s*#Shorts\s*/gi, ' ').trim();
  return [
    `오늘 가장 많이 본 40초 뉴스 — ${t}`,
    '',
    `▶ https://youtube.com/shorts/${videoId}`,
    '',
    '한국과 미국을 움직인 뉴스를 매일 40초로 정리합니다. 구독해 두시면 놓치지 않습니다.',
  ].join('\n');
}

/** 내리지 않은 편 중 조회 최고. rows: {video_id, views, retracted_at, title} */
export function pickPostVideo(rows) {
  const live = (rows ?? []).filter((r) => r.video_id && !r.retracted_at);
  if (!live.length) return null;
  return live.sort((a, b) => (b.views ?? 0) - (a.views ?? 0))[0];
}
