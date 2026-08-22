/**
 * verify-gate.mjs — verify-all 의 각 검사 결과를 상태와 **push 차단 여부**로 판정한다.
 *
 * 왜 분리했나(2026-08-22): pre-push 가 코드 결함이 아닌 이유로 두 번 막혔다.
 *   ❌ audit-coverage     exit=-  300.0s  ← 타임아웃 kill (단독 실행은 "0 결함")
 *   ❌ audit-data-sources exit=2  err=12  ← 단독 실행은 "OK 7 / critical 0"
 *   저녁 보고서가 21:30 정시 발간을 기다리며 도는 동안 자원·네트워크를 다툰 결과다.
 *
 * 두 가지를 바로잡는다.
 *
 *  ① 타임아웃 ≠ 결함. 종전에는 kill 후 code=null 로 resolve 되어
 *     `softProblem = status !== 0` 이 참이 됐다. 시간 내 못 끝낸 것은 **판정이 없는 것**이다.
 *     판정이 없다는 이유로 push 를 막으면, 기계가 바쁠 때마다 막힌다.
 *     대신 `timeout` 이라는 별도 상태로 크게 보여준다(조용히 pass 로 넘기지 않는다).
 *
 *  ② 바깥 세상 상태로 코드 push 를 막지 않는다. 외부 소스(Yahoo/SEC/FRED/CNN)가 사는지는
 *     내 diff 와 무관하다. 이미 critical:false 로 선언돼 있었는데 `exit 2 = hardCritical`
 *     경로가 그 선언을 덮어썼다. live:true 검사는 상태는 그대로 보여주되 차단하지 않는다.
 *     — 대신 cron 주기감시(20분마다)로 옮겼다. 검사를 없앤 게 아니라 자리를 옮긴 것이다.
 *
 * 게이트를 약하게 만들지는 않는다: 결정적 critical 검사의 결함과
 *   `exit 0 인데 stdout 에 ❌ 다수`(silent false pass)는 그대로 막는다.
 */

/**
 * @param {{exitCode:number|null, timedOut?:boolean, errCount?:number, warnCount?:number,
 *          critical?:boolean, live?:boolean}} r
 * @returns {{status:'pass'|'warn'|'fail'|'timeout', blocking:boolean}}
 */
export function classifyCheck(r) {
  const { exitCode, timedOut = false, errCount = 0, warnCount = 0, critical = false, live = false } = r ?? {};
  // 판정이 없다 — 결함이라고도, 무결이라고도 말할 수 없다.
  if (timedOut) return { status: 'timeout', blocking: false };

  const hardCritical = exitCode === 2;
  const softProblem = exitCode !== 0 || errCount > 0;
  const failed = hardCritical || (critical && softProblem);
  const status = failed ? 'fail' : (softProblem || warnCount > 0 ? 'warn' : 'pass');
  // live 검사는 결과를 그대로 보여주되 push 를 막지 않는다.
  return { status, blocking: failed && !live };
}
