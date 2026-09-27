/**
 * flow-omni.mjs — 소재가 모자란 회차에 Flow **Omni Flash ×1**(크레딧)로 영상 한 컷을 만든다. (2026-09-26 신설)
 *
 * 사장님: "차단 시간에는 영상 부족하면 omni flash ×1로 써서라도 만들어. 크레딧 쓰면은 차단은 안 시키더라"
 *   되물음 결과(9/26): Flow 자동화는 **Omni Flash ×1 만** 허용(9/25 FLOW_RULES 2항의 예외), 사건 재현 영상도 허용.
 * 그 밖의 FLOW_RULES 는 그대로 지킨다:
 *   · 구글드라이브 `내 드라이브/_flow/lock.txt` 가 비었을 때만. 남의 락은 덮어쓰지 않는다(5시간 넘게 안 바뀐 락은 낡은 것).
 *     2026-09-27 사장님 「구글드라이브로 다 맞춰라」 → Dropbox `_flow_lock.txt` 폐지(다른 기계가 더는 안 본다).
 *     내용은 queue.md 2항 `<세션> <시작> <예상종료>` + 유료 표시 PAID(5항). 차단 중 다른 세션이 적어 두는
 *     BLOCKED 줄도 "내용 있음" 이라 그대로 막힌다.
 *   · 시간표: FlowVium 은 18~24시(예비)만. FLOW_OMNI_HOURS 로 바꿀 수 있다.
 *   · 생성 사이 10분 이상(규칙 5항 8~12분). 한 회차에 한 컷.
 * 끄개: FLOW_OMNI_FALLBACK=0.
 *
 * 생성은 scripts/flow-clip.mjs 를 FLOW_PURPOSE=omni-flash-x1 로 부른다 — lib/flow.openFlow 는 그 목적일 때만 연다.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve, join } from 'path';
import { homedir } from 'os';
import { spawnSync } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { ROOT } from './project-root.mjs';

// 목록의 이름 그대로(맥미니 history 9/27 실측 「Omni 1.1 Flash」). setVideoModel 은 정확 일치로만 고른다.
export const OMNI_MODEL = 'Omni 1.1 Flash';
// 드라이브 폴더 이름은 계정(spinaiceo — Flow 공용 계정)에 묶여 있다. 다른 기계·계정이면 FLOW_LOCK_FILE 로.
export const DEFAULT_LOCK = process.env.FLOW_LOCK_FILE
  || join(homedir(), 'Library/CloudStorage/GoogleDrive-spinaiceo@gmail.com/내 드라이브/_flow/lock.txt');
const DEFAULT_STATE = resolve(ROOT, 'logs/flow-omni-last.json');
const STALE_MS = 5 * 3600e3;
const MIN_GAP_MS = 10 * 60e3;

function probeClip(f) {
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-i', f], { encoding: 'utf8' });
  const e = String(r.stderr ?? '');
  const d = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(e), wh = /,\s(\d{2,5})x(\d{2,5})[,\s]/.exec(e);
  return d ? { duration: +d[1] * 3600 + +d[2] * 60 + +d[3], width: wh ? +wh[1] : null, height: wh ? +wh[2] : null } : null;
}

const kstHour = (d) => (new Date(d).getUTCHours() + 9) % 24;

/**
 * 공유 락 파일(클라우드 동기 폴더)은 **자식 프로세스로, 시간 한도를 두고** 만진다. (2026-09-26 21:45 사고)
 *   원인(9/27 확인): macOS 개인정보 대화상자 「'node'이(가) 'Dropbox'에서 관리하는 파일에 접근하려고 합니다」가
 *   떠 있는 동안 open() 이 답을 기다린다(온라인 전용 파일을 내려받을 때도 같다) — make-shorts 가 open() 에서
 *   1시간 44분 멈췄고 그 회차가 통째로 안 나갔다(sample 로 main thread 가 open 에 걸린 것 확인).
 *   자식 프로세스는 timeout 에 죽일 수 있다. 못 읽으면 "모름" 이고, 모르면 생성하지 않는다.
 */
const FS_TIMEOUT_MS = Number(process.env.FLOW_LOCK_TIMEOUT_MS || 5000);
function lockFs(op, file, body = '') {
  const code = `const fs=require('fs');const [op,f,b]=process.argv.slice(1);
    if(op==='read'){ if(!fs.existsSync(f)){console.log(JSON.stringify({exists:false}));process.exit(0)}
      const st=fs.statSync(f);console.log(JSON.stringify({exists:true,body:fs.readFileSync(f,'utf8'),mtimeMs:st.mtimeMs}))}
    else { fs.writeFileSync(f,b); console.log('{"ok":true}') }`;
  const r = spawnSync(process.execPath, ['-e', code, op, file, body], { encoding: 'utf8', timeout: FS_TIMEOUT_MS, killSignal: 'SIGKILL' });
  if (r.error || r.status !== 0) return null;
  try { return JSON.parse(r.stdout); } catch { return null; }
}

/**
 * 지금 만들어도 되는가. 만들지 않는 이유를 사람 말로 돌려준다.
 * @returns {{ok:boolean, reason?:string}}
 */
export function omniAllowed({ now = new Date(), lockFile = DEFAULT_LOCK, stateFile = DEFAULT_STATE, env = process.env } = {}) {
  if (env.FLOW_OMNI_FALLBACK === '0') return { ok: false, reason: 'FLOW_OMNI_FALLBACK=0 으로 꺼져 있다' };
  const [from, to] = String(env.FLOW_OMNI_HOURS ?? '18-24').split('-').map(Number);
  const h = kstHour(now);
  if (!(h >= from && h < to)) return { ok: false, reason: `시간표 밖(${h}시 · FlowVium 은 ${from}~${to}시)` };
  if (!existsSync(dirname(lockFile))) return { ok: false, reason: `Flow 락 폴더가 없다: ${dirname(lockFile)}` };
  const lk = lockFs('read', lockFile);
  if (!lk) return { ok: false, reason: `Flow 락을 ${FS_TIMEOUT_MS / 1000}초 안에 못 읽었다 — 모르면 만들지 않는다` };
  if (lk.exists) {
    const body = String(lk.body ?? '').replace(/^\uFEFF/, '').trim();
    const age = Date.now() - lk.mtimeMs;
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
const hhmm = (d) => new Date(d).toLocaleTimeString('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' });
export function takeFlowLock(lockFile, who = 'mac-flowvium', { now = new Date(), minutes = 12 } = {}) {
  const lk = lockFs('read', lockFile);
  if (!lk) return { ok: false, holder: `(락을 ${FS_TIMEOUT_MS / 1000}초 안에 못 읽음)` };
  if (lk.exists) {
    const body = String(lk.body ?? '').replace(/^\uFEFF/, '').trim();
    if (body && Date.now() - lk.mtimeMs < STALE_MS) return { ok: false, holder: body };
  }
  const mine = `${who} ${hhmm(now)} ${hhmm(+now + minutes * 60e3)} PAID Omni ×1 FlowVium 쇼츠 소재 1컷`;
  if (!lockFs('write', lockFile, mine)) return { ok: false, holder: `(락을 ${FS_TIMEOUT_MS / 1000}초 안에 못 썼음)` };
  return {
    ok: true,
    release() {
      const now = lockFs('read', lockFile);
      if (now?.exists && String(now.body ?? '').trim() === mine) lockFs('write', lockFile, '');
    },
  };
}

/**
 * 작성기 칩 글자로 Omni 설정이 맞는지 본다. 문제가 없으면 null.
 *   · 개수는 x1 이어야 한다(아니면 크레딧이 몇 배).
 *   · 사장님 9/27 「omni는 4초짜리로 만들어」 — 칩에 길이가 보이면 4초여야 한다.
 *     칩 모양은 아직 실측 전이라, 길이 표시가 없으면 막지 않는다(받은 파일 길이를 기록해 확인한다).
 */
export const OMNI_SECONDS = 4;
export const OMNI_RES = '720p';          // Omni 기본은 360p — 꼭 눌러야 한다(9/27 실측)
export const OMNI_CREDITS = 7;           // 720p·4초·x1 = "생성 시 7 크레딧"(8초는 12). 읽히면 이 값이어야 한다
export function omniChipProblem(chip) {
  const c = String(chip ?? '');
  if (!/\bx1\b/.test(c)) return `개수가 x1 이 아니다(칩 "${c}")`;
  const res = /\b(\d{3,4})p\b/.exec(c);
  if (res && `${res[1]}p` !== OMNI_RES) return `해상도가 ${OMNI_RES} 가 아니다(${res[1]}p · 칩 "${c}")`;
  const d = /(\d{1,2})\s*(?:s\b|초|sec)/i.exec(c);
  if (d && Number(d[1]) !== OMNI_SECONDS) return `길이가 ${OMNI_SECONDS}초가 아니다(${d[1]}초 · 칩 "${c}")`;
  return null;
}

/**
 * 한 컷 만든다. 조건이 안 맞거나 실패하면 null 과 사유.
 * @returns {Promise<{path:string|null, reason?:string, seconds?:number}>}
 */
export async function generateOmniClip({ prompt, out, waitS = 420, lockFile = DEFAULT_LOCK, stateFile = DEFAULT_STATE, log = () => {} }) {
  const gate = omniAllowed({ lockFile, stateFile });
  if (!gate.ok) return { path: null, reason: gate.reason };
  const lock = takeFlowLock(lockFile, 'mac-flowvium', { minutes: Math.ceil((waitS + 180) / 60) });
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
    // 받은 파일의 실제 길이·크기를 남긴다 — 칩에 길이가 안 보이는 배치라면 이것이 4초 지시를 확인하는 유일한 근거다.
    const clip = probeClip(out);
    try { writeFileSync(stateFile, JSON.stringify({ ...JSON.parse(readFileSync(stateFile, 'utf8')), clip })); } catch { /* 기록 실패는 생성 결과와 무관 */ }
    if (clip && clip.duration > OMNI_SECONDS + 1.5) log(`[Omni] ⚠ 받은 영상이 ${clip.duration.toFixed(1)}초 — ${OMNI_SECONDS}초 지시와 다르다(Flow 기본 길이 확인 필요)`);
    return { path: out, seconds: Math.round((Date.now() - t0) / 1000), clip };
  } finally {
    lock.release();
  }
}
