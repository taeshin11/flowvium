/**
 * outcome-classes.mjs — 추천 결과 라벨을 성질별로 한 군데 모은다. (2026-09-12 신설)
 *
 * 왜 필요한가(실측): 성과 집계 7곳이 각자 손으로 outcome 목록을 적고 있었고,
 *   그중 6곳이 **가장 큰 통인 'sold' 를 빠뜨렸다.**
 *     buy 결과 1,582행 구성 — sold 826(52%) · stop_loss 330 · not_entered 238 ·
 *                             hit_target 118 · still_holding 63 · unknown 7
 *   'sold' 는 매도추천이 청산한 실현 포지션이다. 2026-06-18 이전엔 spy_return 이 NULL 이라
 *   알파를 못 내서 뺐던 것이고, 백필로 데이터는 고쳐졌는데 질의만 그대로 남았다.
 *   그 결과 3개월간 "알파 -2.17%" 로 읽혔지만 sold 를 넣으면 5개월 중 4개월이 플러스다.
 *
 * 통을 나누는 기준은 **손익이 확정됐는가** 이지 결과가 좋은가가 아니다.
 */

/** 손익이 확정된 포지션 — 성과·알파 집계의 분모. */
export const REALIZED = ['hit_target', 'stop_loss', 'sold'];

/** 아직 열려 있는 포지션 — 평가손익(mark-to-market)이라 실현분과 섞으면 안 된다. */
export const UNREALIZED = ['still_holding'];

/** 체결 자체가 없었던 건 — 진입가 캘리브레이션을 볼 때만 쓴다. 성과 분모가 아니다. */
export const NO_POSITION = ['not_entered'];

/** 판정 못 한 건 — 어떤 집계에도 넣지 않는다. 세어 두되 섞지 않는다. */
export const UNUSABLE = ['unknown'];

/** 실현 + 미실현 — "포지션을 잡았던 모든 건". 체결률·보유기간을 볼 때. */
export const POSITIONED = [...REALIZED, ...UNREALIZED];

/** 진입 캘리브레이션용 — 체결 여부를 가르는 비교라 미체결이 들어가야 한다. */
export const ENTRY_SCOPE = [...POSITIONED, ...NO_POSITION];

/**
 * SQL `IN (...)` 절 문자열. 값이 전부 우리가 정한 상수라 인용 부호로 직접 만든다.
 *   `WHERE o.outcome ${sqlIn(REALIZED)}`
 */
export function sqlIn(set) {
  if (!Array.isArray(set) || set.length === 0) throw new Error('sqlIn: 빈 집합');
  return `IN (${set.map((s) => `'${s}'`).join(',')})`;
}
