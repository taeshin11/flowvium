#!/usr/bin/env node
/**
 * allocation-normalize.test.mjs — 비중 정규화가 '레짐 현금'을 존중하는가.
 *
 * 배경(2026-08-20): 시장 국면 신호를 거부(veto)에서 노출(비중)로 옮기면서 심판 단계에서
 *   비중을 축소했는데, applyLocalHarness(8688행)가 그 뒤에 돌면서 합계를 100으로 재정규화해
 *   축소분을 그대로 되돌렸다 — 즉 내 수정은 no-op 이었다.
 *   (코드를 넣은 것과 효과가 나는 것은 다르다. 실행 순서를 확인하지 않으면 이런 게 조용히 통과한다.)
 *
 *   저장소에는 이미 '현금도 포지션' 규율이 있다(종목 4개 미만이면 25% 캡 + 잔여 현금 명시).
 *   레짐 축소도 같은 방식으로 — 줄인 만큼을 현금으로 명시하고, 정규화 목표를 그만큼 낮춘다.
 */
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

let A;
try { A = await import('./allocation-normalize.mjs'); }
catch (e) { console.log(`  FAIL  모듈 없음: ${e.message}`); process.exit(1); }

const sum = (pf) => pf.reduce((s, p) => s + (p.allocation ?? 0), 0);

// [1] 레짐 현금 없음 → 종전대로 100 정규화
let pf = [{ ticker: 'A', allocation: 30 }, { ticker: 'B', allocation: 30 },
          { ticker: 'C', allocation: 30 }, { ticker: 'D', allocation: 30 }];
let r = A.normalizeAllocations(pf, { regimeCashReserve: 0 });
sum(r.portfolio) === 100 ? ok(`레짐 현금 0 → 합계 100 (${sum(r.portfolio)})`) : bad(`합계 ${sum(r.portfolio)}`);

// [2] 핵심 — 레짐 현금 35%면 투자비중은 65 로 맞춰야 한다 (종전에는 100 으로 되돌려 축소가 무효화)
pf = [{ ticker: 'A', allocation: 20 }, { ticker: 'B', allocation: 15 },
      { ticker: 'C', allocation: 15 }, { ticker: 'D', allocation: 15 }];
r = A.normalizeAllocations(pf, { regimeCashReserve: 35 });
sum(r.portfolio) === 65 ? ok(`레짐 현금 35% → 투자 65% 유지 (${sum(r.portfolio)})`) : bad(`합계 ${sum(r.portfolio)} — 축소가 되돌려짐`);
r.cashReserve === 35 ? ok('현금 비중 기록') : bad(`cashReserve ${r.cashReserve}`);
/현금/.test(r.note ?? '') ? ok('현금 보유 사유 문구 생성') : bad('사유 문구 없음 — 검증기가 allocation_sum 결함으로 잡는다');

// [3] 상대 비중은 보존돼야 한다 — 축소는 전체에 비례해야지 순위를 바꾸면 안 된다
const before = [40, 30, 20, 10];
pf = before.map((a, i) => ({ ticker: `T${i}`, allocation: a }));
r = A.normalizeAllocations(pf, { regimeCashReserve: 50 });
const after = r.portfolio.map(p => p.allocation);
const monotonic = after.every((v, i) => i === 0 || after[i - 1] >= v);
monotonic ? ok(`상대 순위 보존 (${after.join('/')})`) : bad(`순위 뒤바뀜: ${after.join('/')}`);

// [4] 종목 수가 적으면 단일 상한 — 몰빵 방지 규율은 유지
pf = [{ ticker: 'A', allocation: 60 }, { ticker: 'B', allocation: 40 }];
r = A.normalizeAllocations(pf, { regimeCashReserve: 0, maxSingle: 25 });
r.portfolio.every(p => p.allocation <= 25) ? ok('단일 상한 25% 유지 (몰빵 방지)') : bad(`상한 위반: ${r.portfolio.map(p=>p.allocation)}`);
sum(r.portfolio) < 100 ? ok(`상한 적용 시 잔여는 현금 (투자 ${sum(r.portfolio)}%)`) : bad('상한인데 100 으로 되돌림');

// [5] 빈 포트폴리오/이상 입력에서 죽지 않는다
A.normalizeAllocations([], { regimeCashReserve: 20 }).portfolio.length === 0 ? ok('빈 포트폴리오 안전') : bad('빈 입력에서 오류');
const z = A.normalizeAllocations([{ ticker: 'A', allocation: 0 }], {});
Number.isFinite(sum(z.portfolio)) ? ok('합계 0 입력 안전 (0으로 나누기 없음)') : bad('NaN 발생');

// [6] 레짐 현금이 100 이상이어도 음수 비중을 만들지 않는다
const ex = A.normalizeAllocations([{ ticker: 'A', allocation: 50 }], { regimeCashReserve: 150 });
ex.portfolio.every(p => p.allocation >= 0) ? ok('과도한 현금 요구에도 음수 없음') : bad('음수 비중 발생');

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
