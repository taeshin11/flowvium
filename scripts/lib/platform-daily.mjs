/**
 * platform-daily.mjs — 플랫폼별 일일 기록의 계산(순수 함수). 근거·규칙은 platform-daily.test.mjs 머리말.
 * 실행은 scripts/platform-daily.mjs.
 */
const r3 = (x) => Math.round(x * 1000) / 1000;
const r2 = (x) => Math.round(x * 100) / 100;

/** YouTube Analytics 하루치 → 기록 한 줄. 노출·CTR 은 API 가 주지 않아 null. */
export function ytRecord({ day, views, engagedViews, averageViewPercentage, subscribersGained, subscribersLost, shares }) {
  const v = Number(views) || 0;
  return {
    date: day, platform: 'youtube',
    impressions: null, ctr: null,
    views: v,
    viewedRate: v ? r3((Number(engagedViews) || 0) / v) : null,
    avgViewPct: averageViewPercentage == null ? null : r2(Number(averageViewPercentage)),
    subsGained: Number(subscribersGained) || 0,
    subsLost: Number(subscribersLost) || 0,
    netSubs: (Number(subscribersGained) || 0) - (Number(subscribersLost) || 0),
    subsPer1k: v ? r2((1000 * (Number(subscribersGained) || 0)) / v) : null,
    shares: shares == null ? null : Number(shares),
  };
}

/** [[day, views], …] 에서 조회가 찬 마지막 날. 없으면 null. */
export function lastFilledDay(rows) {
  const filled = (rows ?? []).filter((r) => Number(r[1]) > 0).map((r) => r[0]).sort();
  return filled.at(-1) ?? null;
}

/** 같은 날·같은 플랫폼 줄을 바꾸고, 없으면 붙인다. 날짜·플랫폼 순으로. */
export function upsertDaily(lines, rec) {
  const rest = (lines ?? []).filter((l) => !(l.date === rec.date && l.platform === rec.platform));
  return [...rest, rec].sort((a, b) => (a.date + a.platform).localeCompare(b.date + b.platform));
}

/** Blogger 페이지뷰 → 기록 한 줄. 하루 조회는 이전 기록 누적과의 차이(없으면 null). */
export function blogRecord({ date, counts, posts, prev }) {
  const all = counts?.ALL_TIME == null ? null : Number(counts.ALL_TIME);
  return {
    date, platform: 'blogger',
    impressions: null, ctr: null, subsPer1k: null, avgViewPct: null, shares: null,
    viewsAll: all,
    viewsDay: all != null && prev?.viewsAll != null ? all - prev.viewsAll : null,
    views7d: counts?.SEVEN_DAYS == null ? null : Number(counts.SEVEN_DAYS),
    views30d: counts?.THIRTY_DAYS == null ? null : Number(counts.THIRTY_DAYS),
    posts: posts == null ? null : Number(posts),
  };
}
