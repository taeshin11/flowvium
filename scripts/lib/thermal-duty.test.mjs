#!/usr/bin/env node
/**
 * thermal-duty.test.mjs — 조절기 가동률 계산이 유휴 구간을 '정지' 로 오인하지 않는다.
 *
 * 배경(2026-08-22 03:53, 내가 만든 모니터가 만 하루도 안 돼 오탐): 보고서가 안 도는 유휴 상태인데
 *   `자원 압력 — 조절기 가동률 0% (임계 45%) — 열로 처리량 급락` 이 떴다.
 *   그 1시간의 실제 이벤트는 정지 1회(03:04:17) + 재개 1회(03:05:19), 62초뿐이었다.
 *   참값은 (3600-62)/3600 = 98.3% 인데 0% 라고 답했다.
 *
 *   원인: 가동률을 *이벤트 사이 구간* 으로만 셌다. stop→run 쌍 하나가 잡히면 stop=62s,
 *   run=0 이 되어 0% 가 된다. 창 시작~첫 이벤트, 마지막 이벤트~현재(유휴가 대부분인 구간)를
 *   아무 쪽에도 안 넣은 것이다. 이벤트가 드물수록 결과가 틀린다 — 즉 평온할수록 경보가 울린다.
 *
 *   올바른 정의: 창 전체에서 *측정된 정지 구간* 을 뺀 나머지가 가동이다.
 *   경보를 만드는 쪽이 스스로 오탐을 내면 진짜 경보까지 무시하게 된다.
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const M = await import('./resource-pressure.mjs');
if (typeof M.computeDuty !== 'function') {
  bad('computeDuty(events, windowMs, now) 미노출 — 순수 계산을 분리해야 검증할 수 있다');
} else {
  const MIN = 60000;
  const now = Date.parse('2026-08-22T03:53:00Z');
  const at = (m) => now - m * MIN;   // m분 전
  const C = (evs, label, want, tol = 1) => {
    const r = M.computeDuty(evs, 60 * MIN, now);
    Math.abs(r.dutyPct - want) <= tol
      ? ok(`${label}: ${r.dutyPct}% (기대 ~${want}%)`)
      : bad(`${label}: ${r.dutyPct}% — 기대 ~${want}%`);
  };

  // ① 실제로 오탐이 났던 그 창: 62초 정지 1회
  C([[at(49), 'stop'], [at(48), 'run']], '유휴창(정지 62s→1분)', 98);
  // ② 이벤트 없음 = 아무것도 안 멈췄다
  C([], '이벤트 없음', 100);
  // ③ 절반을 정지로 보낸 창
  C([[at(60), 'stop'], [at(30), 'run']], '절반 정지', 50);
  // ④ 지금도 정지 중(재개 없음) — 현재까지 세야 한다
  C([[at(30), 'stop']], '진행 중 정지 30분', 50);
  // ⑤ 창 이전에 시작된 정지 — 창 시작으로 잘라 센다
  C([[at(90), 'stop'], [at(45), 'run']], '창 이전 시작 정지', 75);

  const r = M.computeDuty([[at(49), 'stop'], [at(48), 'run']], 60 * MIN, now);
  r.pauses === 1 ? ok('정지 횟수 정확') : bad(`정지 횟수 ${r.pauses}`);

  // 창 밖(더 과거) 정지는 횟수에 안 들어간다 — 시간은 0인데 횟수만 불어나면 경보 문구가 거짓이 된다
  const old = M.computeDuty(
    [[at(600), 'stop'], [at(599), 'run'], [at(500), 'stop'], [at(499), 'run'], [at(10), 'stop'], [at(9), 'run']],
    60 * MIN, now);
  old.pauses === 1
    ? ok(`창 밖 정지 제외 (창내 1회만 집계, 가동률 ${old.dutyPct}%)`)
    : bad(`창 밖 정지까지 셌다: ${old.pauses}회`);
}

console.log(fail === 0 ? '\n✅ thermal-duty 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
