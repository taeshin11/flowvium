/**
 * publish-health.mjs — 쇼츠 발행이 조용히 멈춘 것을 잡는다. (2026-09-19 신설)
 *
 * 왜 (오늘 실제로 당했다): 유튜브 리프레시 토큰이 취소돼 10:15·11:10 두 회차가
 *   업로드 단계에서 죽었다. 렌더도 눈검증도 다 통과했고 로그에 `❌ invalid_grant` 한 줄만 남았다.
 *   **아무도 안 알려줬다.** 사용자가 "왜 영상을 안 올리니" 하고 물어서야 알았다 — 반나절을 날렸다.
 *
 * launchd 는 exit code 를 남기지만 그걸 보는 사람이 없다. 그래서 주기 모니터가 본다.
 */

/** 인증 실패는 사람이 손대야 풀린다 — 재시도로 낫지 않으므로 따로 센다. */
const AUTH_FAIL = /invalid_grant|invalid_credentials|unauthorized_client|Token has been expired or revoked/i;
const UPLOAD_FAIL = /업로드 실패|upload failed/i;

/**
 * 발행 로그에서 최근 실패를 센다.
 * @param {string} logText  video.log 내용(꼬리만 줘도 된다)
 * @param {{hours?:number, now?:Date}} opt
 * @returns {{auth:number, upload:number, lastLine:string|null}}
 */
export function recentFailures(logText, { hours = 6, now = new Date() } = {}) {
  const since = now.getTime() - hours * 3600000;
  let auth = 0; let upload = 0; let lastLine = null;
  let stamp = null;
  for (const line of String(logText ?? '').split('\n')) {
    // 줄머리의 시각을 기억해 둔다. 실패 줄에는 시각이 없을 때가 많다(❌ invalid_grant).
    const m = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/.exec(line);
    if (m) stamp = Date.parse(`${m[1].replace(' ', 'T')}+09:00`);
    if (stamp != null && stamp < since) continue;
    if (AUTH_FAIL.test(line)) { auth += 1; lastLine = line.trim().slice(0, 120); }
    else if (UPLOAD_FAIL.test(line)) { upload += 1; lastLine = line.trim().slice(0, 120); }
  }
  return { auth, upload, lastLine };
}

/**
 * 편성 시각 목록과 마지막 발행을 견줘 **몇 회차를 놓쳤는지** 센다.
 *
 * 시각 목록을 인자로 받는 이유: plist 가 단일 출처다. 여기에 또 적으면 어긋난다.
 * @param {{slots:{h:number,m:number}[], lastPublishedAt:Date|null, now?:Date, graceMin?:number}} o
 * @returns {{missed:number, expected:number, lastAgeMin:number|null}}
 */
export function missedSlots({ slots, lastPublishedAt, now = new Date(), graceMin = 20 }) {
  const kst = (d) => new Date(d.getTime() + 9 * 3600000);
  const n = kst(now);
  const today = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
  const due = (slots ?? [])
    .map((s) => today + (s.h * 60 + s.m + graceMin) * 60000)
    .filter((t) => t <= n.getTime());
  const lastMs = lastPublishedAt ? kst(lastPublishedAt).getTime() : null;
  const missed = lastMs == null ? due.length : due.filter((t) => t > lastMs).length;
  return {
    missed,
    expected: due.length,
    lastAgeMin: lastMs == null ? null : Math.round((n.getTime() - lastMs) / 60000),
  };
}
