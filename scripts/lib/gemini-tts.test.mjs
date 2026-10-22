#!/usr/bin/env node
/**
 * gemini-tts.test.mjs — 한국어 내레이션을 Gemini TTS 'Kore' 로. 2026-10-22 신설.
 * 사용자 10/22 "목소리가 너무 AI스러운데 … 제미나이 TTS 써가지고" → Melo·Kore·Charon 비교 청취 뒤 "Kore 로 하자".
 * 실측(같은 4문장, scratchpad gtts): gemini-3.8-flash-tts, 헤더 x-goog-api-key 로만 된다(키를 URL 에 넣으면 404).
 *   systemInstruction 은 거절("Developer instruction is not enabled"), 본문에 말투 지시를 붙이면 그 지시를 소리 내 읽는다
 *   → **대본 글만** 보낸다. 응답은 inlineData audio/wav(4문장 534 오디오 토큰). 되들음: Kore 는 숫자까지 원문과 같았다.
 * 규칙:
 *   - 응답에 소리가 없으면(텍스트·오류·HTML) '없음' 으로 던진다 — 빈 wav 를 만들지 않는다.
 *   - PCM(audio/L16;rate=…)이 오면 그 rate 로 WAV 머리를 붙인다.
 *   - 엔진: KO_TTS_ENGINE=gemini(키 있음)일 때만 gemini, 기본은 melo. 이 키가 무료 등급(분당 3회, 10/22 429 실측)이라
 *     유료 결제(사장님 결정) 전에는 켜지 않는다 — 켜 두면 회차마다 목소리가 갈린다.
 *   - 실패하면 **회차 전체**를 melo 로 — 한 편 안에서 목소리가 섞이지 않게. 왜 바뀌었는지 로그·logs/tts-engine.jsonl 에 남긴다.
 */
import { readFileSync } from 'fs';
import { geminiTtsBody, parseGeminiAudio, koEngine } from './gemini-tts.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
{
  const b = geminiTtsBody('나스닥은 1.05% 올랐습니다.', 'Kore');
  const t = b.contents?.[0]?.parts?.[0]?.text;
  (t === '나스닥은 1.05% 올랐습니다.' && b.generationConfig.responseModalities[0] === 'AUDIO'
    && b.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName === 'Kore' && !b.systemInstruction)
    ? ok('[1] 대본 글만 · AUDIO · Kore · systemInstruction 없음') : bad(`[1] ${JSON.stringify(b)}`);
}
{
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(40)]);
  const r = parseGeminiAudio({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: wav.toString('base64') } }] } }] });
  r.subarray(0, 4).toString() === 'RIFF' ? ok('[2] audio/wav 는 그대로') : bad('[2]');
}
{
  const pcm = Buffer.alloc(48000);   // 24kHz 16bit mono 1초
  const r = parseGeminiAudio({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm.toString('base64') } }] } }] });
  (r.subarray(0, 4).toString() === 'RIFF' && r.readUInt32LE(24) === 24000 && r.length === 48044) ? ok('[3] PCM 은 rate 로 WAV 머리를 붙인다') : bad(`[3] ${r.length} ${r.readUInt32LE(24)}`);
}
{
  const cases = [{ candidates: [{ content: { parts: [{ text: '죄송합니다' }] } }] }, { error: { code: 429, message: 'quota' } }, '<html>', null];
  const thrown = cases.filter((c) => { try { parseGeminiAudio(c); return false; } catch { return true; } }).length;
  thrown === cases.length ? ok('[4] 소리 없는 응답(텍스트·오류·HTML·null)은 던진다') : bad(`[4] ${thrown}/${cases.length}`);
}
{
  const a = koEngine({ env: {}, hasKey: true }), b = koEngine({ env: { KO_TTS_ENGINE: 'gemini' }, hasKey: true });
  const c = koEngine({ env: { KO_TTS_ENGINE: 'gemini' }, hasKey: false }), d = koEngine({ env: { KO_TTS_ENGINE: 'qwen' }, hasKey: true });
  (a === 'melo' && b === 'gemini' && c === 'melo' && d === 'qwen') ? ok('[5] 기본 melo · KO_TTS_ENGINE=gemini(키 있음)만 gemini · 키 없으면 melo') : bad(`[5] ${a} ${b} ${c} ${d}`);
}
{
  const s = readFileSync(new URL('./tts-korean.mjs', import.meta.url), 'utf8');
  (/synthesizeKoreanGemini\(/.test(s) && /tts-engine\.jsonl/.test(s)) ? ok('[6] synthesizeKoreanAuto 가 gemini 를 쓰고 바뀐 이유를 남긴다') : bad('[6] tts-korean 연결 안 됨');
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
