#!/usr/bin/env node
/**
 * scripts/check-stall.mjs ???ㅽ넧 媛먯? 紐⑤땲??
 *
 * ?뚯씠?꾨씪?몄씠 "硫덉땄"(stall) ?곹깭?몄? 二쇨린?곸쑝濡?媛먯?. cron/verify 媛 alive ?щ룄
 * 寃곌낵媛 媛깆떊 ???섎뒗 silent stall ???〓뒗?? (CLAUDE.md 寃利??ш컖吏? 泥좏븰)
 *
 * 媛먯? ??ぉ:
 *   [1] 理쒖떊 蹂닿퀬??age ???뺢퇋 cron 3??????h). > STALE_H ?쒓컙?대㈃ STALL.
 *   [2] 理쒖떊 cron verify-loop 寃곌낵 age (reports/verify/) ??蹂닿퀬?????먮룞 verify 誘몃룞??媛먯?.
 *   [3] hung report-gen ?꾨줈?몄뒪 ??generate-report-local 媛 HUNG_MIN 遺??섍쾶 ?ㅽ뻾 = 硫덉땄 ?섏떖.
 *   [4] Karpathy ?숈뒿 異붿꽭 ??理쒓렐 3 蹂닿퀬???섍컖 ?됯퇏??吏곸쟾 3 ?鍮?湲됱쬆(stall/?뚭?) ??寃쎄퀬.
 *
 * ?ъ슜: node scripts/check-stall.mjs            # 1???먭? (exit 1 = STALL ?덉쓬)
 *       node scripts/check-stall.mjs --watch=300 # 300珥?二쇨린 諛섎났 (Ctrl+C 醫낅즺)
 *
 * cron/紐⑤땲???깅줉 沅뚯옣: 30遺?二쇨린. exit code 1 = 利됱떆 ?뚮┝ ???
 */
import Database from 'better-sqlite3';
import { readdirSync, statSync } from 'fs';
import { execSync } from 'child_process';

const ROOT = 'C:/Flowvium';
const STALE_H = 11;   // 蹂닿퀬??理쒕? ?덉슜 age (8h cadence + grace)
const VERIFY_STALE_H = 13;
const HUNG_MIN = 20;  // report-gen 理쒕? ?ㅽ뻾 ?쒓컙

function ageHours(iso) { return (Date.now() - new Date(iso).getTime()) / 3600000; }

function checkOnce() {
  const issues = [];
  const info = [];
  const db = new Database(`${ROOT}/data/flowvium.db`, { readonly: true });

  // [1] 理쒖떊 蹂닿퀬??age
  const latest = db.prepare('SELECT generated_at, session FROM reports ORDER BY generated_at DESC LIMIT 1').get();
  if (!latest) { issues.push('蹂닿퀬??0嫄?(DB 鍮꾩뼱?덉쓬)'); }
  else {
    const h = ageHours(latest.generated_at);
    const line = `理쒖떊 蹂닿퀬??${latest.session} ${latest.generated_at.slice(0, 16)} (${h.toFixed(1)}h ??`;
    if (h > STALE_H) issues.push(`STALL: ${line} > ${STALE_H}h ??cron 硫덉땄 ?섏떖`);
    else info.push(line);
  }

  // [4] Karpathy 異붿꽭 ??理쒓렐 3 vs 吏곸쟾 3 ?섍컖 ?됯퇏
  const recent = db.prepare(`
    SELECT (SELECT COUNT(*) FROM hallucination_history WHERE report_id=reports.id) h
    FROM reports ORDER BY generated_at DESC LIMIT 6
  `).all().map(r => r.h);
  if (recent.length >= 6) {
    const cur = (recent[0] + recent[1] + recent[2]) / 3;
    const prev = (recent[3] + recent[4] + recent[5]) / 3;
    const line = `Karpathy ?섍컖 理쒓렐3 ?됯퇏 ${cur.toFixed(1)} vs 吏곸쟾3 ${prev.toFixed(1)}`;
    if (cur > prev + 3) issues.push(`?뚭? ?섏떖: ${line} (+${(cur - prev).toFixed(1)})`);
    else info.push(line);
  }
  db.close();

  // [2] cron verify-loop 寃곌낵 age
  try {
    const vdir = `${ROOT}/reports/verify`;
    const files = readdirSync(vdir).filter(f => f.startsWith('verify-') && f.endsWith('.json'));
    if (files.length === 0) info.push('verify-loop 寃곌낵 0嫄?);
    else {
      const newest = files.map(f => ({ f, t: statSync(`${vdir}/${f}`).mtimeMs })).sort((a, b) => b.t - a.t)[0];
      const h = (Date.now() - newest.t) / 3600000;
      if (h > VERIFY_STALE_H) issues.push(`STALL: cron verify-loop 理쒖떊 ${newest.f} (${h.toFixed(1)}h ?? > ${VERIFY_STALE_H}h`);
      else info.push(`verify-loop 理쒖떊 ${h.toFixed(1)}h ??);
    }
  } catch { info.push('reports/verify/ ?놁쓬'); }

  // [3] hung report-gen ?꾨줈?몄뒪 (Windows)
  try {
    const out = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'node.exe\'\\" | Where-Object { $_.CommandLine -like \'*generate-report-local*\' } | Select-Object ProcessId,CreationDate | ConvertTo-Json"', { encoding: 'utf8', timeout: 15000 });
    const procs = out.trim() ? [].concat(JSON.parse(out)) : [];
    for (const p of procs) {
      // CreationDate: /Date(ms)/ ?먮뒗 WMI datetime
      const m = String(p.CreationDate).match(/\/Date\((\d+)\)\//);
      if (m) {
        const min = (Date.now() - parseInt(m[1], 10)) / 60000;
        if (min > HUNG_MIN) issues.push(`HUNG: report-gen PID ${p.ProcessId} ${min.toFixed(0)}遺??ㅽ뻾 以?(> ${HUNG_MIN}遺? ??硫덉땄 ?섏떖`);
        else info.push(`report-gen PID ${p.ProcessId} ?ㅽ뻾 以?(${min.toFixed(0)}遺?`);
      }
    }
    if (procs.length === 0) info.push('report-gen ?ㅽ뻾 ?꾨줈?몄뒪 ?놁쓬');
  } catch { /* PowerShell 誘멸?????skip */ }

  // [5] git wipe-risk ??誘몄빱諛?誘명뫖??肄붾뱶媛 cron checkout origin/master ??wipe ???꾪뿕.
  //     (2026-06-03 ?곗씠?곗넀???ш굔: fix ??而ㅻ컠+?몄떆 ???섎㈃ ?ㅼ쓬 cron ??silent revert.)
  try {
    const sh = (c) => { try { return execSync(c, { cwd: 'C:/Flowvium', encoding: 'utf8', stdio: ['pipe','pipe','ignore'] }).trim(); } catch { return ''; } };
    const WIPE = /^(scripts\/|src\/|public\/|messages\/|package\.json|data\/[^/]+\.json)/;
    const tracked = sh('git status --porcelain').split('\n').filter(Boolean)
      .filter(l => !l.startsWith('??') && WIPE.test(l.slice(3).replace(/^"|"$/g, '')));
    sh('git fetch --quiet origin master');
    const aheadTouch = sh('git diff --name-only origin/master..HEAD').split('\n').filter(Boolean).filter(p => WIPE.test(p));
    if (tracked.length) issues.push(`git wipe-risk ??誘몄빱諛?tracked 蹂寃?${tracked.length}嫄?(?ㅼ쓬 cron ??wipe): ${tracked.map(l=>l.slice(3)).slice(0,5).join(', ')} ??commit+push`);
    else if (aheadTouch.length) issues.push(`git wipe-risk ??而ㅻ컠?덉쑝??誘명뫖??${aheadTouch.length}?뚯씪, cron ??origin ?쇰줈 revert) ??git push origin master`);
    else info.push('git wipe-risk ?놁쓬 (肄붾뱶 origin/master ?숆린??');
  } catch { /* git 誘멸?????skip */ }

  return { issues, info };
}

function report() {
  const ts = new Date().toISOString().slice(0, 19);
  const { issues, info } = checkOnce();
  console.log(`\n[stall-check ${ts}]`);
  for (const i of info) console.log('  ??, i);
  for (const i of issues) console.log('  ?슚', i);
  console.log(issues.length === 0 ? '  ??醫낇빀: OK (stall ?놁쓬)' : `  ??醫낇빀: ${issues.length} STALL/?뚭? 媛먯?`);
  return issues.length;
}

const watchArg = process.argv.find(a => a.startsWith('--watch='));
if (watchArg) {
  const sec = Math.max(60, parseInt(watchArg.split('=')[1], 10) || 300);
  console.log(`?ㅽ넧 紐⑤땲???쒖옉 ??${sec}珥?二쇨린 (Ctrl+C 醫낅즺)`);
  report();
  setInterval(report, sec * 1000);
} else {
  process.exit(report() > 0 ? 1 : 0);
}
