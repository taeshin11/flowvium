#!/usr/bin/env node
/**
 * index-level-check.test.mjs — 내러티브의 지수 절대레벨을 **지우는 게 아니라 실측과 대조**하는가.
 *
 * 사건(2026-08-23): [12] 교정기 드리프트가 유일하게 남긴 상시발동 항목
 *   `narrative_garble_sanitized` (13/13 보고서, 주 53건, 다양성 100%)를 추적했다.
 *   실물은 전부 `KOSPI 6,913` 이었고, 그걸 지우는 주체는 stripFabricatedIndexLevels 다.
 *
 *   그 함수의 근거 주석(2026-06-17)은 이렇게 적혀 있다:
 *     "^KS11 피드는 KOSPI/KOSDAQ *절대* 지수레벨을 공급 안 함 → 콤마형 절대값은 100% 환각"
 *   **이 전제가 사실이 아니다.** 실측:
 *     ^KS11 regularMarketPrice = 6912.95   (모델이 쓴 6,913 = 반올림 일치)
 *     ^KQ11 = 801.94                        (보고서 "801.9" 일치)
 *     ^GSPC = 7674.37                       (보고서 "7,674" 일치)
 *
 *   게다가 같은 파이프라인이 그 값을 **프롬프트에 직접 공급**한다(:3303-3313):
 *     `[Index Levels] KOSPI 6,913 (+0.9%) …`
 *     `※지수 절대레벨은 위 [Index Levels] 수치만 그대로 인용하라`
 *   모델은 시킨 대로 인용했고, 후처리가 그걸 지웠으며, 그 삭제가 **모델의 환각으로 기록**됐다.
 *   `narrative_garble_sanitized` 는 harness_ 접두어가 없어 **실제로 다음 프롬프트에 주입된다**
 *   (db.mjs:1377 은 harness_/cascade_ 만 제외) — "이 garble 반복 금지: KOSPI 6,913".
 *   즉 인용하라고 시키고, 인용하면 지우고, 지운 걸 하지 말라고 가르치는 닫힌 모순이었다.
 *   :3312 주석이 그 증상("지수가 available 이어도 … sanitizer 가 매번 strip")을 적어놓고
 *   원인을 모델 탓으로 반대 해석했다.
 *
 * 고칠 방향: 실측이 있으면 대조한다(맞으면 유지, 틀리면 실측으로 교정), 실측이 없을 때만 지운다.
 *   저장소에 이미 같은 관용구가 있다 — reconcileSqueeze: "실측이 있으면 실측으로 덮고,
 *   실측에 없는 티커는 확인 불가라 뺀다".
 */
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const M = await import('./index-level-check.mjs')
  .catch(e => { bad(`index-level-check.mjs 없음: ${String(e.message).slice(0,60)}`); return null; });
if (!M) { console.log('\n❌ 1건 실패'); process.exit(1); }

const LV = { KOSPI: 6912.95, KOSDAQ: 801.94, 'S&P500': 7674.37, Nasdaq: 25412.1 };

// [1] 실측과 일치하면 지우지 않는다 — 이번 사건의 핵심
{
  const src = ' 제공한다. KOSPI 6,913(+0.9%)의 상승과 S&P500 7,674의 동반';
  const r = M.reconcileIndexLevels(src, LV);
  r.text === src ? ok('실측 일치 → 원문 그대로 유지') : bad(`맞는 값을 건드린다: ${r.text}`);
  r.fixes.length === 0 ? ok('교정 기록 없음') : bad(`맞는데 교정으로 기록: ${JSON.stringify(r.fixes)}`);
}
// [2] 실측과 다르면 지우지 말고 실측으로 고친다 (삭제보다 교정이 낫다)
{
  const r = M.reconcileIndexLevels('KOSPI 8,864 횡보 중', LV);
  /KOSPI 6,913 횡보/.test(r.text) ? ok(`틀린 값을 실측으로 교정: ${r.text}`) : bad(`교정 안 함: ${r.text}`);
  r.fixes.length === 1 && /8,864/.test(r.fixes[0]) ? ok(`무엇을 고쳤는지 남긴다: ${r.fixes[0]}`) : bad(`기록 부실: ${JSON.stringify(r.fixes)}`);
}
// [3] 실측이 없으면 지운다 (기존 동작 보존 — 확인 불가한 숫자는 싣지 않는다)
{
  const r = M.reconcileIndexLevels('KOSPI 8,864 횡보 중', {});
  r.text === 'KOSPI 횡보 중' ? ok(`실측 없음 → strip: ${r.text}`) : bad(`strip 동작이 깨졌다: ${r.text}`);
  r.fixes.length === 1 ? ok('strip 도 기록') : bad('strip 을 조용히 한다');
}
// [4] 지수와 무관한 콤마 숫자는 건드리지 않는다 (과잉 일반화 = 실데이터 파괴)
{
  const src = '외국인 투자자가 1,493억 원을 순매수하며 KOSPI 지수를 0.9% 끌어올렸다';
  const r = M.reconcileIndexLevels(src, LV);
  r.text === src ? ok('지수명에 붙지 않은 콤마 숫자는 불변') : bad(`실데이터를 파괴한다: ${r.text}`);
}
// [5] 한글 지수명도 동일
{
  const r = M.reconcileIndexLevels('코스피 6,913 상승', LV);
  r.text === '코스피 6,913 상승' ? ok('한글 지수명 일치 유지') : bad(`한글 처리 실패: ${r.text}`);
  // KOSDAQ 은 buildIndexLevelsBlock 의 specs 대로 소수 1자리로 표기한다(dec=1).
  const r2 = M.reconcileIndexLevels('코스닥 1,234 하락', LV);
  /코스닥 801\.9 하락/.test(r2.text) ? ok(`코스닥 교정(소수1자리): ${r2.text}`) : bad(`코스닥 교정 실패: ${r2.text}`);
}
// [6] 반올림 허용 — 6,913 vs 6912.95 를 불일치로 보면 안 된다
{
  const r = M.reconcileIndexLevels('KOSPI 6,913', { KOSPI: 6912.95 });
  r.fixes.length === 0 ? ok('반올림 차이는 일치로 본다') : bad('반올림을 불일치로 본다');
  const r2 = M.reconcileIndexLevels('KOSPI 6,913', { KOSPI: 6920.0 });
  r2.fixes.length === 1 ? ok('의미 있는 차이는 교정') : bad('7포인트 차이를 놓친다');
}
// [7] 배선 — 생성기가 실측 레벨을 넘기는가
{
  const { readFileSync } = await import('fs');
  const src = readFileSync(new URL('../generate-report-local.mjs', import.meta.url), 'utf8')
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  /index-level-check\.mjs/.test(src) ? ok('생성기가 이 모듈을 쓴다') : bad('만들었는데 생성기가 안 쓴다');
  /stripFabricatedIndexLevels\(finalReport\)/.test(src)
    ? bad('아직 실측 없이 blanket strip 한다 — 맞는 값을 계속 지운다')
    : ok('실측을 넘겨 호출한다');
  /return \{ text, map, levels \}/.test(src)
    ? ok('buildIndexLevelsBlock 이 절대레벨을 함께 돌려준다')
    : bad('레벨을 안 돌려준다 — map 은 등락%만 담는다(:3306)');
}

console.log(fail === 0 ? '\n✅ index-level-check 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
