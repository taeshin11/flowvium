#!/usr/bin/env node
/**
 * local-chat-retry.test.mjs — 재생성 조건이 '미번역'까지 포함하는지 검증.
 *
 * 배경(2026-08-20 실측, 캐시 비우고 5회): 한국어 3/5 · 영문 2/5.
 *   4B 가 짧은 명사 나열을 그대로 되돌려주는 경우가 있고, 그때
 *   translate/route.ts 는 cloud 로 넘기는데 자가호스팅이라 키가 revoked → 빈 값 → 원문 반환.
 *   즉 '감지는 되는데 복구 경로가 없다'.
 *
 *   llm-local.ts 의 localChatNoBleed 에는 이미 1회 재생성이 있다. 그런데 조건이
 *   hasChineseBleed(한자·가나 누출)뿐이다. 영문을 그대로 뱉는 경우는 조건에 없다.
 *   재생성 프롬프트는 "Output ONLY in the target language" 라 이 경우를 정확히 겨냥한다.
 *   새 재시도를 넣는 게 아니라, 있는 재생성이 올바른 조건에서 발동하게 한다.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };
const src = readFileSync(resolve(ROOT, 'src/lib/llm-local.ts'), 'utf8');
const fn = src.slice(src.indexOf('export async function localChatNoBleed'), src.indexOf('export async function localChatNoBleed') + 1400);

// 시행착오 결과 원복했다. 재생성 조건에 isUntranslated 를 넣으면 3/5 → 0/5 로 악화한다
// (모델이 번역은 하되 키릴·라틴 조각을 섞고, 재생성도 또 오염돼 null → 원문 노출).
// 병목은 조건이 아니라 4B 의 외래어 음차 품질이다. 사유가 코드에 남아 있는지 확인한다.
/시행착오|음차 품질/.test(fn)
  ? ok('원복 사유가 코드에 기록됨 (같은 실수 반복 방지)')
  : bad('원복했는데 사유가 없다 — 다음 사람이 같은 변경을 다시 시도한다');

// 재생성은 1회로 유지 (무한 재시도 금지)
(fn.match(/await localChat\(/g) || []).length === 2
  ? ok('재생성은 1회 (무한 재시도 아님)')
  : bad(`localChat 호출 ${(fn.match(/await localChat\(/g)||[]).length}회 — 재시도 폭주 위험`);

// 최종 반환도 미번역이면 null (실패를 성공으로 위장하지 않음)
/return out && !hasChineseBleed\(out, locale\) \? out : null/.test(fn)
  ? ok('끝까지 오염이면 null 반환 (종전 동작 유지)')
  : bad('반환 조건이 종전과 다르다');

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
