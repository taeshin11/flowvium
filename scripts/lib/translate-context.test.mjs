#!/usr/bin/env node
/**
 * translate-context.test.mjs — 번역에 원문 문맥을 넘기는지 검증.
 *
 * 배경(2026-08-20 실측): 뉴스 요약이 왕복 번역으로 고유명사를 잃는다.
 *   원제목  "[속보] 코스피 매수 사이드카…"        (한국어)
 *   → cascade AI 가 영어 요약 생성(CASCADE_SYSTEM_PROMPT: 'Use English exclusively')
 *   영문요약 "The Korean Composite's three-day rally…"   ← 코스피가 'Korean Composite' 로 변형
 *   → 다시 한국어 번역
 *   최종요약 "네이셔널컴포지트의 3일 상승세…"      ← 복원 불가
 *
 *   모델 크기 문제가 아님을 실험으로 확인했다(같은 문장, 같은 기계):
 *     4B  현재 프롬프트   "한국 합성 지수는…"           오역        1초
 *     4B  원제목 문맥 추가 "코스피의 3일 상승은 닛케이…"  정확 ✅     1초
 *     27B 현재 프롬프트   "한국 증시의 3일 연속 상승을…"  '코스피' 아님 42초
 *   → 문맥을 주는 것이 모델을 키우는 것보다 정확하고 42배 빠르다.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const B = await import('./translate-prompt.mjs').catch(() => null);
if (!B?.buildTranslatePrompt) { bad('buildTranslatePrompt 미구현 — 문맥 전달 지점이 없다'); console.log('\n결과: 실패 1건'); process.exit(1); }

const p1 = B.buildTranslatePrompt({ text: 'The Korean Composite rallied', langName: 'Korean' });
!/원문|context|headline/i.test(p1) || p1.length < 200
  ? ok('문맥 없으면 단순 프롬프트 (종전 동작 유지)') : bad('문맥 없는데 군더더기 추가');

const p2 = B.buildTranslatePrompt({ text: 'The Korean Composite rallied', langName: 'Korean', context: '[속보] 코스피 매수 사이드카' });
p2.includes('코스피 매수 사이드카') ? ok('문맥이 프롬프트에 포함') : bad('문맥이 반영 안 됨');
/same proper nouns|고유명사|terminology/i.test(p2) ? ok('고유명사 일치 지시 포함') : bad('고유명사 지시 없음');

// 문맥이 번역 대상과 같으면 넣지 않는다(자기 자신을 문맥으로 주면 무의미)
const p3 = B.buildTranslatePrompt({ text: 'same', langName: 'Korean', context: 'same' });
p3 === B.buildTranslatePrompt({ text: 'same', langName: 'Korean' })
  ? ok('문맥==본문이면 문맥 생략') : bad('자기 자신을 문맥으로 넣는다');

// route.ts 가 요약 번역에 제목을 문맥으로 넘기는가
const src = readFileSync(resolve(ROOT, 'src/app/api/news-cascade/route.ts'), 'utf8');
/tOne\(a\.summary,\s*[^)]*a\.title/.test(src) || /tOne\(a\.summary,\s*\{[^}]*context/.test(src)
  ? ok('요약 번역에 원제목을 문맥으로 전달')
  : bad('요약 번역이 문맥 없이 호출됨 (tOne(a.summary))');

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
