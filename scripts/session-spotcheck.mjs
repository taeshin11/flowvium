#!/usr/bin/env node
// scripts/session-spotcheck.mjs
// 세션 모니터 스팟체크 — Claude 세션 CronCreate 가 주기 실행, ALERT 시에만 PushNotification.
// 5점검: (1) monitor-status fresh<25m (2) GPU<85C (3) 보고서 stale (4) lock>90m (5) report.log 신규 FATAL.
// 출력 1줄: "OK ..." 또는 "ALERT: ...". exit code 0=OK / 1=ALERT (cron 은 stdout 으로 판정해도 됨).
// 2026-06-15 신설 (vLLM 이전 후 세션 모니터링 이어가기).
import { readFileSync, statSync, readdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const ROOT = 'C:/Flowvium';
const now = Date.now();
const alerts = [];
const info = [];

// [1] flowvium-cron 이 20분마다 갱신하는 monitor-status.json 신선도 (<25m)
try {
  const s = JSON.parse(readFileSync(`${ROOT}/logs/monitor-status.json`, 'utf8'));
  const ageMin = (now - new Date(s.ts).getTime()) / 60000;
  if (ageMin > 25) alerts.push(`monitor-status ${ageMin.toFixed(0)}m stale (flowvium-cron 중단 의심)`);
  else info.push(`monitor ${ageMin.toFixed(0)}m`);
} catch { alerts.push('monitor-status.json 읽기 실패'); }

// [2] GPU 온도 < 85C
try {
  const out = execSync('nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader,nounits', { encoding: 'utf8', timeout: 10000 });
  const temp = parseInt(out.trim().split('\n')[0], 10);
  if (Number.isFinite(temp)) {
    if (temp >= 85) alerts.push(`GPU ${temp}C >= 85`);
    else info.push(`GPU ${temp}C`);
  }
} catch { info.push('GPU n/a'); }

// [3] 최신 보고서 stale (5회/일 cron: 06:40·11:40·15:40·21:10·23:40 KST, 최대 간격 야간 7h → 9h 임계)
try {
  const dir = `${ROOT}/reports`;
  const files = readdirSync(dir).filter((f) => /^report-.*\.json$/.test(f));
  if (files.length === 0) alerts.push('reports/ 비어있음');
  else {
    const newest = files.map((f) => ({ f, t: statSync(`${dir}/${f}`).mtimeMs })).sort((a, b) => b.t - a.t)[0];
    const ageH = (now - newest.t) / 3600000;
    if (ageH > 9) alerts.push(`최신 보고서 ${ageH.toFixed(1)}h (cron 누락 의심)`);
    else info.push(`report ${ageH.toFixed(1)}h`);
  }
} catch { alerts.push('reports/ 읽기 실패'); }

// [4] report-pipeline.lock > 90m (stuck 파이프라인)
try {
  for (const p of [`${ROOT}/report-pipeline.lock`, `${ROOT}/logs/report-pipeline.lock`]) {
    if (existsSync(p)) {
      const ageMin = (now - statSync(p).mtimeMs) / 60000;
      if (ageMin > 90) alerts.push(`lock ${ageMin.toFixed(0)}m (파이프라인 stuck)`);
      else info.push(`lock ${ageMin.toFixed(0)}m`);
    }
  }
} catch {}

// [5] report.log 최근 신규 FATAL (로그가 25분 내 갱신됐고 tail 에 [FATAL] 있으면 — ERROR 는 노이즈라 제외)
try {
  const log = `${ROOT}/logs/report.log`;
  if (existsSync(log)) {
    const ageMin = (now - statSync(log).mtimeMs) / 60000;
    if (ageMin < 25) {
      const tail = execSync(`powershell -NoProfile -Command "Get-Content -Tail 80 -LiteralPath '${log}'"`, { encoding: 'utf8', timeout: 10000 });
      const hits = tail.split('\n').filter((l) => /\[FATAL\]/.test(l));
      if (hits.length) alerts.push(`report.log 신규 FATAL ${hits.length}건: ${hits.slice(-1)[0].trim().slice(0, 80)}`);
    }
  }
} catch {}

// [6] 라이브 보고서 fallback 감지 (Redis publish 누락/cron hang — file-mtime 으론 안잡히는 사각지대; 2026-06-15 morning-cron hang 사건 후 신설)
try {
  const r = await fetch('https://flowvium.net/api/investment-strategy', { signal: AbortSignal.timeout(9000) });
  if (r.ok) {
    const src = String((await r.json()).source ?? '');
    if (/^fallback/i.test(src)) alerts.push(`라이브 보고서 fallback (source=${src}) — Redis publish 누락/cron hang`);
    else info.push('live OK');
  }
} catch { /* 네트워크 블립은 무시(오탐 방지) */ }

const line = alerts.length
  ? `ALERT: ${alerts.join(' | ')}  [ok: ${info.join(', ')}]`
  : `OK  ${info.join(' / ')}`;
console.log(line);
process.exit(alerts.length ? 1 : 0);
