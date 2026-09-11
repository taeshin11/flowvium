/**
 * token-age.test.mjs — 유튜브 갱신 토큰이 폐기되기 **전에** 알린다.
 *
 * 왜 (2026-09-12): OAuth 앱이 '테스트' 상태면 refresh token 이 7일마다 폐기된다.
 *   2026-09-11 19:23 발행을 마지막으로 업로드가 invalid_grant 로 죽었고, **9시간 뒤에야** 알았다.
 *   그동안 렌더는 계속 돌았다 — 만들고 올리지 못하는 상태가 반 나절 이어졌다.
 *   로그에 invalid_grant 가 이미 5번 있었다. 처음이 아니었다.
 *
 * 죽은 뒤에 아는 것과 죽기 전에 아는 것은 다르다. 발급 시각을 보고 미리 알린다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenAgeDays, tokenVerdict, TEST_MODE_TTL_DAYS } from './token-age.mjs';

const daysAgo = (n) => Date.now() - n * 86400000;

test('발급 후 지난 날수', () => {
  assert.ok(Math.abs(tokenAgeDays({ issuedAt: daysAgo(3) }) - 3) < 0.01);
  assert.equal(tokenAgeDays(null), null);
});

test('테스트 모드 만료(7일)가 가까우면 미리 알린다', () => {
  assert.equal(tokenVerdict({ issuedAt: daysAgo(2) }).level, 'ok');
  assert.equal(tokenVerdict({ issuedAt: daysAgo(5.5) }).level, 'warn');
  assert.equal(tokenVerdict({ issuedAt: daysAgo(8) }).level, 'expired');
});

test('경고문에 무엇을 하라고 적는다 — "곧 만료" 만으로는 못 고친다', () => {
  const v = tokenVerdict({ issuedAt: daysAgo(6) });
  assert.match(v.line, /youtube-auth/);
  assert.match(v.line, /프로덕션|테스트/);
});

test('앱이 프로덕션이면 7일 만료가 없다 — 경고하지 않는다', () => {
  assert.equal(tokenVerdict({ issuedAt: daysAgo(30), published: true }).level, 'ok');
});

test('발급 시각을 모르면 판정하지 않는다', () => {
  assert.equal(tokenVerdict({ issuedAt: null }).level, 'unknown');
});

test('만료 기준은 구글 정책대로 7일', () => {
  assert.equal(TEST_MODE_TTL_DAYS, 7);
});
