#!/usr/bin/env node
/**
 * corrector-drift.test.mjs — 자동교정이 *매 보고서마다* 같은 걸 고치고 있는가.
 *
 * 왜 만드나(2026-08-22): 이 세션에서 근본원인 7건을 잡았는데 그중 5건이 같은 형태였다.
 *   **증상을 고치는 코드가 이미 있었고, 그게 원인을 몇 달간 가렸다.**
 *     · 통화 하드코딩 — 교정기 주석에 2026-05-24 날짜가 박혀 있었다(석 달)
 *     · 과열 강등 — 코드가 쓴 산문을 코드가 정규식으로 되읽음
 *     · garble 적재 — 앞 80자만 잘라 같은 문장을 before/after 로 기록
 *     · SEC 이름 title-case — 약어 파괴가 발간본까지 나감
 *   교정기가 있으면 증상이 안 보인다. 그래서 아무도 생산자를 안 고친다.
 *   나는 손으로 찾았지만, 지표가 있었으면 즉시 잡혔을 것이다.
 *
 * 신호: **거의 모든 보고서에서 발동하는 교정기는 교정 대상이 아니라 버그다.**
 *   실측 분포(최근 7일, 보고서 13개)가 이걸 뒷받침한다 — 사이가 비어 있다:
 *     harness_usNameMismatch         13/13 (100%)  ← 실제 버그(약어 파괴 + 축약형 오탐)
 *     narrative_garble_sanitized     13/13 (100%)  ← 실제 버그(기록이 무의미)
 *     harness_actionCritiqueMismatch 12/13  (92%)  ← 실제 버그(code→code 오귀인)
 *     harness_currencyMismatch       12/13  (92%)  ← 실제 버그(통화 하드코딩)
 *     ────────────────────── 빈 구간 ──────────────────────
 *     flow_movement_missing           2/13  (15%)  ← 정상 산발
 *     pct_subject_missing_sanitized   2/13  (15%)
 *     cascade_asset_unknown_kr_code   1/13   (8%)
 *   임계값은 이 빈 구간에서 잡는다(감이 아니라 측정된 간극).
 *
 * 다양성(고유입력/검출)은 **힌트**지 판정이 아니다. 실측에서 갈린다:
 *   currency 100%(생산자) · garble 100%(생산자) · actionCritique 37%(그래도 생산자)
 *   → 낮은 다양성이 곧 규칙 오탐은 아니다. 모른다고 쓴다.
 */
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const M = await import('./corrector-drift.mjs')
  .catch(e => { bad(`corrector-drift.mjs 없음: ${String(e.message).slice(0,60)}`); return null; });
if (!M) { console.log('\n❌ 1건 실패'); process.exit(1); }

// 실측 그대로 재현 (보고서 13개)
const rows = [];
const push = (t, reports, n, uniq) => {
  for (let i = 0; i < n; i++) {
    rows.push({ defect_type: t, report_id: `r${i % reports}`, llm_value: `v${i % uniq}` });
  }
};
push('harness_usNameMismatch', 13, 33, 20);
push('narrative_garble_sanitized', 13, 53, 53);
push('harness_actionCritiqueMismatch', 12, 27, 10);
push('harness_currencyMismatch', 12, 60, 60);
push('flow_movement_missing', 2, 2, 1);
push('pct_subject_missing_sanitized', 2, 2, 2);
push('cascade_asset_unknown_kr_code', 1, 1, 1);

const out = M.analyzeCorrectors(rows, { totalReports: 13 });
const by = Object.fromEntries(out.map(r => [r.defectType, r]));

// [1] 매 보고서마다 도는 4건을 전부 잡는가
for (const t of ['harness_usNameMismatch', 'narrative_garble_sanitized',
                 'harness_actionCritiqueMismatch', 'harness_currencyMismatch']) {
  by[t]?.flagged
    ? ok(`${t.replace('harness_','')} 표면화 (${by[t].reportsHit}/${by[t].totalReports}, ${by[t].hint})`)
    : bad(`${t} 를 놓친다 — 이 세션에 실제 버그로 확인된 것이다`);
}
// [2] 정상 산발은 조용해야 한다 (경보 피로 방지)
for (const t of ['flow_movement_missing', 'pct_subject_missing_sanitized', 'cascade_asset_unknown_kr_code']) {
  !by[t]?.flagged ? ok(`${t} 는 조용 (${by[t].reportsHit}/${by[t].totalReports})`)
                  : bad(`${t} 를 잘못 표면화 — 경보 피로`);
}
// [3] 표본이 적으면 판단하지 않는다 (보고서 2개로 100% 는 근거가 못 된다)
{
  const tiny = M.analyzeCorrectors([{ defect_type: 'x', report_id: 'a', llm_value: '1' },
                                    { defect_type: 'x', report_id: 'b', llm_value: '2' }], { totalReports: 2 });
  !tiny[0]?.flagged ? ok('표본 부족이면 표면화하지 않는다') : bad('보고서 2개로 단정한다');
}
// [4] 다양성은 힌트로만 — 단정하지 않는다
{
  const hi = by['harness_currencyMismatch'], lo = by['harness_actionCritiqueMismatch'];
  hi.hint !== lo.hint ? ok(`다양성으로 힌트를 나눈다 (100%→"${hi.hint}", 37%→"${lo.hint}")`)
                      : bad('힌트가 구분되지 않는다');
  /의심|확인/.test(hi.hint) && !/확정|틀림/.test(hi.hint)
    ? ok('힌트를 단정하지 않는다') : bad(`힌트가 단정적이다: ${hi.hint}`);
}
// [5] 빈 입력 안전
M.analyzeCorrectors([], { totalReports: 0 }).length === 0 ? ok('빈 입력 안전') : bad('빈 입력에서 깨진다');

// [5b] 이미 고친 교정기는 조용해져야 한다 — 안 그러면 7일간 계속 울고 곧 무시된다.
//   근거: 통화 하드코딩을 고치자 **바로 다음 보고서**에서 교정 6→0 이 됐다(실측 2026-08-22 evening).
{
  const recent = ['r0', 'r1'];   // 최신 2개
  const fixed = rows.filter((r) => !(r.defect_type === 'harness_currencyMismatch' && recent.includes(r.report_id)));
  const o = Object.fromEntries(M.analyzeCorrectors(fixed, { totalReports: 13, recentReportIds: recent })
    .map((r) => [r.defectType, r]));
  !o['harness_currencyMismatch'].flagged
    ? ok('최신 보고서에서 사라진 교정기는 조용해진다')
    : bad('고쳤는데도 계속 경보한다 — 경보 피로');
  o['harness_currencyMismatch'].stillFiring === false ? ok('stillFiring=false 로 이유를 남긴다') : bad('이유가 안 남는다');
  o['narrative_garble_sanitized'].flagged
    ? ok('아직 발동 중인 것은 계속 표면화')
    : bad('살아 있는 신호까지 죽였다 — 과잉 억제');
}

// [6] 모니터가 이걸 쓰는가 — 만들고 안 쓰면 없는 것과 같다
{
  const { readFileSync } = await import('fs');
  const src = readFileSync(new URL('../check-stall.mjs', import.meta.url), 'utf8')
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  /corrector-drift\.mjs/.test(src) ? ok('check-stall 이 이 지표를 본다') : bad('모니터가 안 본다 — 소비처 0');
}

console.log(fail === 0 ? '\n✅ corrector-drift 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
