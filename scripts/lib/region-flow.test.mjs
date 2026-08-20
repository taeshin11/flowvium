#!/usr/bin/env node
/**
 * region-flow.test.mjs — 지역 스탠스 판정에 들어가는 데이터의 완전성.
 *
 * 배경(2026-08-20 실측): korea stance=bearish 의 근거가 "EWY 1w-0.8%, Foreign Net:-30798억" 뿐이었다.
 *   같은 보고서가 별도로 계산해 갖고 있던 데이터는 스탠스 입력에 들어가지 않았다:
 *     KOSPI 당일 +4.9% · KOSDAQ 20일 KOSPI 대비 +11.1%p 우위 · 원달러 -1.7%(외국인 유입 우호)
 *   EWY 는 달러 표시 ETF 의 *1주* 수익률이라 당일 급등을 아직 반영하지 못하는 후행 지표인데,
 *   그것이 당일 +4.9% 를 이겨 bearish 로 판정됐고, 그 스탠스가 KR 전 종목 매수 거부로 이어졌다.
 *   (거부 구조 자체는 signal-scope.mjs 로 분리했다. 여기서는 판정 입력을 고친다.)
 *
 *   원화 표시 지수와 달러 표시 ETF 를 나란히 줄 때는 표시통화를 명시해야 한다 —
 *   원화가 1.7% 움직이면 둘은 구조적으로 갈린다. 라벨 없이 주면 모델이 둘을 같은 것으로 읽는다.
 */
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

let R;
try { R = await import('./region-flow.mjs'); }
catch (e) { console.log(`  FAIL  모듈 없음: ${e.message}`); process.exit(1); }

const ctx = {
  capital: { countryFlow: { countries: [{ id: 'korea', ret1w: -0.8, ret4w: 2.1 }] } },
  koreaFlow: { foreignNet: -3.0798e12 },
  indexLevelsMap: { KOSPI: 4.9, KOSDAQ: 3.2, 'S&P500': 0.1 },
};
const line = R.buildKoreaFlowLine(ctx);
console.log(`  생성된 줄: ${line}`);

/EWY/.test(line) ? ok('EWY 유지 (기존 정보 손실 없음)') : bad('EWY 가 빠짐');
/Foreign net|외국인/.test(line) ? ok('외국인 수급 유지') : bad('외국인 수급이 빠짐');
/KOSPI/.test(line) && /4\.9/.test(line) ? ok('KOSPI 당일 +4.9% 포함 (종전 누락)') : bad('당일 지수 등락이 여전히 빠짐');
/KOSDAQ/.test(line) ? ok('KOSDAQ 포함') : bad('KOSDAQ 누락');
/USD|달러/.test(line) ? ok('EWY 표시통화 명시 (원화 지수와 혼동 방지)') : bad('통화 라벨 없음 — 모델이 원화지수와 동일시');
/KRW|원화/.test(line) ? ok('지수 표시통화 명시') : bad('지수 통화 라벨 없음');

// 데이터가 없을 때 창작하지 않는다 — 이 저장소의 '결측은 명시, 창작 금지' 규율
const empty = R.buildKoreaFlowLine({});
empty === '' || /미가용|no data|없음/i.test(empty)
  ? ok(`결측 시 창작 안 함: ${JSON.stringify(empty)}`) : bad(`결측인데 값을 만듦: ${empty}`);

// 부분 결측 — 있는 것만 싣는다
const partial = R.buildKoreaFlowLine({ indexLevelsMap: { KOSPI: -2.1 } });
/KOSPI/.test(partial) && !/EWY/.test(partial)
  ? ok('부분 결측: 있는 것만 (EWY 없으면 EWY 생략)') : bad(`부분 결측 처리 이상: ${partial}`);

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
