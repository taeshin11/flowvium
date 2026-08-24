#!/usr/bin/env node
/**
 * index-level-gate.test.mjs — 발간 게이트와 후처리가 **같은 규칙**으로 지수레벨을 판정하는가.
 *
 * 사고(2026-08-23 00:11 ~ 08-24 11:14, 발간 30시간 중단 — 내가 냈다):
 *   전날 stripFabricatedIndexLevels(무조건 삭제)를 실측 대조로 바꿨다. 후처리는 이제
 *   맞는 값(KOSPI 6,913 = 실측 6912.95)을 **남긴다**. 그런데 발간 게이트
 *   verify-report.mjs:1035 의 index_value_fabrication 은 옛 전제를 그대로 쓴다:
 *     "우리 ^KS11 피드는 절대값을 공급 안 함 → 내러티브의 절대 지수레벨은 전부 ungrounded 환각"
 *   그래서 맞는 값을 환각으로 보고 **발간을 막았다.**
 *
 *   실측 피해: 커밋 직후 첫 실행부터 6회 중 5회 차단.
 *     08-23 morning 🚫 · noon 🚫 · afternoon 🚫 · evening ✅ · midnight 🚫 · 08-24 morning 🚫
 *   (evening 만 통과한 건 그 회차 내러티브에 게이트 정규식이 걸리는 표현이 없었기 때문이다.)
 *
 *   내 잘못의 정체: **생산자만 바꾸고 소비처를 확인하지 않았다.** 이 세션 내내 잡아온
 *   "두 곳이 갈리면 재발한다"를 내가 그대로 저질렀다.
 *
 * 그래서 판정을 한 함수로 모은다. 게이트와 후처리가 같은 함수를 쓰면 갈릴 수가 없다.
 */
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const M = await import('./index-level-check.mjs')
  .catch(e => { bad(`모듈 로드 실패: ${String(e.message).slice(0,60)}`); return null; });
if (!M || typeof M.detectIndexLevelMismatch !== 'function') {
  bad('detectIndexLevelMismatch() 없음 — 게이트가 쓸 단일 판정이 없다');
  console.log('\n❌ 실패'); process.exit(1);
}

const LV = { KOSPI: 6912.95, KOSDAQ: 801.94, 'S&P500': 7674.37 };

// [1] 실측과 일치하면 환각이 아니다 — 이 사고의 핵심
for (const t of ['KOSPI 6,913(+0.9%)의 상승', '코스피 6,913 상승', 'KOSDAQ 801.9 급락']) {
  M.detectIndexLevelMismatch(t, LV) === null
    ? ok(`환각 아님: ${t}`)
    : bad(`맞는 값을 환각으로 본다 → 발간 차단 재발: ${t}`);
}
// [2] 실측과 다르면 환각이다 (게이트 본래 목적 유지)
{
  const d = M.detectIndexLevelMismatch('KOSPI 8,864 횡보', LV);
  d && d.claimed === 8864 && Math.round(d.actual) === 6913
    ? ok(`틀린 값은 잡는다: claimed=${d.claimed} actual=${d.actual}`)
    : bad(`진짜 환각을 놓친다: ${JSON.stringify(d)}`);
}
// [3] 실측이 없으면 "확인 불가" — 단정하지 않는다
{
  const d = M.detectIndexLevelMismatch('KOSPI 8,864 횡보', {});
  d && d.unverifiable === true ? ok('실측 없으면 unverifiable 로 표시') : bad(`확인 불가를 환각으로 단정: ${JSON.stringify(d)}`);
}
// [4] 연도·상대표현은 지수레벨이 아니다 (기존 예외 보존)
for (const t of ['KOSPI 2024년 이후', 'KOSPI 200일선 대비 +3%', 'KOSPI 1,200p 대비']) {
  M.detectIndexLevelMismatch(t, LV) === null ? ok(`제외: ${t}`) : bad(`상대표현/연도를 환각으로 본다: ${t}`);
}
// [5] 지수와 무관한 콤마 숫자는 건드리지 않는다
M.detectIndexLevelMismatch('외국인 1,493억 원 순매수하며 KOSPI 지수를 0.9% 끌어올렸다', LV) === null
  ? ok('지수명에 붙지 않은 숫자는 무시') : bad('실데이터를 환각으로 본다');

// [6] 게이트가 이 함수를 쓰는가 — 안 쓰면 또 갈린다
{
  const { readFileSync } = await import('fs');
  const src = readFileSync(new URL('../verify-report.mjs', import.meta.url), 'utf8')
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  /index-level-check\.mjs/.test(src) ? ok('verify-report 가 단일 판정을 쓴다') : bad('게이트가 아직 자체 정규식을 쓴다 — 사고 재발');
  /const idxM = fullNarr\.match\(/.test(src)
    ? bad('옛 인라인 정규식이 남아 있다') : ok('옛 인라인 정규식 제거됨');
}
// [7] 생성기가 실측 레벨을 보고서에 저장하는가 — 게이트가 나중에 대조하려면 있어야 한다
{
  const { readFileSync } = await import('fs');
  const gen = readFileSync(new URL('../generate-report-local.mjs', import.meta.url), 'utf8')
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  /indexLevelsAbs/.test(gen) && /finalReport\.indexLevelsAbs\s*=/.test(gen)
    ? ok('보고서에 생성시점 실측 레벨을 저장한다')
    : bad('레벨을 저장 안 한다 — 게이트가 대조할 근거가 없다');
}

console.log(fail === 0 ? '\n✅ index-level-gate 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
