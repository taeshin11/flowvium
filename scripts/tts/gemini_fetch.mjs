#!/usr/bin/env node
/**
 * gemini_fetch.mjs — 문장마다 Gemini TTS 를 불러 <out-prefix><i>.wav 로 저장한다. tts-korean.synthesizeKoreanGemini 가 자식으로 부른다
 *   (그쪽은 동기 함수다). 키는 환경변수 GEMINI_API_KEY 로만 받는다 — 명령줄에 두면 ps 에 보인다.
 *   한 문장이라도 소리를 못 받으면 종료코드 1 + 이유 한 줄 — 부르는 쪽이 회차 전체를 다른 엔진으로 돌린다.
 *   node scripts/tts/gemini_fetch.mjs <texts.json> <out-prefix>
 */
import { readFileSync, writeFileSync } from 'fs';
import { geminiTtsBody, parseGeminiAudio, GEMINI_TTS_MODEL, GEMINI_TTS_VOICE } from '../lib/gemini-tts.mjs';

const [textsFile, outPrefix] = process.argv.slice(2);
const key = process.env.GEMINI_API_KEY;
if (!key) { console.error('GEMINI_API_KEY 없음'); process.exit(1); }
const texts = JSON.parse(readFileSync(textsFile, 'utf8'));
const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent`;

async function one(text) {
  // 5xx 는 한 번만 다시 부른다(서버 쪽 일시 오류). 429(한도)·4xx 는 다시 부르지 않는다 — 한도면 다시 불러도 같다.
  for (let t = 0; ; t++) {
    const r = await fetch(url, { method: 'POST', headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify(geminiTtsBody(text, GEMINI_TTS_VOICE)), signal: AbortSignal.timeout(120_000) });
    const body = await r.text();
    if (r.status >= 500 && t === 0) { console.error(`  [gemini-tts] HTTP ${r.status} — 한 번 더`); continue; }
    let j; try { j = JSON.parse(body); } catch { throw new Error(`HTTP ${r.status} JSON 아님: ${body.slice(0, 60)}`); }
    if (!r.ok && !j.error) j.error = { code: r.status, message: body.slice(0, 120) };
    return { wav: parseGeminiAudio(j), tokens: j.usageMetadata?.candidatesTokenCount ?? null };
  }
}

const out = new Array(texts.length);
let next = 0;
async function worker() {
  while (next < texts.length) {
    const i = next++;
    const { wav, tokens } = await one(texts[i]);
    const path = `${outPrefix}${i}.wav`;
    writeFileSync(path, wav);
    out[i] = { path, tokens };
  }
}
try {
  await Promise.all([worker(), worker(), worker()]);
  process.stdout.write(JSON.stringify({ model: GEMINI_TTS_MODEL, voice: GEMINI_TTS_VOICE, out }));
} catch (e) {
  console.error(String(e?.message ?? e).slice(0, 200));
  process.exit(1);
}
