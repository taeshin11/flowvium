/**
 * ffmpeg-timeout.test.mjs — ffmpeg 이 영원히 멈춰 있지 못하게 한다.
 *
 * 왜 (2026-09-11): 09:19 회차의 배경음악 믹싱 ffmpeg 이 **12시간 18분**째 멈춰 있었다.
 *   CPU 0% · RSS 0GB — 일하는 게 아니라 읽기에서 막혀 있었다.
 *   입력이 구글드라이브 경로였다:
 *     -i .../GoogleDrive-spinaiceo@gmail.com/내 드라이브/FlowVium-media/shorts-ko.mp4
 *   드라이브 파일이 로컬에 없거나 네트워크가 막히면 read 가 무한정 걸린다.
 *   그 위로 make-shorts → video-publish → video-backfill 이 통째로 물려 좀비 4개가 됐다.
 *
 *   make-shorts 의 ffmpeg 호출 4곳에 **타임아웃이 하나도 없었다.**
 *   렌더는 길어야 몇 분이다 — 그보다 오래 걸리면 끝난 게 아니라 막힌 것이다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FFMPEG_TIMEOUT_MS, ffmpegOpts, describeFfmpegResult } from './ffmpeg-timeout.mjs';

test('상한은 넉넉하되 무한은 아니다', () => {
  assert.ok(FFMPEG_TIMEOUT_MS >= 5 * 60_000, '정상 렌더를 끊으면 안 된다');
  assert.ok(FFMPEG_TIMEOUT_MS <= 20 * 60_000, '12시간을 기다리는 일이 다시 있으면 안 된다');
});

test('기존 옵션을 지우지 않고 타임아웃만 얹는다', () => {
  const o = ffmpegOpts({ stdio: ['ignore', 'ignore', 'pipe'] });
  assert.deepEqual(o.stdio, ['ignore', 'ignore', 'pipe']);
  assert.equal(o.timeout, FFMPEG_TIMEOUT_MS);
  assert.equal(o.killSignal, 'SIGKILL');   // SIGTERM 을 무시하는 경우가 있다
});

test('호출부가 timeout 을 직접 주면 그것을 쓴다', () => {
  assert.equal(ffmpegOpts({ timeout: 1000 }).timeout, 1000);
});

test('타임아웃으로 죽은 것과 그냥 실패한 것을 구분해 말한다', () => {
  const t = describeFfmpegResult({ status: null, signal: 'SIGKILL', error: { code: 'ETIMEDOUT' } });
  assert.match(t, /시간/);
  const f = describeFfmpegResult({ status: 1, stderr: 'Invalid data found' });
  assert.match(f, /Invalid data/);
  assert.equal(describeFfmpegResult({ status: 0 }), null);
});
