/**
 * platform-ops.mjs — OS 종속 작업의 플랫폼 중립 래퍼.
 *
 * 배경(2026-08-20): 윈도우→맥 이식이 launchd 진입점만 run-report.sh 로 바꾸고 하위 코드는
 *   그대로 뒀다. 실행 경로에 남은 윈도우 전용 원시 7군데가 전부 try/catch 안에서 조용히
 *   실패하고 있었다 — 모니터는 "dart-corpcodes 537h 미실행" 같은 *결과*만 보고 원인을 못 짚었다.
 *
 *   호출부마다 process.platform 분기를 심으면 다음 이식에서 또 샌다. OS 를 아는 곳은 여기뿐이다.
 *   각 함수는 예외를 던지지 않고 실패를 값으로 돌려준다 — 호출부가 catch 로 삼키면
 *   같은 무증상 실패가 반복되기 때문이다.
 */
import { existsSync, openSync, readSync, closeSync, fstatSync } from 'fs';
import { spawnSync } from 'child_process';

const WIN = process.platform === 'win32';

/** ZIP 해제. { ok, error } 를 돌려준다. 성공 판정은 호출부가 산출물 존재로 다시 확인할 것. */
export function unzip(zipPath, destDir) {
  if (!existsSync(zipPath)) return { ok: false, error: `zip 없음: ${zipPath}` };
  const r = WIN
    ? spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
        `Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force`], { encoding: 'utf8' })
    : spawnSync('unzip', ['-o', '-q', zipPath, '-d', destDir], { encoding: 'utf8' });
  if (r.error) return { ok: false, error: `${WIN ? 'Expand-Archive' : 'unzip'} 실행 불가: ${r.error.message}` };
  if (r.status !== 0) return { ok: false, error: `종료코드 ${r.status}: ${(r.stderr || '').trim().slice(0, 200)}` };
  return { ok: true };
}

/**
 * 파일 마지막 n줄. 없는 파일/읽기 실패는 빈 문자열.
 * 외부 프로세스를 쓰지 않는다 — tail/Get-Content 둘 다 플랫폼마다 인자가 달라 이식 때 또 샌다.
 */
export function readTail(path, n = 80, maxBytes = 4 * 1024 * 1024) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    const len = Math.min(size, maxBytes);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n');
    if (lines.at(-1) === '') lines.pop();
    return lines.slice(-n).join('\n');
  } catch { return ''; }
  finally { if (fd !== undefined) try { closeSync(fd); } catch {} }
}

/**
 * 명령줄에 pattern 을 포함하는 프로세스들. [{ pid, ageSec, command }].
 * ageSec 은 hung 판정에 필요하다 — 존재 여부만으로는 멈춘 프로세스를 못 가린다.
 */
/**
 * 명령줄이 pattern(문자열 부분매칭 또는 정규식)에 맞는 프로세스 목록.
 * 기본으로 자기 자신과 부모는 제외한다 — 모니터가 자기 명령줄에 걸려 유령을 세는 사고가 실제로 났다.
 * 함수 자체를 스모크 테스트할 때만 opts.includeSelf 로 켠다.
 */
export function findProcesses(pattern, opts = {}) {
  const out = [];
  if (WIN) {
    const r = spawnSync('powershell', ['-NoProfile', '-Command',
      `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${pattern}*' } | ` +
      `ForEach-Object { '{0}|{1}|{2}' -f $_.ProcessId, [int]((Get-Date) - $_.CreationDate).TotalSeconds, $_.CommandLine }`],
      { encoding: 'utf8', timeout: 15000 });
    for (const l of (r.stdout || '').split('\n')) {
      const [pid, age, ...rest] = l.trim().split('|');
      if (pid && /^\d+$/.test(pid)) out.push({ pid: +pid, ageSec: +age || 0, command: rest.join('|') });
    }
    return out;
  }
  // ps 의 etime 은 [[dd-]hh:]mm:ss — 초로 환산한다.
  const r = spawnSync('ps', ['-axo', 'pid=,etime=,command='], { encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
  for (const line of (r.stdout || '').split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const [, pid, etime, command] = m;
    // 2026-08-21: pattern 은 문자열 또는 정규식. 문자열 부분매칭만 되던 탓에 명령줄에 이름이
    //   *스치기만* 한 프로세스가 잡혔다(실측: 내 백그라운드 대기 셸이 'report-gen 2번째'로 집계됨).
    if (pattern instanceof RegExp ? !pattern.test(command) : !command.includes(pattern)) continue;
    // 자기 자신과 부모는 세지 않는다. 종전 코드
    //     if (+pid === process.pid && !command.includes(pattern)) continue;
    //   는 앞 줄이 이미 includes 를 요구하므로 절대 참이 될 수 없는 죽은 가드였다.
    if (!opts.includeSelf && (+pid === process.pid || +pid === process.ppid)) continue;
    const dm = etime.match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
    const ageSec = dm ? (+(dm[1] || 0) * 86400) + (+(dm[2] || 0) * 3600) + (+dm[3] * 60) + +dm[4] : 0;
    out.push({ pid: +pid, ageSec, command });
  }
  return out;
}
