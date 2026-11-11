// price-window.mjs — 시세 점을 '최근 N일(달력)'로 자른다. 2026-11-11.
// 공급원마다 여유분을 붙여 받고 거래일 수로 잘랐더니, 거래일이 N개보다 적은 구간(휴일·주말)에선 하나도 안 잘려
//   '90일'이 105일이 됐다(lib/price-window.test 머리말). 날짜로 자른다. 선을 그리려면 2개는 남긴다.
export function withinDays(points, days, now = Date.now()) {
  const cutoff = new Date(now - days * 86400e3).toISOString().slice(0, 10);
  const kept = points.filter((p) => !/^\d{4}-\d{2}-\d{2}/.test(p.date) || p.date.slice(0, 10) >= cutoff);
  return kept.length >= 2 ? kept : points.slice(-2);
}
