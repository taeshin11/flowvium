#!/usr/bin/env node
/**
 * translate-validate.test.mjs — 번역 판정 책임 분리 검증.
 *
 * 2026-08-20 시행착오 기록:
 *   1차 시도: 배치 판정(anyTr)에 요약을 포함시켰다 → 역효과.
 *     한국어 소스 기사는 제목이 번역 불필요라, LLM 응답에 summary 필드가 없으면
 *     '변화 없음'과 구분되지 않아 멀쩡한 배치를 통째로 버렸다.
 *     실측: 제목 12/12→8/11, 요약 9/12→0/11. 되돌렸다.
 *   최종 설계: 책임을 분리한다.
 *     · 배치 판정(anyTr, route.ts): '제목' 기준 유지 — 배치가 아예 동작했는지만 본다.
 *     · 서빙 게이트(translation-gate.mjs): '결과' 기준 — 번역이 필요했던 필드 중
 *       대상 언어 비율이 임계 이상인가. 여기가 실제로 사용자에게 나가는 것을 결정한다.
 *     · 잔여 보정(residual-foreign.mjs): 개별 필드의 미번역을 잡아 per-field 재번역.
 *   실측 결과: source=cached · 제목 11/11 · 요약 10/10 한글.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };
const src = readFileSync(resolve(ROOT, 'src/app/api/news-cascade/route.ts'), 'utf8');

// ① 서빙 게이트가 결과 기반 공용 모듈이어야 한다 (제목 변화 기준이 남아 있으면 안 됨)
/from '@\/lib\/translation-gate'/.test(src) && !/function translationSucceeded\(/.test(src)
  ? ok('서빙 게이트가 공용 translation-gate 모듈 (로컬 구현 제거)')
  : bad('route.ts 에 로컬 translationSucceeded 가 남아 있다');

// ② 게이트가 요약까지 본다
const G = await import('./translation-gate.mjs');
const orig = [{ title: '코스피 상승 소식이 전해졌다', summary: 'The KOSPI rallied on strong earnings' }];
const tr   = [{ title: '코스피 상승 소식이 전해졌다', summary: '코스피가 실적 호조에 상승했다' }];
G.translationSucceeded(orig, tr, 'ko') === true
  ? ok('제목 불변 + 요약 번역 → 성공 (요약을 판정에 포함)')
  : bad('요약 번역을 인정하지 않는다');

// ③ 잔여 보정이 영문도 잡는다
const R = await import('./residual-foreign.mjs');
R.residualForeign('The KOSPI rallied on strong earnings today', 'ko') === true
  ? ok('잔여 보정이 영문 미번역을 탐지') : bad('영문 미번역을 못 잡는다');

// ④ skipLocal 은 kanaDominant 로 판정한다 (residualForeign 재사용 금지 — 영문까지 로컬 skip 됐던 회귀)
/skipLocal = locale === 'ko' && kanaDominant\(/.test(src)
  ? ok('skipLocal 이 kanaDominant 로 분리 판정')
  : bad('skipLocal 이 residualForeign 재사용 — 영문마다 로컬 LLM 을 건너뛴다');

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
