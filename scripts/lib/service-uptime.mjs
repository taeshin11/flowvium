/**
 * service-uptime.mjs — "이 포트를 서빙하는 프로세스가 얼마나 오래 떠 있는가".
 *
 * 왜 포트 기준인가: cron-runner 의 배포창 가드는 웹 uptime 을 `pm2 jlist` 로 얻었다.
 *   이 기기의 웹은 launchd 가 띄우고 pm2 는 설치조차 안 되어 있어, 20분마다
 *   "pm2 uptime 조회 실패(가드 미적용)" 만 찍히고 가드는 한 번도 발동하지 않았다.
 *   프로세스 매니저 이름(pm2 name / launchd label)을 박으면 다음 이식에서 또 어긋난다.
 *   모니터가 *실제로 찌르는 포트* 를 기준으로 삼으면 측정 대상과 측정 방법이 같아진다.
 */
import { execFile } from 'child_process';

const run = (cmd, args) => new Promise((res) => {
  execFile(cmd, args, { timeout: 5000 }, (err, stdout) => res(err ? null : String(stdout)));
});

/**
 * ps 의 ELAPSED 표기를 ms 로. 형식 세 가지: MM:SS · HH:MM:SS · D-HH:MM:SS
 * @returns {number|null} 파싱 실패 시 null — 모르는 값을 0 으로 만들지 않는다(0 은 '방금 떴다'는 뜻이 된다).
 */
export function parseEtime(s) {
  const t = String(s ?? '').trim();
  const m = t.match(/^(?:(\d+)-)?(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [, d, h, mi, sec] = m;
  return ((Number(d ?? 0) * 24 + Number(h ?? 0)) * 3600 + Number(mi) * 60 + Number(sec)) * 1000;
}

/**
 * 해당 포트를 LISTEN 중인 프로세스의 가동시간(ms). 아무도 안 듣거나 조회 실패면 null.
 * null 은 '모른다' 다 — 호출부는 가드를 적용하지 않는 쪽(기존 동작)으로 처리하면 된다.
 */
export async function listenerUptimeMs(port) {
  const out = await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']);
  const pid = String(out ?? '').split('\n').map((s) => s.trim()).filter(Boolean)[0];
  if (!pid) return null;
  const et = await run('ps', ['-p', pid, '-o', 'etime=']);
  return et == null ? null : parseEtime(et);
}
