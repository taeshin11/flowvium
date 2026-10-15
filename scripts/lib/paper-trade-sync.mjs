/**
 * paper-trade-sync.mjs — 최신 보고서 회차를 가상매매에 한 번씩 넘긴다(순수 부분). 근거는 paper-trade-sync.test.mjs.
 */
/** reports: [{id, generatedAt, portfolio}] → 아직 처리 안 한 '가장 최근' 회차 하나(없으면 null). */
export function pickNewReport(reports, { lastId }) {
  const latest = [...(reports ?? [])].sort((a, b) => String(a.generatedAt).localeCompare(String(b.generatedAt))).at(-1);
  if (!latest || latest.id === lastId) return null;
  if (!Array.isArray(latest.portfolio) || latest.portfolio.length === 0) return null;
  return latest;
}
