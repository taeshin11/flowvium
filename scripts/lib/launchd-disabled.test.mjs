#!/usr/bin/env node
/**
 * launchd-disabled.test.mjs — 운영자가 disable 한 LLM 을 **아무도 되살리지 못하는가.** 2026-09-24 신설.
 *
 * 오늘의 사고: 27B(28GB)를 `launchctl disable` 로 막아 뒀는데 06:00·08:20·10:30·11:01 에 네 번 떴고,
 *   10:30 기동이 10:45 영상 렌더와 겹쳐 10:47 맥이 멈췄다 → 11:00 강제 재부팅.
 *
 * 되살린 경로를 어제부터 하나씩 막았다 — run-report 관문 · cron self-heal · check-stall ·
 *   테스트(run-report-selfcopy). 오늘 다섯 번째가 나왔다: **누락 보고서 캐치업**이
 *   REPORT_VIA_AGY 없이 run-report.sh 를 불렀다. 경로를 하나씩 막는 건 끝이 없다.
 *
 * 모든 경로가 모이는 곳은 하나다 — llm-health-check.mjs 의 restartService().
 *   거기서 `launchctl load -w` 를 썼고, **-w 는 disable 을 지운다.**
 *   그리고 그 load 분기는 메모리 검사도 건너뛰었다(검사는 kickstart 분기에만 있었다).
 *   경계에서 막는다: disable 된 라벨은 누가 불러도 올리지 않는다.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './project-root.mjs';
import { isLabelDisabled } from './launchd-disabled.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

// 실제 `launchctl print-disabled gui/501` 출력 모양
const SAMPLE = `disabled services = {
		"com.spinai.flowvium-llm-web" => enabled
		"com.spinai.flowvium-llm" => disabled
		"com.apple.something" => true
		"com.spinai.jp-day" => false
	}`;

// [1] disabled 를 읽는다
isLabelDisabled(SAMPLE, 'com.spinai.flowvium-llm') === true ? ok('[1] "=> disabled" 를 disabled 로 읽는다') : bad('[1]');
// [2] ★ 이름이 앞부분만 같은 다른 잡을 헷갈리지 않는다 — llm 과 llm-web
isLabelDisabled(SAMPLE, 'com.spinai.flowvium-llm-web') === false ? ok('[2] llm-web 은 enabled (접두사 혼동 없음)') : bad('[2] llm-web 을 disabled 로 읽었다');
// [3] 옛 표기(true/false)도 읽는다
isLabelDisabled(SAMPLE, 'com.apple.something') === true ? ok('[3] "=> true" 도 disabled') : bad('[3]');
isLabelDisabled(SAMPLE, 'com.spinai.jp-day') === false ? ok('[3b] "=> false" 는 enabled') : bad('[3b]');
// [4] 목록에 없으면 disabled 가 아니다(기본은 enabled)
isLabelDisabled(SAMPLE, 'com.nope') === false ? ok('[4] 없는 라벨은 disabled 아님') : bad('[4]');
// [5] 읽기 실패(빈 출력)는 **모름** — null. 모르면서 올리면 오늘 사고가 된다
isLabelDisabled('', 'com.spinai.flowvium-llm') === null ? ok('[5] 빈 출력 → null(모름)') : bad('[5]');

// [6] ★ restartService 가 `load -w` 를 쓰지 않는다 — -w 는 운영자의 disable 을 지운다
{
  const src = readFileSync(resolve(ROOT, 'scripts/llm-health-check.mjs'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  !/['"]load['"]\s*,\s*['"]-w['"]/.test(code)
    ? ok('[6] llm-health-check 에 `load -w` 가 없다') : bad('[6] 아직 `load -w` 를 쓴다 — disable 이 무력화된다');
}

// [7] ★ restartService 가 disable 을 **확인한다** — 경계에서 막는다
{
  const src = readFileSync(resolve(ROOT, 'scripts/llm-health-check.mjs'), 'utf8');
  const i = src.indexOf('function restartService');
  const body = src.slice(i, i + 3000);
  /isLabelDisabled\s*\(/.test(body)
    ? ok('[7] restartService 가 disable 여부를 먼저 본다') : bad('[7] disable 을 안 본다 — 어느 경로로든 되살아난다');
}

console.log(fail ? `\n  ❌ ${fail}건 실패` : '\n  ✅ 전부 통과');
process.exit(fail ? 1 : 0);
