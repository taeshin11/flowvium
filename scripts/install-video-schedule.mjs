#!/usr/bin/env node
/**
 * install-video-schedule.mjs — 영상 발행을 launchd 에 건다.
 *
 * 왜 필요한가(2026-08-29): "왜 영상 안 올라왔니" 를 두 번 들었다. 답은 매번 같았다 —
 *   **자동화가 없어서** 사람이 명령을 쳐야 올라갔다. 보고서는 크론이 도는데 영상은 아니었다.
 *
 * 왜 crontab 이 아니라 launchd 인가: 이 기계의 다른 상주 작업(보고서·백업·임베딩)이
 *   전부 launchd 다. 한 곳에서 보이는 편이 낫고, 맥에서는 launchd 가 표준이다.
 *
 * 왜 하루 5번인가: 유튜브 API 할당량이 10,000/일이고 videos.insert 가 1,600 이라 6편이 상한이다.
 *   5편이면 여유가 한 편 남아 재시도가 가능하다.
 *
 * 시각은 **분까지** 받는다(8:30). 2026-09-18 실측으로 8시·13시 회차가 다른 시각의 절반도
 *   안 나온다는 게 확인돼 자리를 옮겨야 했는데, 정시만 받던 탓에 손으로 plist 를 고쳐야 했다.
 *   손으로 고치면 다음 설치가 그걸 덮어쓴다 — 받는 쪽을 고치는 게 맞다.
 *
 * 사용: node scripts/install-video-schedule.mjs [--times 10:15,11:10,...] [--format shorts]
 *       [--locale ko] [--gpu-wait 25] [--uninstall] [--dry-run]
 */
import { writeFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { ROOT } from './lib/project-root.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const LABEL = 'com.spinai.flowvium-video';
const PLIST = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const LOGDIR = join(homedir(), 'flowvium_runtime');
const LOG = join(LOGDIR, 'video.log');

// "8:30" 과 "8" 을 모두 받는다. 분을 못 받아 손으로 plist 를 고치던 것을 막는다.
// 2026-09-27 기본값을 실제 편성으로(11:10→14:10: 오전 구독 전환이 절반). 종전 기본값 6,10,14,18,22 는 옛 편성이었다.
const times = String(arg('--times', '10:15,12:10,14:10,15:10,16:20,18:20,21:45')).split(',').map((t) => {
  const [h, m = '0'] = String(t).trim().split(':');
  return { h: Number(h), m: Number(m) };
}).filter(({ h, m }) => Number.isInteger(h) && h >= 0 && h < 24 && Number.isInteger(m) && m >= 0 && m < 60);
if (!times.length) { console.error('❌ --times 가 비었다 (예: 10:15,12:10,15:10)'); process.exit(1); }

if (argv.includes('--uninstall')) {
  spawnSync('launchctl', ['bootout', `gui/${process.getuid()}/${LABEL}`], { encoding: 'utf8' });
  if (existsSync(PLIST)) unlinkSync(PLIST);
  console.log(`✅ 제거됨 — ${LABEL}`);
  process.exit(0);
}

const nodeBin = process.execPath;
const script = join(ROOT, 'scripts', 'video-publish.mjs');
const cal = times.map(({ h, m }) => `    <dict><key>Hour</key><integer>${h}</integer><key>Minute</key><integer>${m}</integer></dict>`).join('\n');
// 라이브 plist 가 쓰던 값들. 여기서 안 만들면 재설치 때 조용히 사라진다(2026-09-18 확인).
const FORMAT = arg('--format', 'shorts');
const GPU_WAIT = arg('--gpu-wait', '25');

// RunAtLoad 는 **끄다**. 설치하자마자 한 편이 올라가면 의도치 않은 발행이 된다.
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>${script}</string>
    <string>--locale</string><string>${arg('--locale', 'ko')}</string>
    <string>--format</string><string>${FORMAT}</string>
  </array>
  <key>WorkingDirectory</key><string>${ROOT}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>${homedir()}</string>
    <key>PATH</key><string>${join(homedir(), '.local/node/bin')}:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>NODE_ENV</key><string>production</string>
    <key>VIDEO_GPU_WAIT_MIN</key><string>${GPU_WAIT}</string>
  </dict>
  <key>StartCalendarInterval</key>
  <array>
${cal}
  </array>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>${LOG}</string>
  <key>StandardErrorPath</key><string>${LOG}</string>
</dict>
</plist>
`;

if (argv.includes('--dry-run')) { console.log(plist); process.exit(0); }

mkdirSync(LOGDIR, { recursive: true });
mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
writeFileSync(PLIST, plist);
spawnSync('launchctl', ['bootout', `gui/${process.getuid()}/${LABEL}`], { encoding: 'utf8' });  // 있으면 내린다
const r = spawnSync('launchctl', ['bootstrap', `gui/${process.getuid()}`, PLIST], { encoding: 'utf8' });
if (r.status !== 0) {
  console.error(`❌ launchctl bootstrap 실패: ${String(r.stderr).trim().slice(0, 200)}`);
  process.exit(1);
}
console.log(`✅ 설치됨 — ${LABEL}`);
console.log(`   시각: ${times.map(({ h, m }) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`).join(', ')} (기계 로컬시각)`);
console.log(`   로그: ${LOG}`);
console.log('   ⚠ 설치만으로는 발행하지 않는다(RunAtLoad 꺼짐). 다음 예정 시각부터 돈다.');
console.log(`   지금 한 번 돌리려면: launchctl kickstart gui/${process.getuid()}/${LABEL}`);
