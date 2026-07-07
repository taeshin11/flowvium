#!/usr/bin/env node
// pm2-watchdog.mjs — flowvium pm2 프로세스 keep-alive (2026-06-17 전수조사 #1).
//   배경: cron-runner(flowvium-cron) 가 ~31개 잡의 단일 실행체 — 죽으면 전부 silent 정지. 기존
//   boot-resurrect 태스크는 트리거가 깨져 1999 이후 한 번도 안 돎(267011) + '세션 중 사망' 미대응.
//   FlowVium-pm2-watchdog 태스크가 15분마다 이 스크립트 실행 → 필수 프로세스 빠지면 resurrect →
//   (그래도 안 뜨면) 개별 restart. 정상이면 무로그(노이즈 방지). logs/pm2-watchdog.log 에 복구이력.
//   node 작성 이유: pm2 jlist JSON 에 중복키(username/USERNAME) 있어 PowerShell ConvertFrom-Json 거부 →
//   node JSON.parse 는 중복키 허용(마지막 값 채택).
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';

const LORA_LOCK = 'C:\\Flowvium\\logs\\lora-training.lock';
const HOLD_STATE = 'C:\\Flowvium\\logs\\vllm-hold-count.json';

const PM2 = `${process.env.APPDATA}\\npm\\pm2.cmd`;
const LOG = 'C:\\Flowvium\\logs\\pm2-watchdog.log';
const NEED = ['flowvium-cron', 'flowvium-web', 'flowvium-tunnel', 'flowvium-redis-shim'];
// KST 로컬시각 — toISOString(UTC)이던 시절 07-07 장애분석에서 "로그가 9시간 전에 끊김"으로 오독됨.
const ts = () => new Date().toLocaleString('sv-SE');
const logline = (m) => { try { appendFileSync(LOG, `${ts()} ${m}\n`); } catch { /* */ } };

function onlineNames() {
  try {
    const out = execFileSync(PM2, ['jlist'], { encoding: 'utf8', timeout: 20000, windowsHide: true, shell: true, maxBuffer: 20 * 1024 * 1024 });
    const j = JSON.parse(out);
    return new Set(j.filter((p) => p?.pm2_env?.status === 'online').map((p) => p.name));
  } catch (e) { logline(`[WATCHDOG] jlist 실패: ${String(e?.message).slice(0, 80)}`); return null; }
}

// vLLM(:8000) liveness + 자동 재기동 — vLLM 은 pm2 가 아니라 WSL 스케줄 태스크(FlowVium-vLLM)라
//   pm2 watchdog 의 사각지대였음. 2026-06-17 vLLM 이 18:40 silent death → 어떤 모니터도 못 잡고
//   다음 cron 보고서 실패 직전까지 방치된 사건의 근본수정. pm2 처럼 self-healing 하게 직접 watch.
async function checkVllm() {
  const alive = async () => {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 6000);
      const r = await fetch('http://127.0.0.1:8000/v1/models', { signal: c.signal });
      clearTimeout(t);
      return r.ok;
    } catch { return false; }
  };
  if (await alive()) { try { unlinkSync(HOLD_STATE); } catch { /* */ } return; } // 정상 — 무로그
  // LoRA 학습 윈도우: vLLM 을 의도적으로 정지(GPU 24GB 점유 해제)한 상태 → 재기동하면 학습 OOM.
  //   logs/lora-training.lock 존재 시 재기동 보류(오케스트레이터가 학습 후 lock 제거+vLLM 재기동).
  if (existsSync(LORA_LOCK)) { logline('[VLLM] :8000 다운이나 lora-training.lock 존재 — LoRA 학습중, 재기동 보류'); return; }
  // 모델 로딩 중(~1-2min)이면 vllm 프로세스가 이미 떠 있음 → 재기동 시 중복 spawn/포트경합 → 보류.
  //   ★[v]llm 브래킷 필수 — "vllm serve" 그대로 쓰면 bash -c 래퍼 자신의 cmdline 이 매칭돼 loading 이
  //   항상 true → WSL 사망 후에도 영구 보류 (2026-07-07 noon~evening 11시간 무복구 사건의 근본원인).
  let loading = false;
  try {
    const ps = execFileSync('wsl.exe', ['-d', 'Ubuntu-24.04', '-u', 'root', 'bash', '-c', 'pgrep -f "[v]llm serve" | head -1'],
      { encoding: 'utf8', timeout: 15000, windowsHide: true }).trim();
    loading = ps.length > 0;
  } catch { /* wsl 미가용 */ }
  if (loading) {
    // 보류 무한루프 방지: 연속 4회(~1h) 로딩중이면 정상 로딩(~2-4min)일 수 없음 — 좀비로 판정, 강제 재기동.
    let holds = 0;
    try { holds = JSON.parse(readFileSync(HOLD_STATE, 'utf8')).holds | 0; } catch { /* */ }
    holds += 1;
    try { writeFileSync(HOLD_STATE, JSON.stringify({ holds, at: ts() })); } catch { /* */ }
    if (holds < 4) { logline(`[VLLM] :8000 미응답이나 vllm 프로세스 존재(로딩중 추정) — 재기동 보류 (${holds}/4)`); return; }
    logline(`[VLLM] :8000 미응답 + 로딩중 추정 ${holds}회 연속 — 좀비 판정, pkill 후 강제 재기동`);
    try { execFileSync('wsl.exe', ['-d', 'Ubuntu-24.04', '-u', 'root', 'bash', '-c', 'pkill -f "[v]llm serve"; sleep 3'], { timeout: 30000, windowsHide: true }); } catch { /* */ }
  } else {
    logline('[VLLM] :8000 다운 + vllm 프로세스 없음 — FlowVium-vLLM 태스크 재기동');
  }
  try { unlinkSync(HOLD_STATE); } catch { /* */ }
  try { execFileSync('schtasks', ['/run', '/tn', 'FlowVium-vLLM'], { timeout: 20000, windowsHide: true }); }
  catch (e) { logline(`[VLLM] 재기동 실패: ${String(e?.message).slice(0, 80)}`); }
}
await checkVllm();

// RAG 임베더(:8100, bge-m3 CPU) liveness — Startup .cmd 는 로그온 시에만 돌아 WSL 이 세션 중 죽으면
//   아무도 재기동 안 하는 사각지대 (2026-07-07 WSL 동반사망으로 실증). 중복 spawn 은 :8100 바인딩
//   실패로 즉시 종료돼 무해 (serve-embed.sh 는 uvicorn exec 단일 프로세스).
async function checkEmbedder() {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 6000);
    const r = await fetch('http://127.0.0.1:8100/health', { signal: c.signal });
    clearTimeout(t);
    if (r.ok) return;
  } catch { /* down */ }
  logline('[EMBED] :8100 다운 — serve-embed.sh 재기동');
  try {
    spawn('wsl.exe', ['-d', 'Ubuntu-24.04', '-u', 'root', '--', 'bash', '/mnt/c/Flowvium/scripts/rag/serve-embed.sh'],
      { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch (e) { logline(`[EMBED] 재기동 실패: ${String(e?.message).slice(0, 80)}`); }
}
await checkEmbedder();

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
