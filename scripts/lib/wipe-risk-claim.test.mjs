#!/usr/bin/env node
/**
 * wipe-risk-claim.test.mjs — "wipe 위험"을 주장하는 곳은 전부 *실제 런처를 읽고* 말해야 한다.
 *
 * 배경: 2026-06-03 데이터 손실은 run-report.bat 의
 *   `git checkout origin/master -- scripts/ src/ ...` 때문이었다. 그래서 검증 스크립트들이
 *   "다음 cron 이 wipe 한다" 고 경고한다.
 *
 *   그런데 맥 이관 후 launchd 가 부르는 run-report.sh 에는 그 checkout 이 없다(주석에
 *   "옮기지 않았다" 고 명시). 즉 이 플랫폼에서 wipe 는 일어나지 않는다.
 *   2026-08-20 에 report-launcher.launcherWipesWorktree() 를 만들어 check-stall.mjs 는
 *   고쳤는데, 같은 판정을 하는 check-uncommitted-risk.mjs 는 그대로 남았다.
 *
 *   틀린 메커니즘을 단정하는 경고는 두 가지로 해롭다 —
 *   (a) 사람을 엉뚱한 조치로 보내고 (b) 매번 헛경보라 진짜 경고까지 무시하게 만든다.
 *   커밋을 권하는 것 자체는 옳다. 이유를 사실대로 말하라는 것이다.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

// wipe 를 단정하는 문구를 가진 스크립트는 런처 판정을 반드시 참조해야 한다
const CLAIMERS = ['scripts/check-stall.mjs', 'scripts/check-uncommitted-risk.mjs'];
for (const f of CLAIMERS) {
  const src = readFileSync(resolve(ROOT, f), 'utf8');
  const claimsWipe = /wipe|revert\(wipe\)|되돌린다/.test(src);
  if (!claimsWipe) { ok(`${f} — wipe 를 주장하지 않음`); continue; }
  if (/launcherWipesWorktree/.test(src)) ok(`${f} — 런처를 읽고 판정한다`);
  else bad(`${f} — 런처를 안 읽고 wipe 를 단정한다 (이 플랫폼 런처엔 checkout 이 없다)`);
}

// 사실 확인: 실제 런처가 정말 wipe 를 안 하는가 (테스트의 전제가 참인지 스스로 검사)
const { launcherWipesWorktree, launcherPath } = await import('./report-launcher.mjs');
const p = launcherPath();
const w = launcherWipesWorktree();
console.log(`\n  이 플랫폼 런처: ${p ?? '(미검출)'} · worktree 되돌림=${w}`);
if (p && !w) ok('전제 확인 — 현재 런처는 작업트리를 되돌리지 않는다');
else if (w) ok('현재 런처는 실제로 되돌린다 — 그렇다면 wipe 경고가 옳다');
else bad('런처를 못 찾았다 — 판정 근거가 없다');

console.log(fail === 0 ? '\n✅ wipe-risk-claim 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
