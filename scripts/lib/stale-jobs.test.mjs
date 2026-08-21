#!/usr/bin/env node
/**
 * stale-jobs.test.mjs — 할 일을 끝내고도 안 죽은 잡을 잡아낸다.
 *
 * 배경(2026-08-22): 예약 백업 잡이 00:57 에 `✅ 완료` 를 찍고 **5시간** 더 살아 있었다.
 *   check-stall 의 검사 9종 중 어느 것도 이걸 못 봤다 — [3] 은 report-gen 만 본다.
 *   좀비가 붙들고 있던 건 libuv 스레드풀 4칸과 Drive 데몬이고, 그동안 같은 기기에서
 *   보고서가 돌았다. 20분마다 도는 모니터가 있었는데 5시간을 몰랐다는 게 문제다.
 *
 *   '주기 잡인데 주기보다 오래 살아 있다' 는 잡 종류와 무관한 신호다.
 *   상주 데몬(cron-runner·redis-shim·웹·LLM 서버)은 당연히 오래 산다 — 그건 허용목록으로,
 *   임계값은 코드가 아니라 data/resource-thresholds.json 에 둔다(하드코딩 금지).
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const { findStaleJobs, loadJobPolicy } = await import('./stale-jobs.mjs');
const policy = loadJobPolicy();

// 실제 그날의 상황 그대로
const procs = [
  { pid: 31735, elapsedSec: 18030, command: '/Users/x/.local/node/bin/node /app/scripts/backup-takeover.mjs' },
  { pid: 17532, elapsedSec: 32280, command: '/Users/x/.local/node/bin/node /app/scripts/cron-runner.mjs' },
  { pid: 50863, elapsedSec: 195530, command: '/Users/x/.local/node/bin/node /app/scripts/redis-rest-shim.mjs' },
  { pid: 51031, elapsedSec: 840,   command: '/Users/x/.local/node/bin/node /app/scripts/generate-report-local.mjs --session=morning' },
];

const found = findStaleJobs(procs, policy);
found.some((f) => f.pid === 31735)
  ? ok('5시간 좀비 백업 잡을 잡는다')
  : bad('5시간 좀비 백업 잡을 못 잡는다 — 그날 모니터가 침묵한 그대로다');
found.some((f) => f.pid === 17532 || f.pid === 50863)
  ? bad('상주 데몬(cron-runner·redis-shim)을 좀비로 오인한다 — 20분마다 오경보')
  : ok('상주 데몬은 허용목록으로 제외한다');
found.some((f) => f.pid === 51031)
  ? bad('정상 진행 중인 보고서 생성을 좀비로 오인한다')
  : ok('정상 진행 중인 잡은 건드리지 않는다');

// 임계값은 설정에서 온다 — 코드에 박으면 다음 사람이 못 찾는다
const cfg = JSON.parse(readFileSync(resolve(ROOT, 'data/resource-thresholds.json'), 'utf8'));
cfg.jobs && typeof cfg.jobs.defaultMaxMinutes === 'number'
  ? ok(`임계값이 설정 파일에 있다 (기본 ${cfg.jobs.defaultMaxMinutes}분)`)
  : bad('임계값이 설정 파일에 없다 — 코드 하드코딩');

const src = readFileSync(resolve(ROOT, 'scripts/lib/stale-jobs.mjs'), 'utf8');
/\b(60|90|120|300)\s*\*\s*60\b/.test(src) && !/thresholds/.test(src)
  ? bad('분 단위 임계값이 코드에 박혀 있다')
  : ok('코드에 분 임계값 하드코딩 없음');

// 모니터에 실제로 배선됐는가
const cs = readFileSync(resolve(ROOT, 'scripts/check-stall.mjs'), 'utf8');
/findStaleJobs/.test(cs)
  ? ok('check-stall 에 배선됐다')
  : bad('검사기를 만들었는데 모니터가 안 부른다 — 소비처 0');

console.log(fail === 0 ? '\n✅ stale-jobs 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
