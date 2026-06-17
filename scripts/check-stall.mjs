#!/usr/bin/env node
/**
 * scripts/check-stall.mjs — 스톨 감지 모니터.
 *
 * 파이프라인이 "멈춤"(stall) 상태인지 주기적으로 감지. cron/verify 가 alive 여도
 * 결과가 갱신 안 되는 silent stall 을 잡는다. (CLAUDE.md 검증 사각지대 철학)
 *
 * 감지 항목:
 *   [1] 최신 보고서 age — 정규 cron 3회/일(≈8h). > STALE_H 시간이면 STALL.
 *   [2] 최신 cron verify-loop 결과 age (reports/verify/) — 보고서 후 자동 verify 미동작 감지.
 *   [3] hung report-gen 프로세스 — generate-report-local 가 HUNG_MIN 분 넘게 실행 = 멈춤 의심.
 *   [4] Karpathy 학습 추세 — 최근 3 보고서 환각 평균이 직전 3 대비 급증(stall/회귀) 시 경고.
 *
 * 사용: node scripts/check-stall.mjs            # 1회 점검 (exit 1 = STALL 있음)
 *       node scripts/check-stall.mjs --watch=300 # 300초 주기 반복 (Ctrl+C 종료)
 *
 * cron/모니터 등록 권장: 30분 주기. exit code 1 = 즉시 알림 대상.
 */
import Database from 'better-sqlite3';
import { readdirSync, statSync } from 'fs';
import { execSync } from 'child_process';

const ROOT = 'D:/Flowvium';
const STALE_H = 11;   // 보고서 최대 허용 age (8h cadence + grace)
const VERIFY_STALE_H = 13;
const HUNG_MIN = 20;  // report-gen 최대 실행 시간

function ageHours(iso) { return (Date.now() - new Date(iso).getTime()) / 3600000; }

function checkOnce() {
  const issues = [];
  const info = [];
  const db = new Database(`${ROOT}/data/flowvium.db`, { readonly: true });

  // [1] 최신 보고서 age
  const latest = db.prepare('SELECT generated_at, session FROM reports ORDER BY generated_at DESC LIMIT 1').get();
  if (!latest) { issues.push('보고서 0건 (DB 비어있음)'); }
  else {
    const h = ageHours(latest.generated_at);
    const line = `최신 보고서 ${latest.session} ${latest.generated_at.slice(0, 16)} (${h.toFixed(1)}h 전)`;
    if (h > STALE_H) issues.push(`STALL: ${line} > ${STALE_H}h — cron 멈춤 의심`);
    else info.push(line);
  }

  // [4] Karpathy 추세 — 최근 3 vs 직전 3 환각 평균
  // 2026-06-17: harness_* (harness 가 잡은 교정 — 학습용 적재, 사각지대#5) 는 회귀추세에서 제외.
  //   추세는 *verify-escaped*(harness 도 못 잡은) 환각만 측정해야 — harness 가 잡는 건 파이프라인이 처리 중.
  const recent = db.prepare(`
    SELECT (SELECT COUNT(*) FROM hallucination_history WHERE report_id=reports.id AND defect_type NOT LIKE 'harness_%') h
    FROM reports ORDER BY generated_at DESC LIMIT 6
  `).all().map(r => r.h);
  if (recent.length >= 6) {
    // 2026-06-17 (사용자 "alert 언제 고쳐"): 평균 → 중앙값(outlier-robust). 단일 보고서가 환각 15건으로
    //   튀면(예: midnight 52w/ma_halluc 14건) 3개 평균이 5.7 로 왜곡돼 '회귀'를 3사이클 오발. '회귀'는
    //   지속적 악화여야 함 — 중앙값은 2개+ 보고서가 상승해야 움직이므로 단일 outlier 를 무시. (0,15,2)→2,
    //   (6,1,0)→1 ⇒ 무경보. 진짜 회귀(여러 건 상승)는 여전히 포착.
    const med3 = (a) => [...a].sort((x, y) => x - y)[1];
    const cur = med3(recent.slice(0, 3));
    const prev = med3(recent.slice(3, 6));
    const curMean = ((recent[0] + recent[1] + recent[2]) / 3).toFixed(1);
    const line = `Karpathy 환각 최근3 중앙값 ${cur} vs 직전3 ${prev} (평균 ${curMean})`;
    if (cur > prev + 3) issues.push(`회귀 의심: ${line} (중앙값 +${cur - prev})`);
    else info.push(line);
  }
  db.close();

  // [2] cron verify-loop 결과 age
  try {
    const vdir = `${ROOT}/reports/verify`;
    const files = readdirSync(vdir).filter(f => f.startsWith('verify-') && f.endsWith('.json'));
    if (files.length === 0) info.push('verify-loop 결과 0건');
    else {
      const newest = files.map(f => ({ f, t: statSync(`${vdir}/${f}`).mtimeMs })).sort((a, b) => b.t - a.t)[0];
      const h = (Date.now() - newest.t) / 3600000;
      if (h > VERIFY_STALE_H) issues.push(`STALL: cron verify-loop 최신 ${newest.f} (${h.toFixed(1)}h 전) > ${VERIFY_STALE_H}h`);
      else info.push(`verify-loop 최신 ${h.toFixed(1)}h 전`);
    }
  } catch { info.push('reports/verify/ 없음'); }

  // [3] hung report-gen 프로세스 (Windows)
  try {
    const out = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'node.exe\'\\" | Where-Object { $_.CommandLine -like \'*generate-report-local*\' } | Select-Object ProcessId,CreationDate | ConvertTo-Json"', { encoding: 'utf8', timeout: 15000 });
    const procs = out.trim() ? [].concat(JSON.parse(out)) : [];
    for (const p of procs) {
      // CreationDate: /Date(ms)/ 또는 WMI datetime
      const m = String(p.CreationDate).match(/\/Date\((\d+)\)\//);
      if (m) {
        const min = (Date.now() - parseInt(m[1], 10)) / 60000;
        if (min > HUNG_MIN) issues.push(`HUNG: report-gen PID ${p.ProcessId} ${min.toFixed(0)}분 실행 중 (> ${HUNG_MIN}분) — 멈춤 의심`);
        else info.push(`report-gen PID ${p.ProcessId} 실행 중 (${min.toFixed(0)}분)`);
      }
    }
    if (procs.length === 0) info.push('report-gen 실행 프로세스 없음');
  } catch { /* PowerShell 미가용 — skip */ }

  // [5] git wipe-risk — 미커밋/미푸시 코드가 cron checkout origin/master 에 wipe 될 위험.
  //     (2026-06-03 데이터손실 사건: fix 후 커밋+푸시 안 하면 다음 cron 이 silent revert.)
  try {
    const sh = (c) => { try { return execSync(c, { cwd: 'D:/Flowvium', encoding: 'utf8', stdio: ['pipe','pipe','ignore'] }).trim(); } catch { return ''; } };
    const WIPE = /^(scripts\/|src\/|public\/|messages\/|package\.json|data\/[^/]+\.json)/;
    const tracked = sh('git status --porcelain').split('\n').filter(Boolean)
      .filter(l => !l.startsWith('??') && WIPE.test(l.slice(3).replace(/^"|"$/g, '')));
    sh('git fetch --quiet origin master');
    const aheadTouch = sh('git diff --name-only origin/master..HEAD').split('\n').filter(Boolean).filter(p => WIPE.test(p));
    if (tracked.length) issues.push(`git wipe-risk — 미커밋 tracked 변경 ${tracked.length}건 (다음 cron 이 wipe): ${tracked.map(l=>l.slice(3)).slice(0,5).join(', ')} → commit+push`);
    else if (aheadTouch.length) issues.push(`git wipe-risk — 커밋했으나 미푸시(${aheadTouch.length}파일, cron 이 origin 으로 revert) → git push origin master`);
    else info.push('git wipe-risk 없음 (코드 origin/master 동기화)');
  } catch { /* git 미가용 — skip */ }

  return { issues, info };
}

function report() {
  const ts = new Date().toISOString().slice(0, 19);
  const { issues, info } = checkOnce();
  console.log(`\n[stall-check ${ts}]`);
  for (const i of info) console.log('  ✅', i);
  for (const i of issues) console.log('  🚨', i);
  console.log(issues.length === 0 ? '  → 종합: OK (stall 없음)' : `  → 종합: ${issues.length} STALL/회귀 감지`);
  return issues.length;
}

const watchArg = process.argv.find(a => a.startsWith('--watch='));
if (watchArg) {
  const sec = Math.max(60, parseInt(watchArg.split('=')[1], 10) || 300);
  console.log(`스톨 모니터 시작 — ${sec}초 주기 (Ctrl+C 종료)`);
  report();
  setInterval(report, sec * 1000);
} else {
  process.exit(report() > 0 ? 1 : 0);
}
