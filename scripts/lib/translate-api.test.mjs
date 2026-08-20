#!/usr/bin/env node
/**
 * translate-api.test.mjs — /api/translate 의 성공 판정이 결과 기반인지 검증.
 *
 * 배경(2026-08-20): translate/route.ts:74 가 `ollamaTxt.trim() !== text.trim()` 으로 판정한다.
 *   '바뀌었는가'는 노력의 대리지표다. 모델이 짧은 명사 나열을 그대로 되돌려주면
 *   '실패'로 보고 cloud 로 넘기는데, 자가호스팅이라 클라우드 키가 revoked 여서 원문이 그대로 나간다.
 *   실측: "Industrial conglomerates, machinery, aerospace, and transportation." 원문 반환.
 *   (온도 0.3 비결정성으로 어떤 실행에서는 번역되기도 한다 — 그래서 더 위험하다.)
 *
 *   같은 저장소의 translationSucceeded 는 이미 이 교훈으로 '결과 기반'으로 고쳤다(translation-gate.mjs).
 *   여기도 같은 원칙을 적용한다: 출력이 대상 언어인가를 본다(lang-detect).
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };
const src = readFileSync(resolve(ROOT, 'src/app/api/translate/route.ts'), 'utf8');

/isUntranslated|lang-detect/.test(src)
  ? ok('언어 감지기로 성공 판정')
  : bad('`out !== text` 대리지표로 판정 — 동일 출력과 번역 불필요를 구분 못 함');

/ollamaTxt\.trim\(\) !== text\.trim\(\)/.test(src)
  ? bad('변화 기반 판정이 남아 있다')
  : ok('변화 기반 판정 제거됨');

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
