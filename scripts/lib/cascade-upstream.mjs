/**
 * cascade-upstream.mjs — 공급망 downstream 수혜 티커 집합을 만든다.
 *
 * 왜 별도 모듈인가(2026-08-22): 이 배선이 죽어 있었고, 죽은 걸 아무도 몰랐다.
 *   generate-report-local.mjs:6955 가 이렇게 쓰고 있었다:
 *     new Set((ctxRaw?.cascade ?? []).flatMap(c => (c.downstreamBeneficiaries ?? []).map(...)))
 *   그런데 `ctxRaw.cascade` 는 news-cascade **기사** 배열이다(:3882). 실측 스키마는
 *     title·link·pubDate·source·region·id·summary·sentiment·importance·cascades·analyzedAt·analysisSource
 *   — downstreamBeneficiaries 가 없다. 그 필드를 만드는 건 /api/supply-chain-signals 이고
 *   ctxRaw 에는 `supplyChainSignals` 로 따로 담긴다(:3887). *다른 객체* 를 읽고 있었다.
 *
 *   결과: Set 이 언제나 비어 `micro_cascade_upstream` 룰은 발화가 구조적으로 불가능했다.
 *   최근 12개 보고서·후보 382행 실측에서 이 룰 발화 0회 — 이 사이트의 핵심 서사가 공급망인데도.
 *   `?? []` 가 조용히 삼켜서 몇 달간 증상이 안 보였다(preferSmallModel·ctx.news?.articles 와 같은 부류).
 *
 * 순수 함수로 뺀 이유: '어느 변수를 읽는가' 가 아니라 '그 객체가 실제로 그 필드를 갖는가' 를
 *   실측 스키마로 테스트하기 위해서다. 인라인 표현식은 그걸 검사할 방법이 없다.
 */

/**
 * @param {{ supplyChainSignals?: any[] }} ctx  gatherContext 결과(ctxRaw)
 * @returns {Set<string>} downstream 수혜 티커
 */
export function buildCascadeUpstreamSet(ctx) {
  const out = new Set();
  const signals = Array.isArray(ctx?.supplyChainSignals) ? ctx.supplyChainSignals : [];
  for (const s of signals) {
    const list = Array.isArray(s?.downstreamBeneficiaries) ? s.downstreamBeneficiaries : [];
    for (const d of list) {
      // route.ts 는 string[] 을 주고, db.mjs 주석은 객체형도 언급한다 — 둘 다 받는다.
      const t = typeof d === 'string' ? d : d?.ticker;
      if (t) out.add(String(t));
    }
  }
  return out;
}
