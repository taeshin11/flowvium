/**
 * tts-korean.mjs — 한국어 음성 합성 + 문자 타임스탬프.
 *
 * 왜 별도인가 (2026-09-03): tts-local.mjs 는 Kokoro 를 쓰는데 **한국어를 지원하지 않는다**
 *   (0.9.4 기준 영/영국/스/불/힌/이/포/일/중). 기본 음성이 am_michael(미국 남성)이고
 *   whisper 도 base.en(영어 전용)이다. 한국어 대본을 그대로 넣으면 소리가 깨진다 —
 *   채널을 한국어로 돌리면서 이걸 못 봤으면 미국 남성이 한국어를 읽는 영상이 공개로 나갔다.
 *
 * 현재 기본 엔진은 **MeloTTS** 다 (2026-09-13, 사용자 비교 청취 후 "멜로가 낫다").
 *   실측 — 적재 0.8초 · 문장당 0.7~0.9초(실시간 7배). Qwen3-TTS 는 적재 7초에 문장당 15초
 *   (실시간 0.26배)였다. 같은 3문장이 44초 → 2.4초. 네 장면짜리 한 회차에서 1분 넘게 줄어든다.
 *   되들음 정확도는 Qwen 이 약간 앞섰지만(오독 5곳 vs 7곳, whisper base 기준) 사용자가
 *   두 음성을 직접 듣고 Melo 를 골랐다 — 판단 기준은 속도가 아니라 말투였다.
 *
 * 아래 Piper 단락은 2026-09-03 시점의 기록이다. 그때 MeloTTS 를 포기한 이유로 적힌
 *   "mecab 모듈명 충돌" 은 증상이었고, 진짜 원인은 이 맥의 파일시스템이 대소문자를
 *   구분하지 않아 `MeCab/` 과 `mecab/` 이 같은 디렉터리인 것이었다(2026-09-13 규명).
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
import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { ROOT } from './project-root.mjs';
import { speakNumbers } from './kr-number.mjs';
import { speakLatin } from './kr-latin.mjs';
import { earCheckAndRepair } from './ear-check.mjs';
import { createRequire } from 'module';

/** ffmpeg-static 의 실제 경로. 파이썬 쪽에 넘겨 배속에 쓰게 한다. */
function ffmpegBin() {
  try { return createRequire(import.meta.url)('ffmpeg-static'); } catch { return ''; }
}

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

// ── Qwen3-TTS 경로 (2026-09-03, 사용자 "tts가 너무 ai톤이다" → 'brief' 톤 채택) ───

/** Qwen3-TTS 전용 venv. Piper 와 섞지 않는다 — transformers 버전이 다르다. */
export function qwenPythonPath() {
  return process.env.KO_TTS_QWEN_PYTHON || join(homedir(), '.flowvium-tools', 'qwen-tts-venv', 'bin', 'python');
}

/** 사용자가 네 후보를 듣고 고른 말투. 실측 억양 7.86반음으로 가장 절제돼 있다. */
export const ANCHOR_INSTRUCT = '속보를 전하는 아나운서처럼 단정하고 힘있게, 문장 끝을 분명히 맺으며 읽어라.'
  // 2026-09-03 사용자: "너무 목소리가 느린데.. 한숨도 많고".
  //   실측 48.3초(목표 40초). 모델에 속도 인자가 없어 지시문으로 조인다.
  //   다만 지시만으로는 안 되는 경우가 있어 아래 atempo 후처리를 같이 쓴다.
  + ' 빠르고 경쾌한 속도로, 쉬는 구간 없이 이어서 말하라. 숨소리와 한숨을 내지 마라.';

/** 지시만으로 안 잡히는 속도를 오디오에서 마저 조인다. 1.0 이면 후처리 없음. */
export const ANCHOR_TEMPO = Number(process.env.KO_TTS_TEMPO || 1.18);

export function qwenTtsReady() {
  const py = qwenPythonPath();
  if (!existsSync(py)) return { ok: false, reason: `qwen venv 없음: ${py}` };
  const script = resolve(ROOT, 'scripts/tts/qwen_align.py');
  if (!existsSync(script)) return { ok: false, reason: `정렬 스크립트 없음: ${script}` };
  return { ok: true, python: py, script };
}

/**
 * 여러 문장을 **한 프로세스에서** 합성한다.
 *
 * 왜 묶는가: 모델 적재가 캐시 상태에서도 7초다. 장면마다 프로세스를 띄우면 4장면에 28초를
 *   적재에만 쓴다. Qwen 은 합성 자체도 실시간의 0.3~0.6배라 아낄 수 있는 건 다 아껴야 한다.
 *
 * @param {string[]} texts
 * @param {{outPrefix:string, instruct?:string, timeoutMs?:number}} opts
 * @returns {Array<{path:string, alignment:object, durationSec:number, note:string|null}>}
 */
export function synthesizeKoreanBatch(texts, opts = {}) {
  const { outPrefix, instruct = ANCHOR_INSTRUCT, tempo = ANCHOR_TEMPO, timeoutMs = 30 * 60_000 } = opts;
  if (!outPrefix) throw new Error('outPrefix 가 필요하다');
  const ready = qwenTtsReady();
  if (!ready.ok) throw new Error(`Qwen 한국어 TTS 준비 안 됨 — ${ready.reason}`);

  mkdirSync(dirname(outPrefix), { recursive: true });
  const tag = `qwen-${process.pid}-${Math.abs(hash(texts.join('|')))}`;
  const tf = join(tmpdir(), `${tag}.json`);
  const jf = join(tmpdir(), `${tag}.out.json`);
  try {
    writeFileSync(tf, JSON.stringify(texts), 'utf8');
    execFileSync(ready.python, [
      ready.script, '--texts-file', tf, '--out-prefix', outPrefix, '--json-out', jf,
      '--instruct', instruct, '--tempo', String(tempo),
    ], {
      timeout: timeoutMs,
      stdio: ['ignore', 'ignore', 'inherit'],
      // 파이썬이 배속에 쓸 ffmpeg. 이 기계엔 PATH 에 ffmpeg 이 없고 ffmpeg-static 만 있다.
      env: { ...process.env, FFMPEG_BIN: process.env.FFMPEG_BIN || ffmpegBin() },
    });
    const out = JSON.parse(readFileSync(jf, 'utf8'));
    if (!Array.isArray(out) || out.length !== texts.length) {
      throw new Error(`결과 개수 불일치 — 입력 ${texts.length}, 출력 ${out?.length}`);
    }
    return out;
  } finally {
    for (const f of [tf, jf]) { try { unlinkSync(f); } catch { /* noop */ } }
  }
}


// ── MeloTTS 경로 (2026-09-13, 기본 엔진) ──────────────────────────────────────

/** MeloTTS venv. Piper 와 같은 venv 를 쓴다 — onnxruntime 말고는 겹치는 의존이 없다. */
export function meloPythonPath() {
  return process.env.KO_TTS_MELO_PYTHON || join(homedir(), '.flowvium-tools', 'melo-venv', 'bin', 'python');
}

/** 엔진 자체 속도. 음높이를 보존하므로 배속 후처리보다 깨끗하다. */
export const MELO_SPEED = Number(process.env.KO_TTS_MELO_SPEED || 1.15);

export function meloTtsReady() {
  const py = meloPythonPath();
  if (!existsSync(py)) return { ok: false, reason: `melo venv 없음: ${py}` };
  const script = resolve(ROOT, 'scripts/tts/melo_align.py');
  if (!existsSync(script)) return { ok: false, reason: `정렬 스크립트 없음: ${script}` };
  return { ok: true, python: py, script };
}

/**
 * MeloTTS 로 여러 문장을 한 프로세스에서 합성한다.
 * 반환 계약은 Qwen·Piper 와 같다 — 호출부가 엔진을 몰라도 된다.
 */
export function synthesizeKoreanMelo(texts, opts = {}) {
  // 2026-09-16: lang 을 받는다. MeloTTS 는 일본어도 하는데 파이썬 쪽이 "KR" 로 못박혀 있어
  //   쓰지 못하고 있었다. 기본값은 그대로 한국어라 기존 호출부는 달라지지 않는다.
  const { outPrefix, speed = MELO_SPEED, timeoutMs = 30 * 60_000, display = null, lang = 'ko' } = opts;
  if (!outPrefix) throw new Error('outPrefix 가 필요하다');
  const ready = meloTtsReady();
  if (!ready.ok) throw new Error(`MeloTTS 준비 안 됨 — ${ready.reason}`);

  mkdirSync(dirname(outPrefix), { recursive: true });
  const tag = `melo-${process.pid}-${Math.abs(hash(texts.join('|')))}`;
  const tf = join(tmpdir(), `${tag}.json`);
  const jf = join(tmpdir(), `${tag}.out.json`);
  try {
    writeFileSync(tf, JSON.stringify(texts), 'utf8');
    // 자막은 원문 그대로(숫자는 숫자로), 소리는 한글로 읽은 것 — 시각만 공유한다.
    let df = null;
    if (display && display.length === texts.length) {
      df = join(tmpdir(), `${tag}.display.json`);
      writeFileSync(df, JSON.stringify(display), 'utf8');
    }
    execFileSync(ready.python, [
      ready.script, '--texts-file', tf, '--out-prefix', outPrefix, '--json-out', jf,
      '--speed', String(speed), '--lang', String(lang),
      ...(df ? ['--display-texts-file', df] : []),
    ], {
      timeout: timeoutMs,
      stdio: ['ignore', 'ignore', 'inherit'],
      env: { ...process.env, FFMPEG_BIN: process.env.FFMPEG_BIN || ffmpegBin() },
    });
    const out = JSON.parse(readFileSync(jf, 'utf8'));
    if (!Array.isArray(out) || out.length !== texts.length) {
      throw new Error(`결과 개수 불일치 — 입력 ${texts.length}, 출력 ${out?.length}`);
    }
    return out;
  } finally {
    for (const f of [tf, jf]) { try { unlinkSync(f); } catch { /* noop */ } }
  }
}

/**
 * 한국어 배치 합성 — 엔진 한 칸.
 *
 * 기본은 melo. KO_TTS_ENGINE=qwen 으로 되돌릴 수 있다.
 * **조용히 떨어지지 않는다** — 어느 엔진이 돌았는지, 왜 바뀌었는지 찍는다.
 * 목소리가 바뀐 걸 모르고 발행하는 게 느린 것보다 나쁘다.
 */
export function synthesizeKoreanAuto(texts, opts = {}) {
  const want = (process.env.KO_TTS_ENGINE || 'melo').toLowerCase();
  const log = opts.log ?? ((m) => console.log(`  [ko-tts] ${m}`));

  if (want === 'qwen') {
    log('엔진 qwen (KO_TTS_ENGINE 지정)');
    return synthesizeKoreanBatch(texts, opts);
  }
  const melo = meloTtsReady();
  if (melo.ok) {
    // 2026-09-14 사용자 "숫자읽을때 이상하게 읽네".
    //   Melo 의 한국어 g2p 가 여러 자리 숫자를 못 읽는다(실측 10건 중 8건 오독,
    //   "2026년"→"2016년" 처럼 값이 바뀌는 것까지). 소리에는 한글로 읽은 글을 주고
    //   **자막에는 원문을 그대로** 둔다 — 화면의 "6800억" 이 "육천팔백억" 보다 읽기 쉽다.
    // 2026-09-25 시청자 댓글 "G20을 <지이영>으로 발음하는 AI가 너무 싫어". 영문 약어도 같은 문제였다
    //   (OECD → "띠" · GDP → "뿐", 되들음 실측). 약어를 한글 글자 이름으로 먼저 바꾸고 숫자를 읽는다 —
    //   순서가 중요하다: G20 이 "지 20" 이 돼야 speakNumbers 가 20 을 "이십" 으로 읽는다.
    const spoken = texts.map((t) => speakNumbers(speakLatin(t)));
    const changed = spoken.filter((t, i) => t !== texts[i]).length;
    log(`엔진 melo (속도 ${opts.speed ?? MELO_SPEED})${changed ? ` · 숫자·약어 한글화 ${changed}/${texts.length}문장` : ''}`);
    const out = synthesizeKoreanMelo(spoken, { ...opts, display: texts });
    // 2026-09-25 귀검증 — 사장님 "왜 자꾸 이런 문제가 생기는 거지 이런 문제 없게 해".
    //   화면은 매 편 눈검증을 하는데 소리는 아무도 안 들어서, 오독(G20 → "지이영")을 시청자가 먼저 찾았다.
    //   약어가 든 문장만 되들어 보고, 안 들리면 다른 표기로 다시 만든다(ear-check.mjs). EAR_CHECK=0 으로 끈다.
    if (process.env.EAR_CHECK === '0') return out;
    let n = 0;
    return earCheckAndRepair({
      texts,
      out: out.map((o, i) => ({ ...o, spoken: spoken[i] })),
      synth: (sp, disp) => synthesizeKoreanMelo(sp, { ...opts, display: disp, outPrefix: `${opts.outPrefix}-ear${++n}` }),
      transcribe: (items) => transcribeKo(items.map((x) => x.path)),
      log,
      record: (x) => {
        try {
          mkdirSync(join(ROOT, 'logs'), { recursive: true });
          appendFileSync(join(ROOT, 'logs/ear-check.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...x })}\n`);
        } catch { /* 기록 실패는 발행을 막지 않는다 — 로그 줄은 이미 남았다 */ }
      },
    }).out;
  }
  const qwen = qwenTtsReady();
  if (qwen.ok) {
    log(`⚠️ melo 사용 불가(${melo.reason}) — qwen 으로 진행. 목소리가 달라진다.`);
    return synthesizeKoreanBatch(texts, opts);
  }
  throw new Error(`한국어 TTS 없음 — melo: ${melo.reason} / qwen: ${qwen.reason}`);
}

/**
 * 한국어 받아쓰기(귀검증용). melo venv 의 faster-whisper small 을 쓴다 — 없으면 던진다(ear-check 가 '판정 없음' 으로 적는다).
 * @param {string[]} paths wav 경로
 * @returns {string[]} 같은 순서의 받아쓴 문장
 */
export function transcribeKo(paths) {
  const py = meloPythonPath();
  const script = resolve(ROOT, 'scripts/tts/ear_asr.py');
  if (!existsSync(py) || !existsSync(script)) throw new Error(`받아쓰기 도구 없음: ${!existsSync(py) ? py : script}`);
  const tag = `ear-${process.pid}-${Date.now()}`;
  const inf = join(tmpdir(), `${tag}.json`);
  const outf = join(tmpdir(), `${tag}.out.json`);
  try {
    writeFileSync(inf, JSON.stringify(paths), 'utf8');
    execFileSync(py, [script, inf, outf], { timeout: 10 * 60_000, stdio: ['ignore', 'ignore', 'pipe'] });
    return JSON.parse(readFileSync(outf, 'utf8'));
  } finally {
    for (const f of [inf, outf]) { try { unlinkSync(f); } catch { /* noop */ } }
  }
}
