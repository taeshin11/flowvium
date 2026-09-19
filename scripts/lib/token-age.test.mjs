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
import { tokenAgeDays, tokenVerdict, refreshExpiresAt, TEST_MODE_TTL_DAYS } from './token-age.mjs';

const daysAgo = (n) => Date.now() - n * 86400000;

test('발급 후 지난 날수', () => {
  assert.ok(Math.abs(tokenAgeDays({ issuedAt: daysAgo(3) }) - 3) < 0.01);
  assert.equal(tokenAgeDays(null), null);
});

// 2026-09-19: 이 두 가지는 원래 issuedAt(추정값) 으로 판정했다. 그 추정이 틀려서 관문이
//   한 번도 울리지 못했으므로(파일 머리말 참고) 근거를 구글이 준 만료 시각으로 바꾼다.
test('테스트 모드 만료(7일)가 가까우면 미리 알린다', () => {
  const inDays = (n) => Date.now() + n * 86400000;
  assert.equal(tokenVerdict({ refreshExpiresAt: inDays(5) }).level, 'ok');
  assert.equal(tokenVerdict({ refreshExpiresAt: inDays(1.5) }).level, 'warn');
  assert.equal(tokenVerdict({ refreshExpiresAt: inDays(-1) }).level, 'expired');
});

test('경고문에 무엇을 하라고 적는다 — "곧 만료" 만으로는 못 고친다', () => {
  const v = tokenVerdict({ refreshExpiresAt: Date.now() + 86400000 });
  assert.match(v.line, /youtube-auth/);
  assert.match(v.line, /프로덕션|테스트/);
});

test('갱신 토큰 만료 시각을 파일에서 계산한다', () => {
  const t = refreshExpiresAt({ writtenAt: daysAgo(1), refreshTokenExpiresIn: 600004 });
  assert.ok(Math.abs((t - Date.now()) / 86400000 - 5.9) < 0.05, `남은 일수 ${(t - Date.now()) / 86400000}`);
  assert.equal(refreshExpiresAt({ writtenAt: Date.now() }), null);   // 초가 없으면 계산하지 않는다
  assert.equal(refreshExpiresAt(), null);
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

// ── 2026-09-19: 이 관문이 한 번도 울리지 못했다 ───────────────────────────────
// 오늘 아침 쇼츠가 invalid_grant 로 전멸했는데 경고는 없었다. check-stall 이
//   `issuedAt = expiry_date - 1시간` 으로 나이를 추정했기 때문이다 — expiry_date 는
//   **액세스** 토큰 만료라 매시간 갱신된다. 나이가 영원히 0.0 일로 나왔다(실측).
//   토큰 파일에는 구글이 준 refresh_token_expires_in 이 들어 있다. 추정을 버리고 그걸 쓴다.

test('갱신 토큰 만료 시각을 주면 그걸로 판정한다 — 추정하지 않는다', () => {
  const inDays = (n) => Date.now() + n * 86400000;
  assert.equal(tokenVerdict({ refreshExpiresAt: inDays(6) }).level, 'ok');
  assert.equal(tokenVerdict({ refreshExpiresAt: inDays(1.5) }).level, 'warn');
  assert.equal(tokenVerdict({ refreshExpiresAt: inDays(-0.1) }).level, 'expired');
});

test('액세스 토큰 만료로는 갱신 토큰 나이를 알 수 없다 (오늘의 재발 방지)', () => {
  // 매시간 갱신되므로 이 값은 늘 "방금" 이다. 그걸 근거로 ok 라고 말하면 안 된다.
  const justRefreshed = Date.now() - 60_000;
  const v = tokenVerdict({ issuedAt: justRefreshed, refreshExpiresAt: null });
  assert.equal(v.level, 'unknown', `액세스 토큰만으로 ${v.level} 이라고 단정했다 — ${v.line}`);
});

test('갱신 토큰 만료가 있으면 무엇을 하라고 적는다', () => {
  const v = tokenVerdict({ refreshExpiresAt: Date.now() + 1.5 * 86400000 });
  assert.match(v.line, /auth/);
  assert.match(v.line, /프로덕션|테스트/);
});

test('프로덕션 게시 앱은 갱신 토큰 만료가 없다', () => {
  assert.equal(tokenVerdict({ refreshExpiresAt: Date.now() - 86400000, published: true }).level, 'ok');
});

test('서비스 이름을 붙일 수 있다 — 유튜브와 블로거를 같이 본다', () => {
  const v = tokenVerdict({ refreshExpiresAt: Date.now() + 1.5 * 86400000, service: '블로거' });
  assert.match(v.line, /블로거/);
});
