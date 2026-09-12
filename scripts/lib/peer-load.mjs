/**
 * peer-load.mjs — 같은 기기에서 지금 무엇이 무거운가, 그리고 그게 아직 살아 있는가.
 *
 * 왜 살아 있는지까지 보나(2026-09-12 실측): 해제 신호만 믿으면 안 된다.
 *   · SIGKILL 은 trap 에 안 걸린다 — macOS 가 메모리 부족으로 끊을 때 쓰는 신호다.
 *   · bash 는 foreground 명령이 끝나야 trap 을 돈다. 시험에서 SIGTERM 을 보냈더니
 *     `sleep` 이 끝날 때까지 8초를 기다려도 키가 안 지워졌다.
 *   즉 **해제는 최선을 다하는 것일 뿐 보장이 아니다.** 임자 PID 가 진실이다.
 *
 * 죽은 키를 살아 있다고 읽으면 상대가 있지도 않은 작업을 몇 시간 기다린다.
 * 반대로 산 키를 죽었다고 읽으면 같이 돌다 메모리가 터진다. 그래서 짐작하지 않고 PID 를 본다.
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const runtimeDir = () => process.env.FLOWVIUM_RUNTIME_DIR || join(homedir(), 'flowvium_runtime');
export const loadFile = () => join(runtimeDir(), 'machine-load-now.json');

/** 그 PID 가 살아 있나. 신호 0 은 아무것도 보내지 않고 존재만 확인한다. */
export function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return null;   // 모른다 (판정 불가)
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM' ? true : false; } // 남의 프로세스여도 살아는 있다
}

/**
 * @returns {{ live: object[], stale: object[], raw: object }}
 *   live  = 지금 실제로 도는 작업, stale = 해제 신호를 못 받고 남은 키
 */
export function currentLoad({ file = loadFile(), exclude = [] } = {}) {
  let raw = {};
  try { if (existsSync(file)) raw = JSON.parse(readFileSync(file, 'utf8')); } catch { raw = {}; }
  const live = [], stale = [];
  for (const [key, v] of Object.entries(raw)) {
    if (exclude.includes(key)) continue;
    const a = alive(Number(v?.pid));
    const entry = { key, ...v, ageH: v?.since ? (Date.now() - Date.parse(v.since)) / 3600000 : null, alive: a };
    // PID 가 없는 옛 기록은 살아 있다고 본다 — 모르는 걸 죽었다고 단정해 같이 돌면 메모리가 터진다.
    (a === false ? stale : live).push(entry);
  }
  return { live, stale, raw };
}
