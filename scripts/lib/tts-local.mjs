/**
 * tts-local.mjs — 로컬 TTS(Kokoro) + whisper 강제정렬.
 *
 * 왜 로컬인가: ElevenLabs Starter 는 월 4만 자다. 6분 영상 1편이 약 5,800자라 월 7편.
 *   하루 5편은 월 87만 자 — 어떤 등급으로도 감당이 안 된다(2026-08-28 실측: 남은 104자).
 *   Kokoro 는 Apache-2.0 이고 이 기계(M4 Pro/MPS)에서 실시간의 6~13배로 돈다.
 *
 * 반환 모양은 **tts.mjs 의 synthesizeWithTimestamps 와 같다** — 호출부가 그대로 쓴다.
 *   {path, alignment:{characters, character_start_times_seconds, character_end_times_seconds}, durationSec}
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, unlinkSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { homedir } from 'node:os';
import { ROOT } from './project-root.mjs';
import { envValue } from './footage.mjs';

/**
 * 파이썬 실행기. 저장소 **밖** 도구 폴더에 둔다 — venv 를 저장소에 두면 tsc 가
 *   gradio 소스까지 타입체크하고 git 도 오염된다(2026-08-28 실측).
 *
 * ⚠ TTS 전용 venv 다. 립싱크(LatentSync)와 **같은 곳에 두면 안 된다** —
 *   LatentSync 는 numpy 1.26 을 고정하고 Kokoro 는 2.2 를 쓴다. 한 곳에 섞었더니
 *   `cannot import name 'broadcast_to'` 로 TTS 가 통째로 죽었다.
 */
export function pythonPath() {
  return envValue('TTS_PYTHON') || join(homedir(), '.flowvium-tools', 'tts-venv', 'bin', 'python');
}

export const DEFAULT_VOICE = 'am_michael';   // Kokoro 미국 남성 최상위 등급(B/C+) 중 하나

/** 소리가 났는가. 무음 파일이 그대로 합성되면 그 장면만 조용히 비는데, 렌더는 성공으로 끝난다. */
const MIN_WAV_BYTES = 8000;

/**
 * @param {string} text
 * @param {{outPath:string, voice?:string, speed?:number, whisper?:string, python?:string}} opts
 */
export function synthesizeLocal(text, opts = {}) {
  const { outPath, voice = DEFAULT_VOICE, speed = 1.0, whisper = 'base.en' } = opts;
  if (!outPath) throw new Error('outPath 필요');
  if (!text || !String(text).trim()) throw new Error('빈 대본');
  const py = opts.python ?? pythonPath();
  if (!existsSync(py)) {
    throw new Error(`파이썬을 못 찾았다: ${py} — .env.local 의 TTS_PYTHON 으로 지정하거나 도구 환경을 만들 것`);
  }
  const script = resolve(ROOT, 'scripts/tts/kokoro_align.py');
  if (!existsSync(script)) throw new Error(`정렬 스크립트 없음: ${script}`);

  mkdirSync(dirname(outPath), { recursive: true });
  const txt = join(tmpdir(), `kokoro-${process.pid}-${Math.abs(hash(text))}.txt`);
  const jsn = `${txt}.json`;
  writeFileSync(txt, String(text), 'utf8');
  try {
    const r = spawnSync(py, [script,
      '--text-file', txt, '--out', outPath, '--json-out', jsn,
      '--voice', voice, '--speed', String(speed), '--whisper', whisper,
    ], { encoding: 'utf8', maxBuffer: 32 << 20 });
    if (r.status !== 0) {
      const err = String(r.stderr ?? '').trim().split('\n').slice(-4).join('\n');
      throw new Error(`Kokoro 실패 (exit ${r.status}):\n${err}`);
    }
    if (!existsSync(jsn)) throw new Error('정렬 결과 파일이 없다 — 스크립트가 조용히 끝났다');
    const d = JSON.parse(readFileSync(jsn, 'utf8'));
    const bytes = existsSync(outPath) ? statSync(outPath).size : 0;
    if (bytes < MIN_WAV_BYTES) throw new Error(`무음 의심 — ${bytes} bytes (voice=${voice})`);
    const ends = d?.alignment?.character_end_times_seconds ?? [];
    if (!ends.length || !d?.durationSec) throw new Error('alignment 없음 — 자막 타이밍을 만들 수 없다');
    // stderr 의 진단 한 줄은 남긴다. 정렬이 실패해 균등분배로 떨어졌는지 알아야 한다.
    const note = (String(r.stderr ?? '').match(/\[kokoro\][^\n]*/) ?? [''])[0];
    return { path: outPath, alignment: d.alignment, durationSec: d.durationSec, note };
  } finally {
    for (const f of [txt, jsn]) { try { unlinkSync(f); } catch { /* noop */ } }
  }
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return h;
}
