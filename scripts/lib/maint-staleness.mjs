/**
 * maint-staleness.mjs — 놓친 유지보수 작업을 얼마 만에 따라잡는가.
 *
 * 왜 (2026-09-12): node-cron 이 실행을 827번 놓쳤다(최근 이틀 68번). cron-runner 가 단일
 *   프로세스라 한 작업이 동기적으로 오래 물면 그 사이 스케줄이 통째로 밀린다.
 *   오늘 shorts-health 가 08:30 에 그렇게 날아갔다 — 등록도 됐고 종료코드도 맞는데 발화를 못 했다.
 *
 * 소급 기제는 이미 있다(auto-monitor 가 20분마다 stale 잡 1개를 즉석 실행).
 *   문제는 **언제 stale 로 보느냐** 다. 하루 한 번 작업에 maxAgeH=30 이면 놓친 뒤 6시간을 더 기다린다.
 *   주기보다 조금만 길게 잡아야 놓친 직후 따라잡는다. 너무 짧으면 정상 실행도 stale 로 본다.
 */

/** 놓친 뒤 소급까지 걸리는 시간. 음수면 정상 실행도 stale 로 잡힌다는 뜻이다. */
export function catchUpLagH(periodH, maxAgeH) {
  return maxAgeH - periodH;
}

/**
 * 주기에 맞는 maxAgeH 제안.
 *   주기의 10% 여유(최소 1h, 최대 3h) — 실행 시각이 조금 흔들려도 오탐하지 않을 만큼만 준다.
 */
export function suggestMaxAgeH(periodH) {
  if (!Number.isFinite(periodH) || periodH <= 0) return null;
  const slack = Math.min(3, Math.max(1, periodH * 0.1));
  return Math.round(periodH + slack);
}
