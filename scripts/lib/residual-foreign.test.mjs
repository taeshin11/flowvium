#!/usr/bin/env node
/**
 * residual-foreign.test.mjs — 잔존 외국어 판정이 '영문'도 잡는지 검증.
 *
 * 배경(2026-08-20 실측): /api/news-cascade?locale=ko 에서 요약 3~11건이 영문으로 노출.
 *   news-cascade/route.ts:80-88 residualForeign 이 대상별 '특정 스크립트'만 본다:
 *     ko → 일본어 가나만 · ja → 한글만 · zh → 가나·한글만
 *   영문은 어떤 대상에서도 잔존으로 판정되지 않아 sweep(:297)을 그대로 통과했다.
 *   cascade AI 가 요약을 영어로 만들므로(CASCADE_SYSTEM_PROMPT) 이 사각지대가 상시 노출로 이어졌다.
 *   특정 언어를 하나씩 추가하는 건 화이트리스트 하드코딩이다 —
 *   '대상 언어 문자가 하나도 없으면 미번역'이라는 일반 규칙이 근본이다.
 *   단, 티커/숫자처럼 정상적으로 대상문자가 없는 짧은 텍스트는 제외해야 한다.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const src = readFileSync(resolve(ROOT, 'src/app/api/news-cascade/route.ts'), 'utf8');
// route.ts 가 공용 모듈을 쓰는가 (로컬 구현이 남아 있으면 사각지대가 되살아난다)
/from '@\/lib\/residual-foreign'/.test(src) && !/function residualForeign\(/.test(src)
  ? ok('route.ts 가 공용 residual-foreign 모듈 사용 (로컬 구현 제거됨)')
  : bad('route.ts 에 로컬 residualForeign 구현이 남아 있다');

// 실제 동작 확인 (모듈로 분리돼 있으면 직접, 아니면 소스 검사로 대체)
const M = await import('./residual-foreign.mjs').catch(() => null);
if (M?.residualForeign) {
  const cases = [
    ['ko', 'The 3-day rally in the KOSPI is driven by positive sentiment', true,  '영문 요약(ko) → 잔존'],
    ['ko', 'SK 하이닉스의 주가 상승은 주주 반환 조치에 의해 주도되었다', false, '한국어 요약(ko) → 정상'],
    ['ko', 'BILL', false, '짧은 티커 → 잔존 아님(오탐 방지)'],
    ['ko', '2026-08-20 +3.5%', false, '숫자·기호만 → 잔존 아님'],
    ['ko', 'これは日本語です', true, '가나(ko) → 잔존 (종전 동작 유지)'],
    ['ja', '한국어 문장입니다', true, '한글(ja) → 잔존 (종전 동작 유지)'],
  ];
  for (const [loc, txt, want, label] of cases) {
    const got = M.residualForeign(txt, loc);
    got === want ? ok(label) : bad(`${label} — got=${got} want=${want}`);
  }
} else bad('residual-foreign.mjs 미분리 — 동작 검증 불가');

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
