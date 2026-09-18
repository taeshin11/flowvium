/**
 * report-cards.mjs — 홈·리포트가 **카드로 그리는 서사 필드**의 최소 길이. (2026-09-18 신설)
 *
 * 왜 한 곳에 두는가: 같은 값이 generate-report-local.mjs(백필)과 verify-report.mjs(검출)에
 *   따로 적혀 있었다. 두 군데 적은 값은 반드시 어긋난다 — 이 저장소가 이미 여러 번 겪은 일이고
 *   (스코프 목록, 매수/매도 룰 카테고리), 그때마다 한쪽만 고쳐서 사각지대가 생겼다.
 *
 * 왜 이 검사가 필요한가: LLM 이 macro 응답에서 필드 하나를 빠뜨리면 생성기가 '' 로 채우고
 *   그대로 발간된다. 사용자가 두 번 지적했다 — 2026-07-06 "기본적 분석 왜 비어있지?",
 *   2026-09-18 같은 자리. 첫 번째 때 **검출만 넣고 예방을 안 넣어서** 두 달 만에 재발했다.
 */

/** 카드로 렌더되는 필드와 최소 글자 수. 이 값이 유일한 출처다. */
export const CARD_MIN = Object.freeze({
  macroAnalysis: 30,
  technicalAnalysis: 15,
  fundamentalAnalysis: 15,
});

/**
 * 비었거나 부실한 카드 필드를 돌려준다.
 * @param {Record<string, unknown>} report
 * @returns {{field: string, len: number, min: number}[]}
 */
export function emptyCards(report) {
  const out = [];
  for (const [field, min] of Object.entries(CARD_MIN)) {
    const v = report?.[field];
    const len = typeof v === 'string' ? v.trim().length : 0;
    if (len < min) out.push({ field, len, min });
  }
  return out;
}
