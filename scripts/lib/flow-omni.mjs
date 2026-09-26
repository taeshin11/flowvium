/**
 * flow-omni.mjs — 소재가 모자란 회차에 Flow **Omni Flash ×1**(크레딧)로 영상 한 컷을 만든다. (2026-09-26 신설)
 *
 * 사장님: "차단 시간에는 영상 부족하면 omni flash ×1로 써서라도 만들어. 크레딧 쓰면은 차단은 안 시키더라"
 *   되물음 결과(9/26): Flow 자동화는 **Omni Flash ×1 만** 허용(9/25 FLOW_RULES 2항의 예외), 사건 재현 영상도 허용.
 * 그 밖의 FLOW_RULES 는 그대로 지킨다:
 *   · Dropbox `@1 생성동영상/_flow_lock.txt` 가 비었을 때만. 남의 락은 덮어쓰지 않는다(5시간 넘게 안 바뀐 락은 낡은 것).
 *   · 시간표: FlowVium 은 18~24시(예비)만. FLOW_OMNI_HOURS 로 바꿀 수 있다.
 *   · 생성 사이 10분 이상(규칙 5항 8~12분). 한 회차에 한 컷.
 * 끄개: FLOW_OMNI_FALLBACK=0.
 *
 * 생성은 scripts/flow-clip.mjs 를 FLOW_PURPOSE=omni-flash-x1 로 부른다 — lib/flow.openFlow 는 그 목적일 때만 연다.
 */
import { existsSync, readFileSync, writeFileSync, statSync, mkdirSync } from 'fs';
import { dirname, resolve, join } from 'path';
import { homedir } from 'os';
import { spawnSync } from 'child_process';
import { ROOT } from './project-root.mjs';

export const OMNI_MODEL = 'Omni Flash';
export const DEFAULT_LOCK = join(homedir(), 'Library/CloudStorage/Dropbox/@1 생성동영상/_flow_lock.txt');
const DEFAULT_STATE = resolve(ROOT, 'logs/flow-omni-last.json');
const STALE_MS = 5 * 3600e3;
const MIN_GAP_MS = 10 * 60e3;

const kstHour = (d) => (new Date(d).getUTCHours() + 9) % 24;

/**
 * 지금 만들어도 되는가. 만들지 않는 이유를 사람 말로 돌려준다.
 * @returns {{ok:boolean, reason?:string}}
 */
export function omniAllowed({ now = new Date(), lockFile = DEFAULT_LOCK, stateFile = DEFAULT_STATE, env = process.env } = {}) {
  if (env.FLOW_OMNI_FALLBACK === '0') return { ok: false, reason: 'FLOW_OMNI_FALLBACK=0 으로 꺼져 있다' };
  const [from, to] = String(env.FLOW_OMNI_HOURS ?? '18-24').split('-').map(Number);
  const h = kstHour(now);
  if (!(h >= from && h < to)) return { ok: false, reason: `시간표 밖(${h}시 · FlowVium 은 ${from}~${to}시)` };
  if (!existsSync(dirname(lockFile))) return { ok: false, reason: `Dropbox 락 폴더가 없다: ${dirname(lockFile)}` };
  if (existsSync(lockFile)) {
    const body = readFileSync(lockFile, 'utf8').trim();
    const age = Date.now() - statSync(lockFile).mtimeMs;
    if (body && age < STALE_MS) return { ok: false, reason: `다른 곳이 Flow 락을 쥐고 있다: "${body.slice(0, 60)}"` };
  }
  try {
    const last = Date.parse(JSON.parse(readFileSync(stateFile, 'utf8')).at);
    if (Number.isFinite(last) && Date.now() - last < MIN_GAP_MS) {
      return { ok: false, reason: `직전 생성이 ${Math.round((Date.now() - last) / 60e3)}분 전 — 10분 이상 띄운다` };
    }
  } catch { /* 기록 없음 = 처음 */ }
  return { ok: true };
}

/** 락을 우리 이름으로 잡는다. 이미 누가(내용 있음·신선) 쥐고 있으면 ok:false. 풀 때는 **우리 것일 때만** 비운다. */
export function takeFlowLock(lockFile, who = 'mac-flowvium') {
  if (existsSync(lockFile)) {
    const body = readFileSync(lockFile, 'utf8').trim();
    if (body && Date.now() - statSync(lockFile).mtimeMs < STALE_MS) return { ok: false, holder: body };
  }
  const mine = `${who}: Omni Flash ×1 쇼츠 소재 1컷 · ${new Date().toISOString()}`;
  writeFileSync(lockFile, mine);
  return {
    ok: true,
    release() {
      try { if (readFileSync(lockFile, 'utf8').trim() === mine) writeFileSync(lockFile, ''); } catch { /* 이미 없음 */ }
    },
  };
}

/**
 * 한 컷 만든다. 조건이 안 맞거나 실패하면 null 과 사유.
 * @returns {Promise<{path:string|null, reason?:string, seconds?:number}>}
 */
export async function generateOmniClip({ prompt, out, waitS = 420, lockFile = DEFAULT_LOCK, stateFile = DEFAULT_STATE, log = () => {} }) {
  const gate = omniAllowed({ lockFile, stateFile });
  if (!gate.ok) return { path: null, reason: gate.reason };
  const lock = takeFlowLock(lockFile);
  if (!lock.ok) return { path: null, reason: `락을 못 잡았다: ${lock.holder}` };
  const t0 = Date.now();
  try {
    mkdirSync(dirname(stateFile), { recursive: true });
    writeFileSync(stateFile, JSON.stringify({ at: new Date().toISOString(), prompt: String(prompt).slice(0, 200) }));
    log(`[Omni] Flow ${OMNI_MODEL} ×1 로 한 컷 만든다(크레딧) — 락 잡음`);
    const r = spawnSync(process.execPath, [resolve(ROOT, 'scripts/flow-clip.mjs'),
      '--model', OMNI_MODEL, '--allow-paid', '--prompt', prompt, '--out', out, '--wait', String(waitS)], {
      cwd: ROOT, encoding: 'utf8', timeout: (waitS + 180) * 1000,
      env: { ...process.env, FLOW_PURPOSE: 'omni-flash-x1' },
    });
    const tail = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.trim().split('\n').slice(-2).join(' | ').slice(0, 160);
    if (r.status !== 0 || !existsSync(out)) return { path: null, reason: `flow-clip 실패(exit ${r.status}): ${tail}` };
    return { path: out, seconds: Math.round((Date.now() - t0) / 1000) };
  } finally {
    lock.release();
  }
}
