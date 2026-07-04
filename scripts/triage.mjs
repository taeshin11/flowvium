#!/usr/bin/env node
/**
 * triage.mjs — "지금 어디가 아픈가" 단일 명령 헬스 요약 (2026-07-04 신설)
 *
 * 갭: 로깅/상태파일은 층층이 쌓였는데(모니터·recheck·페이지감사·heartbeat·DB·pm2) 장애 시
 * "어디서 업데이트가 안 됐고 에러났는지" 보려면 6곳+ 을 손으로 열어야 했다. 이 스크립트가
 * 전부 읽어 한 화면 요약 + 🚨 만 추리면 1차 분류(triage)가 10초 안에 끝난다.
 *
 * 읽기 전용(활성 프로브 없음 — 그건 check-stall.mjs 몫). 사용: node scripts/triage.mjs
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';

// .env.local (cron-runner 와 동일 — CRON_SECRET 로 client-log GET)
try {
  const envPath = resolve(process.cwd(), '.env.local');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch { /* non-fatal */ }

const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;
const SECRET = process.env.CRON_SECRET || '';
const now = Date.now();
const alerts = [];
const ageMin = (iso) => Math.round((now - new Date(iso).getTime()) / 60000);
const fmtAge = (min) => (min == null || Number.isNaN(min)) ? '?' : min < 90 ? `${min}분` : min < 60 * 36 ? `${(min / 60).toFixed(1)}h` : `${(min / 1440).toFixed(1)}d`;
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const line = (s) => console.log(s);

line('═══ FlowVium triage — ' + new Date().toISOString() + ' ═══');

// [1] pm2 프로세스
try {
  const list = JSON.parse(execSync('pm2 jlist', { encoding: 'utf8', timeout: 15000, windowsHide: true }));
  const rows = list.map((p) => {
    const st = p.pm2_env?.status ?? '?';
    const restarts = p.pm2_env?.restart_time ?? 0;
    const up = p.pm2_env?.pm_uptime ? fmtAge(Math.round((now - p.pm2_env.pm_uptime) / 60000)) : '?';
    if (st !== 'online') alerts.push(`pm2 ${p.name} 상태 ${st}`);
    if (restarts >= 20) alerts.push(`pm2 ${p.name} 재시작 ${restarts}회 누적 (crash loop 의심)`);
    return `  ${st === 'online' ? '✅' : '🚨'} ${p.name.padEnd(18)} ${st} up=${up} restarts=${restarts}`;
  });
  line('[1] pm2'); rows.forEach((r) => line(r));
} catch (e) { line('[1] pm2 — 조회 실패: ' + String(e).slice(0, 80)); alerts.push('pm2 jlist 실패'); }

// [2] 주기 모니터 (runMonitor 20분 주기 — 40분+ 침묵이면 모니터 자체가 죽은 것)
const mon = readJson('logs/monitor-status.json');
if (mon) {
  const a = ageMin(mon.ts);
  const bad = a > 40 || (mon.defects ?? []).length > 0;
  line(`[2] 모니터 ${bad ? '🚨' : '✅'} ${fmtAge(a)} 전 | checks: ${Object.entries(mon.checks ?? {}).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  if (a > 40) alerts.push(`모니터 ${fmtAge(a)} 침묵 (20분 주기 — cron-runner 확인)`);
  for (const d of mon.defects ?? []) { line('    🚨 ' + d); alerts.push('모니터 결함: ' + d.slice(0, 100)); }
} else { line('[2] 모니터 — monitor-status.json 없음'); alerts.push('monitor-status.json 없음'); }

// [3] 발간 recheck (마지막 발간의 라이브 반영+렌더 검증)
const rc = readJson('logs/recheck-status.json');
if (rc) {
  const ok = rc.liveConfirmed === true;
  line(`[3] 발간검증 ${ok ? '✅' : '🚨'} ${rc.session ?? '?'} ${fmtAge(ageMin(rc.ts))} 전 | ${(rc.checks ?? []).join(' · ')}`);
  if (!ok) alerts.push(`recheck 라이브 미확인 (${rc.session}, ${rc.reportFile})`);
} else line('[3] 발간검증 — recheck-status.json 없음');

// [4] 페이지 감사 (6h 주기 — 23페이지+탭)
const pa = readJson('logs/page-audit.json');
if (pa) {
  const ts = pa.ts ?? pa.finishedAt ?? pa.startedAt;
  const a = ts ? ageMin(ts) : null;
  const flags = pa.flags ?? pa.flagged ?? pa.summary?.flags ?? [];
  const nf = Array.isArray(flags) ? flags.length : flags;
  line(`[4] 페이지감사 ${nf ? '⚠️ ' : '✅'} ${fmtAge(a)} 전 | flag ${nf}건`);
  if (a != null && a > 60 * 8) alerts.push(`페이지감사 ${fmtAge(a)} 경과 (6h 주기)`);
  if (Array.isArray(flags)) flags.slice(0, 3).forEach((f) => line('    ⚠️  ' + (typeof f === 'string' ? f : JSON.stringify(f)).slice(0, 120)));
} else line('[4] 페이지감사 — page-audit.json 없음');

// [5] HTTP 크론 last-run — 주기는 vercel.json 스케줄에서 파생 (이름 패턴 추정 금지:
//     evaluate-signals/log-cascade-events 가 주간(`* * 0`)인데 26h 잣대로 오탐났던 것 수정)
const clr = readJson('logs/cron-last-run.json');
if (clr) {
  const cronDefs = new Map((readJson('vercel.json')?.crons ?? []).map((c) => [c.path, c.schedule]));
  const maxAgeMin = (path) => {
    const sched = cronDefs.get(path) ?? '';
    const dow = sched.trim().split(/\s+/)[4]; // 5번째 필드 ≠ '*' → 주간 잡
    return dow && dow !== '*' ? 60 * 24 * 8 : 60 * 26;
  };
  const entries = Object.entries(clr).map(([k, v]) => [k, Math.round((now - Number(v)) / 60000)]).sort((x, y) => y[1] - x[1]);
  const staleD = entries.filter(([k, a]) => a > maxAgeMin(k));
  line(`[5] HTTP크론 ${staleD.length ? '🚨' : '✅'} ${entries.length}개 | 주기초과 공백 ${staleD.length}건`);
  staleD.slice(0, 5).forEach(([k, a]) => { line(`    🚨 ${k} — ${fmtAge(a)} 전 (허용 ${fmtAge(maxAgeMin(k))})`); alerts.push(`HTTP 크론 공백: ${k} ${fmtAge(a)}`); });
} else line('[5] HTTP크론 — cron-last-run.json 없음');

// [6] MAINT heartbeat (주간 잡 포함 — 8d+ 만 flag)
const hb = readJson('logs/maintenance-heartbeat.json');
if (hb) {
  const entries = Object.entries(hb).map(([k, v]) => [k, ageMin(v)]).sort((x, y) => y[1] - x[1]);
  const stale = entries.filter(([, a]) => a > 60 * 24 * 8);
  line(`[6] MAINT잡 ${stale.length ? '🚨' : '✅'} ${entries.length}개 | 최장공백 ${entries[0] ? `${entries[0][0]} ${fmtAge(entries[0][1])}` : '-'}`);
  stale.forEach(([k, a]) => alerts.push(`MAINT 잡 공백: ${k} ${fmtAge(a)} (8d+)`));
} else line('[6] MAINT잡 — maintenance-heartbeat.json 없음');

// [7] 보고서 파이프 — 최신 report 나이 + report.log 의 FATAL/ERROR 꼬리
try {
  const files = readdirSync('reports').filter((f) => /^report-.*-ko\.json$/.test(f))
    .map((f) => ({ f, m: statSync('reports/' + f).mtimeMs })).sort((a, b) => b.m - a.m);
  const latest = files[0];
  const a = latest ? Math.round((now - latest.m) / 60000) : null;
  // 세션 3회/일(모닝·정오·오후) — 11h+ 공백이면 한 세션 누락 의심
  line(`[7] 보고서 ${a != null && a > 60 * 11 ? '🚨' : '✅'} 최신 ${latest?.f ?? '-'} (${fmtAge(a)} 전)`);
  if (a != null && a > 60 * 11) alerts.push(`보고서 ${fmtAge(a)} 공백 — 세션 누락 의심 (logs/report.log 확인)`);
  const tail = readFileSync('logs/report.log', 'utf8').split('\n').slice(-300);
  const errs = tail.filter((l) => /\[FATAL\]|Unhandled|TypeError|ECONNREFUSED/.test(l)).slice(-3);
  errs.forEach((l) => { line('    🚨 ' + l.trim().slice(0, 140)); alerts.push('report.log: ' + l.trim().slice(0, 100)); });
} catch { line('[7] 보고서 — reports/ 읽기 실패'); }

// [8] endpoint_snapshots 24h 4XX/5XX (발간 시점 데이터 소스 실패)
try {
  const { openDb } = await import('./lib/db.mjs');
  const db = openDb();
  const rows = db.prepare(`SELECT endpoint, COUNT(*) n, SUM(CASE WHEN http_status>=400 OR ok=0 THEN 1 ELSE 0 END) bad
    FROM endpoint_snapshots WHERE captured_at > datetime('now','-1 day')
    GROUP BY endpoint HAVING bad>0 ORDER BY bad DESC LIMIT 6`).all();
  line(`[8] 스냅샷(24h) ${rows.length ? '⚠️ ' : '✅'} 실패 endpoint ${rows.length}종`);
  rows.forEach((r) => {
    line(`    ⚠️  ${r.endpoint} — ${r.bad}/${r.n} 실패`);
    if (r.bad === r.n && r.n >= 2) alerts.push(`endpoint 전멸(24h): ${r.endpoint} ${r.bad}/${r.n}`);
  });
} catch (e) { line('[8] 스냅샷 — DB 조회 실패: ' + String(e).slice(0, 80)); }

// [9] 프런트(브라우저) 에러 — /api/client-log (24h)
try {
  const r = await fetch(`${BASE}/api/client-log?sinceMin=1440`, { headers: SECRET ? { Authorization: `Bearer ${SECRET}` } : {}, signal: AbortSignal.timeout(8000) });
  if (r.ok) {
    const j = await r.json();
    line(`[9] 프런트에러(24h) ${j.count >= 5 ? '⚠️ ' : '✅'} ${j.count}건`);
    (j.samples ?? []).slice(0, 3).forEach((s) => line(`    ${s.ts.slice(11, 16)} [${s.type}] ${s.message} @${s.url}`));
    if (j.count >= 5) alerts.push(`브라우저 에러 24h ${j.count}건`);
  } else { line(`[9] 프런트에러 — GET ${r.status}`); alerts.push(`client-log GET ${r.status} (web down? SECRET 미로드?)`); }
} catch (e) { line('[9] 프런트에러 — 조회 실패: ' + String(e).slice(0, 60)); alerts.push('client-log 조회 실패 (web 프로세스 확인)'); }

// ═══ 종합 ═══
line('');
if (alerts.length === 0) {
  line('✅ TRIAGE CLEAN — 9개 층 모두 정상. 능동 프로브는 node scripts/check-stall.mjs');
} else {
  line(`🚨 TRIAGE — 주의 ${alerts.length}건:`);
  alerts.forEach((a, i) => line(`  ${i + 1}. ${a}`));
  line('→ 심층: node scripts/check-stall.mjs (능동 프로브) | pm2 logs <name> --lines 50 | reports/verify/ 최근파일');
}
process.exit(alerts.length ? 1 : 0);
