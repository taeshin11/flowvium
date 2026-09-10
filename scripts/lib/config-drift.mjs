/**
 * config-drift.mjs — 설정 파일이 그것을 읽는 프로세스보다 새로운가.
 *
 * 왜 (2026-09-10): cron-runner 는 09-08 16:00 부터 떠 있었는데 09-09·09-10 에 작업 셋을 추가했다.
 *   그 프로세스는 시작할 때 한 번만 설정을 읽는다 — shorts-health · shorts-reconcile ·
 *   shorts-verify 가 **한 번도 돌지 않았고 로그에 흔적도 없다.** 등록하지 않은 것과 구별되지 않는다.
 *   src 를 고치고 build 를 안 한 것과 같은 얼굴이다(build-drift.mjs) —
 *   "고쳤다" 와 "돌고 있다" 사이의 틈은 아무 소리도 내지 않는다.
 *
 * 자동으로 재기동하지는 않는다. 돌던 작업을 끊을 수 있어 사람이 시점을 고르는 편이 낫다.
 */
import { execFileSync } from 'node:child_process';
import { statSync, existsSync } from 'node:fs';

/** 기동 도중 파일이 만져질 수 있어 이만큼은 봐준다. */
export const GRACE_MS = 60_000;

/** true=낡음, false=정상, null=판정 불가. */
export function isStale(input) {
  // 기본값은 undefined 일 때만 적용된다 — null 을 그대로 구조분해하면 터진다.
  const { startedAt, configMtime } = input ?? {};
  if (!Number.isFinite(startedAt) || !Number.isFinite(configMtime)) return null;
  return configMtime - startedAt > GRACE_MS;
}

/** 패턴에 맞는 프로세스의 기동 시각(ms). 못 찾으면 null. */
export function processStartedAt(pattern) {
  try {
    const pid = execFileSync('/usr/bin/pgrep', ['-f', pattern], { encoding: 'utf8' }).trim().split('\n')[0];
    if (!pid) return null;
    const lstart = execFileSync('/bin/ps', ['-o', 'lstart=', '-p', pid], { encoding: 'utf8' }).trim();
    const t = Date.parse(lstart);
    return Number.isFinite(t) ? t : null;
  } catch { return null; }
}

export function fileMtime(path) {
  try { return existsSync(path) ? statSync(path).mtimeMs : null; } catch { return null; }
}
