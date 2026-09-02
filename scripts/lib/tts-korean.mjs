/**
 * tts-korean.mjs — 한국어 음성 합성 + 문자 타임스탬프.
 *
 * 왜 별도인가 (2026-09-03): tts-local.mjs 는 Kokoro 를 쓰는데 **한국어를 지원하지 않는다**
 *   (0.9.4 기준 영/영국/스/불/힌/이/포/일/중). 기본 음성이 am_michael(미국 남성)이고
 *   whisper 도 base.en(영어 전용)이다. 한국어 대본을 그대로 넣으면 소리가 깨진다 —
 *   채널을 한국어로 돌리면서 이걸 못 봤으면 미국 남성이 한국어를 읽는 영상이 공개로 나갔다.
 *
 * 왜 Piper 인가 — 셋을 재고 골랐다:
 *   ElevenLabs  starter 40,000자 중 **104자 잔여**, 갱신 3주 뒤. 하루 5편은 어떤 등급으로도 무리.
 *   MeloTTS     MIT 이고 한국어를 하지만 mecab-python3(일본어)와 python-mecab-ko(한국어 g2p)가
 *               같은 `MeCab` 모듈명을 다툰다. 언어 지연 import 패치까지 넣었는데 g2p 에서 또 막혔다.
 *   Piper       MIT + ONNX 단일 런타임. 의존성 충돌이 원천적으로 없다.
 *               실측: 6.76초 음성을 0.50초에 합성(실시간 13배). whisper 되들음 언어 ko 확인.
 *
 * tts-local.mjs 와 **같은 반환 계약**을 지킨다 — 호출부가 둘을 갈아끼울 수 있어야 한다.
 *   { path, alignment, durationSec, note }
 */
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { ROOT } from './project-root.mjs';

/** Piper 런타임이 있는 venv. MeloTTS 시도 때 만든 것을 그대로 쓴다. */
export function pythonPath() {
  return process.env.KO_TTS_PYTHON || join(homedir(), '.flowvium-tools', 'melo-venv', 'bin', 'python');
}

/** 음성 모델(.onnx). rhasspy/piper-voices 의 ko_KR-kss-medium. */
export function voiceModelPath() {
  return process.env.KO_TTS_MODEL
    || join(homedir(), '.flowvium-tools', 'piper-voices', 'ko', 'ko_KR-kss-medium.onnx');
}

/** 준비됐는가. 없으면 **왜** 없는지 알려준다 — 조용히 영어 음성으로 떨어지면 안 된다. */
export function koTtsReady() {
  const py = pythonPath();
  const model = voiceModelPath();
  if (!existsSync(py)) return { ok: false, reason: `python 없음: ${py}` };
  if (!existsSync(model)) return { ok: false, reason: `음성 모델 없음: ${model}` };
  const script = resolve(ROOT, 'scripts/tts/piper_align.py');
  if (!existsSync(script)) return { ok: false, reason: `정렬 스크립트 없음: ${script}` };
  return { ok: true, python: py, model, script };
}

const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return h; };

/**
 * 한국어 문장을 합성하고 문자 단위 시각을 돌려준다.
 *
 * @param {string} text
 * @param {{outPath:string, speed?:number, whisper?:string, timeoutMs?:number}} opts
 * @returns {{path:string, alignment:object, durationSec:number, note:string|null}}
 */
export function synthesizeKorean(text, opts = {}) {
  const { outPath, speed = 1.0, whisper = 'base', timeoutMs = 10 * 60_000 } = opts;
  if (!outPath) throw new Error('outPath 가 필요하다');
  const ready = koTtsReady();
  if (!ready.ok) throw new Error(`한국어 TTS 준비 안 됨 — ${ready.reason}`);

  mkdirSync(dirname(outPath), { recursive: true });
  const tag = `piper-${process.pid}-${Math.abs(hash(text))}`;
  const txt = join(tmpdir(), `${tag}.txt`);
  const jsn = join(tmpdir(), `${tag}.json`);
  try {
    writeFileSync(txt, String(text ?? ''), 'utf8');
    execFileSync(ready.python, [
      ready.script,
      '--text-file', txt, '--out', outPath, '--json-out', jsn,
      '--model', ready.model, '--speed', String(speed), '--whisper', whisper,
    ], { timeout: timeoutMs, stdio: ['ignore', 'ignore', 'pipe'] });
    const d = JSON.parse(readFileSync(jsn, 'utf8'));
    if (!(d.durationSec > 0)) throw new Error('길이 0 — 합성 실패');
    return { path: outPath, alignment: d.alignment, durationSec: d.durationSec, note: d.note ?? null };
  } finally {
    for (const f of [txt, jsn]) { try { unlinkSync(f); } catch { /* noop */ } }
  }
}
