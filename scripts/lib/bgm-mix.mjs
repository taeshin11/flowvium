/**
 * bgm-mix.mjs — 영상에 배경음을 깐다. 내레이션보다 BGM_GAP_DB 아래, 말할 때 더 내린다. 2026-10-17 신설.
 *
 * 사장님 "시청 방해 안 하는 배경음악" (Mac mini2 전달 10/17 21:1x):
 *   내레이션 −14 LUFS 일 때 배경 약 −32 (18~22dB 아래), sidechaincompress 로 말할 때 더 내리고,
 *   0.3초 페이드인·0.5~1초 페이드아웃. 애매하면 더 작게.
 * 종전(09-06, make-shorts 안): 곡을 **−20 LUFS 고정**으로 맞춘 뒤 섞었다 → 내레이션과 9~10dB 차이
 *   (1899ab2a 실측). 고정값은 내레이션 음량이 바뀌면 같이 틀린다 — 이 회차 내레이션을 재서 맞춘다.
 *   09-06 의 교훈(곱셈 말고 loudnorm, 더킹은 ratio 4 / threshold 0.10 — 사라지지 말고 낮아지기만)은 그대로.
 * 섞은 뒤 **섞인 배경만 따로** 다시 잰다(더킹·페이드 뒤 실제 음량). 18dB 보다 가까우면 실패로 돌려준다 —
 *   호출부는 배경음 없이 간다(내레이션을 덮는 것보다 낫다).
 */
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import ffmpegPath from 'ffmpeg-static';
import { measure } from './loudness.mjs';
import { audioArgs } from './shorts-layout.mjs';
import { ffmpegOpts, describeFfmpegResult } from './ffmpeg-timeout.mjs';

// 목표는 **섞은 뒤 잰 간격**이다(2026-10-18). loudnorm 에 내레이션−20 을 넣으면 EQ·더킹·페이드가 곡과
//   내레이션 크기에 따라 4~7dB 더 깎아 실측 25.6~27.2dB — 폰 스피커에선 거의 안 들렸다(Mac mini2).
//   더킹 압축기는 절대 음량에 반응해(threshold 0.10) 깎이는 양이 회차마다 달라, 고정 보정값으로는 못 맞춘다.
export const BGM_GAP_DB = Number(process.env.SHORTS_BGM_GAP_DB || 21.5);
const GAP_TOL = 0.5, MAX_PASSES = 3;
export const BGM_MIN_GAP_DB = 18;
const FADE_IN = 0.3, FADE_OUT = 0.8;

/** 입력 [0:a]=내레이션(영상 소리), [1:a]=곡 → [a]=믹스, [bedonly]=섞인 배경. */
export function bgmFilter({ voiceI, durSec, gapDb = BGM_GAP_DB }) {
  const bedI = Math.max(-70, voiceI - gapDb);
  const outSt = Math.max(0, durSec - FADE_OUT);
  return `[1:a]loudnorm=I=${bedI.toFixed(1)}:TP=-2:LRA=7,`
    + 'equalizer=f=900:t=q:w=1.6:g=-6,equalizer=f=2200:t=q:w=1.6:g=-5,'
    + 'highpass=f=70,lowpass=f=9000,'
    + `atrim=0:${durSec},afade=t=in:st=0:d=${FADE_IN},afade=t=out:st=${Number(outSt.toFixed(2))}:d=${FADE_OUT}[bed];`
    + '[0:a]asplit=2[v1][v2];'
    + '[bed][v2]sidechaincompress=threshold=0.10:ratio=4:attack=20:release=400,asplit=2[ducked][bedonly];'
    // normalize=0: amix 가 입력 수로 나눠 둘 다 −6dB 낮추지 않게. 음량 차이는 위에서 정했다.
    + '[v1][ducked]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[a]';
}

export function bgmGapOk(voiceI, bedI, min = BGM_MIN_GAP_DB) {
  const gap = voiceI - bedI;
  return { ok: Number.isFinite(gap) && gap >= min, gap };
}

function durationOf(path) {
  const m = String(spawnSync(ffmpegPath, ['-hide_banner', '-i', path], { encoding: 'utf8' }).stderr ?? '')
    .match(/Duration: (\d+):(\d+):([\d.]+)/);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null;
}

/**
 * input(영상) 에 bed(곡) 를 깔아 output 에 쓴다. 영상은 복사.
 * @returns {{ok:boolean, reason?:string, voiceI?:number, bedI?:number, gap?:number}}
 */
export function mixBgm({ input, bed, output, workDir, target = BGM_GAP_DB }) {
  const v = measure(['-i', input]);
  if (!v || !Number.isFinite(v.I) || v.I < -70) return { ok: false, reason: `내레이션 음량을 못 쟀다(${v?.I})` };
  const durSec = durationOf(input);
  if (!(durSec > 0)) return { ok: false, reason: '영상 길이를 못 읽었다' };
  const bedOut = join(workDir, 'bgm-bed-only.wav');
  // 섞고 → 섞인 배경을 재고 → 목표와 어긋난 만큼 곡 음량을 고쳐 다시 섞는다(최대 3번).
  let pre = target, g = null, b = null, passes = 0;
  while (passes < MAX_PASSES) {
    passes++;
    const r = spawnSync(ffmpegPath, [
      '-v', 'error', '-i', input, '-stream_loop', '-1', '-i', bed,   // 영상 길이만큼 곡을 반복
      '-filter_complex', bgmFilter({ voiceI: v.I, durSec, gapDb: pre }),
      '-map', '0:v?', '-map', '[a]', '-c:v', 'copy', ...audioArgs(), '-shortest', '-y', output,
      '-map', '[bedonly]', '-y', bedOut,
    ], ffmpegOpts({ stdio: ['ignore', 'ignore', 'pipe'] }));
    if (r.status !== 0 || !existsSync(output)) return { ok: false, reason: describeFfmpegResult(r) ?? '사유 불명', voiceI: v.I, passes };
    b = measure(['-i', bedOut]);
    g = bgmGapOk(v.I, b?.I);
    if (!Number.isFinite(g.gap) || Math.abs(g.gap - target) <= GAP_TOL) break;
    pre = Math.min(30, Math.max(8, pre - (g.gap - target)));
  }
  return { ok: g.ok, reason: g.ok ? undefined : `배경이 내레이션과 ${g.gap?.toFixed?.(1)}dB 차이 — ${BGM_MIN_GAP_DB}dB 미만`, voiceI: v.I, bedI: b?.I, gap: g.gap, passes };
}
