#!/usr/bin/env node
// scripts/session-spotcheck.mjs
// 세션 모니터 스팟체크 — Claude 세션 CronCreate 가 주기 실행, ALERT 시에만 PushNotification.
// 5점검: (1) monitor-status fresh<25m (2) GPU<85C (3) 보고서 stale (4) lock>90m (5) report.log 신규 FATAL.
// 출력 1줄: "OK ..." 또는 "ALERT: ...". exit code 0=OK / 1=ALERT (cron 은 stdout 으로 판정해도 됨).
// 2026-06-15 신설 (vLLM 이전 후 세션 모니터링 이어가기).
import { readFileSync, writeFileSync, statSync, readdirSync, existsSync } from 'node:fs';
import { execSync, spawn } from 'node:child_process';

const ROOT = 'C:/Flowvium';
const now = Date.now();
const alerts = [];
const info = [];

// [1] flowvium-cron 이 20분마다 갱신하는 monitor-status.json 신선도 (<25m) + 결함 surface
//   2026-06-17 (사용자 "모니터가 왜 못잡냐"): 기존엔 신선도(mtime)만 보고 result.defects 배열은 무시 →
//   runMonitor 가 잡은 결함(fallback purge, GPU 과열 등)이 스팟체크로 안 올라왔다. 이제 defects 도 ALERT 화.
try {
  const s = JSON.parse(readFileSync(`${ROOT}/logs/monitor-status.json`, 'utf8'));
  const ageMin = (now - new Date(s.ts).getTime()) / 60000;
  if (ageMin > 25) alerts.push(`monitor-status ${ageMin.toFixed(0)}m stale (flowvium-cron 중단 의심)`);
  else info.push(`monitor ${ageMin.toFixed(0)}m`);
  if (ageMin <= 25 && Array.isArray(s.defects) && s.defects.length) {
    alerts.push(`모니터 결함 ${s.defects.length}: ${s.defects.slice(0, 3).join(' | ').slice(0, 140)}`);
  }
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
  const r = await fetch('https://flowvium.net/api/investment-strategy', { signal: AbortSignal.timeout(9000), headers: { connection: 'close' } });
  if (r.ok) {
    const src = String((await r.json()).source ?? '');
    if (/^fallback/i.test(src)) alerts.push(`라이브 보고서 fallback (source=${src}) — Redis publish 누락/cron hang`);
    else info.push('live OK');
  }
} catch { /* 네트워크 블립은 무시(오탐 방지) */ }

// [7] 발행후 라이브 재검 결과 (post-publish-recheck.mjs 가 매 발행 후 기록 — 로그인 슬라이스+verify probe)
try {
  const s = JSON.parse(readFileSync(`${ROOT}/logs/recheck-status.json`, 'utf8'));
  const ageH = (now - new Date(s.ts).getTime()) / 3600000;
  if (ageH < 12) {  // 직전 발행분 재검만 반영 (오래된 건 무시)
    if (s.verdict === 'alert' || (s.highDefects?.length)) {
      const d = s.highDefects?.length ? ` high결함 ${s.highDefects.map((x) => x.type).join(',')}` : '';
      alerts.push(`발행후재검 ALERT(${ageH.toFixed(1)}h${s.liveConfirmed ? '' : ', 라이브미반영'})${d}`);
    } else info.push(`재검OK(${s.nSlices}장)`);
  }
} catch { /* 재검기록 없음(아직 발행 전이거나 구버전) — 무시 */ }

// [8] 현재 세션 발행 누락 감지 (2026-06-17 사용자 "morning 누락+fallback 을 모니터가 왜 못잡냐").
//   [3] file-mtime/9h 임계는 단일 세션 누락을 못 잡는다(세션 간격 <9h). 스케줄 발행시각 + 40분 grace 가
//   지났는데 해당 세션의 오늘자 보고서 파일이 없으면 ALERT — 06:40 morning git-hang 같은 silent 미발행 포착.
try {
  const kst = new Date(now + 9 * 3600000);
  const kh = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const today = kst.toISOString().slice(0, 10);
  const SESS = [[6 * 60 + 40, 'morning'], [11 * 60 + 40, 'noon'], [15 * 60 + 40, 'afternoon'], [21 * 60 + 10, 'evening'], [23 * 60 + 40, 'midnight']];
  const GRACE = 40; // 생성 소요(분) — 발행시각 + 40분까지는 생성중일 수 있어 유예
  const due = SESS.filter(([m]) => kh >= m + GRACE).pop(); // 오늘 발행기한 지난 세션 중 가장 최근
  if (due) {
    const label = due[1];
    if (!existsSync(`${ROOT}/reports/report-${today}-${label}-ko.json`)) {
      alerts.push(`현재 세션(${label}) 미발행 — ${today} ${label} 보고서 파일 없음 (cron hang/실패 의심)`);
    } else info.push(`세션 ${label}✓`);
  }
} catch {}

// [8] git wipe-risk (CLAUDE.md 의무 — "check-stall git wipe-risk 를 주기 모니터에 통합". 미커밋 tracked
//   변경 + 미푸시 ahead 커밋 = 다음 cron checkout 이 silent wipe. 2026-06-16 누락 발견 후 spotcheck 통합.)
try {
  execSync('node scripts/check-uncommitted-risk.mjs', { cwd: ROOT, encoding: 'utf8', timeout: 15000, stdio: 'pipe' });
  info.push('wipe-risk✓');
} catch (e) {
  const out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  const m = out.match(/🚨[^\n]{0,80}/) || out.match(/(미커밋|미푸시|ahead)[^\n]{0,60}/);
  alerts.push(`git wipe-risk: ${m ? m[0].trim() : '미커밋/미푸시 코드 — cron 이 revert 위험'}`);
}

// [9] Karpathy closed loop 건강 — 보고서는 갱신되는데 hallucination_history(verify-loop 산물)가 정체면 루프 단절.
try {
  const D = (await import('node:module')).createRequire(import.meta.url)('better-sqlite3');
  const db = new D(`${ROOT}/data/flowvium.db`, { readonly: true });
  const latest = db.prepare('SELECT MAX(detected_at) m, COUNT(*) n FROM hallucination_history').get();
  db.close();
  const ageH = latest.m ? (now - new Date(latest.m).getTime()) / 3600000 : 999;
  if (ageH > 14) alerts.push(`Karpathy 정체 ${ageH.toFixed(0)}h (verify-loop 단절 의심, n=${latest.n})`);
  else info.push(`Karpathy ${latest.n}행`);
} catch { /* DB 잠김/없음 — 무시 */ }

// [11] 좀비 보고서 래퍼 감지 (2026-06-17: wscript→run-report.bat 가 발간 후에도 안 죽고 10h+ 잔류 →
//   report.log 핸들 점유 → 다음 스케줄 런 cascade stall → 보고서 silent 미발행. 이 실패를 어떤 모니터도
//   못 잡던 사각지대. Task ExecutionTimeLimit=PT30M 가 30분에 죽여야 하므로 35분+ 생존 wscript = 안전망 실패.)
try {
  const out = execSync(
    'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'wscript.exe\'\\" | Where-Object { $_.CommandLine -match \'run-report\' } | ForEach-Object { [int]((Get-Date)-$_.CreationDate).TotalMinutes } | Measure-Object -Maximum | Select-Object -ExpandProperty Maximum"',
    { encoding: 'utf8', timeout: 12000 }).trim();
  const maxAge = parseInt(out, 10);
  if (Number.isFinite(maxAge) && maxAge > 35) alerts.push(`좀비 보고서 래퍼 ${maxAge}m 잔류 (Task 타임아웃 실패 — cascade stall 위험, kill 필요)`);
  else if (Number.isFinite(maxAge)) info.push(`wrapper ${maxAge}m`);
} catch { /* 프로세스 없음/조회 실패 — 무시(오탐 방지) */ }

// [10] deep-monitor (A=렌더 전수감사 + B=정확도probe, DB 누적) — surface 최신결과 + 6h throttle 로 detached 재실행.
//   (2026-06-16: 기존 모니터는 liveness 만 봤고 correctness/전체페이지는 발행시 1회뿐이었음. deep 가 주기적
//    correctness 검산 + 전향적 DB 적재. 무거워서 spotcheck 가 직접 안 돌리고 6h 마다 백그라운드 spawn.)
try {
  const dpath = `${ROOT}/logs/monitor-deep-status.json`;
  let ageH = 999, s = null;
  if (existsSync(dpath)) { s = JSON.parse(readFileSync(dpath, 'utf8')); ageH = (now - new Date(s.ts).getTime()) / 3600000; }
  if (s && ageH < 12) { // 최근 결과만 surface
    if (s.verdict === 'alert' || s.highFlags || s.probesError) {
      const bits = [];
      if (s.highFlags) bits.push(`렌더high ${s.highFlags}(${(s.highDetectors || []).join(',')})`);
      if (s.probesError) bits.push(`정확도err ${s.probesError}`);
      alerts.push(`deep감사 ALERT(${ageH.toFixed(1)}h): ${bits.join(', ')}`);
    } else info.push(`deep✓(${ageH.toFixed(0)}h,${s.pagesAudited}p,probe${s.probes?.length ?? 0})`);
  }
  // throttle 재실행: 결과 >6h 또는 없음 + lock 비신선(<15m) 시 백그라운드 detached spawn (비블로킹)
  const lock = `${ROOT}/logs/monitor-deep.lock`;
  const lockFresh = existsSync(lock) && (now - statSync(lock).mtimeMs) / 60000 < 15;
  if ((!s || ageH > 6) && !lockFresh) {
    try {
      writeFileSync(lock, new Date(now).toISOString());
      const ch = spawn(process.execPath, [`${ROOT}/scripts/monitor-deep.mjs`], { cwd: ROOT, detached: true, stdio: 'ignore' });
      ch.unref();
      info.push('deep재실행spawn');
    } catch { /* spawn 실패 비치명 */ }
  }
} catch { /* deep surface 실패 무시 */ }

const line = alerts.length
  ? `ALERT: ${alerts.join(' | ')}  [ok: ${info.join(', ')}]`
  : `OK  ${info.join(' / ')}`;
console.log(line);
// 2026-06-16: Windows libuv assert(!UV_HANDLE_CLOSING) 회피 — fetch 잔류 핸들 닫히기 전 process.exit() 즉시 호출 시 크래시.
//   Connection:close 로 keep-alive 소켓 잔류 제거 + 자연 종료(exitCode). 미종료 시 3s unref 타이머가 force-exit(자체로 loop 유지 안 함).
process.exitCode = alerts.length ? 1 : 0;
setTimeout(() => process.exit(process.exitCode), 3000).unref();
