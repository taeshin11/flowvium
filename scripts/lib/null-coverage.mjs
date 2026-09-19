/**
 * null-coverage.mjs — 갓 만든 컬럼의 NULL 을 **면제가 아니라 시점으로** 판정한다. (2026-09-19 신설)
 *
 * audit-coverage 의 "NULL ≥80% 면 결함" 관문은 오래 쓰인 컬럼에는 맞지만, 어제 붙인 컬럼에는
 *   틀린 말을 한다 — 과거 행에 값을 소급해 넣을 방법이 없기 때문이다(예: shorts_published.hooks_json
 *   97%null. 대본 보관을 2026-09-18 에 시작했으니 그 전 편에는 대본 자체가 없다).
 *
 * 그렇다고 STRUCTURAL_NULLS 에 적어 두면 **영구 면제**가 된다. 그건 이 관문이 막으려던 바로 그
 *   상황이다 — 기록이 조용히 끊겨도 아무도 모른다. 그래서 도입 시점 이후 행만 놓고 같은 잣대를
 *   다시 댄다. 배선이 끊기면 최근 구간이 비면서 다시 ❌ 가 난다.
 *
 * 표본이 적을 때 ok 라고 하지 않는 이유: 3행이 차 있다고 배선이 성한 건 아니다. 모르면 모른다고
 *   한다(pending) — 그 편이 "정상" 으로 덮는 것보다 낫다.
 */

/** 도입 후 구간을 판정할 수 있는 최소 행수. 이보다 적으면 말하지 않는다. */
export const MIN_RECENT_ROWS = 10;
/** 기존 관문과 같은 잣대. 다른 숫자를 쓰면 두 기준이 생긴다. */
export const NULL_ERR_PCT = 80;

/**
 * @param {{overallNullPct:number, recentRows:number, recentNullPct:number}} m
 * @returns {{verdict:'ok'|'error'|'pending', note:string}}
 */
export function judgeNullCoverage({ overallNullPct, recentRows, recentNullPct }) {
  if (recentRows < MIN_RECENT_ROWS) {
    return { verdict: 'pending', note: `도입 후 ${recentRows}행뿐 — 판정 보류(전체 ${Math.round(overallNullPct)}%null)` };
  }
  if (recentNullPct >= NULL_ERR_PCT) {
    return { verdict: 'error', note: `도입 후 ${recentRows}행 중 ${Math.round(recentNullPct)}%null — 배선이 끊겼다` };
  }
  return { verdict: 'ok', note: `도입 후 ${recentRows}행 중 ${Math.round(recentNullPct)}%null(전체 ${Math.round(overallNullPct)}%null 은 소급 불가분)` };
}
