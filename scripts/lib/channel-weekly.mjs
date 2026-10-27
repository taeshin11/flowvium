/**
 * channel-weekly.mjs (lib) — 날짜별 채널 합계를 7일 묶음으로 비교한다. 근거는 channel-weekly.test.mjs.
 *   묶음: endDate 부터 거꾸로 7일씩 4주(최근 주 = weeks[0]). 28일 가운데 값 = 4주 값의 가운데(짝수라 가운데 둘의 평균).
 *   저장(재생목록 추가)은 쇼츠·롱폼으로 나눈 질의를 API 가 받지 않는다(10/27 실측) — 뺀다.
 *   비율 지표(1천 회당·평균 시청)는 주마다 합계로 다시 계산한다 — 날짜별 비율을 평균하면 적은 날이 크게 셈된다.
 */
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const median = (xs) => { const s = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

export function mark(last, prev) {
  if (last == null || prev == null || prev === 0) return '·';
  const ch = (last - prev) / Math.abs(prev);
  return ch > 0.1 ? '▲' : ch < -0.1 ? '▼' : '■';
}

export function weekCompare(rows, traffic, endDate) {
  const weeks = [0, 1, 2, 3].map((w) => ({ from: addDays(endDate, -7 * w - 6), to: addDays(endDate, -7 * w) }));
  const inW = (d, w) => d >= w.from && d <= w.to;
  const sum = (w, k) => rows.filter((r) => inW(r.day, w)).reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const per = weeks.map((w) => {
    const views = sum(w, 'views');
    const mins = sum(w, 'estimatedMinutesWatched');
    // 평균 시청 비율은 조회수 가중 평균(합계에서 다시 못 구하는 값이라)
    const pctW = rows.filter((r) => inW(r.day, w)).reduce((a, r) => a + (Number(r.averageViewPercentage) || 0) * (Number(r.views) || 0), 0);
    const k1 = (x) => (views ? (x * 1000) / views : null);
    const src = (s) => traffic.filter((t) => inW(t.day, w) && t.src === s).reduce((a, t) => a + t.views, 0);
    return {
      views,
      engagedRate: views ? sum(w, 'engagedViews') / views : null,
      avgViewSec: views ? (mins * 60) / views : null,
      avgViewPct: views ? pctW / views : null,
      subsPer1k: k1(sum(w, 'subscribersGained') - sum(w, 'subscribersLost')),
      likesPer1k: k1(sum(w, 'likes')), commentsPer1k: k1(sum(w, 'comments')), sharesPer1k: k1(sum(w, 'shares')),
      endScreenShare: views ? src('END_SCREEN') / views : null,
      relatedShare: views ? src('RELATED_VIDEO') / views : null,
      searchShare: views ? src('YT_SEARCH') / views : null,
    };
  });
  const names = Object.keys(per[0]);
  const metrics = names.map((name) => {
    const vals = per.map((p) => p[name]);
    const pct = /Rate|Share|Pct/.test(name) && name !== 'avgViewPct';
    const f = (x) => (x == null ? null : pct ? r1(x * 100) : r1(x));
    return { name: pct ? `${name}(%)` : name, last: f(vals[0]), prev: f(vals[1]), median28: f(median(vals)), mark: mark(vals[0], vals[1]), belowMedian: vals[0] != null && median(vals) != null && vals[0] < median(vals), lowN: per[0].views < 500 };
  });
  return { weeks, metrics };
}
