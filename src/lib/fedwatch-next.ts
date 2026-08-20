/**
 * fedwatch-next.ts — FOMC '차기 회의' 선택의 단일 경로.
 *
 * 배경: /api/fedwatch 의 meetings 는 *연초부터의 전체 일정*이라 meetings[0] 은 이미 끝난 회의다.
 *   2026-06-19 에 API 쪽에서 nextMeeting 을 계산해 내려주도록 고쳤고 그 파일 316행이
 *     "meetings[0] 은 Apr 29 등 과거일 수 있음 — 소비처가 …"
 *   라고 경고까지 적어 뒀지만, 소비처 4곳 중 judge-chat 만 따랐다.
 *   2026-08-21 실측(오늘 8/20~21): 홈에 "FOMC Apr 29 — Hold 97% / Cut 3%"(넉 달 전 회의).
 *
 *   화면보다 나쁜 건 나머지 3곳이 LLM 프롬프트에 들어간다는 점이다 —
 *     daily-brief.ts summariseFed / marketBullets, investment-strategy 의 sentiment.
 *   모델이 "다음 FOMC 는 4월 29일"이라는 낡은 사실을 받아 거시 판단을 쌓고 있었다.
 *
 *   주석으로 경고하는 대신 함수 하나로 만들고 테스트로 못 박는다.
 */
export type FomcLike = Record<string, unknown> & { date?: unknown; label?: unknown };

/**
 * @param fed  /api/fedwatch 응답(또는 그 캐시). nextMeeting 이 있으면 그것이 권위 값이다.
 * @param todayStr 'YYYY-MM-DD'. 생략 시 오늘(UTC 기준 날짜 문자열).
 * @returns 차기(아직 안 열린) 회의. 전부 과거면 마지막 회의. 데이터가 없으면 null.
 */
export function pickNextMeeting(fed: unknown, todayStr?: string): FomcLike | null {
  const d = fed as Record<string, unknown> | null | undefined;
  if (!d) return null;
  const nm = d.nextMeeting as FomcLike | null | undefined;
  if (nm && typeof nm === 'object') return nm;
  const ms = d.meetings as FomcLike[] | undefined;
  if (!Array.isArray(ms) || ms.length === 0) return null;
  const today = todayStr ?? new Date().toISOString().slice(0, 10);
  // 날짜 문자열은 'YYYY-MM-DD' 라 사전순 비교가 곧 시간순이다.
  const future = ms.find((m) => typeof m.date === 'string' && (m.date as string) >= today);
  // 전부 과거면 마지막 회의를 돌려준다 — 첫 원소로 되돌아가면 이 함수를 만든 이유가 없어진다.
  return future ?? ms[ms.length - 1] ?? null;
}
