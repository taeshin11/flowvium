#!/usr/bin/env node
/**
 * loudness.test.mjs — 재고, 맞추고, 맞췄는지 다시 잰다.
 *
 * 배경(2026-09-17): 사무실2 가 자기 쇼츠 본편이 전부 -35 LUFS 였다는 걸 찾았다.
 *   유튜브는 작은 소리를 키워 주지 않는다(-14 기준으로 큰 것만 줄인다).
 *   우리 한국어 쇼츠도 재 보니 -22.3 LUFS — 8dB 작게 나가고 있었다.
 */
import { spawnSync } from 'child_process';
import { mkdtempSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import ffmpegPath from 'ffmpeg-static';

let fail = 0;
const ok  = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

const L = await import('./loudness.mjs');
const dir = mkdtempSync(join(tmpdir(), 'loud-'));

// 조용한 소리를 만든다 — -35 LUFS 근처, **강약이 있게**.
//   순수한 사인파는 LRA 가 0 인데 ffmpeg 은 measured_lra == 0 이면 선형 모드를 쓰지 않는다
//   (af_loudnorm.c 의 조건). 말소리는 강약이 있으니 실제로는 해당하지 않는다 — 시험 소리가 틀렸던 것.
const quiet = join(dir, 'quiet.wav');
spawnSync(ffmpegPath, ['-y', '-v', 'error', '-f', 'lavfi', '-i',
  'sine=frequency=440:duration=8,volume=0.2,tremolo=f=0.4:d=0.8', '-ar', '48000', '-ac', '1', quiet]);
if (!existsSync(quiet)) { bad('시험용 소리를 못 만들었다'); process.exit(1); }

// [1] 잰다
const m = L.measure(['-i', quiet]);
(m && Number.isFinite(m.I) && m.I < -25)
  ? ok(`조용한 소리를 잰다: ${m.I.toFixed(1)} LUFS`)
  : bad(`측정 실패: ${JSON.stringify(m)}`);

// [2] 맞춘다 → [3] 다시 잰다 (맞췄다고 믿지 않는다)
const out = join(dir, 'loud.wav');
const r = L.normalize(quiet, out, -14, { extraOut: ['-ar', '48000', '-ac', '1'] });
const m2 = r.ok ? L.measure(['-i', out]) : null;
(m2 && Math.abs(m2.I - -14) <= 1)
  ? ok(`-14 LUFS 로 맞춘다: ${m2.I.toFixed(1)} (${r.mode})`)
  : bad(`맞추지 못했다: ${JSON.stringify({ r, m2 })}`);
// 설계 의도는 선형이다 — 소리 모양(강약)을 안 바꾼다. 여유가 있는 입력에서 선형이 안 나오면 필터가 틀린 것.
r.mode === 'linear'
  ? ok('피크 여유가 있으면 선형으로 맞춘다(강약 보존)')
  : bad(`선형이 아니라 ${r.mode} 로 맞췄다 — 측정값 전달이 틀렸을 수 있다`);

// [4] 무음은 맞추지 않는다 — -inf 를 선형 이득으로 쓰면 터진다
const silent = join(dir, 'silent.wav');
spawnSync(ffmpegPath, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '2', silent]);
const r3 = L.normalize(silent, join(dir, 's-out.wav'), -14);
(!r3.ok && /무음|측정/.test(r3.reason ?? ''))
  ? ok(`무음은 건드리지 않는다 — ${r3.reason}`)
  : bad(`무음을 맞추려 했다: ${JSON.stringify(r3)}`);

// [배선] 쇼츠와 광고가 실제로 이 모듈로 최종 음량을 맞추는가
{
  const { readFileSync } = await import('fs');
  const { ROOT } = await import('./project-root.mjs');
  const shorts = readFileSync(`${ROOT}/scripts/video/make-shorts.mjs`, 'utf8');
  const outro = readFileSync(`${ROOT}/scripts/video/make-outro-clip.mjs`, 'utf8');
  (/SHORTS_LUFS \?\? -14/.test(shorts) && /normalizeLoudness\(OUT,/.test(shorts))
    ? ok('쇼츠는 맨 끝에서 -14 LUFS 로 맞춘다') : bad('쇼츠에 최종 음량 단계가 없다');
  (/AISVI_LUFS \?\? -14/.test(outro) && /normalizeLoudness\(OUT,/.test(outro))
    ? ok('광고 파일도 -14 LUFS 로 나간다') : bad('광고 파일에 음량 단계가 없다');
  !/\]aresample=24000/.test(outro)   // 필터 안의 쓰임만 본다(주석의 설명은 제외)
    ? ok('광고가 24kHz 를 거치지 않는다(12kHz 위가 잘리지 않는다)') : bad('광고 필터에 aresample=24000 이 남아 있다');
}

console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
