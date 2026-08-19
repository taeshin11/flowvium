#!/usr/bin/env node
/**
 * install-report-schedule.mjs — data/report-sessions.json 에서 launchd 스케줄을 생성한다.
 *
 * 시각을 코드에 박지 않는다. 트리거시각 = publishKst − leadMinutes 이고 둘 다 JSON 이 쥔다.
 * 리드타임을 바꾸고 싶으면 JSON 의 leadMinutes 만 고치고 이 스크립트를 다시 돌리면 된다.
 *
 * 전제: 이 기계의 시간대가 KST 여야 한다(launchd StartCalendarInterval 은 로컬시각 기준).
 *       KST 가 아니면 중단한다 — 조용히 어긋난 시각으로 등록하면 발간을 통째로 놓친다.
 *
 * 사용: node scripts/install-report-schedule.mjs [--dry-run] [--uninstall]
 */
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import * as S from './lib/report-sessions.mjs';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOME = process.env.HOME;
const AGENTS = resolve(HOME, 'Library/LaunchAgents');
const LABEL = (id) => `com.spinai.flowvium-report-${id}`;
const dry = process.argv.includes('--dry-run');
const uninstall = process.argv.includes('--uninstall');

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const offsetMin = -new Date().getTimezoneOffset();
if (offsetMin !== 540) {
  console.error(`중단: 이 기계의 UTC 오프셋이 ${offsetMin}분이다. KST(+540) 가 아니면 트리거 시각이 어긋난다.`);
  console.error(`      시간대=${tz}. 시간대를 KST 로 맞추거나, JSON 의 시각을 로컬 기준으로 다시 정의하라.`);
  process.exit(2);
}

const NODE = process.execPath;
const uid = process.getuid();
mkdirSync(AGENTS, { recursive: true });

for (const id of S.sessionIds()) {
  const label = LABEL(id);
  const plistPath = resolve(AGENTS, `${label}.plist`);
  if (uninstall) {
    try { execFileSync('launchctl', ['bootout', `gui/${uid}/${label}`], { stdio: 'ignore' }); } catch {}
    if (existsSync(plistPath)) unlinkSync(plistPath);
    console.log(`  제거 ${label}`);
    continue;
  }
  const [hh, mm] = S.getTriggerKst(id).split(':').map(Number);
  const cfg = S.getSessionConfig(id);
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${APP}/scripts/run-report.sh</string>
    <string>--session=${id}</string>
    <string>--locale=ko</string>
    <string>--auto-upload</string>
  </array>
  <key>WorkingDirectory</key><string>${APP}</string>
  <key>EnvironmentVariables</key><dict>
    <key>HOME</key><string>${HOME}</string>
    <key>NODE_BIN</key><string>${NODE}</string>
    <key>PATH</key><string>${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StartCalendarInterval</key><dict>
    <key>Hour</key><integer>${hh}</integer>
    <key>Minute</key><integer>${mm}</integer>
  </dict>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>${APP}/logs/report-${id}.log</string>
  <key>StandardErrorPath</key><string>${APP}/logs/report-${id}.log</string>
</dict></plist>
`;
  console.log(`  ${id.padEnd(9)} 트리거 ${S.getTriggerKst(id)} KST → 발간 ${cfg.publishKst} (lead ${cfg.leadMinutes}분)`);
  if (dry) continue;
  writeFileSync(plistPath, plist);
  try { execFileSync('launchctl', ['bootout', `gui/${uid}/${label}`], { stdio: 'ignore' }); } catch {}
  execFileSync('launchctl', ['bootstrap', `gui/${uid}`, plistPath]);
}
if (!dry && !uninstall) console.log('\n등록 완료. 확인: launchctl print gui/$(id -u)/com.spinai.flowvium-report-morning');
