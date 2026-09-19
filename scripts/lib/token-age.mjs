/**
 * token-age.mjs — 구글 갱신 토큰이 폐기되기 전에 알린다.
 *
 * 왜 (2026-09-12): OAuth 앱이 '테스트' 상태면 구글은 refresh token 을 7일 뒤 폐기한다.
 *   2026-09-11 19:23 을 마지막으로 업로드가 invalid_grant 로 죽었고 **9시간 뒤에야** 알았다.
 *   그동안 렌더는 계속 돌았다 — 만들고 올리지 못하는 상태가 반 나절 이어졌다.
 *
 * 2026-09-19 — **그 경고가 한 번도 울리지 못했다.** 오늘 아침 쇼츠가 또 전멸했는데(invalid_grant
 *   8회) 경고는 없었다. 부르는 쪽이 `issuedAt = expiry_date - 1시간` 으로 나이를 추정했는데,
 *   expiry_date 는 **액세스** 토큰 만료라 매시간 갱신된다. 나이가 영원히 0.0 일로 나왔다(실측).
 *   검출기를 만들어 두고 입력을 틀린 것이다 — 있으나 마나였다.
 *
 *   토큰 파일에는 구글이 갱신 응답마다 주는 `refresh_token_expires_in` 이 들어 있다.
 *   그 값은 **갱신 토큰의 남은 초**다. 추정할 이유가 없다. 실측(2026-09-19 12:41 재인증):
 *     youtube-token.json  refresh_token_expires_in = 600004 초 = 6.9일 → 09-26 11:21 폐기
 *     blogger-token.json  refresh_token_expires_in = 527962 초 = 6.1일
 *   그래서 이 함수는 **추정값(issuedAt)만으로는 ok 라고 말하지 않는다.** 모르면 모른다고 한다.
 *
 * 근본 해결은 앱을 프로덕션으로 게시하는 것이다(그러면 7일 만료가 없다).
 *   게시했다면 YOUTUBE_APP_PUBLISHED=1 로 알려 주면 이 경고를 끈다.
 */

/** 구글 정책: 테스트 상태 앱의 갱신 토큰은 7일 뒤 폐기. */
export const TEST_MODE_TTL_DAYS = 7;
/**
 * 며칠 남았을 때 알릴까. 재인증은 사람이 브라우저로 해야 한다 —
 * 밤에 만료되면 아침 회차가 통째로 날아가므로 하루 전은 너무 늦다.
 */
export const WARN_AT_DAYS_LEFT = 2;

/** 발급 후 지난 날수. 추정 입력이라 판정의 근거로는 쓰지 않는다(위 주석 참고). */
export function tokenAgeDays(input) {
  // 기본값은 undefined 일 때만 적용된다 — null 을 그대로 구조분해하면 터진다.
  //   2026-09-12 에 config-drift 에서 같은 실수를 하고 또 했다.
  const { issuedAt } = input ?? {};
  if (!Number.isFinite(issuedAt)) return null;
  return (Date.now() - issuedAt) / 86400000;
}

/** 갱신 토큰이 몇 밀리초 뒤에 폐기되는지. 파일이 마지막으로 쓰인 시각 + 남은 초. */
export function refreshExpiresAt({ writtenAt, refreshTokenExpiresIn } = {}) {
  if (!Number.isFinite(writtenAt) || !Number.isFinite(refreshTokenExpiresIn)) return null;
  return writtenAt + refreshTokenExpiresIn * 1000;
}

export function tokenVerdict(input) {
  const { published = false, service = '유튜브' } = input ?? {};
  const exp = input?.refreshExpiresAt;

  if (published) return { level: 'ok', line: `${service} 토큰 — 앱이 프로덕션이라 7일 만료 없음` };
  if (!Number.isFinite(exp)) {
    // 액세스 토큰 만료(expiry_date)만 있는 경우가 여기로 온다. 그건 매시간 갱신되므로
    //   "방금 발급" 으로 보일 뿐이고, 갱신 토큰이 언제 죽는지는 말해 주지 않는다.
    return { level: 'unknown', line: `${service} 갱신 토큰 만료 시각을 못 읽었다(refresh_token_expires_in 없음) — 액세스 토큰 만료로는 알 수 없다` };
  }

  const left = (exp - Date.now()) / 86400000;
  const fix = `재인증: node scripts/${service === '블로거' ? 'blogger' : 'youtube'}-auth.mjs · `
    + '근본: OAuth 앱을 테스트 → 프로덕션으로 게시하면 7일 만료가 사라진다';
  if (left <= 0) return { level: 'expired', line: `${service} 갱신 토큰이 이미 폐기됐다(테스트 모드 ${TEST_MODE_TTL_DAYS}일). ${fix}` };
  if (left <= WARN_AT_DAYS_LEFT) return { level: 'warn', line: `${service} 갱신 토큰 ${left.toFixed(1)}일 남았다(테스트 모드). ${fix}` };
  return { level: 'ok', line: `${service} 갱신 토큰 ${left.toFixed(1)}일 남음 (테스트 모드 상한 ${TEST_MODE_TTL_DAYS}일)` };
}
