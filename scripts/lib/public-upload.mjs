// public-upload.mjs — 로그아웃 공개 화면 기준 마지막 실제 공개와 22:00 보고 첫 줄. 근거는 public-upload.test.mjs 머리말. (2026-11-13)
export const EMERGENCY_HOURS = 48;
export const feedUrl = (channelId) => `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;

const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

export function parseFeed(xml) {
  return [...String(xml).matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    videoId: /<yt:videoId>([^<]+)<\/yt:videoId>/.exec(e)?.[1] ?? null,
    title: unescape(/<title>([^<]*)<\/title>/.exec(e)?.[1] ?? ''),
    published: /<published>([^<]+)<\/published>/.exec(e)?.[1] ?? null,
  })).filter((x) => x.videoId && x.published && !Number.isNaN(Date.parse(x.published)));
}

export function lastPublic(entries) {
  return entries.reduce((best, e) => (!best || Date.parse(e.published) > Date.parse(best.published) ? e : best), null);
}

const kst = (ms) => new Date(ms + 9 * 3600e3).toISOString().replace(/^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2}).*/, '$1/$2 $3:$4');

/** 22:00 보고 첫 줄. 공개 시각을 못 읽으면 '모름'이 아니라 비상이다 — 확인 못 한 것을 괜찮다고 쓰지 않는다. */
export function firstLine({ last, hours, now = Date.now() }) {
  const reserve = `예비 ${hours}시간`;
  if (!last || Number.isNaN(Date.parse(last))) return `🚨 비상 — 공개 화면에서 영상을 못 읽음 · ${reserve}`;
  const t = Date.parse(last);
  const age = (now - t) / 3600e3;
  if (age > EMERGENCY_HOURS) return `🚨 비상 — 마지막 실제 공개 ${kst(t)} (${Math.floor(age)}시간 전) · ${reserve}`;
  return `마지막 실제 공개 ${kst(t)} · ${reserve}`;
}
