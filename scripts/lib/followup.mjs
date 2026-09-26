/**
 * followup.mjs — 24~72시간 안에 다룬 이슈의 '후속 편' 판정과 대본 지시. 2026-09-27. 근거는 followup.test.mjs 머리말.
 */
const norm = (k) => String(k ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * @param {string} keyword 이번 후보의 키워드
 * @param {{issue_key:string, published_at:string, headline:string, views:number, dayMedian:number}[]} episodes 최근 편
 * @returns {{hoursAgo:number, headline:string, good:boolean}|null}
 */
export function followupInfo(keyword, episodes, now = Date.now()) {
  const k = norm(keyword);
  if (!k) return null;
  const hits = (episodes ?? []).filter((e) => norm(e.issue_key) === k)
    .map((e) => ({ ...e, h: (now - Date.parse(e.published_at)) / 3600e3 }))
    .filter((e) => e.h >= 24 && e.h <= 72)
    .sort((a, b) => a.h - b.h);
  if (!hits.length) return null;
  const p = hits[0];
  return { hoursAgo: Math.round(p.h), headline: p.headline, good: Number(p.views) >= Number(p.dayMedian) };
}

export function followupPromptLine(info) {
  if (!info) return '';
  return `- **이 이슈는 ${info.hoursAgo}시간 전에 한 번 다뤘다**(지난 편: "${String(info.headline).slice(0, 60)}"). `
    + '지난 편 이후 **새로 나온 사실**부터 말하라. 지난 편 내용을 되풀이하지 마라 — 같은 말이면 시청자가 넘긴다.';
}
