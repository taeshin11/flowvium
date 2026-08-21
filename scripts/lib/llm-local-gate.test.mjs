#!/usr/bin/env node
/**
 * llm-gate.test.mjs — 웹 LLM 동시성 게이트가 설정 가능하고 거절을 관측하는지 검증.
 *
 * 배경(2026-08-20 실측): news-cascade 12건 중 정확히 2건만 AI 분석 성공.
 *   ai: 2 · ai-failed: 8 · keyword-rule: 2
 *   llm-local.ts 의 OLLAMA_MAX_CONCURRENT = 2 와 정확히 일치한다.
 *   게이트 대기 상한 OLLAMA_WAIT_MS = 15,000 인데 웹 레인의 실제 생성이 22.4초(509토큰, 22.7 tok/s)라
 *   대기자는 구조적으로 통과할 수 없다. 거절 시 null 만 돌려주고 로그를 남기지 않아
 *   "AI 분석이 왜 안 되지"를 추적할 수 없었다(rawLen: 0 만 보였다).
 *   상수는 GPU 를 보고서와 공유하던 시절 값이다 — 전용 레인(:8001, 4B)에는 맞지 않는다.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };
const src = readFileSync(resolve(ROOT, 'src/lib/llm-local.ts'), 'utf8');

/const OLLAMA_MAX_CONCURRENT = \d+;/.test(src)
  ? bad('동시성 상한이 코드 리터럴 — 레인 구성이 바뀌어도 못 따라간다')
  : ok('동시성 상한이 설정 가능');
/const OLLAMA_WAIT_MS = \d+;/.test(src)
  ? bad('대기 상한이 코드 리터럴 — 모델 속도가 바뀌면 대기자가 전멸한다')
  : ok('대기 상한이 설정 가능');
/(logger|console)\.[a-z]+\([^)]*(gate|busy|reject|saturat)/i.test(src)
  ? ok('게이트 거절을 관측 가능하게 남긴다')
  : bad('게이트가 조용히 거절 — 실패 원인을 추적할 수 없다');

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
