#!/usr/bin/env node
/**
 * bgm-mix.test.mjs — 배경음은 내레이션보다 18~22dB 아래. 2026-10-17 신설.
 *   사장님 "시청 방해 안 하는 배경음악" (Mac mini2 전달 10/17 21:1x): 내레이션 −14 LUFS 일 때 배경 약 −32,
 *   말할 때 더 내리고(sidechaincompress), 0.3초 페이드인·0.5~1초 페이드아웃, 애매하면 더 작게.
 *   종전(09-06~)은 곡을 −20 LUFS 고정으로 맞춰 내레이션과 9~10dB 차이였다(1899ab2a 실측).
 *   고정값이 아니라 **이 회차 내레이션을 재서** 그보다 20dB 아래로 맞추고, 섞은 배경만 따로 다시 잰다.
 */
import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createRequire } from 'module';
import { bgmFilter, bgmGapOk, BGM_GAP_DB, BGM_MIN_GAP_DB, mixBgm } from './bgm-mix.mjs';
import { measure } from './loudness.mjs';
const FF = createRequire(import.meta.url)('ffmpeg-static');
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const dir = mkdtempSync(join(tmpdir(), 'bgm-mix-test-'));

{ // [1] 필터 — 곡 음량을 내레이션 기준으로, 페이드, 더킹, 배경만 따로 내보냄
  const f = bgmFilter({ voiceI: -16, durSec: 30, gapDb: 20 });
  (/loudnorm=I=-36(\.0+)?:/.test(f)) ? ok('[1a] 내레이션 −16 → 곡 −36 LUFS (20dB 아래)') : bad(`[1a] ${f}`);
  (/afade=t=in:st=0:d=0\.3/.test(f) && /afade=t=out:st=29\.2:d=0\.8/.test(f)) ? ok('[1b] 페이드인 0.3초 · 페이드아웃 0.8초(끝에 맞춤)') : bad(`[1b] ${f}`);
  (/sidechaincompress/.test(f) && /\[bedonly\]/.test(f)) ? ok('[1c] 말할 때 더킹 · 섞인 배경을 따로 꺼낸다') : bad(`[1c] ${f}`);
  (BGM_GAP_DB >= 21 && BGM_GAP_DB <= 22 && BGM_MIN_GAP_DB === 18) ? ok(`[1d] 목표(잰 간격) ${BGM_GAP_DB}dB · 하한 ${BGM_MIN_GAP_DB}dB`) : bad(`[1d] ${BGM_GAP_DB}/${BGM_MIN_GAP_DB}`);
}
{ // [2] 관문
  (bgmGapOk(-14, -34).ok && !bgmGapOk(-14, -24).ok && !bgmGapOk(-14, NaN).ok) ? ok('[2] 20dB 통과 · 10dB 거름 · 못 재면 거름') : bad('[2]');
}
{ // [3] 실제로 섞어 잰다 — 시끄러운 곡(−8 LUFS 급)을 넣어도 18dB 이상 아래
  const v = join(dir, 'v.mp4'), bed = join(dir, 'bed.wav'), out = join(dir, 'o.mp4');
  spawnSync(FF, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=gray:s=64x64:d=6', '-f', 'lavfi',
    '-i', 'sine=f=300:d=6,volume=0.3,apulsator=hz=1', '-shortest', '-c:v', 'libx264', '-c:a', 'aac', '-ac', '1', v]);   // 쇼츠 소리는 모노(AUDIO_SPEC)
  spawnSync(FF, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anoisesrc=c=pink:a=0.9:d=4', bed]);
  const r = mixBgm({ input: v, bed, output: out, workDir: dir });
  const voice = measure(['-i', v]), mixed = existsSync(out) ? measure(['-i', out]) : null;
  (r.ok && r.gap >= 18 && mixed && mixed.I >= voice.I - 0.3 && mixed.I - voice.I < 0.5)
    ? ok(`[3] 내레이션 ${r.voiceI.toFixed(1)} · 섞인 배경 ${r.bedI.toFixed(1)} LUFS → ${r.gap.toFixed(1)}dB 아래 · 믹스 ${mixed.I.toFixed(1)}`)
    : bad(`[3] ${JSON.stringify(r)} mixed=${mixed?.I}`);
}
{ // [3b] 2026-10-18 Mac mini2: 잰 간격이 25.6~27.2dB 로 목표보다 작아 폰 스피커에선 거의 안 들린다.
  //   loudnorm 목표 = 내레이션−20 으로 넣어도 EQ·더킹·페이드가 4~7dB 더 깎는다(곡마다 다름) → 섞은 배경을 재서 고친다.
  //   실제 돌리는 곡(assets/bgm 첫 곡)과 시끄러운 잡음 둘 다 잰 간격이 목표 ±0.75dB 안.
  const { licensedBeds } = await import('./bgm-beds.mjs');
  const bgmDir = new URL('../../assets/bgm/', import.meta.url).pathname;
  const real = licensedBeds(bgmDir).beds[0];
  const v = join(dir, 'v2.mp4');
  spawnSync(FF, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=gray:s=64x64:d=12', '-f', 'lavfi',
    '-i', 'sine=f=220:d=12,volume=0.5,apulsator=hz=0.7', '-shortest', '-c:v', 'libx264', '-c:a', 'aac', '-ac', '1', v]);
  for (const [name, bed] of [['잡음', join(dir, 'bed.wav')], [real, join(bgmDir, real ?? 'none')]]) {
    const r = mixBgm({ input: v, bed, output: join(dir, 'o2.mp4'), workDir: dir });
    (r.ok && Math.abs(r.gap - BGM_GAP_DB) <= 0.75)
      ? ok(`[3b] ${name} — 잰 간격 ${r.gap.toFixed(1)}dB (목표 ${BGM_GAP_DB}, ${r.passes}회)`)
      : bad(`[3b] ${name} ${JSON.stringify(r)}`);
  }
}
{ // [4] 연결 — make-shorts 가 이 모듈로 섞는다(고정 −20 LUFS 가 남아 있지 않다)
  const ms = readFileSync(new URL('../video/make-shorts.mjs', import.meta.url), 'utf8');
  (/mixBgm\(/.test(ms) && !/SHORTS_BGM_LUFS \|\| -20/.test(ms)) ? ok('[4] make-shorts 가 mixBgm 사용 · 고정 −20 LUFS 제거') : bad('[4] make-shorts 연결 안 됨');
}
{ // [4b] 2026-10-18: 주간 해설은 곡을 −24 LUFS 고정으로 섞어 10/18 회차가 내레이션과 11.9dB 차이였다(같은 필터로 재현 실측).
  const we = readFileSync(new URL('../video/make-weekly-explainer.mjs', import.meta.url), 'utf8');
  (/mixBgm\(/.test(we) && !/loudnorm=I=-24/.test(we)) ? ok('[4b] 주간 해설도 mixBgm(잰 간격 기준) · 고정 −24 LUFS 제거') : bad('[4b] 주간 해설이 아직 고정 음량');
}
rmSync(dir, { recursive: true, force: true });
console.log(fail ? `\n❌ bgm-mix ${fail}건 실패` : '\n✅ bgm-mix 전부 통과');
process.exit(fail ? 1 : 0);
