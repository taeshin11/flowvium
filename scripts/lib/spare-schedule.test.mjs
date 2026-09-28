#!/usr/bin/env node
/**
 * spare-schedule.test.mjs — 예비 렌더가 보고서 시작과 같은 분에 돌지 않는다. 2026-09-28 신설.
 *
 * 9/28 22:30: 예비 잡(매시 30분)과 자정 보고서(22:30 트리거)가 같은 분에 시작했다. 예비의 "보고서 중이면 쉰다" 검사는
 *   22:30:00 에 봤고 보고서는 22:30:35 에 떴다 — 검사를 통과해 **보고서와 나란히 렌더**했고 실패했다(274초, 예비 없음).
 *   보고서 트리거는 05:30·10:30·14:30·22:30 — 하루 네 번 같은 충돌. 시각은 report-sessions(JSON) 가 쥔다.
 * → 예비 분(minute)은 어떤 보고서 트리거와도 10분 이상 떨어진다. 보고서가 이미 돌면 예비는 검사에서 쉰다.
 * 또 예비 렌더 출력은 버려지고 있었다(cron-runner 가 삼킴) — 실패 사유를 logs/shorts-spare.log 에 남긴다.
 */
import { readFileSync } from 'fs';
import { sessionIds, getTriggerKst } from './report-sessions.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const src = readFileSync(new URL('../cron-runner.mjs', import.meta.url), 'utf8');
const line = src.split('\n').find((l) => /label: 'shorts-spare'/.test(l)) ?? '';
const scheds = [...line.matchAll(/'(\d+) \* \* \* \*'/g)].map((m) => Number(m[1]));
const triggers = sessionIds().map((id) => Number(getTriggerKst(id).split(':')[1]));
const dist = (a, b) => Math.min(Math.abs(a - b), 60 - Math.abs(a - b));
(scheds.length && scheds.every((m) => triggers.every((t) => dist(m, t) >= 10)))
  ? ok(`[1] 예비 ${scheds.map((m) => `:${m}`).join(',')} · 보고서 트리거 분 ${[...new Set(triggers)].join(',')} — 10분 이상 떨어짐`)
  : bad(`[1] 예비 분 ${scheds} · 보고서 트리거 분 ${triggers}`);
const spare = readFileSync(new URL('../shorts-spare.mjs', import.meta.url), 'utf8');
/logs\/shorts-spare\.log/.test(spare) ? ok('[2] 예비 렌더 출력을 logs/shorts-spare.log 에 남긴다') : bad('[2] 예비 렌더 출력이 버려진다');
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
