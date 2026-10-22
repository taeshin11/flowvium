/**
 * macro-valid.mjs — /api/macro-indicators 의 지표 중 관측이 아닌 것(점검 HTML 을 읽은 값)을 뺀다. 근거는 macro-valid.test.mjs 머리말.
 */
const DAY = /^\d{4}-\d{2}-\d{2}/;

/** @returns {{kept: object[], dropped: string[]}} */
export function validMacroIndicators(list) {
  const kept = []; const dropped = [];
  for (const x of Array.isArray(list) ? list : []) {
    const strings = Object.values(x ?? {}).filter((v) => typeof v === 'string');
    const badDate = x?.releaseDate != null && !DAY.test(String(x.releaseDate));
    if (badDate || strings.some((s) => s.includes('<'))) dropped.push(String(x?.id ?? '?'));
    else kept.push(x);
  }
  return { kept, dropped };
}
