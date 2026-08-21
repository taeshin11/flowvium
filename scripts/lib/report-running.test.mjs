#!/usr/bin/env node
/**
 * report-running.test.mjs — "보고서가 도는 중인가"의 판단이 한 곳에서 나오고,
 *                            락 파일뿐 아니라 *살아 있는 프로세스* 도 본다.
 *
 * 배경: 단일 GPU 라 보고서 Wave1 이 도는 동안 다른 LLM 작업이 끼어들면 서로 굶는다
 *   (기록: 2026-06-11 "Wave1 전멸" 사건 → build-segments-dynamic 에 lock 양보 추가).
 *   그런데 그 판단이 세 곳에 흩어져 있었고 서로 달랐다:
 *     run-report.sh:41            pgrep -f generate-report-local  (프로세스를 본다)
 *     cron-runner.mjs:119         logs/report-pipeline.lock 만    (락만 본다)
 *     build-segments-dynamic:27   logs/report-pipeline.lock 만    (락만 본다)
 *   락은 래퍼(run-report.sh)만 만든다. run-report.sh 주석이 직접 적어 둔 대로
 *   "수동으로 generate-report-local.mjs 를 직접 돌리는 경우가 실제로 있다".
 *   그때 락은 없고 프로세스만 산다 → cron 쪽 둘은 "안 돈다" 고 판단해 GPU 에 끼어든다.
 *   래퍼는 이미 그걸 알고 pgrep 을 하는데, 정작 끼어드는 쪽 둘은 안 한다.
 *   (이 세션에서 내가 생성기를 직접 돌렸을 때도 락이 없어 정확히 그 상태가 됐다.)
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

let M = null;
try { M = await import('./report-running.mjs'); }
catch (e) { bad(`scripts/lib/report-running.mjs 없음 — ${e.message}`); }

if (M) {
  // 1) 실제 동작 — 지금 생성기가 도는지 여부와 무관하게 boolean 이어야 하고 throw 하면 안 된다
  const alive = await M.isReportProcessAlive();
  typeof alive === 'boolean' ? ok(`isReportProcessAlive() → ${alive}`) : bad('boolean 이 아니다');

  const running = await M.isReportPipelineRunning(ROOT);
  typeof running === 'boolean' ? ok(`isReportPipelineRunning() → ${running}`) : bad('boolean 이 아니다');

  // 2) 프로세스가 살아 있으면 락이 없어도 true 여야 한다 — 이번 결함의 핵심
  if (alive && !running) bad('프로세스가 살아 있는데 "안 돈다" 고 답한다 — 바로 그 사각지대');
  else ok('프로세스 생존이 판단에 반영된다');

  // 3) pgrep 미매칭(exit 1)을 예외로 흘리지 않는다
  const none = await M.isProcessAlive('__없는패턴_zz9__');
  none === false ? ok('미매칭 패턴에 false (예외 아님)') : bad(`미매칭인데 ${none}`);

  // 4) 자기 자신에 걸리지 않는다 — pgrep -f 는 명령줄 전체를 보므로 이 테스트 프로세스의
  //    argv 에 있는 문자열로 물으면 자기가 잡힌다. 판정 함수가 그러면 영원히 true 다.
  const selfPat = 'report-running.test';           // 이 프로세스의 argv 에 들어 있다
  const selfHit = await M.isProcessAlive(selfPat);
  selfHit === false ? ok('자기 자신은 살아있는 것으로 세지 않는다')
                    : bad('자기 프로세스에 매칭된다 — 영구 true 가 되어 GPU 를 영원히 양보한다');
}

console.log('\n소비처가 공용 판단을 쓰는가');
for (const [f, why] of [
  ['scripts/cron-runner.mjs', 'segments-refresh 등이 GPU 에 끼어드는 것을 막는다'],
  ['scripts/build-segments-dynamic.mjs', '벌크 sweep 이 Wave1 을 굶기는 것을 막는다'],
]) {
  const src = readFileSync(resolve(ROOT, f), 'utf8');
  if (/report-running\.mjs/.test(src)) ok(`${f} — 공용 판단 사용 (${why})`);
  else bad(`${f} — 락 파일만 본다. 수동 실행 중인 보고서를 못 본다 (${why})`);
}

console.log(fail === 0 ? '\n✅ report-running 전부 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
