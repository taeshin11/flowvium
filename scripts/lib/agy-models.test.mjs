#!/usr/bin/env node
/**
 * agy-models.test.mjs — agy 모델 이름이 서버 목록에서 사라져도 사슬이 통째로 죽지 않는가. 2026-10-13 신설.
 *
 * 실측(10/13 12:10): agy 서버 목록에서 gemini-3.1-pro-high·gemini-3.7-flash-high·claude-opus-4-6-thinking 이
 *   사라졌다(agy 실행파일은 10/10 그대로 — 서버 쪽 변경). 코드 곳곳에 이름이 박혀 있어 모든 agy 호출이
 *   "is not recognized" 로 떨어졌고, 쇼츠 대본이 로컬 4B 로 내려가 "한동훈 주한미대사"(없는 직함)를 지어낸 편이 공개됐다.
 * → 선호 순서는 코드에 두되, **지금 서버가 받는 이름만** 쓴다(agy models 목록으로 거른다).
 */
import * as AM from './agy-models.mjs';
const { parseModelList, pickAvailable, PREFERRED_TEXT, PREFERRED_VISION } = AM;
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

// [7] 검증은 gemini-4-neon-medium — 사장님 11/23(Mac mini2 경유) "agy 는 gemini4 neon (argon 대체)". 그 전 10/15~11/23 argon-medium. 글·그림 검증 모두.
//   argon-medium 은 neon 이 서버에서 빠졌을 때의 다음 칸으로 남긴다.
//   그림: 10/15 실측 argon-medium 이 그림 3장(색·위치·개수)을 모두 맞혔다(17~21초) — 9/23 'Gemini 이미지 503' 은 3.x 때 일.
{
  const live = ['gemini-4-neon-medium', 'gemini-4-argon-medium', 'gemini-4-argon-high', 'gemini-3.8-flash-high', 'gemini-3.8-flash-medium', 'claude-opus-5-5-medium', 'claude-sonnet-5-5-medium'];
  const V = AM.PREFERRED_VERIFY ?? [];
  pickAvailable(V, live)[0] === 'gemini-4-neon-medium' ? ok('[7a] 글 검증 1순위 neon-medium') : bad(`[7a] ${JSON.stringify(V)}`);
  pickAvailable(AM.PREFERRED_EYE, live)[0] === 'gemini-4-neon-medium' ? ok('[7b] 영상 프레임 눈검증 1순위 neon-medium') : bad(`[7b] ${AM.PREFERRED_EYE}`);
  pickAvailable(AM.PREFERRED_VISION, live)[0] === 'gemini-4-neon-medium' ? ok('[7c] 그림 검증 1순위 neon-medium') : bad(`[7c] ${AM.PREFERRED_VISION}`);
  const noArgon = live.filter((m) => !m.startsWith('gemini-4-neon'));
  pickAvailable(V, noArgon).length && pickAvailable(V, noArgon).every((m) => noArgon.includes(m)) ? ok('[7d] neon 이 서버에서 빠지면 살아 있는 이름으로(빈 사슬 금지)') : bad('[7d]');
  pickAvailable(AM.PREFERRED_CLASSIFY, live)[0] === 'gemini-4-neon-medium' ? ok('[7f] 주제 분류 1순위 neon-medium') : bad(`[7f] ${AM.PREFERRED_CLASSIFY}`);
  // 교차검증은 계열이 다른 둘 — gemini 쪽이 neon-medium, claude 쪽은 그대로.
  const g = pickAvailable(V, live).find((m) => m.startsWith('gemini-'));
  const c = pickAvailable(AM.PREFERRED_VISION, live).find((m) => m.startsWith('claude-'));
  g === 'gemini-4-neon-medium' && /^claude-/.test(c ?? '') ? ok(`[7e] 교차검증 ${g} + ${c}`) : bad(`[7e] ${g} ${c}`);
}
// [7g] 글(대본·보고서) 사슬 1순위 neon-medium, 다음 flash-high. 2026-11-25 실측(같은 이슈 '미세먼지' --dry 2+2):
//   neon 2/2 성공(177·206초, 대본 호출 111초 이하), flash 1/2(405초 — high 180초 시간초과 뒤 medium) ·
//   한 번은 high·medium 다 시간초과로 "대본을 쓸 모델이 없다". 11/23~24 실패 17건 중 15건이 이 시간초과였다.
{
  const live = ['gemini-4-neon-medium', 'gemini-4-argon-medium', 'gemini-3.8-flash-high', 'gemini-3.8-flash-medium'];
  const t = pickAvailable(PREFERRED_TEXT, live);
  t[0] === 'gemini-4-neon-medium' && t[1] === 'gemini-3.8-flash-high' ? ok(`[7g] 글 사슬 ${t.slice(0, 3).join(' → ')}`) : bad(`[7g] ${JSON.stringify(t)}`);
}
// [8] 검증 호출부가 검증 사슬을 실제로 넘긴다(보고서 fact-check · 해설 문장 검증 · 인물 판정).
{
  const src = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
  const gen = src('../generate-report-local.mjs');
  /callOllama\(factPrompt[^;]*verifyChain\(\)/.test(gen) ? ok('[8a] 보고서 fact-check → verifyChain') : bad('[8a] 보고서 fact-check 가 검증 사슬을 안 넘긴다');
  /label: 'explainer-verify'[^}]*chain: verifyChain\(\)/.test(src('../video/make-weekly-explainer.mjs')) ? ok('[8b] 해설 문장 검증 → verifyChain') : bad('[8b] explainer-verify');
  /label: 'person-lead'[^}]*chain: [^,]*verifyChain\(\)/.test(src('./face-check.mjs')) ? ok('[8c] 인물 판정 → verifyChain') : bad('[8c] person-lead');
  /crossCheckModels[\s\S]{0,200}PREFERRED_VERIFY/.test(src('./agy-models.mjs')) ? ok('[8d] 교차검증 gemini 쪽 = 검증 사슬') : bad('[8d] crossCheckModels');
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
