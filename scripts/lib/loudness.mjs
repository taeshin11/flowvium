/**
 * loudness.mjs — 음량을 재고(EBU R128), 목표에 맞춘다.
 *
 * 왜 (2026-09-17): 옆 세션(맥미니 사무실2)이 자기 쇼츠 본편이 전부 -35 LUFS 였다는 걸 찾았다.
 *   유튜브는 기준(-14)보다 큰 소리만 줄이고 **작은 소리는 키워 주지 않는다.**
 *   우리 한국어 쇼츠도 재 보니 -22.3 LUFS 로 8dB 작게 나가고 있었다.
 *   (광고 파일만 따로 재면 -17.3 이라 끝에서 튈 줄 알았는데, 쇼츠 안에서는 배경음 단계가
 *    둘을 같이 낮춰 본편과 0.5dB 차이였다 — 부분만 재고 판단하면 틀린다.)
 *
 * 곱셈(volume=)이 아니라 loudnorm 이다 — 배경음에서 이미 겪었다. 소리마다 기준이 달라
 *   배수를 정하면 다음 소리에서 또 틀린다.
 * 두 번 돈다(측정 → 선형 적용). 한 번에 돌리는 동적 모드는 소리 모양(강약)을 바꾼다.
 *   ffmpeg 이 선형을 못 쓰는 경우 스스로 동적으로 넘어간다 — 결과(mode)에 남긴다.
 *   그 조건(af_loudnorm.c): 올린 뒤 피크가 TP 를 넘거나, 측정 LRA 가 목표보다 크거나, **LRA 가 0**일 때.
 *   리미터를 거친 믹스는 피크 여유가 없어 대개 동적이 된다.
 * 맞췄다고 믿지 않는다 — 호출부가 다시 잴 수 있게 measure 를 따로 둔다.
 */
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import ffmpegPath from 'ffmpeg-static';

export const TP = -1.5;
export const LRA = 11;

/**
 * 입력 인자(예: ['-i', file] 또는 concat 목록)의 음량. 못 재면 null.
 * target 은 선형 적용에 쓸 offset 을 같은 조건으로 받기 위한 것이다.
 */
export function measure(inputArgs, { target = -14, ff = ffmpegPath, timeoutMs = 180_000 } = {}) {
  const r = spawnSync(ff, ['-hide_banner', '-nostats', ...inputArgs, '-map', '0:a:0',
    '-af', `loudnorm=I=${target}:TP=${TP}:LRA=${LRA}:print_format=json`, '-f', 'null', '-'],
  { encoding: 'utf8', timeout: timeoutMs });
  const t = String(r.stderr ?? '');
  const a = t.lastIndexOf('{'); const b = t.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try {
    const o = JSON.parse(t.slice(a, b + 1));
    return { I: Number(o.input_i), TP: Number(o.input_tp), LRA: Number(o.input_lra),
      thresh: Number(o.input_thresh), offset: Number(o.target_offset) };
  } catch { return null; }
}

/** 측정값으로 만든 선형 loudnorm 필터 문자열. */
export function linearFilter(m, target) {
  return `loudnorm=I=${target}:TP=${TP}:LRA=${LRA}`
    + `:measured_I=${m.I}:measured_TP=${m.TP}:measured_LRA=${m.LRA}`
    + `:measured_thresh=${m.thresh}:offset=${m.offset}:linear=true:print_format=json`;
}

/**
 * input 의 소리를 target LUFS 로 맞춰 output 에 쓴다.
 * @param {object} o  extraOut: 출력 인자(코덱·샘플레이트 등). 영상이 있으면 호출부가 '-c:v','copy' 를 준다.
 * @returns {{ok:boolean, mode?:string, before?:number, reason?:string}}
 */
export function normalize(input, output, target, { extraOut = [], ff = ffmpegPath, timeoutMs = 300_000 } = {}) {
  const m = measure(['-i', input], { target, ff });
  if (!m) return { ok: false, reason: '측정 실패' };
  // 무음이면 -inf 가 나온다. 그걸 이득으로 쓰면 터진다 — 맞추지 않는다.
  if (![m.I, m.TP, m.LRA, m.thresh, m.offset].every(Number.isFinite) || m.I < -70) {
    return { ok: false, reason: `무음이거나 측정값이 비정상(I=${m.I})` };
  }
  const r = spawnSync(ff, ['-y', '-hide_banner', '-nostats', '-i', input,
    '-af', linearFilter(m, target), ...extraOut, output], { encoding: 'utf8', timeout: timeoutMs });
  if (r.status !== 0 || !existsSync(output)) {
    return { ok: false, reason: `적용 실패: ${String(r.stderr ?? '').split('\n').filter(Boolean).pop()?.slice(0, 120)}` };
  }
  // ffmpeg 이 실제로 선형으로 했는지 결과에 적어 준다(못 하면 dynamic 으로 넘어간다).
  const t = String(r.stderr ?? '');
  const mode = /"normalization_type"\s*:\s*"(\w+)"/.exec(t)?.[1] ?? 'unknown';
  return { ok: true, mode, before: m.I };
}
