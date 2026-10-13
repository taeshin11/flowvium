#!/usr/bin/env node
/**
 * shorts-script-source.test.mjs — 쇼츠 대본은 agy 사슬이 쓰고, 사슬이 다 죽으면 로컬 4B 로 쓰지 않는다. 2026-10-13 신설.
 *
 * 실측(10/13 12:10, g8fnIYbmeaw — 비공개로 내림): agy 서버 목록에서 모델 이름이 사라져 대본이 로컬 Qwen3.5-4B 로 내려갔고,
 *   "한동훈 주한미대사는 강경화 주미대사의 이 말에 대해 틀렸다라고 지적했습니다" — 없는 직함·없는 발언을 지어낸 편이 공개됐다.
 *   (기사: 한동훈 "李 틀렸다".) 사장님 9/19 "4B쓰던것들 다 넘기고 4B는 끄자". 대본은 사실을 말하는 자리라
 *   4B 대본은 내보내지 않는다 — 회차를 거르는 편이 실존 인물 발언을 지어내는 것보다 낫다(빈 편은 예비·다음 슬롯이 메운다).
 */
import { readFileSync } from 'node:fs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const src = readFileSync(new URL('../video/make-shorts.mjs', import.meta.url), 'utf8');
const fn = /async function rawScript\([\s\S]*?\n}\n/.exec(src)?.[0] ?? '';
(/agyTextChain\(/.test(fn)) ? ok('[1] 대본은 agy 사슬(한 모델이 아니라)로 쓴다') : bad('[1] rawScript 가 agyTextChain 을 안 쓴다');
const localIdx = fn.indexOf('/chat/completions');
const guard = /if \(process\.env\.SHORTS_ALLOW_LOCAL_SCRIPT !== '1'\) throw /.exec(fn);
(localIdx < 0 || (guard && guard.index < localIdx)) ? ok('[2] 사슬이 다 죽으면 로컬 4B 로 쓰지 않고 멈춘다(사람이 켤 때만 허용)') : bad('[2] agy 실패 시 로컬 4B 대본으로 그냥 내려간다');
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
