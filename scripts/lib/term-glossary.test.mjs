#!/usr/bin/env node
/**
 * term-glossary.test.mjs — 표기 정규화를 모델에게 미리 알려주는가.
 *
 * 실측(2026-08-27, 최근 7일 narrative_garble_sanitized 95건 분해):
 *     21회  '컨' → '콘'                    ← 단일 최대 반복
 *      2회  '컨탱고 구조로 …' → '콘탱고 구조로 …'  (같은 유형)
 *      5회  ' ' → ''  · 4회 '4.6% ' → '' · …
 *   즉 약 1/4 이 **컨탱고→콘탱고 표기 정규화** 하나다.
 *
 * 이건 환각이 아니라 **우리 집 표기 규칙**이다. 그런데 교정될 때마다
 *   narrative_garble_sanitized 로 적재되고, 이 유형은 harness_ 접두어가 없어
 *   **다음 프롬프트에 "이 garble 반복 금지" 로 주입된다**(db.mjs:1377 은 harness_/cascade_ 만 제외).
 *   모델은 우리 선호 표기를 들은 적이 없는데 벌만 받는다 — 지수레벨 사건과 같은 구조다.
 *
 * 방향: 정규화 규칙이 이미 있는 곳(narrative-fix.mjs)에서 용어집을 뽑아 프롬프트에 넣는다.
 *   목록을 프롬프트에 따로 박으면 두 벌이 되어 갈린다(이 세션에서 반복해 겪은 실패).
 */
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const N = await import('./narrative-fix.mjs');
if (typeof N.canonicalTermGlossary !== 'function') {
  bad('canonicalTermGlossary() 없음 — 정규화 규칙을 프롬프트가 알 방법이 없다');
  console.log('\n❌ 실패'); process.exit(1);
}

const g = N.canonicalTermGlossary();
// [1] 실측 최대 반복 항목이 들어 있는가
/콘탱고/.test(g) ? ok(`용어집에 콘탱고 포함: ${g.slice(0, 60)}…`) : bad('최대 반복 항목이 빠졌다');
// [2] 정규화기와 같은 출처인가 — 프롬프트에 따로 박으면 갈린다
{
  const { readFileSync } = await import('fs');
  const src = readFileSync(new URL('./narrative-fix.mjs', import.meta.url), 'utf8');
  /CANONICAL_TERMS/.test(src) && /CANONICAL_TERMS/.test(src.split('canonicalTermGlossary')[0])
    ? ok('정규화 규칙과 용어집이 같은 상수에서 나온다')
    : bad('용어집이 별도 목록이다 — 규칙이 바뀌면 갈린다');
}
// [3] 프롬프트가 실제로 쓰는가
{
  const { readFileSync } = await import('fs');
  const gen = readFileSync(new URL('../generate-report-local.mjs', import.meta.url), 'utf8')
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  /canonicalTermGlossary/.test(gen) ? ok('생성기 프롬프트가 용어집을 쓴다') : bad('만들었는데 프롬프트가 안 쓴다 — 소비처 0');
}
// [4] 정규화 동작은 그대로 (용어집을 넣었다고 교정기를 끄면 안 된다 — 모델이 안 지킬 수 있다)
{
  const out = N.fixNarrativeText ? N.fixNarrativeText('VIX 15.7의 컨탱고 구조') : null;
  out == null ? ok('(fixNarrativeText 미노출 — 정규화 경로는 별도 검증)')
              : /콘탱고/.test(out) ? ok(`정규화는 계속 동작: ${out}`) : bad(`정규화가 꺼졌다: ${out}`);
}

console.log(fail === 0 ? '\n✅ term-glossary 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
