/**
 * ffmpeg-timeout.mjs — ffmpeg 호출에 상한을 준다.
 *
 * 왜 (2026-09-11): 배경음악 믹싱 ffmpeg 이 12시간 18분째 멈춰 있었다. CPU 0% · RSS 0GB —
 *   일하는 게 아니라 읽기에서 막혀 있었다. 입력이 구글드라이브(CloudStorage) 경로였고,
 *   드라이브 파일이 로컬에 없거나 네트워크가 막히면 read 가 무한정 걸린다.
 *   그 위로 make-shorts → video-publish → video-backfill 이 통째로 물려 좀비 4개가 됐다.
 *   make-shorts 의 ffmpeg 호출 4곳에 타임아웃이 하나도 없었다.
 *
 * 렌더는 길어야 몇 분이다. 그보다 오래 걸리면 끝난 게 아니라 막힌 것이다 —
 *   끊고 실패로 처리해야 다음 회차가 산다. 12시간을 기다리면 그날이 통째로 죽는다.
 */

/** 정상 렌더를 끊지 않을 만큼 넉넉하되, 막힌 것을 하루 종일 두지 않을 만큼 짧게. */
export const FFMPEG_TIMEOUT_MS = Number(process.env.FFMPEG_TIMEOUT_MS || 10 * 60_000);

/** spawnSync 옵션에 타임아웃을 얹는다. 호출부가 준 값은 건드리지 않는다. */
export function ffmpegOpts(opts = {}) {
  return {
    ...opts,
    timeout: opts.timeout ?? FFMPEG_TIMEOUT_MS,
    // SIGTERM 을 무시하고 버티는 경우가 있다 — 막힌 프로세스는 확실히 끊는다.
    killSignal: opts.killSignal ?? 'SIGKILL',
  };
}

/** 실패 사유를 사람 말로. 성공이면 null — "시간 초과" 와 "입력이 깨졌다" 는 조치가 다르다. */
export function describeFfmpegResult(r) {
  if (!r) return 'ffmpeg 결과가 없다';
  if (r.status === 0) return null;
  if (r.error?.code === 'ETIMEDOUT' || (r.status === null && r.signal)) {
    return `시간 초과로 끊었다(${Math.round(FFMPEG_TIMEOUT_MS / 60000)}분) — `
      + '입력이 구글드라이브에 있으면 로컬에 내려받히지 않아 읽기가 막힐 수 있다';
  }
  return String(r.stderr ?? '').slice(0, 200) || `종료코드 ${r.status}`;
}
