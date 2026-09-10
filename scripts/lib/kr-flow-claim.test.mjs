/**
 * kr-flow-claim.test.mjs — KR 수급 계약이 상쇄되는 날 사라지지 않는가.
 *
 * 왜 (2026-09-10): 임계가 **외국인+기관 합계** |합| ≥ 3,000억이었다.
 *   2026-09-09: 외국인 -5,441억 · 기관 +6,343억 → 합계 +901억 → 임계 미달 → claim 미생성.
 *   그래서 LLM 은 KR 수급 계약을 **아예 못 받았고** "외국인 자금 유입을 견인했다"를 썼다
 *   (실측은 외국인 순매도). 교정기도 claim 이 없어 돌지 않아 그대로 발간됐다.
 *
 *   합계가 작다는 것은 "수급이 없었다"가 아니라 **외국인과 기관이 반대로 크게 움직였다**는 뜻이다.
 *   그날이야말로 서술이 헷갈리는 날이라 계약이 가장 필요하다. 임계는 각 주체로 본다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildKrFlowClaim, KR_FLOW_MIN } from './kr-flow-claim.mjs';

const 억 = 1e8;

test('상쇄되는 날에도 계약이 나온다 (2026-09-09 실측)', () => {
  const c = buildKrFlowClaim({ foreignNet: -5441 * 억, institutionNet: 6343 * 억, period: '9/9' });
  assert.ok(c, '계약이 없으면 LLM 이 수급을 자유롭게 창작한다');
  assert.match(c.text, /외국인[^,]*순매도/);
  assert.match(c.text, /기관[^,]*순매수/);
});

test('양쪽 다 작으면 여전히 잡음으로 버린다', () => {
  assert.equal(buildKrFlowClaim({ foreignNet: 500 * 억, institutionNet: -300 * 억 }), null);
});

test('한쪽만 커도 계약이 나온다', () => {
  const c = buildKrFlowClaim({ foreignNet: -4000 * 억, institutionNet: 100 * 억 });
  assert.ok(c);
  assert.match(c.text, /외국인[^,]*순매도/);
});

test('기관 값이 없으면 외국인만으로 판단한다', () => {
  assert.ok(buildKrFlowClaim({ foreignNet: -5000 * 억 }));
  assert.equal(buildKrFlowClaim({ foreignNet: -100 * 억 }), null);
});

test('외국인 값이 없으면 계약을 만들지 않는다 — 지어내지 않는다', () => {
  assert.equal(buildKrFlowClaim({ institutionNet: 9000 * 억 }), null);
  assert.equal(buildKrFlowClaim(null), null);
});

test('검출기가 방향을 읽을 수 있는 형태다', async () => {
  const { measuredDirection } = await import('./flow-contradiction.mjs');
  const c = buildKrFlowClaim({ foreignNet: -5441 * 억, institutionNet: 6343 * 억 });
  assert.equal(measuredDirection(c.text), 'sell', '외국인 방향이 먼저 읽혀야 한다');
});

test('임계는 한 곳에서만 정의한다', () => {
  assert.equal(KR_FLOW_MIN, 3e11);
});
