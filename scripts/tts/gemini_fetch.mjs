#!/usr/bin/env node
/**
 * gemini_fetch.mjs — 문장마다 Gemini TTS 를 불러 <out-prefix><i>.wav 로 저장한다. tts-korean.synthesizeKoreanGemini 가 자식으로 부른다
 *   (그쪽은 동기 함수다). 키는 환경변수 GEMINI_API_KEY 로만 받는다 — 명령줄에 두면 ps 에 보인다.
 *   한 문장이라도 소리를 못 받으면 종료코드 1 + 이유 한 줄 — 부르는 쪽이 회차 전체를 다른 엔진으로 돌린다.
 *   node scripts/tts/gemini_fetch.mjs <texts.json> <out-prefix>
 */
import { readFileSync, writeFileSync } from 'fs';
import { geminiTtsBody, parseGeminiAudio, geminiError, takeSlot, GEMINI_TTS_MODEL, GEMINI_TTS_VOICE } from '../lib/gemini-tts.mjs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
// 분당 한도(10/23 실측 10회, 프로젝트·모델당)를 쇼츠·롱폼·광고가 같이 쓴다 — 호출 기록을 파일 하나로 같이 센다.
const CALLS = resolve(dirname(fileURLToPath(import.meta.url)), '../../logs/gemini-tts-calls.json');

const [textsFile, outPrefix] = process.argv.slice(2);
const key = process.env.GEMINI_API_KEY;
if (!key) { console.error('GEMINI_API_KEY 없음'); process.exit(1); }
const texts = JSON.parse(readFileSync(textsFile, 'utf8'));
const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent`;

async function one(text) {
  // 5xx 는 한 번만 다시 부른다(서버 쪽 일시 오류). 4xx 는 다시 부르지 않는다.
  // 429 분당 한도는 위 takeSlot 이 막는다. 그래도 걸리면(다른 기계가 같은 프로젝트를 쓸 때) 서버가 준 retryDelay 만큼 한 번 기다린다 —
  //   하루 한도(PerDay)·그 밖의 429 는 기다려도 같으므로 바로 실패(부르는 쪽이 회차 전체를 melo 로).
  let waited = false;
  for (let t = 0; ; t++) {
    await takeSlot(CALLS, { log: (m) => console.error(`  [gemini-tts] ${m}`) });
    const r = await fetch(url, { method: 'POST', headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify(geminiTtsBody(text, GEMINI_TTS_VOICE)), signal: AbortSignal.timeout(120_000) });
    const body = await r.text();
    if (r.status >= 500 && t === 0) { console.error(`  [gemini-tts] HTTP ${r.status} — 한 번 더`); continue; }
    let j; try { j = JSON.parse(body); } catch { throw new Error(`HTTP ${r.status} JSON 아님: ${body.slice(0, 60)}`); }
    const e = r.status === 429 ? geminiError(j) : null;
    if (e && !waited && /PerMinute/.test(e.quotaId ?? '') && e.retryMs && e.retryMs <= 65_000) {
      console.error(`  [gemini-tts] ${e.message.slice(0, 90)} — 서버가 준 ${e.retryMs / 1000}초를 한 번 기다린다`);
      waited = true; await new Promise((res) => setTimeout(res, e.retryMs + 200)); continue;
    }
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
