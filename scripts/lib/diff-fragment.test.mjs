#!/usr/bin/env node
/**
 * diff-fragment.test.mjs — "교정 전/후"를 학습용으로 기록할 때 실제로 바뀐 구간을 담는가.
 *
 * 사건(2026-08-22): 오탐률 추적에서 최근 7일 최대 *주입* 항목이
 *   narrative_garble_sanitized (검출 50 · 12개 보고서 전부 · 주입 251회)로 나왔다.
 *   실물을 보니 llm_value 와 correct_value 가 **같은 문장**이었다:
 *     LLM    : thesis: "오늘 한국 시장에서는 외국인 투자자가 6,727억 원을 순매수하며 …"
 *     CORRECT: 교정형 "오늘 한국 시장에서는 외국인 투자자가 6,727억 원을 순매수하며 …" — 이 garble 반복 금지
 *
 *   generate-report-local.mjs:9310 이 before/after 를 각각 `.slice(0, 80)` 한다.
 *   교정은 대개 문장 뒤쪽에서 일어나므로 앞 80자는 서로 같다. 결과적으로
 *   **멀쩡한 문장을 가리키며 "이 garble 반복 금지"** 를 다음 프롬프트에 주입해 왔다.
 *   설계 의도("모델이 garble 자체를 학습")는 옳고, 문자열을 자르는 위치가 틀렸다.
 *
 * 이건 앞서 잡은 flow_movement_missing 오탐과 같은 구조인데 규모가 훨씬 크고
 *   harness_ 접두어가 없어 **실제로 주입된다**(db.mjs:1377 은 harness_ 만 제외한다).
 */
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const M = await import('./diff-fragment.mjs')
  .catch(e => { bad(`diff-fragment.mjs 없음: ${String(e.message).slice(0,60)}`); return null; });
if (!M) { console.log('\n❌ 1건 실패'); process.exit(1); }

// [1] 실제 사건 형태: 차이가 80자 뒤에 있다
{
  const head = '오늘 한국 시장에서는 외국인 투자자가 6,727억 원을 순매수하며 KOSPI 지수를 0.9% 끌어올렸는데, 이는 원화 강세와 함께 한국 주식에 대한 신뢰가 회복되고 있음을 뜻한다. ';
  const before = head + '숏 스퀴즈는 짧은 매수로 나타났다.';
  const after  = head + '숏 스퀴즈가 나타났다.';
  const d = M.diffFragment(before, after);
  d && d.before.includes('짧은 매수')
    ? ok(`바뀐 구간을 잡는다: before=${JSON.stringify(d.before).slice(0,44)}`)
    : bad(`앞부분만 잘라 차이를 못 담는다: ${JSON.stringify(d?.before ?? null).slice(0,60)}`);
  d && !d.after.includes('짧은 매수') && d.after.includes('나타났다')
    ? ok(`교정형도 같은 구간: after=${JSON.stringify(d.after).slice(0,44)}`)
    : bad(`after 구간이 어긋난다: ${JSON.stringify(d?.after ?? null).slice(0,60)}`);
  d.before !== d.after ? ok('before ≠ after (같은 문장을 두 번 적지 않는다)') : bad('before 와 after 가 같다 — 사건 재현');
}

// [2] 차이가 없으면 기록거리가 아니다
M.diffFragment('같은 문장', '같은 문장') === null
  ? ok('동일 문자열은 null (기록하지 않는다)')
  : bad('동일한데 기록거리를 만든다');

// [3] 앞쪽이 다른 경우도 정상 동작 (과잉 일반화 방지)
{
  const d = M.diffFragment('삭제된 문장이 앞에 있다. 뒤는 같다.', '앞이 바뀐 문장이다. 뒤는 같다.');
  d && d.before !== d.after && /삭제된/.test(d.before) ? ok('앞쪽 차이도 잡는다') : bad(`앞쪽 차이를 놓친다: ${JSON.stringify(d)}`);
}

// [4] 한쪽이 통째로 제거된 경우 (sanitizer 가 문장을 지우는 형태)
{
  const d = M.diffFragment('본문 유지. 환각 문장 제거 대상.', '본문 유지.');
  d && /환각 문장/.test(d.before) && d.after.length < d.before.length
    ? ok('삭제형 교정도 구간을 담는다')
    : bad(`삭제형을 못 담는다: ${JSON.stringify(d)}`);
}

// [5] 길이 상한 — 프롬프트 슬롯을 통째로 먹지 않게
{
  const b = 'x'.repeat(500) + 'AAA' + 'y'.repeat(500);
  const a = 'x'.repeat(500) + 'BBB' + 'y'.repeat(500);
  const d = M.diffFragment(b, a, { max: 80 });
  d.before.length <= 80 && d.after.length <= 80
    ? ok(`상한 준수 (${d.before.length}자)`) : bad(`상한 초과: ${d.before.length}자`);
  d.before.includes('AAA') && d.after.includes('BBB')
    ? ok('상한을 지키면서도 차이는 포함한다') : bad('잘라내다 차이를 잃었다');
}

// [6] 실제 기록 지점이 이걸 쓰는가
{
  const { readFileSync } = await import('fs');
  const src = readFileSync(new URL('../generate-report-local.mjs', import.meta.url), 'utf8')
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  /diff-fragment\.mjs/.test(src) ? ok('생성기가 이 모듈을 쓴다') : bad('만들었는데 기록 지점이 안 쓴다');
  /llm_value:\s*`\$\{k\}:\s*"\$\{before\.slice\(0,\s*80\)\}"`/.test(src)
    ? bad('아직 before.slice(0,80) 로 기록한다 — 사건 재현')
    : ok('앞 80자 자르기 제거됨');
}

console.log(fail === 0 ? '\n✅ diff-fragment 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
