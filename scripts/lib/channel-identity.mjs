/**
 * channel-identity.mjs — 인증한 계정이 그 채널의 주인인지 대조한다.
 *
 * 왜 (2026-09-11): yt-analytics 권한을 받으며 계정을 잘못 골랐다. 동의도 저장도 API 호출도
 *   전부 성공했는데 **다른 채널의 숫자**가 돌아왔다(Powder & Ink 구독 5 vs Flowvium 구독 37).
 *   숫자가 너무 안 맞아 알아챘을 뿐, 비슷했으면 엉뚱한 채널로 결론을 냈을 것이다.
 *   성공처럼 보이는 실패라 검사가 필요하다.
 *
 * 기대값이 없으면 판정하지 않는다 — 없는 기준으로 막으면 처음 설정하는 사람이 갇힌다.
 * 다만 인증 채널을 **못 읽는 것**은 통과가 아니다. 모르면 막는다.
 */
export function channelMatches(authedId, expectedId, { got = '', want = '' } = {}) {
  const exp = String(expectedId ?? '').trim();
  if (!exp) return { ok: null, reason: '기대 채널 id 가 설정돼 있지 않다(YOUTUBE_CHANNEL_ID)' };
  const id = String(authedId ?? '').trim();
  if (!id) return { ok: false, reason: '인증된 채널을 못 읽었다 — 모르는 채로 넘기지 않는다' };
  if (id === exp) return { ok: true };
  return {
    ok: false,
    reason: `다른 채널이다 — 인증된 것은 ${got || id}, 필요한 것은 ${want ? `${want} ` : ''}${exp}. `
      + '유튜브 채널을 소유한 계정으로 다시 받아라: node scripts/youtube-auth.mjs --account <아이디>',
  };
}
