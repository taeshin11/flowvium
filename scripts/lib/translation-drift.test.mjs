#!/usr/bin/env node
/**
 * translation-drift.test.mjs — "다수 로케일은 번역했는데 일부만 영문" 검출.
 *
 * 배경(2026-08-21): /ko/report 의 내러티브 섹션 라벨이 WHY / WATCH / STORY 였다.
 *   16개 로케일 중 11개는 번역했다(fr POURQUOI · ru ПОЧЕМУ · th ทำไม …). ko·ja·zh 만 영문.
 *   내 영문 누출 검사기는 이걸 못 잡는다 — 티커·약어를 걸러내려고 ^[A-Z]{2,6}$ 를 제외하기 때문이다.
 *
 *   화면을 훑는 방식으로는 한계가 있다. 카탈로그(messages/*.json)를 서로 비교하면
 *   판단 없이 알 수 있다: *다른 로케일이 번역한 키를 이 로케일만 영문으로 두었나*.
 *   CEO·ROE·FAQ 처럼 모두가 영문으로 둔 키는 보편 용어라 자동으로 빠진다.
 *
 * 동족어 주의: es 'Sector' · fr 'Date' · fr 'Impact' 는 실제로 그 언어에서도 같은 철자다.
 *   유럽어에는 오탐이 많다(실측 de 374 · fr 369). CJK(ko·ja·zh)는 동족어가 없어 신호가 확실하다
 *   (실측 ko 18 · ja 94 · zh 92). 그래서 '형제 로케일' 기준을 별도로 제공한다.
 */
import { translationDrift, siblingDrift } from './translation-drift.mjs';

let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };
const eqA = (g, w, m) => (JSON.stringify([...g].sort()) === JSON.stringify([...w].sort()) ? ok(m)
  : (console.log(`  FAIL  ${m}\n          got ${JSON.stringify([...g].sort())}\n          want ${JSON.stringify([...w].sort())}`), fail++));

const CAT = {
  en:      { 'a.why': 'WHY', 'a.ceo': 'CEO', 'a.score': 'score', 'a.only': 'Only' },
  ko:      { 'a.why': 'WHY', 'a.ceo': 'CEO', 'a.score': 'score', 'a.only': 'Only' },
  ja:      { 'a.why': 'WHY', 'a.ceo': 'CEO', 'a.score': 'スコア', 'a.only': 'Only' },
  'zh-CN': { 'a.why': 'WHY', 'a.ceo': 'CEO', 'a.score': '得分', 'a.only': 'Only' },
  fr:      { 'a.why': 'POURQUOI', 'a.ceo': 'CEO', 'a.score': 'score', 'a.only': 'Only' },
  ru:      { 'a.why': 'ПОЧЕМУ', 'a.ceo': 'CEO', 'a.score': 'счёт', 'a.only': 'Only' },
};

// ① 아무도 번역 안 한 키는 보편 용어 — 드리프트 아님
{
  const r = translationDrift(CAT, 'ko');
  r.every(x => x.key !== 'a.ceo') ? ok('전 로케일 영문(CEO)은 드리프트 아님') : bad('보편 용어를 드리프트로 봄');
  r.every(x => x.key !== 'a.only') ? ok('아무도 번역 안 한 키 제외') : bad('a.only 오탐');
}
// ② 다른 로케일이 번역한 키를 이 로케일만 영문 → 드리프트
{
  eqA(translationDrift(CAT, 'ko').map(x => x.key), ['a.why', 'a.score'], 'ko 드리프트 2건');
  eqA(translationDrift(CAT, 'ja').map(x => x.key), ['a.why'], 'ja 는 score 를 번역했으므로 1건');
}
// ③ 형제 로케일 기준 — CJK 중 다른 형제가 번역했으면 신호가 강하다
{
  const s = siblingDrift(CAT, 'ko', ['ja', 'zh-CN']);
  eqA(s.map(x => x.key), ['a.score'], 'ko: 형제(ja·zh)가 번역한 것만 → a.score');
  s[0] && s[0].siblings && s[0].siblings.ja === 'スコア' ? ok('형제 번역값을 함께 준다(검토 근거)') : bad('형제 값 미제공');
}
// ④ 형제가 없거나 인자가 이상해도 죽지 않는다
{
  siblingDrift(CAT, 'ko', []).length === 0 ? ok('형제 목록 비면 빈 결과') : bad('빈 형제 처리 이상');
  translationDrift(null, 'ko').length === 0 ? ok('null 카탈로그 안전') : bad('null 처리 이상');
  translationDrift(CAT, 'nope').length === 0 ? ok('없는 로케일 안전') : bad('미지 로케일 처리 이상');
}
// ⑤ 실제 카탈로그로 돌려 본다 (수치는 고정하지 않는다 — 번역이 채워지면 줄어야 정상)
{
  const { readFileSync, readdirSync } = await import('fs');
  const { resolve, dirname } = await import('path');
  const { fileURLToPath } = await import('url');
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const flat = (o, p = '', out = {}) => {
    if (typeof o === 'string') out[p] = o;
    else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) flat(v, p ? `${p}.${k}` : k, out);
    return out;
  };
  const cat = {};
  for (const f of readdirSync(resolve(ROOT, 'messages')).filter(x => x.endsWith('.json')))
    cat[f.slice(0, -5)] = flat(JSON.parse(readFileSync(resolve(ROOT, 'messages', f), 'utf8')));
  const CJK = ['ko', 'ja', 'zh-CN', 'zh-TW'];
  for (const loc of CJK) {
    const sib = siblingDrift(cat, loc, CJK.filter(x => x !== loc));
    console.log(`  (참고) ${loc}: 형제 CJK 가 번역했는데 영문인 키 ${sib.length}건`
      + (sib.length ? ` — 예: ${sib.slice(0, 3).map(x => x.key).join(', ')}` : ''));
  }
  ok('실제 카탈로그 분석 동작');
}

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
