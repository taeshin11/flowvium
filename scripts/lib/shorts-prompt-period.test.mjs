#!/usr/bin/env node
/**
 * shorts-prompt-period.test.mjs — 짧은 기간 집계를 기록처럼 말하지 않는가. 2026-09-25 신설.
 *
 * 시청자 댓글(수출 편): "수출실적 분기별&상,하반기 기록으로 알려줘야합니다.
 *   단기 10일짜리 신기록은 허영심,자만심,풍선일 뿐입니다."
 * 관세청 수출은 1~10일·1~20일 잠정치가 먼저 나오고, 통신사 제목이 "사상 최대" 를 붙인다.
 * 우리 대본이 그 기간을 빼고 옮기면 열흘치가 한 달·한 해 기록처럼 들린다 — 사실을 부풀리는 것이다.
 * 두 대본 프롬프트(단일 이슈 · 브리핑) 모두에 규칙이 있어야 한다 — 한쪽만 고치면 다른 쪽으로 샌다.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { ROOT } from './project-root.mjs';

let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const src = readFileSync(join(ROOT, 'scripts/video/make-shorts.mjs'), 'utf8');
const brief = src.slice(src.indexOf('const briefPrompt'), src.indexOf('const prompt = `'));
const single = src.slice(src.indexOf('const prompt = `'), src.indexOf('`;', src.indexOf('const prompt = `')));
const RULE = /집계 기간/;
RULE.test(single) ? ok('단일 이슈 프롬프트에 기간 규칙') : bad('단일 이슈 프롬프트에 기간 규칙 없음');
RULE.test(brief) ? ok('브리핑 프롬프트에 기간 규칙') : bad('브리핑 프롬프트에 기간 규칙 없음');
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
