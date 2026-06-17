#!/usr/bin/env node
// pm2-watchdog.mjs — flowvium pm2 프로세스 keep-alive (2026-06-17 전수조사 #1).
//   배경: cron-runner(flowvium-cron) 가 ~31개 잡의 단일 실행체 — 죽으면 전부 silent 정지. 기존
//   boot-resurrect 태스크는 트리거가 깨져 1999 이후 한 번도 안 돎(267011) + '세션 중 사망' 미대응.
//   FlowVium-pm2-watchdog 태스크가 15분마다 이 스크립트 실행 → 필수 프로세스 빠지면 resurrect →
//   (그래도 안 뜨면) 개별 restart. 정상이면 무로그(노이즈 방지). logs/pm2-watchdog.log 에 복구이력.
//   node 작성 이유: pm2 jlist JSON 에 중복키(username/USERNAME) 있어 PowerShell ConvertFrom-Json 거부 →
//   node JSON.parse 는 중복키 허용(마지막 값 채택).
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const PM2 = `${process.env.APPDATA}\\npm\\pm2.cmd`;
const LOG = 'C:\\Flowvium\\logs\\pm2-watchdog.log';
const NEED = ['flowvium-cron', 'flowvium-web', 'flowvium-tunnel', 'flowvium-redis-shim'];
const ts = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const logline = (m) => { try { appendFileSync(LOG, `${ts()} ${m}\n`); } catch { /* */ } };

function onlineNames() {
  try {
    const out = execFileSync(PM2, ['jlist'], { encoding: 'utf8', timeout: 20000, windowsHide: true, shell: true, maxBuffer: 20 * 1024 * 1024 });
    const j = JSON.parse(out);
    return new Set(j.filter((p) => p?.pm2_env?.status === 'online').map((p) => p.name));
  } catch (e) { logline(`[WATCHDOG] jlist 실패: ${String(e?.message).slice(0, 80)}`); return null; }
}

const on = onlineNames();
if (!on) process.exit(1);
const missing = NEED.filter((n) => !on.has(n));
if (!missing.length) process.exit(0); // 정상 — 무로그

logline(`[WATCHDOG] missing: ${missing.join(',')} — pm2 resurrect`);
try { execFileSync(PM2, ['resurrect'], { timeout: 30000, windowsHide: true, shell: true }); } catch { /* */ }
await new Promise((r) => setTimeout(r, 6000));

const on2 = onlineNames() || new Set();
const still = NEED.filter((n) => !on2.has(n));
if (still.length) {
  logline(`[WATCHDOG] resurrect 후에도 빠짐: ${still.join(',')} — 개별 restart`);
  for (const s of still) { try { execFileSync(PM2, ['restart', s], { timeout: 30000, windowsHide: true, shell: true }); } catch { /* */ } }
} else {
  logline(`[WATCHDOG] recovered (${missing.join(',')})`);
}
process.exit(0);
