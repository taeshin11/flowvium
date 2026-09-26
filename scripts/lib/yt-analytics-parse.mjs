/**
 * yt-analytics-parse.mjs — 유튜브 분석 API(reports.query, dimensions=video) 응답을 영상별로. 2026-09-26.
 * 열은 **헤더 이름으로** 찾는다(metrics 순서가 바뀌어도 틀리지 않게).
 * engagedRatio = engagedViews / views — 쇼츠에서 첫 순간 넘기지 않고 본 비율. 조회수와 상관 0.56(실측).
 */
export function parseAnalyticsRows(columnHeaders, rows) {
  const idx = Object.fromEntries((columnHeaders ?? []).map((h, i) => [h.name, i]));
  const num = (row, k) => (idx[k] == null || row[idx[k]] == null ? null : Number(row[idx[k]]));
  const out = new Map();
  for (const row of rows ?? []) {
    const views = num(row, 'views');
    const eng = num(row, 'engagedViews');
    out.set(row[idx.video], {
      subs: num(row, 'subscribersGained'),
      engagedRatio: views > 0 && eng != null ? eng / views : null,
      avgViewPct: num(row, 'averageViewPercentage'),
    });
  }
  return out;
}
