#!/usr/bin/env node
/**
 * agy-models.test.mjs — agy 모델 이름이 서버 목록에서 사라져도 사슬이 통째로 죽지 않는가. 2026-10-13 신설.
 *
 * 실측(10/13 12:10): agy 서버 목록에서 gemini-3.1-pro-high·gemini-3.7-flash-high·claude-opus-4-6-thinking 이
 *   사라졌다(agy 실행파일은 10/10 그대로 — 서버 쪽 변경). 코드 곳곳에 이름이 박혀 있어 모든 agy 호출이
 *   "is not recognized" 로 떨어졌고, 쇼츠 대본이 로컬 4B 로 내려가 "한동훈 주한미대사"(없는 직함)를 지어낸 편이 공개됐다.
 * → 선호 순서는 코드에 두되, **지금 서버가 받는 이름만** 쓴다(agy models 목록으로 거른다).
 */
import { parseModelList, pickAvailable, PREFERRED_TEXT, PREFERRED_VISION } from './agy-models.mjs';
import { readFileSync, readdirSync } from 'node:fs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

const listing = 'Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\ngemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)\nclaude-opus-5-5-medium\tClaude Opus 5.5 (Medium)\nclaude-sonnet-5-5-medium\tClaude Sonnet 5.5 (Medium)\n';
const avail = parseModelList(listing);
(JSON.stringify(avail) === JSON.stringify(['gemini-3.8-flash-high', 'gemini-3.8-flash-medium', 'claude-opus-5-5-medium', 'claude-sonnet-5-5-medium'])) ? ok('[1] agy models 출력에서 이름만 읽는다') : bad(`[1] ${JSON.stringify(avail)}`);

const chain = pickAvailable(['gemini-3.1-pro-high', 'gemini-3.8-flash-high', 'gemini-3.7-flash-high'], avail);
(chain[0] === 'gemini-3.8-flash-high' && !chain.includes('gemini-3.1-pro-high') && !chain.includes('gemini-3.7-flash-high')) ? ok('[2] 서버에 없는 이름은 사슬에서 뺀다') : bad(`[2] ${JSON.stringify(chain)}`);
(pickAvailable(['gemini-3.1-pro-high'], avail).length >= 1 && pickAvailable(['gemini-3.1-pro-high'], avail).every((m) => avail.includes(m))) ? ok('[3] 다 사라지면 선호 목록에서 살아 있는 것으로 채운다(빈 사슬 금지)') : bad(`[3] ${JSON.stringify(pickAvailable(['gemini-3.1-pro-high'], avail))}`);
(JSON.stringify(pickAvailable(['a', 'b'], null)) === '["a","b"]') ? ok('[4] 목록을 못 읽으면 거르지 않는다(모르면 막지 않는다)') : bad('[4]');
(PREFERRED_TEXT.some((m) => avail.includes(m)) && PREFERRED_VISION.some((m) => avail.includes(m))) ? ok('[5] 선호 목록에 지금 살아 있는 이름이 있다') : bad('[5]');

// [6] 호출하는 곳마다 박힌 기본 이름이 없어야 한다 — 이름은 agy-models 한 곳에서만.
const dir = new URL('./', import.meta.url);
const hard = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.mjs') || f.endsWith('.test.mjs') || f === 'agy-models.mjs') continue;
  const s = readFileSync(new URL(f, dir), 'utf8');
  for (const m of s.matchAll(/(AGY_[A-Z_]+|model)\s*\|\|\s*'(gemini|claude)-[\w.-]+'|Object\.freeze\(\[\s*'(gemini|claude)-/g)) hard.push(`${f}: ${m[0]}`);
}
const vs = readFileSync(new URL('../seed-translation-memory.mjs', import.meta.url), 'utf8');
if (/\|\|\s*'gemini-/.test(vs)) hard.push('seed-translation-memory.mjs');
(hard.length === 0) ? ok('[6] 호출부에 박힌 모델 기본값 없음') : bad(`[6] ${hard.join(' · ')}`);
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
