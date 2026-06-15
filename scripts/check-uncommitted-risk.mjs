#!/usr/bin/env node
/**
 * scripts/check-uncommitted-risk.mjs ??cron git-checkout ??wipe ???꾪뿕 肄붾뱶 媛먯?.
 *
 * 諛곌꼍(2026-06-03 ?곗씠???먯떎 ?ш굔): run-report.bat 媛 留?cron 留덈떎
 *   `git checkout origin/master -- scripts/ src/ public/ messages/ data/*.json package.json`
 *   ???ㅽ뻾 ??origin/master ???녿뒗 蹂寃?誘몄빱諛?OR 而ㅻ컠?덉?留?誘명뫖????silent ??젣.
 *   "fix ??而ㅻ컠+?몄떆" ?쇰뒗 best practice 瑜??닿꼈????洹멸구 *?ъ쟾?? ?≪븘?대뒗 寃利앹껜怨?
 *
 * 媛먯? 2醫?
 *   [1] cron-checkout 寃쎈줈??誘몄빱諛?modified/staged/untracked) 蹂寃????ㅼ쓬 cron ??wipe
 *   [2] 濡쒖뺄 HEAD 媛 origin/master 蹂대떎 ahead (而ㅻ컠?덉?留?誘명뫖?? ??cron ??origin ?쇰줈 revert
 *
 * ?ъ슜: node scripts/check-uncommitted-risk.mjs   (exit 1 = wipe ?꾪뿕 ?덉쓬)
 */
import { execSync } from 'node:child_process';

const ROOT = 'C:/Flowvium';
const sh = (cmd) => { try { return execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch (e) { return (e.stdout || '') + (e.stderr || ''); } };

// run-report.bat 媛 checkout ?섎뒗 寃쎈줈 (= wipe ???
const WIPE_GLOBS = /^(scripts\/|src\/|public\/|messages\/|package\.json|data\/[^/]+\.json)/;

const issues = [];
const info = [];

// [1] 誘몄빱諛?*tracked* 蹂寃?(cron ??git checkout origin/master ??tracked ?뚯씪留?revert).
//     untracked(??) ??checkout ??嫄대뱶由ъ? ?딆븘 ?앹〈 ??wipe ?꾪뿕 ?꾨떂(蹂꾨룄 info).
const porcelain = sh('git status --porcelain').split('\n').filter(Boolean);
const inWipePath = (line) => WIPE_GLOBS.test(line.slice(3).replace(/^"|"$/g, ''));
const trackedAtRisk = porcelain.filter(l => !l.startsWith('??') && inWipePath(l));
const untrackedInPath = porcelain.filter(l => l.startsWith('??') && inWipePath(l));

if (trackedAtRisk.length) {
  issues.push(`[1] cron-checkout 寃쎈줈??誘몄빱諛?tracked 蹂寃?${trackedAtRisk.length}嫄????ㅼ쓬 cron ??origin/master 濡?revert(wipe):`);
  trackedAtRisk.slice(0, 20).forEach(l => issues.push(`     ${l}`));
  issues.push(`     ??議곗튂: git add + commit + push origin master`);
} else {
  info.push('[1] cron-checkout 寃쎈줈 誘몄빱諛?tracked 蹂寃??놁쓬 (wipe ?꾪뿕 0)');
}
if (untrackedInPath.length) {
  info.push(`[1b] untracked ${untrackedInPath.length}嫄?(checkout 誘몃??곸씠???앹〈?섏?留?踰꾩쟾愿由?沅뚯옣): ${untrackedInPath.map(l => l.slice(3)).slice(0, 8).join(', ')}`);
}

// [2] 而ㅻ컠?덉?留?誘명뫖??(origin/master 蹂대떎 ahead)
sh('git fetch --quiet origin master');
const ahead = sh('git rev-list --count origin/master..HEAD');
if (/^\d+$/.test(ahead) && Number(ahead) > 0) {
  const commits = sh('git log --oneline origin/master..HEAD').split('\n').filter(Boolean);
  // ahead 而ㅻ컠??wipe 寃쎈줈瑜?嫄대뱶?몃뒗吏 ?뺤씤
  const touched = sh(`git diff --name-only origin/master..HEAD`).split('\n').filter(Boolean).filter(p => WIPE_GLOBS.test(p));
  if (touched.length) {
    issues.push(`[2] 濡쒖뺄??origin/master 蹂대떎 ${ahead} 而ㅻ컠 ahead ?몃뜲 cron-checkout 寃쎈줈(${touched.length}?뚯씪) ?ы븿 ??push ???섎㈃ cron ??revert:`);
    commits.slice(0, 10).forEach(c => issues.push(`     ${c}`));
    issues.push(`     ??議곗튂: git push origin master`);
  } else {
    info.push(`[2] ${ahead} 而ㅻ컠 ahead ?대굹 cron-checkout 寃쎈줈 誘명룷??(?덉쟾)`);
  }
} else {
  info.push('[2] origin/master ? ?숆린?붾맖 (ahead 0)');
}

const ts = new Date().toISOString().slice(0, 19);
console.log(`\n[uncommitted-risk ${ts}]`);
for (const i of info) console.log('  ??, i);
for (const i of issues) console.log('  ?슚', i);
console.log(issues.length === 0
  ? '  ??醫낇빀: OK (cron wipe ?꾪뿕 ?놁쓬 ??紐⑤뱺 肄붾뱶 蹂寃?而ㅻ컠+?몄떆??'
  : `  ??醫낇빀: ?좑툘 wipe ?꾪뿕 ??fix 瑜?origin/master ??而ㅻ컠+?몄떆 ?꾩슂`);
process.exit(issues.length > 0 ? 1 : 0);
