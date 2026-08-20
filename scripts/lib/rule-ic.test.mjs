#!/usr/bin/env node
/**
 * rule-ic.test.mjs — 룰별 정보계수(IC) 유도 검증.
 *
 * 배경(2026-08-20 실측):
 *   · 매수룰 10개 중 9개가 초과수익 양수인데(micro_news_gap +8.32%p 승률 100%,
 *     fund_op_margin_expansion -4.10%p 승률 33%), 선정은 '총점 합산 순위'로 한다.
 *   · 총점 ↔ 초과수익 상관 r=0.333 (약함). 반면 강한 룰 보유 여부는 +12.24%p 를 가른다(n=59).
 *   · 즉 약한 룰 여러 개가 강한 룰 하나를 점수로 이긴다 — 신호 희석.
 *     (선행연구: coarse sort 가 extreme-signal 종목을 near-mean 과 평균내 신호를 뭉갠다.
 *      표준 처방은 IC 가중 또는 조건부 게이팅.)
 *   · 강한 룰 목록을 코드에 박으면 그 자체가 하드코딩이고 다음 분기에 틀린다.
 *     실측 성과에서 매번 유도해야 한다.
 */
const M = await import('./rule-ic.mjs').catch(() => null);
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };
if (!M?.deriveRuleIC) { bad('deriveRuleIC 미구현 — 룰 가중이 유도되지 않는다'); console.log('\n결과: 실패 1건'); process.exit(1); }

const ic = M.deriveRuleIC({ dbPath: 'data/flowvium.db', minSample: 15 });
Array.isArray(ic) && ic.length ? ok(`룰 ${ic.length}개 IC 유도`) : bad(`IC 유도 실패 (${ic?.length})`);

// ① 표본 미달은 제외 — 근거 없이 가중하지 않는다
ic.every(x => x.n >= 15) ? ok('minSample 미만 제외') : bad(`표본 부족 포함: ${ic.filter(x=>x.n<15).map(x=>x.id).join(',')}`);

// ② 모든 항목에 표본수·근거
ic.every(x => x.n != null && x.excess != null && x.win != null) ? ok('n·초과수익·승률 부착') : bad('근거 누락');

// ③ 실측에서 확인된 순서가 재현돼야 한다 (news_gap > op_margin_expansion)
const a = ic.find(x => x.id === 'micro_news_gap'), b = ic.find(x => x.id === 'fund_op_margin_expansion');
(a && b && a.weight > b.weight) ? ok(`가중 순서 재현: ${a.id}=${a.weight.toFixed(2)} > ${b.id}=${b.weight.toFixed(2)}`)
                                : bad(`순서 미재현 (${a?.weight} vs ${b?.weight})`);

// ④ 초과수익 음수 룰은 가중이 0 이하 — 점수를 더해주면 안 된다
const negs = ic.filter(x => x.excess < 0);
negs.every(x => x.weight <= 0) ? ok(`초과수익 음수 룰 ${negs.length}개의 가중 ≤ 0`) : bad('음수 룰에 양수 가중');

// ⑤ 데이터 없으면 빈 배열 — 지어내지 않는다
M.deriveRuleIC({ dbPath: 'data/flowvium.db', minSample: 999999 }).length === 0
  ? ok('표본 부족 시 빈 배열') : bad('표본 없는데 IC 생성');

// ⑥ 가중 점수 계산이 가능해야 하고, 가중 없는 룰은 기여 0
const w = M.icWeightedScore(['micro_news_gap', 'fund_op_margin_expansion', '존재하지않는룰'], ic);
typeof w === 'number' ? ok(`IC 가중 점수 계산 = ${w.toFixed(3)}`) : bad('가중 점수 계산 실패');

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
