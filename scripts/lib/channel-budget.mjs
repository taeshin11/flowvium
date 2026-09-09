/**
 * channel-budget.mjs — 채널에 하루 동안 가할 수 있는 행동의 총량.
 *
 * 왜 만들었나 (2026-09-09 실측):
 *   2026-09-06 에 21편을 올리고, 09-07 아침에 그중 11편을 한꺼번에 영구 삭제했다.
 *   발행 후 8시간 시점 조회수 중앙값이 이렇게 움직였다.
 *
 *     09-05  1,371 · 09-06  1,235 · 09-07  1,275 · 09-08  385 · 09-09  210
 *
 *   09-08 발행분은 435~837 로 **한 편도 예외 없이** 이전의 1,300 대 밑이었다.
 *   특정 영상의 실패가 아니라 채널 단위 현상이다. 편성 재조정(09-08 13:55)·
 *   배경음악 교체(18:14)·홍보 클립(09-09 20:30)은 모두 하락 **이후**라 원인이 아니고,
 *   주제 분포도 그대로였다. 시각이 맞는 것은 대량 업로드 + 대량 삭제뿐이다.
 *
 * 근본 원인은 "판단을 잘못했다" 가 아니라 **총량을 세는 곳이 없었다** 이다.
 *   내리기·지우기 스크립트에는 각각 안전장치가 있었지만 전부 호출 1회 단위였다.
 *   발행은 진입점이 둘(슬롯 편성, 백필)인데 서로를 몰랐다 — 각자 정상 동작하면서
 *   합계 21편이 됐다. 그래서 세는 자리를 여기 하나로 모으고, 네 경로가 모두 통과한다.
 *
 * 상한의 근거: 09-05(10편)과 09-07(8편)은 조회수가 정상이었고 09-06(21편) 다음에 무너졌다.
 *   그래서 발행은 10편에 둔다. 관측이 쌓이면 환경변수로 조정한다 — 코드를 고치지 않는다.
 */

/** 상한. 환경변수로 덮되, 기본값은 위 실측에 근거한다. */
export const LIMITS = {
  publish: Number(process.env.SHORTS_MAX_PER_DAY ?? 10),
  retract: Number(process.env.SHORTS_MAX_RETRACT_PER_DAY ?? 2),
  purge: Number(process.env.SHORTS_MAX_PURGE_PER_DAY ?? 2),
};

const LABEL = { publish: '발행', retract: '내리기', purge: '영구 삭제' };

/** 받침 유무로 은/는 을 고른다. "발행는" 처럼 나오면 사람이 쓴 글로 안 읽힌다. */
function topic(word) {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  const hasFinal = c >= 0 && c <= 11171 && c % 28 !== 0;
  return `${word}${hasFinal ? '은' : '는'}`;
}

/** 저장값은 UTC ISO 다. 편성은 KST 하루로 세야 사람이 보는 것과 맞는다. */
export function kstDay(iso = new Date().toISOString()) {
  return new Date(new Date(iso).getTime() + 9 * 3600000).toISOString().slice(0, 10);
}

/** ISO 문자열 목록에서 해당 KST 날짜의 개수. */
export function countSince(isoList, day = kstDay()) {
  return isoList.filter((x) => x && kstDay(x) === day).length;
}

/**
 * 오늘 이미 `used` 건 했을 때 한 건 더 해도 되는가.
 * allowance 는 **남은 건수** — 일괄 작업은 이 수만큼만 잘라서 처리한다.
 */
export function budgetCheck(kind, used) {
  const limit = LIMITS[kind];
  if (!Number.isFinite(limit)) throw new Error(`모르는 행동: ${kind}`);
  const allowance = Math.max(0, limit - used);
  return allowance > 0
    ? { ok: true, allowance, limit, used }
    : { ok: false, allowance: 0, limit, used, reason: `${topic(LABEL[kind])} 하루 ${limit}건까지다 (오늘 ${used}건)` };
}

/** DB 에서 오늘치를 세어 그대로 판정한다. 호출부가 날짜 계산을 다시 하지 않게 한다. */
export function checkAgainstDb(db, kind, day = kstDay()) {
  const col = kind === 'publish' ? 'published_at' : 'retracted_at';
  const rows = db
    .prepare(`SELECT ${col} t FROM shorts_published WHERE ${col} IS NOT NULL`)
    .all()
    .map((r) => r.t);
  return budgetCheck(kind, countSince(rows, day));
}
