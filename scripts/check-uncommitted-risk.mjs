#!/usr/bin/env node
/**
 * scripts/check-uncommitted-risk.mjs — cron git-checkout 에 wipe 될 위험 코드 감지.
 *
 * 배경(2026-06-03 데이터 손실 사건): run-report.bat 가 매 cron 마다
 *   `git checkout origin/master -- scripts/ src/ public/ messages/ data/*.json package.json`
 *   을 실행 → origin/master 에 없는 변경(미커밋 OR 커밋했지만 미푸시)을 silent 삭제.
 *   "fix 후 커밋+푸시" 라는 best practice 를 어겼을 때 그걸 *사전에* 잡아내는 검증체계.
 *
 * 감지 2종:
 *   [1] cron-checkout 경로의 미커밋(modified/staged/untracked) 변경 → 다음 cron 이 wipe
 *   [2] 로컬 HEAD 가 origin/master 보다 ahead (커밋했지만 미푸시) → cron 이 origin 으로 revert
 *
 * 사용: node scripts/check-uncommitted-risk.mjs   (exit 1 = wipe 위험 있음)
 */
import { execSync } from 'node:child_process';
import { ROOT as _PROJECT_ROOT } from './lib/project-root.mjs';
// 2026-08-21: 이 스크립트는 "다음 cron 이 wipe 한다" 를 *무조건* 단정했다. 그 checkout 은
//   윈도우용 run-report.bat 에만 있고, 이 맥의 launchd 는 git 명령이 없는 run-report.sh 를 부른다
//   (run-report.sh:60 이 "옮기지 않았다" 고 명시). 같은 판정을 하는 check-stall.mjs 는
//   2026-08-20 에 launcherWipesWorktree() 로 고쳐졌는데 여기만 남아 있었다 — 한쪽만 고친 것이다.
//   틀린 메커니즘은 (a) 사람을 엉뚱한 조치로 보내고 (b) 매번 헛경보라 진짜 경고까지 무디게 만든다.
//   커밋 권고 자체는 유지한다. 이유를 사실대로 말할 뿐이다.
import { launcherWipesWorktree, launcherPath } from './lib/report-launcher.mjs';

const ROOT = _PROJECT_ROOT;
// 2026-06-17: timeout 추가 — git fetch 가 네트워크 stall 시 무한 hang 하던 위험 차단.
const sh = (cmd, timeout = 0) => { try { return execSync(cmd, { cwd: ROOT, encoding: 'utf8', ...(timeout ? { timeout } : {}) }).trim(); } catch (e) { return (e.stdout || '') + (e.stderr || ''); } };

// run-report.bat 가 checkout 하는 경로 (= wipe 대상)
const WIPE_GLOBS = /^(scripts\/|src\/|public\/|messages\/|package\.json|data\/[^/]+\.json)/;

const issues = [];
const info = [];
const WIPES = launcherWipesWorktree();
const HOW   = WIPES ? '다음 cron 이 origin/master 로 revert(wipe)' : '이 플랫폼 런처는 되돌리지 않는다 — 유실 위험은 미백업뿐';
const TAG   = WIPES ? 'wipe 위험' : '미동기화';
info.push(`[0] 실행 런처 ${launcherPath() ?? '(미검출)'} · worktree 되돌림=${WIPES}`);

// [1] 미커밋 *tracked* 변경 (cron 의 git checkout origin/master 는 tracked 파일만 revert).
//     untracked(??) 는 checkout 이 건드리지 않아 생존 → wipe 위험 아님(별도 info).
const porcelain = sh('git status --porcelain').split('\n').filter(Boolean);
const inWipePath = (line) => WIPE_GLOBS.test(line.slice(3).replace(/^"|"$/g, ''));
const trackedAtRisk = porcelain.filter(l => !l.startsWith('??') && inWipePath(l));
const untrackedInPath = porcelain.filter(l => l.startsWith('??') && inWipePath(l));

if (trackedAtRisk.length) {
  issues.push(`[1] 코드 경로에 미커밋 tracked 변경 ${trackedAtRisk.length}건 — ${HOW}:`);
  trackedAtRisk.slice(0, 20).forEach(l => issues.push(`     ${l}`));
  issues.push(`     → 조치: git add + commit + push origin master`);
} else {
  info.push('[1] cron-checkout 경로 미커밋 tracked 변경 없음 (wipe 위험 0)');
}
if (untrackedInPath.length) {
  info.push(`[1b] untracked ${untrackedInPath.length}건 (checkout 미대상이라 생존하지만 버전관리 권장): ${untrackedInPath.map(l => l.slice(3)).slice(0, 8).join(', ')}`);
}

// [2] 커밋했지만 미푸시 (origin/master 보다 ahead)
sh('git fetch --quiet origin master', 20000);
const ahead = sh('git rev-list --count origin/master..HEAD');
if (/^\d+$/.test(ahead) && Number(ahead) > 0) {
  const commits = sh('git log --oneline origin/master..HEAD').split('\n').filter(Boolean);
  // ahead 커밋이 wipe 경로를 건드렸는지 확인
  const touched = sh(`git diff --name-only origin/master..HEAD`).split('\n').filter(Boolean).filter(p => WIPE_GLOBS.test(p));
  if (touched.length) {
    issues.push(`[2] 로컬이 origin/master 보다 ${ahead} 커밋 ahead · 코드 경로 ${touched.length}파일 포함 — ${HOW}:`);
    commits.slice(0, 10).forEach(c => issues.push(`     ${c}`));
    issues.push(`     → 조치: git push origin master`);
  } else {
    info.push(`[2] ${ahead} 커밋 ahead 이나 cron-checkout 경로 미포함 (안전)`);
  }
} else {
  info.push('[2] origin/master 와 동기화됨 (ahead 0)');
}

const ts = new Date().toISOString().slice(0, 19);
console.log(`\n[uncommitted-risk ${ts}]`);
for (const i of info) console.log('  ✅', i);
for (const i of issues) console.log('  🚨', i);
console.log(issues.length === 0
  ? '  → 종합: OK (모든 코드 변경 커밋+푸시됨)'
  : `  → 종합: ⚠️ ${TAG} — fix 를 origin/master 에 커밋+푸시 필요`);
process.exit(issues.length > 0 ? 1 : 0);
