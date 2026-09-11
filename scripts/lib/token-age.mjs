/**
 * token-age.mjs — 유튜브 갱신 토큰이 폐기되기 전에 알린다.
 *
 * 왜 (2026-09-12): OAuth 앱이 '테스트' 상태면 구글은 refresh token 을 7일 뒤 폐기한다.
 *   2026-09-11 19:23 을 마지막으로 업로드가 invalid_grant 로 죽었고 **9시간 뒤에야** 알았다.
 *   그동안 렌더는 계속 돌았다 — 만들고 올리지 못하는 상태가 반 나절 이어졌다.
 *   로그의 invalid_grant 는 이번이 5번째였다. 죽은 뒤 아는 것과 죽기 전 아는 것은 다르다.
 *
 * 근본 해결은 앱을 프로덕션으로 게시하는 것이다(그러면 7일 만료가 없다).
 *   게시했다면 YOUTUBE_APP_PUBLISHED=1 로 알려 주면 이 경고를 끈다.
 */

/** 구글 정책: 테스트 상태 앱의 갱신 토큰은 7일 뒤 폐기. */
export const TEST_MODE_TTL_DAYS = 7;
/** 하루 남았을 때가 아니라 미리 — 재인증은 사람이 해야 하고 밤에 만료되면 반나절이 날아간다. */
const WARN_AT_DAYS = 5;

export function tokenAgeDays(input) {
  // 기본값은 undefined 일 때만 적용된다 — null 을 그대로 구조분해하면 터진다.
  //   2026-09-12 에 config-drift 에서 같은 실수를 하고 또 했다.
  const { issuedAt } = input ?? {};
  if (!Number.isFinite(issuedAt)) return null;
  return (Date.now() - issuedAt) / 86400000;
}

export function tokenVerdict(input) {
  const { published = false } = input ?? {};
  const age = tokenAgeDays(input);
  if (age == null) return { level: 'unknown', line: '토큰 발급 시각을 못 읽었다' };
  if (published) return { level: 'ok', line: `토큰 ${age.toFixed(1)}일 — 앱이 프로덕션이라 7일 만료 없음` };

  const fix = '재인증: node scripts/youtube-auth.mjs --account <아이디> · '
    + '근본: OAuth 앱을 테스트 → 프로덕션으로 게시하면 7일 만료가 사라진다';
  if (age >= TEST_MODE_TTL_DAYS) return { level: 'expired', line: `유튜브 토큰 ${age.toFixed(1)}일 — 이미 폐기됐을 것이다(테스트 모드 7일). ${fix}` };
  if (age >= WARN_AT_DAYS) return { level: 'warn', line: `유튜브 토큰 ${age.toFixed(1)}일 — ${(TEST_MODE_TTL_DAYS - age).toFixed(1)}일 뒤 폐기된다(테스트 모드). ${fix}` };
  return { level: 'ok', line: `유튜브 토큰 ${age.toFixed(1)}일 (테스트 모드 상한 ${TEST_MODE_TTL_DAYS}일)` };
}
