/**
 * portfolio-churn.test.mjs — 회차마다 추천이 얼마나 갈아엎히는가.
 *
 * 왜 (2026-09-10 사용자 "보고서랑 쇼츠 다 잘봐라"): 하루 4~5회차가 각각 다른 포트폴리오를 낸다.
 *   실측 7일 — 직전 회차와 **평균 48%만 겹치고**, 31쌍 중 9건은 25% 이하였다(사실상 전면 교체).
 *   예: 09-10 morning 6종 → noon 4종에서 1종만 유지.
 *   보고서를 따라가는 사람에게 몇 시간마다 목록이 뒤집히는 것은 따라갈 수 없는 신호다.
 *
 * 다만 **갈아엎는 것 자체가 결함은 아니다** — 새 데이터가 들어오면 판단이 바뀔 수 있다.
 *   그래서 고치지 않고 **보이게** 한다. 얼마나 바뀌는지 모르면 바꿀지 말지도 정할 수 없다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overlapRate, churnSummary, CHURN_FLOOR } from './portfolio-churn.mjs';

test('겹치는 비율', () => {
  // 정의는 "새 목록 중 이전에도 있던 비율" — 새로 늘어난 종목은 겹치지 않은 것으로 센다.
  assert.equal(overlapRate(['A', 'B', 'C'], ['A', 'B']), 2 / 3);
  assert.equal(overlapRate(['A', 'B'], ['A', 'B']), 1);
  assert.equal(overlapRate(['A', 'B'], ['A', 'B', 'C', 'D']), 1);
  assert.equal(overlapRate(['C', 'D'], ['A', 'B']), 0);
  assert.equal(overlapRate(['A', 'C'], ['A', 'B']), 0.5);
});

test('빈 목록은 판정하지 않는다 — 0% 라고 하지 않는다', () => {
  assert.equal(overlapRate([], ['A']), null);
  assert.equal(overlapRate(['A'], []), null);
});

test('연속 회차를 요약한다', () => {
  const s = churnSummary([
    { id: 'a', tickers: ['A', 'B', 'C', 'D'] },
    { id: 'b', tickers: ['A', 'B', 'C', 'D'] },   // 100%
    { id: 'c', tickers: ['X', 'Y', 'Z', 'D'] },   // 25%
  ]);
  assert.equal(s.pairs, 2);
  assert.equal(s.avg, 0.625);
  assert.deepEqual(s.wiped.map((w) => w.id), ['c']);
});

test('표본이 없으면 판정하지 않는다', () => {
  assert.equal(churnSummary([]).pairs, 0);
  assert.equal(churnSummary([{ id: 'a', tickers: ['A'] }]).avg, null);
});

test('전면 교체 기준은 낮게 — 자주 울리면 아무도 안 본다', () => {
  assert.ok(CHURN_FLOOR <= 0.25);
});
