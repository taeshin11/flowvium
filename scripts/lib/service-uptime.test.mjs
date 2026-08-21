#!/usr/bin/env node
/**
 * service-uptime.test.mjs — "이 URL 을 서빙하는 프로세스가 언제 떴는가".
 *
 * 배경: cron-runner 의 auto-monitor 에는 "배포 재시작 직후 엔드포인트 프로브 skip" 가드가 있다
 *   (2026-06-12 사건: 배포 순간 모니터가 닿아 14 엔드포인트 DEAD 대량 오탐).
 *   그 가드는 uptime 을 `pm2 jlist` 로 얻는다. 그런데 이 맥에서 웹은 launchd 가 띄우고
 *   pm2 는 설치조차 안 되어 있다. 그래서 20분마다 이 로그만 찍힌다:
 *       [auto-monitor] pm2 uptime 조회 실패(가드 미적용): Command failed: pm2 jlist
 *   즉 가드가 한 번도 발동한 적이 없다. 오탐 방지 장치가 조용히 꺼져 있었던 것이다.
 *
 * 서비스 이름(pm2 name / launchd label)을 박지 않는다 — 그건 다음 이식에서 또 어긋난다.
 * 모니터가 *실제로 찌르는 포트* 의 리스닝 프로세스에서 uptime 을 읽는다. 대상과 측정이 같아진다.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

let M = null;
try { M = await import('./service-uptime.mjs'); }
catch (e) { bad(`scripts/lib/service-uptime.mjs 없음 — ${e.message}`); }

if (M) {
  // etime 파싱 — ps 는 MM:SS / HH:MM:SS / D-HH:MM:SS 세 형태를 쓴다
  const cases = [['05:30', 330_000], ['01:16:51', 4611_000], ['2-03:04:05', 183845_000], ['00:00', 0]];
  let pOk = true;
  for (const [s, want] of cases) {
    const got = M.parseEtime(s);
    if (got !== want) { bad(`parseEtime('${s}') = ${got}, 기대 ${want}`); pOk = false; }
  }
  if (pOk) ok('etime 3형식(MM:SS · HH:MM:SS · D-HH:MM:SS) 파싱 정확');
  M.parseEtime('쓰레기') === null ? ok('파싱 불가 입력에 null') : bad('쓰레기 입력에 숫자 반환');

  // 실제 포트 — 웹이 떠 있으면 값이 나와야 한다
  const up = await M.listenerUptimeMs(3000);
  if (up == null) bad(':3000 리스너 uptime 을 못 읽었다 (웹이 떠 있는데 null 이면 구현 문제)');
  else ok(`:3000 리스너 uptime = ${(up / 1000 / 60).toFixed(1)}분`);

  const none = await M.listenerUptimeMs(59999);
  none === null ? ok('아무도 안 듣는 포트는 null (예외 아님)') : bad(`빈 포트인데 ${none}`);
}

console.log('\n소비처가 pm2 대신 이것을 쓰는가');
const src = readFileSync(resolve(ROOT, 'scripts/cron-runner.mjs'), 'utf8');
/execFileAsync\(\s*'pm2'/.test(src)
  ? bad('cron-runner 가 여전히 pm2 를 부른다 — 이 기기엔 없어서 가드가 영영 안 걸린다')
  : ok('cron-runner 가 pm2 를 부르지 않는다');
/service-uptime\.mjs/.test(src)
  ? ok('cron-runner 가 포트 기반 uptime 을 쓴다')
  : bad('cron-runner 가 uptime 소스를 안 바꿨다');

console.log(fail === 0 ? '\n✅ service-uptime 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
