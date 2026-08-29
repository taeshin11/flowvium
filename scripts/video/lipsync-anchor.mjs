#!/usr/bin/env node
/**
 * lipsync-anchor.mjs — 앵커 클립의 **입을 나레이션에 맞춘다**(LatentSync).
 *
 * 왜 따로 도는가: 확산 모델이라 느리다. 실측(2026-08-28, M4 Pro/MPS):
 *   스텝당 2.77초 · 16프레임 배치 · 24fps → 6분 영상에 스텝20 이면 8.3시간, 스텝6 이면 2.5시간.
 *   렌더(13분) 안에 넣으면 실패 한 번에 전부 날아간다. 별도 단계로 두고 결과만 받는다.
 *
 * 무엇을 하는가:
 *   ① 8초짜리 앵커 클립을 나레이션 길이만큼 이어 붙인다(그대로는 입을 맞출 재료가 모자란다)
 *   ② LatentSync 로 입을 오디오에 맞춘다
 *   ③ 결과를 앵커 파일로 저장한다 — 파이프라인은 이걸 **반복 없이** 얹는다
 *
 * 사용: node scripts/video/lipsync-anchor.mjs --audio <voice.mp3> --out <anchor-synced.mp4>
 *       [--anchor <clip.mp4>] [--steps 6]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import ffmpegPath from 'ffmpeg-static';
import { ROOT } from '../lib/project-root.mjs';
import { envValue } from '../lib/footage.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const log = (...a) => console.log('  [립싱크]', ...a);

const TOOLS = envValue('LIPSYNC_HOME') || join(homedir(), '.flowvium-tools');
const LS = join(TOOLS, 'LatentSync');
const PY = join(TOOLS, 'venv', 'bin', 'python');
const BIN = join(TOOLS, 'bin');            // ffmpeg 심볼릭 링크 — LatentSync 가 PATH 에서 찾는다

export function toolsReady() {
  const missing = [];
  if (!existsSync(PY)) missing.push(`파이썬 ${PY}`);
  if (!existsSync(join(LS, 'scripts', 'inference.py'))) missing.push(`LatentSync ${LS}`);
  if (!existsSync(join(LS, 'checkpoints', 'latentsync_unet.pt'))) missing.push('체크포인트 latentsync_unet.pt');
  if (!existsSync(join(BIN, 'ffmpeg'))) missing.push(`ffmpeg 링크 ${BIN}/ffmpeg`);
  return { ok: missing.length === 0, missing };
}

const ff = (args, label) => {
  const r = spawnSync(ffmpegPath, args, { encoding: 'utf8', maxBuffer: 16 << 20 });
  if (r.status !== 0) throw new Error(`ffmpeg ${label}: ${String(r.stderr).slice(-300)}`);
};

const durationOf = (f) => {
  const out = spawnSync(ffmpegPath, ['-hide_banner', '-i', f], { encoding: 'utf8' }).stderr ?? '';
  const m = out.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  return m ? (+m[1] * 3600 + +m[2] * 60 + +m[3]) : 0;
};

/**
 * @param {{audio:string, out:string, anchor?:string, steps?:number, work?:string}} opts
 * @returns {{path:string, seconds:number, minutes:number}}
 */
export function lipsyncAnchor(opts) {
  // 공식 inference.sh 기준값을 기본으로 둔다. 1.6 체크포인트는 **512 로 학습**됐고
  //   256 설정으로 돌리면 릴리스 노트가 말한 그 흐릿함이 그대로 나온다(2026-08-29 실측).
  //   스텝도 README 권장이 20~50 이다 — 6 으로 깎으면 화질이 같이 깎인다.
  const { audio, out, steps = Number(arg('--steps', '20')),
          fps = Number(arg('--anchor-fps', '24')),
          config = arg('--config', 'configs/unet/stage2_512.yaml'),
          deepcache = !argv.includes('--no-deepcache') } = opts;
  const ready = toolsReady();
  if (!ready.ok) throw new Error(`립싱크 도구가 없다 — ${ready.missing.join(', ')}`);
  if (!existsSync(audio)) throw new Error(`오디오 없음: ${audio}`);
  const anchor = opts.anchor;
  if (!anchor || !existsSync(anchor)) throw new Error(`앵커 클립 없음: ${anchor}`);

  const work = opts.work ?? join(tmpdir(), `flowvium-lipsync-${process.pid}`);
  mkdirSync(work, { recursive: true });
  mkdirSync(dirname(out), { recursive: true });

  const secs = durationOf(audio);
  if (!secs) throw new Error(`오디오 길이를 못 읽었다: ${audio}`);
  const clip = durationOf(anchor);
  log(`오디오 ${secs.toFixed(1)}초 · 클립 ${clip.toFixed(1)}초 · 스텝 ${steps} · ${fps}fps · ${config.split('/').pop()}${deepcache ? ' · deepcache' : ''}`);

  // ① 클립을 오디오 길이만큼 늘리고 **프레임률을 낮춘다.**
  //   립싱크 비용은 프레임 수에 비례한다 — 24fps 를 12 로 낮추면 값이 절반이다.
  //   앵커 박스는 519x692 로 작고 말하는 얼굴이라 12fps 도 알아보기 어렵지 않다.
  //   배경 영상은 그대로 30fps 다. 겹칠 때 ffmpeg 이 맞춰 올린다.
  const looped = join(work, 'looped.mp4');
  ff(['-y', '-hide_banner', '-loglevel', 'error', '-stream_loop', '-1', '-t', secs.toFixed(3),
      '-i', anchor, '-an', '-r', String(fps),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', looped], 'loop');

  // ② 립싱크. 예상 시간을 먼저 알린다 — 몇 시간짜리를 말없이 시작하면 멈춘 줄 안다.
  // 실측(2026-08-29): 54초 오디오·24fps·스텝6 이 42분 이상 → 프레임당 약 1.15초.
  //   프레임 수에 비례하므로 fps 를 낮추면 그만큼 준다.
  const est = secs * fps * 1.15 / 60;
  log(`시작 — 예상 ${est.toFixed(0)}분 (실측 프레임당 1.15초 기준)`);
  const t0 = Date.now();
  const r = spawnSync(PY, ['-m', 'scripts.inference',
    '--unet_config_path', config,
    '--inference_ckpt_path', 'checkpoints/latentsync_unet.pt',
    '--video_path', looped, '--audio_path', audio, '--video_out_path', out,
    '--inference_steps', String(steps), '--guidance_scale', '1.5',
    ...(deepcache ? ['--enable_deepcache'] : []),   // 공식 스크립트가 켠다 — 품질 손실 없이 빨라진다
  ], { cwd: LS, encoding: 'utf8', maxBuffer: 64 << 20,
       env: { ...process.env, PATH: `${BIN}:${process.env.PATH}` } });
  if (r.status !== 0) {
    throw new Error(`LatentSync 실패 (exit ${r.status}):\n${String(r.stderr).trim().split('\n').slice(-6).join('\n')}`);
  }
  if (!existsSync(out) || statSync(out).size < 100_000) {
    throw new Error(`결과가 비었다: ${out} — LatentSync 가 조용히 끝났다`);
  }
  const took = (Date.now() - t0) / 60000;
  const got = durationOf(out);
  log(`완료 ${took.toFixed(1)}분 · 결과 ${got.toFixed(1)}초 (오디오 ${secs.toFixed(1)}초)`);
  if (Math.abs(got - secs) > 1.0) log(`⚠ 길이가 ${Math.abs(got - secs).toFixed(1)}초 어긋난다`);
  return { path: out, seconds: took * 60, minutes: took };
}

// 직접 실행
if (import.meta.url === `file://${process.argv[1]}`) {
  const audio = arg('--audio');
  const out = arg('--out');
  if (!audio || !out) { console.error('❌ --audio 와 --out 이 필요하다'); process.exit(1); }
  const anchor = arg('--anchor') ?? resolve(ROOT, 'assets/anchor/anchor-en-male.mp4');
  try { lipsyncAnchor({ audio, out, anchor }); }
  catch (e) { console.error(`❌ ${e.message}`); process.exit(1); }
}
