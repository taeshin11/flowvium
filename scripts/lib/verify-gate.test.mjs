#!/usr/bin/env node
/**
 * verify-gate.test.mjs — push 를 막는 기준이 "결함이 있다"인가, "확인을 못 했다"인가.
 *
 * 사건(2026-08-22 21:00~21:25): 저녁 보고서가 21:30 정시 발간을 기다리며 도는 동안
 *   pre-push 가 두 번 막혔다. 둘 다 코드 결함이 아니었다:
 *     ❌ audit-coverage     (300.0s) exit=-  ← 300초 타임아웃으로 kill (단독 실행은 "0 결함")
 *     ❌ audit-data-sources (10.2s) exit=2 err=12  ← 단독 실행은 "OK 7 / critical 0"
 *   보고서 파이프라인과 자원·네트워크를 다투다 생긴 것이다. 13분 기다렸다 밀었더니 통과했다.
 *
 * 두 가지가 잘못돼 있다.
 *
 *  ① **타임아웃과 결함을 같게 센다.** verify-all.mjs:31 이 300초에 child.kill() 하고
 *     close 핸들러가 code=null 로 resolve 한다. 그러면 `softProblem = res.status !== 0` 이
 *     참이 되어 critical 체크는 fail 이 된다. 시간 내 못 끝낸 것은 **판정이 없는 것**이지
 *     결함이 아니다. 느린 순간마다 push 가 막힌다.
 *
 *  ② **바깥 세상 상태로 코드 push 를 막는다.** audit-data-sources 는 Yahoo/SEC/FRED/CNN 이
 *     살아있는지 본다. 이건 내 diff 와 무관하다. 이미 critical:false 로 선언돼 있는데
 *     `exit 2 = hardCritical` 경로가 그 선언을 덮어쓴다(verify-all.mjs:289).
 *     외부 사례도 같은 결론이다 — 비결정적·네트워크 의존 검사는 CI/주기감시로 보내고
 *     pre-push 는 결정적인 것만 둔다.
 *
 * 단, **지우지는 않는다.** 이 검사가 이번 세션에 Yahoo crumb 401 을 잡았다.
 *   push 게이트에서 빼는 대신 cron 주기 감시로 옮긴다(감시자가 사라지면 안 된다).
 *   실측 확인: cron 은 check-data-quality(우리 엔드포인트)만 돌고
 *   audit-data-sources(상류 소스)는 push 때만 돌고 있었다.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const M = await import('./verify-gate.mjs')
  .catch(e => { bad(`verify-gate.mjs 없음: ${String(e.message).slice(0,60)}`); return null; });
if (!M) { console.log('\n❌ 1건 실패'); process.exit(1); }

const C = (o) => M.classifyCheck({ exitCode: 0, timedOut: false, errCount: 0, warnCount: 0, critical: false, live: false, ...o });

// [1] 타임아웃은 판정 없음 — 막지 않는다. 실측: audit-coverage exit=- 300.0s
{
  const r = C({ exitCode: null, timedOut: true, critical: true });
  r.status === 'timeout' ? ok(`타임아웃은 별도 상태: ${r.status}`) : bad(`타임아웃이 ${r.status} 로 뭉개진다`);
  r.blocking === false ? ok('타임아웃은 push 를 막지 않는다') : bad('시간 내 못 끝냈다고 push 를 막는다');
}
// [2] 라이브 외부 검사는 exit 2 여도 막지 않는다. 실측: audit-data-sources exit=2 err=12
{
  const r = C({ exitCode: 2, errCount: 12, critical: false, live: true });
  r.blocking === false ? ok('외부 소스 장애가 코드 push 를 막지 않는다') : bad('바깥 세상 상태로 push 를 막는다');
  r.status === 'fail' ? ok('그래도 fail 로 보여준다(숨기지 않음)') : bad(`가시성을 잃었다: ${r.status}`);
}
// [3] 결정적 검사의 진짜 결함은 계속 막는다 (게이트를 무력화하면 안 된다)
{
  const r = C({ exitCode: 1, errCount: 3, critical: true });
  r.blocking === true ? ok('결정적 critical 결함은 막는다') : bad('진짜 결함을 통과시킨다');
}
{
  // silent false pass: exit 0 인데 stdout 에 ❌ 다수
  const r = C({ exitCode: 0, errCount: 5, critical: true });
  r.blocking === true ? ok('exit 0 인데 ❌ 다수 → 막는다(silent false pass 방지 유지)') : bad('silent false pass 가 통과한다');
}
// [4] non-critical 결정적 검사는 warn (기존 동작 보존)
{
  const r = C({ exitCode: 1, errCount: 1, critical: false });
  r.blocking === false && r.status === 'warn' ? ok('non-critical 은 warn 유지') : bad(`동작이 바뀌었다: ${JSON.stringify(r)}`);
}
// [5] 깨끗하면 pass
C({}).status === 'pass' ? ok('무결이면 pass') : bad('무결인데 pass 가 아니다');

// [6] verify-all 이 이 모듈을 쓰고, 옛 인라인 판정이 남지 않았다
{
  const src = readFileSync(resolve(ROOT, 'scripts/verify-all.mjs'), 'utf8')
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  /verify-gate\.mjs/.test(src) ? ok('verify-all 이 단일 출처를 쓴다') : bad('verify-all 이 아직 자체 판정을 쓴다');
  /const hardCritical = res\.status === 2;/.test(src)
    ? bad('옛 hardCritical 인라인 판정이 남아 있다') : ok('인라인 판정 제거됨');
  /timedOut/.test(src) ? ok('타임아웃을 구분해 전달한다') : bad('타임아웃 구분 없이 kill 만 한다');
}
// [7] 감시자를 없애지 않았는가 — cron 이 상류 소스 헬스를 돌아야 한다
{
  const cron = readFileSync(resolve(ROOT, 'scripts/cron-runner.mjs'), 'utf8')
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  /audit-data-sources\.mjs/.test(cron)
    ? ok('cron 이 상류 소스 헬스를 감시한다')
    : bad('push 게이트에서만 빼고 주기감시에 안 넣었다 — 감시자가 사라진다');
}

console.log(fail === 0 ? '\n✅ verify-gate 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
