/**
 * region-flow.mjs — 지역 스탠스 판정에 넣을 수급/지수 요약을 만든다.
 *
 * 배경(2026-08-20 실측): korea stance=bearish 의 근거가 "EWY 1w-0.8%, Foreign Net:-30798억" 뿐이었다.
 *   같은 보고서가 이미 계산해 갖고 있던 KOSPI 당일 +4.9% 는 스탠스 입력에 들어가지 않았다.
 *   EWY 는 *달러 표시 ETF 의 1주* 수익률이라 당일 급등을 아직 못 담는 후행 지표인데, 그것이
 *   당일 +4.9% 를 이겨 bearish 가 됐고 그 스탠스가 KR 전 종목 매수 거부로 이어졌다.
 *   (거부가 단독으로 성립하던 구조는 signal-scope.mjs 에서 분리했다. 여기서는 판정 '입력'을 고친다.)
 *
 *   표시통화를 반드시 라벨링한다. 원화가 하루 1.7% 움직이면 원화표시 KOSPI 와 달러표시 EWY 는
 *   구조적으로 갈리는데, 라벨이 없으면 모델이 둘을 같은 것으로 읽고 한쪽만 인용한다.
 *
 *   결측은 창작하지 않고 생략한다 — 이 저장소의 '결측은 명시, plumbing 창작 금지' 규율.
 */

/** @returns {string} 스탠스 프롬프트에 넣을 한 줄. 데이터가 하나도 없으면 ''. */
export function buildKoreaFlowLine(ctx = {}) {
  const parts = [];

  // [1] 원화 표시 지수 — 당일 등락. 가장 신선한 신호이므로 앞에 둔다.
  const idx = ctx.indexLevelsMap ?? {};
  const idxParts = [];
  for (const label of ['KOSPI', 'KOSDAQ']) {
    const v = idx[label];
    if (typeof v === 'number' && Number.isFinite(v)) idxParts.push(`${label} ${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);
  }
  if (idxParts.length) parts.push(`Korea index (KRW, 전일대비): ${idxParts.join(' ')}`);

  // [2] 달러 표시 지역 ETF — 1주/4주. 후행이지만 외국인 관점 수익률이라 유지한다.
  try {
    const korea = (ctx.capital?.countryFlow?.countries ?? []).find(c => c.id === 'korea');
    if (korea && (korea.ret1w != null || korea.ret4w != null)) {
      parts.push(`Korea ETF EWY (USD, 후행): 1w=${korea.ret1w?.toFixed(1) ?? '?'}% 4w=${korea.ret4w?.toFixed(1) ?? '?'}%`);
    }
  } catch { /* 결측은 생략 */ }

  // [3] 외국인 수급
  try {
    const kf = ctx.koreaFlow;
    const net = kf?.foreignNet ?? kf?.netBuy;
    if (net != null && Number.isFinite(net)) {
      parts.push(`Foreign net: ${net > 0 ? '+' : ''}${(net / 1e8).toFixed(1)}억`);
    }
  } catch { /* 결측은 생략 */ }

  if (!parts.length) return '';
  // 통화가 다른 두 수치를 같이 줄 때는 해석 지침을 함께 준다 — 라벨만으로는 모델이 종종 뭉갠다.
  if (idxParts.length && /EWY/.test(parts.join(' '))) {
    parts.push('※ KRW 지수와 USD ETF 가 갈리면 환율 영향 — 어느 쪽을 근거로 삼았는지 명시할 것');
  }
  return parts.join(' | ');
}
