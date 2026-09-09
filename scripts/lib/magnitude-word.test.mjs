/**
 * magnitude-word.test.mjs — 작은 변동을 "급등/급락" 이라 부르지 않는다.
 *
 * 왜 (2026-09-09): verify-report 는 "2.3% 급등" 을 결함으로 **잡고 있었는데**, 생성 쪽에는
 *   같은 규칙이 없어서 매 보고서마다 다시 났다. 검출만 있고 예방이 없으면 게이트는
 *   막는 역할만 하고 고쳐지지 않는다 — 늘 지적받던 그 패턴이다.
 *   임계값은 한 곳(MAGNITUDE_MIN_PCT)에서만 정의해 검출·생성이 갈라지지 않게 한다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { softenMagnitude, MAGNITUDE_MIN_PCT } from './narrative-fix.mjs';

test('3% 미만은 급등/급락을 상승/하락으로 낮춘다', () => {
  assert.equal(softenMagnitude('코스피 2.3% 급등과 함께'), '코스피 2.3% 상승과 함께');
  assert.equal(softenMagnitude('1.1% 급락'), '1.1% 하락');
  assert.equal(softenMagnitude('0.8% 폭등'), '0.8% 상승');
  assert.equal(softenMagnitude('2.9% 폭락'), '2.9% 하락');
});

test('3% 이상은 건드리지 않는다 — 진짜 급등이다', () => {
  assert.equal(softenMagnitude('7.2% 급등과'), '7.2% 급등과');
  assert.equal(softenMagnitude('+5.9% 급등,'), '+5.9% 급등,');
  assert.equal(softenMagnitude('3.0% 급등'), '3.0% 급등');
});

test('한 문장에 여러 개가 있어도 각각 판단한다', () => {
  assert.equal(softenMagnitude('A 는 1.2% 급등, B 는 8.4% 급락'), 'A 는 1.2% 상승, B 는 8.4% 급락');
});

test('숫자가 안 붙은 급등은 손대지 않는다 — 판단할 근거가 없다', () => {
  assert.equal(softenMagnitude('연초 이후 급등했다'), '연초 이후 급등했다');
});

test('임계값은 한 곳에서만 정의한다', () => {
  assert.equal(MAGNITUDE_MIN_PCT, 3);
});

test('sanitizeText 를 타면 자동으로 적용된다 (필드마다 손대지 않는다)', async () => {
  const { sanitizeText } = await import('./narrative-fix.mjs');
  assert.match(sanitizeText('코스피가 2.3% 급등했다', 'ko'), /2\.3% 상승/);
});
