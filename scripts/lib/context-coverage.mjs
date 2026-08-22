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

/**
 * describeContextShapes — 각 섹션이 *실제로 어떤 키를 갖는지* 기록한다.
 *
 * 왜(2026-08-22): 같은 부류의 버그를 이 저장소에서 세 번 만났다 —
 *   ① preferSmallModel: 선언만 하고 라우팅에서 안 씀
 *   ② ctx.news?.articles: 존재하지 않는 필드를 읽어 micro_news_positive 가 개통 이래 0 발화
 *   ③ ctxRaw.cascade[].downstreamBeneficiaries: 그 스키마에 없는 필드 → 공급망 룰 발화 불가
 *   셋 다 "읽는 쪽이 없는 필드를 읽고 `?? []` 가 조용히 삼킨" 경우다. 몇 달간 무증상이었다.
 *
 * 정적 분석으로 잡으려면 unwrap 체인(`newsCascade?.articles ?? []`)까지 재현해야 해서
 *   깨지기 쉽다. 그래서 *실행 시점의 진짜 모양* 을 남긴다 —
 *   매 보고서 실행마다 갱신되므로 항상 현재를 반영한다.
 *   값은 담지 않는다(시크릿·대용량 회피). 키 이름과 종류만이다.
 */
export function describeContextShapes(ctx) {
  const out = {};
  if (!ctx || typeof ctx !== 'object') return out;
  const keysOf = (o) => (o && typeof o === 'object' && !Array.isArray(o)) ? Object.keys(o).slice(0, 60) : [];
  for (const [k, v] of Object.entries(ctx)) {
    if (Array.isArray(v)) {
      // 배열 섹션은 *원소* 의 키가 중요하다 — 버그 ③ 이 정확히 이 자리였다.
      //   원소마다 키가 다를 수 있으므로 앞쪽 표본의 합집합을 쓴다.
      const union = new Set();
      for (const el of v.slice(0, 20)) for (const kk of keysOf(el)) union.add(kk);
      out[k] = { kind: 'array', n: v.length, elementKeys: [...union].sort() };
    } else if (v && typeof v === 'object') {
      out[k] = { kind: 'object', keys: keysOf(v).sort() };
    } else {
      out[k] = { kind: v === null || v === undefined ? 'null' : typeof v };
    }
  }
  return out;
}
