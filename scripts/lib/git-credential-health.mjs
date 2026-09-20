/**
 * git-credential-health.mjs — 푸시가 막히기 전에 안다. (2026-09-20 신설)
 *
 * 왜 이게 안전장치인가: 이 저장소의 크론은 매 실행마다
 *   `git checkout origin/master -- scripts/ src/ public/ messages/ data/*.json package.json`
 *   을 한다. **밀지 못한 변경은 조용히 지워진다**(CLAUDE.md 맨 위의 2026-06-03 사건).
 *   그러니 "푸시가 된다" 는 것 자체가 지켜야 할 상태다.
 *
 * 2026-09-20 에 그 상태가 빠져 있었다. 키체인에 깃허브 자격증명이 **아예 없었고**,
 *   푸시는 VS Code 의 인증 소켓(GIT_ASKPASS → unix socket)을 타고 나가고 있었다.
 *   그 소켓이 죽자 크론이 만든 커밋 4개가 밀리지 않은 채 쌓였다. 아무도 몰랐다 —
 *   푸시를 시도해 봐야만 알 수 있는 구조였기 때문이다.
 *
 * 지금은 토큰을 키체인에 넣었다. 다만 그것은 VS Code 가 발급한 gho_ 토큰이라 세션이
 *   갱신되거나 권한이 회수되면 죽는다. 그래서 **증상(밀리지 않은 커밋)을 기다리지 않고**
 *   자격증명 자체를 주기적으로 확인한다.
 *
 * 비밀은 돌려주지 않는다 — 판정에 필요한 것은 "있는가 · 어떤 종류인가 · 통하는가" 뿐이다.
 */

/** 자격증명 헬퍼 출력에서 판정에 필요한 것만 뽑는다. 비밀번호는 담지 않는다. */
export function parseCredential(stdout) {
  const kv = {};
  for (const line of String(stdout ?? '').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) kv[line.slice(0, i)] = line.slice(i + 1);
  }
  const pw = kv.password ?? '';
  // 토큰 앞 네 글자는 종류를 말해 준다: ghp_ 고전 PAT · gho_ OAuth · ghu_ 앱 사용자 · github_pat_ 세분화
  const kind = /^github_pat_/.test(pw) ? 'github_pat'
    : /^gh[pous]_/.test(pw) ? pw.slice(0, 3)
      : pw ? 'unknown' : null;
  return { username: kv.username ?? null, hasPassword: Boolean(pw), kind };
}

/**
 * @param {{hasPassword:boolean, apiStatus?:number|null, canPush?:boolean, kind?:string|null}} m
 * @returns {{level:'ok'|'error'|'unknown', line:string}}
 */
export function credentialVerdict(m) {
  const fix = '조치: VS Code 로 한 번 푸시해 자격증명을 새로 받고 키체인에 저장할 것';
  if (!m?.hasPassword) {
    return { level: 'error', line: `깃허브 자격증명이 키체인에 없다 — 푸시가 VS Code 가 떠 있을 때만 된다. ${fix}` };
  }
  if (m.apiStatus == null) {
    // 망이 안 되거나 물어보지 못한 경우. 모르는 것을 정상이라 말하지 않는다(token-age 에서 배웠다).
    return { level: 'unknown', line: '깃허브 자격증명을 확인하지 못했다(응답 없음) — 통하는지 모른다' };
  }
  if (m.apiStatus === 401 || m.apiStatus === 403) {
    return { level: 'error', line: `깃허브 토큰이 폐기됐거나 만료됐다(HTTP ${m.apiStatus}) — 지금 푸시하면 실패한다. ${fix}` };
  }
  if (m.apiStatus !== 200) {
    return { level: 'unknown', line: `깃허브가 HTTP ${m.apiStatus} 로 답했다 — 통하는지 모른다` };
  }
  if (!m.canPush) {
    return { level: 'error', line: `깃허브 토큰에 쓰기 권한이 없다 — 읽기만 된다. ${fix}` };
  }
  return { level: 'ok', line: `깃허브 자격증명 정상 (${m.kind ?? '종류 미상'} · 쓰기 가능)` };
}
