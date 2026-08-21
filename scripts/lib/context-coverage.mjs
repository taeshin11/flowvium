/**
 * context-coverage.mjs — 수집된 컨텍스트의 결측/공백을 *전 구간* 파악한다.
 *
 * 왜 파생인가: 종전 ctxNullCheck 은 손으로 적은 목록이라 실제와 갈렸다.
 *   실측(2026-08-21): gatherContext 가 25종을 반환하는데 14종만 검사하고 있었다.
 *   덮이지 않은 11종(blockTrades·credit·fearGreedAssets·fearGreedByCountry·fundFlows·fx·
 *   narratives·newsGap·optionsFlow·supplyChainSignals·ticFlows)은 비어도 로그 한 줄 없었다.
 *   같은 세션에 '조용히 빈 값' 으로 신호가 죽는 사고를 두 번 겪었다
 *   (ctxRaw.shorts 오타 · ctxRaw.companyFinancials 부재).
 *   목록을 늘리는 대신 객체에서 파생한다 — 새 섹션이 생기면 자동으로 검사 대상이 된다.
 *
 * null 과 빈 컬렉션을 구분한다:
 *   failed — null/undefined. 수집이 실패했거나 키가 없다.
 *   empty  — 응답은 왔는데 내용이 없다(빈 배열/객체/문자열/Map, {entries:[]} 래핑 포함).
 *   대응이 다르므로 뭉치면 원인 추적이 안 된다.
 *
 * 0 과 false 는 값이다. '비었다'로 분류하지 않는다.
 */

/** 컬렉션류의 내용 유무. 값(0/false/숫자/비어있지 않은 문자열)은 항상 내용 있음. */
function isEmptyValue(v) {
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'string') return v.length === 0;
  if (v instanceof Map || v instanceof Set) return v.size === 0;
  if (v && typeof v === 'object') {
    // { entries: [...] } 래핑 — ctxRaw.short 가 이 형태다.
    if (Array.isArray(v.entries)) return v.entries.length === 0;
    if (Array.isArray(v.items)) return v.items.length === 0;
    return Object.keys(v).length === 0;
  }
  return false;   // 숫자·불리언 등 스칼라는 값이다
}

/**
 * @param {Record<string, unknown>} ctx  수집된 원본 컨텍스트(gatherContext 산출)
 * @returns {{failed:string[], empty:string[], ok:string[], total:number}}
 */
export function inspectContextSections(ctx) {
  const out = { failed: [], empty: [], ok: [], total: 0 };
  if (!ctx || typeof ctx !== 'object') return out;
  for (const [k, v] of Object.entries(ctx)) {
    out.total++;
    if (v === null || v === undefined) out.failed.push(k);
    else if (isEmptyValue(v)) out.empty.push(k);
    else out.ok.push(k);
  }
  return out;
}

/** 로그 한 줄. 호출부가 매번 같은 문장을 다시 쓰지 않도록. */
export function formatContextCoverage(r) {
  const parts = [`섹션 ${r.total}종 — 정상 ${r.ok.length}`];
  if (r.failed.length) parts.push(`수집실패 ${r.failed.length}(${r.failed.join(', ')})`);
  if (r.empty.length) parts.push(`내용없음 ${r.empty.length}(${r.empty.join(', ')})`);
  return parts.join(' · ');
}
