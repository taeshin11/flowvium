#!/usr/bin/env node
/**
 * translation-gate.test.mjs — 번역 성공 판정이 '결과'를 보는지 검증.
 *
 * 배경(2026-08-20 실측): /api/news-cascade?locale=ko 응답이 source=cached-en · translated=false.
 *   번역본은 실제로 만들어져 Redis(flowvium:tr:v1:ko:*)에 한국어로 캐시돼 있는데도 버려졌다.
 *   translationSucceeded(route.ts:92-107)의 첫 기준이 원인:
 *     const changed = sample.some((t,i) => t.title !== orig[i].title);
 *     if (!changed) return false;
 *   한국어 소스 기사는 제목이 이미 한국어라 바뀔 이유가 없다. 앞 5건이 모두 한국어 기사면
 *   '안 바뀜 = 실패'로 단정해 번역 결과 전체를 폐기하고 cached-en 을 서빙했다.
 *   '변화'는 결과가 아니라 노력의 대리지표다. 결과(대상 언어인가)로 판정해야 한다.
 *   두 번째 기준(제목 70% 대상 스크립트)은 이미 결과 기반이고 통과했다(8/11=73%).
 */
const G = await import('./translation-gate.mjs').catch(() => null);
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };
if (!G?.translationSucceeded) { bad('translationSucceeded 미분리 — 결과 기반 판정 검증 불가'); console.log('\n결과: 실패 1건'); process.exit(1); }

const A = (t, s) => ({ title: t, summary: s });
// ① 실측 재현: 한국어 소스 기사라 제목이 안 바뀌었지만 요약은 번역됨 → 성공이어야 한다
const orig = [A('코스피 상승', 'The KOSPI rallied'), A('SK 급등', 'SK surged'), A('KT 협력', 'KT partners')];
const tr   = [A('코스피 상승', '코스피가 상승했다'), A('SK 급등', 'SK가 급등했다'), A('KT 협력', 'KT가 협력한다')];
G.translationSucceeded(orig, tr, 'ko') === true
  ? ok('제목 불변 + 요약 번역됨 → 성공 (종전에는 폐기)')
  : bad('제목이 안 바뀌었다고 번역 전체를 버린다');

// ② 진짜 실패: 아무것도 번역되지 않음
const tr2 = [A('KOSPI rallied', 'The KOSPI rallied'), A('SK surged', 'SK surged'), A('KT partners', 'KT partners')];
const orig2 = tr2;
G.translationSucceeded(orig2, tr2, 'ko') === false
  ? ok('전부 미번역 → 실패') : bad('미번역인데 성공 판정');

// ③ 부분 번역(임계 미달)은 실패 — 종전 70% 기준 보존
// 픽스처는 실제 길이여야 한다 — 짧은 문자열은 MIN_WORDY 미만이라 판정에서 빠진다(티커 오탐 방지 장치).
const orig3 = Array.from({length:10},(_,i)=>A(`Federal Reserve holds rates steady number ${i}`, `The central bank kept policy unchanged in decision ${i}`));
const tr3 = orig3.map((a,i)=> i<3 ? A(`연준이 금리를 동결했다 ${i}`,`중앙은행이 정책을 유지했다 ${i}`) : a);
G.translationSucceeded(orig3, tr3, 'ko') === false
  ? ok('부분 번역(30%) → 실패 (partial 캐시 차단 유지)') : bad('부분 번역이 통과');

// ④ 번역이 필요 없는 경우(전부 이미 대상 언어) → 성공
const orig4 = [A('코스피 상승', '코스피가 올랐다')];
G.translationSucceeded(orig4, orig4, 'ko') === true
  ? ok('번역 불필요 → 성공') : bad('할 일이 없는데 실패 판정');

// ⑤ en 대상은 항상 성공 (종전 동작)
G.translationSucceeded(orig, tr, 'en') === true ? ok('locale=en → 성공') : bad('en 처리 변경됨');

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
