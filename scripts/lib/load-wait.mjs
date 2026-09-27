/**
 * load-wait.mjs — 부하가 한계 아래로 내려올 때까지 정해진 시간만 기다린다. (2026-09-28, 근거는 load-wait.test.mjs 머리말)
 * @returns {Promise<{ok:boolean, load:number, waitedMs:number}>}
 */
import { loadavg } from 'node:os';

export async function waitForLoad({ limit, waitMs, pollMs = 60_000,
  read = () => loadavg()[0], sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now } = {}) {
  const t0 = now();
  let load = read();
  while (load > limit && now() - t0 < waitMs) {
    await sleep(pollMs);
    load = read();
  }
  return { ok: load <= limit, load, waitedMs: now() - t0 };
}
