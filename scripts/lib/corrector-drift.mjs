/**
 * corrector-drift.mjs — "자동교정이 매 보고서마다 같은 걸 고치고 있는가".
 *
 * 배경(2026-08-22): 이 세션에서 근본원인 7건을 잡았는데 5건이 같은 형태였다 —
 *   **증상을 고치는 코드가 이미 있었고, 그게 원인을 몇 달간 가렸다.**
 *   통화 교정기 주석에는 2026-05-24 날짜가 박혀 있었다(석 달). 교정기가 있으면
 *   증상이 화면에 안 보이니 아무도 생산자를 고치지 않는다.
 *
 * 신호는 단순하다: **거의 모든 실행에서 발동하는 교정기는 교정 대상이 아니라 버그다.**
 *   교정이란 드물게 일어나는 일을 바로잡는 것이다. 매번 일어난다면 앞단이 틀린 것이다.
 *
 * 임계값은 감이 아니라 실측 간극에서 잡았다(최근 7일, 보고서 13개):
 *     usNameMismatch 13/13 · garble 13/13 · actionCritique 12/13 · currency 12/13   ← 전부 실제 버그
 *     ───────────────────── 빈 구간 ─────────────────────
 *     flow_movement 2/13 · pct_subject 2/13 · cascade_asset 1/13                    ← 정상 산발
 *   92% 와 15% 사이가 비어 있어 그 안(70%)을 임계로 둔다. 데이터가 바뀌면 이 값도 다시 봐야 한다.
 *
 * 다양성(고유입력/검출)은 **힌트**로만 쓴다. 실측에서 갈리기 때문이다 —
 *   currency 100%(생산자) · actionCritique 37%(그래도 생산자). 낮은 다양성이 곧
 *   규칙 오탐이라고 단정할 수 없다. 모르는 것은 모른다고 쓴다.
 */

/** 거의 매번 발동 = 앞단이 틀렸다. 실측 간극(92% vs 15%) 안쪽 값. */
export const HIT_RATE_THRESHOLD = 0.70;
/** 표본이 이보다 적으면 판단하지 않는다 — 보고서 2개로 100% 는 근거가 못 된다. */
export const MIN_REPORTS = 5;
/** 한두 건이 우연히 매 보고서에 걸린 경우를 제외. */
export const MIN_DETECTIONS = 5;

const HIGH_DIVERSITY = 0.8;
const LOW_DIVERSITY = 0.4;

/**
 * @param {Array<{defect_type:string, report_id:string, llm_value?:string}>} rows
 * @param {{totalReports:number, recentReportIds?:string[]}} opts
 *        totalReports: 같은 기간의 전체 보고서 수
 *        recentReportIds: 최신 보고서 id 몇 개. 주면 **거기서도 발동해야** 표면화한다 —
 *          고친 뒤에도 7일 창이 빌 때까지 계속 경보하면 그 경보는 곧 무시된다.
 *          근거: 통화 하드코딩을 고치자 **바로 다음 보고서**에서 교정 6→0 이 됐다(실측).
 * @returns {Array<{defectType:string, detections:number, reportsHit:number, totalReports:number,
 *                  hitRate:number, diversity:number, flagged:boolean, hint:string}>}
 */
export function analyzeCorrectors(rows, { totalReports = 0, recentReportIds = null } = {}) {
  const recent = recentReportIds?.length ? new Set(recentReportIds) : null;
  const byType = new Map();
  for (const r of rows ?? []) {
    const t = r?.defect_type;
    if (!t) continue;
    if (!byType.has(t)) byType.set(t, { reports: new Set(), values: new Set(), n: 0 });
    const e = byType.get(t);
    e.n += 1;
    if (r.report_id) e.reports.add(r.report_id);
    e.values.add(String(r.llm_value ?? ''));
  }
  const out = [];
  for (const [defectType, e] of byType) {
    const reportsHit = e.reports.size;
    const hitRate = totalReports > 0 ? reportsHit / totalReports : 0;
    const diversity = e.n > 0 ? e.values.size / e.n : 0;
    const enough = totalReports >= MIN_REPORTS && e.n >= MIN_DETECTIONS;
    // 지금도 발동 중인가. 최신 보고서에 없으면 이미 고쳐진 것이다.
    const stillFiring = !recent || [...e.reports].some((r) => recent.has(r));
    const flagged = enough && hitRate >= HIT_RATE_THRESHOLD && stillFiring;
    const hint = !flagged ? ''
      : diversity >= HIGH_DIVERSITY
        ? '입력이 매번 달라 — 생산자(만드는 쪽) 결함 의심'
        : diversity <= LOW_DIVERSITY
          ? '같은 입력 반복 — 규칙 오탐이거나 단일 생산자 결함, 실물 확인 필요'
          : '섞여 있음 — 실물 확인 필요';
    out.push({ defectType, detections: e.n, reportsHit, totalReports, hitRate, diversity, flagged, stillFiring, hint });
  }
  return out.sort((a, b) => b.hitRate - a.hitRate || b.detections - a.detections);
}
