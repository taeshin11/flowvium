#!/usr/bin/env node
/**
 * cron-skip-heartbeat.test.mjs — 보고서 중 "일부러 건너뛴" 매시간 잡을 미실행 경보로 올리지 않는다. 2026-09-28 신설.
 *
 * 실측: 모니터가 보고서마다(하루 3번) "🚨 [maint] 잡 미실행 의심: shorts-spare 슬롯 33분 지남" 을 올렸다.
 *   shorts-spare 는 보고서 중에 **렌더하면 안 되어서** 건너뛰는 게 맞는 동작이고, 한 시간 뒤 다음 슬롯이 받친다.
 *   그런데 건너뜀은 heartbeat 를 안 남겨 "안 돌았다" 로 셌다 — 매일 뜨는 거짓 경보는 진짜 경보를 묻는다.
 * → MAINT_JOBS 항목에 reportSkipIsRun:true 를 둔 잡만 건너뜀도 heartbeat 로 남긴다(다른 잡의 소급 재시도는 그대로).
 *   크론 틱 자체를 흘린 경우(node-cron missed execution)는 여전히 잡힌다 — 그땐 runMaintenance 가 불리지도 않는다.
 */
import { readFileSync } from 'fs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const src = readFileSync(new URL('../cron-runner.mjs', import.meta.url), 'utf8');
const spare = src.split('\n').find((l) => /label: 'shorts-spare'/.test(l)) ?? '';
/reportSkipIsRun:\s*true/.test(spare) ? ok('[1] shorts-spare 는 reportSkipIsRun') : bad(`[1] ${spare.trim().slice(0, 120)}`);
const skipLine = src.split('\n').find((l) => /async function runMaintenance/.test(l)) ?? '';
/opts|reportSkipIsRun/.test(skipLine) ? ok('[2] runMaintenance 가 잡 옵션을 받는다') : bad(`[2] ${skipLine.trim()}`);
const body = src.slice(src.indexOf('async function runMaintenance'), src.indexOf('async function runMaintenance') + 800);
/skip — 보고서 파이프라인 실행 중[\s\S]{0,200}writeHeartbeat\(label\)|reportSkipIsRun[\s\S]{0,120}writeHeartbeat\(label\)/.test(body)
  ? ok('[3] 건너뜀일 때 그 옵션이면 heartbeat 를 남긴다') : bad('[3] 건너뜀에 heartbeat 가 없다');
const calls = [...src.matchAll(/runMaintenance\(j\.label, j\.script, j\.timeoutMs, j\.commitPaths([^)]*)\)/g)].map((m) => m[1]);
(calls.length >= 3 && calls.every((c) => /,\s*j\b/.test(c))) ? ok(`[4] 부르는 곳 ${calls.length}곳 모두 잡 옵션을 넘긴다`) : bad(`[4] ${JSON.stringify(calls)}`);
// 다른 잡은 그대로(소급 재시도 유지)
const others = src.split('\n').filter((l) => /label: '/.test(l) && /reportSkipIsRun/.test(l));
others.length === 1 ? ok('[5] 이 옵션은 shorts-spare 하나에만') : bad(`[5] ${others.length}개 잡에 붙었다`);
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
