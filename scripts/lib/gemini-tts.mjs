/**
 * gemini-tts.mjs — Gemini TTS 요청·응답(순수 함수). 근거·규칙은 gemini-tts.test.mjs 머리말.
 */
export const GEMINI_TTS_MODEL = process.env.KO_TTS_GEMINI_MODEL || 'gemini-3.8-flash-tts';
export const GEMINI_TTS_VOICE = process.env.KO_TTS_GEMINI_VOICE || 'Kore';

/** 대본 글만 보낸다 — 말투 지시를 붙이면 그 지시를 읽는다(10/22 실측). */
export function geminiTtsBody(text, voice = GEMINI_TTS_VOICE) {
  return {
    contents: [{ parts: [{ text: String(text) }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
  };
}

function wavHeader(pcmBytes, rate, channels = 1, bits = 16) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcmBytes, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * channels * bits / 8, 28); h.writeUInt16LE(channels * bits / 8, 32); h.writeUInt16LE(bits, 34);
  h.write('data', 36); h.writeUInt32LE(pcmBytes, 40);
  return h;
}

/** 응답 JSON → WAV Buffer. 소리가 없으면 이유를 담아 던진다. */
export function parseGeminiAudio(json) {
  if (!json || typeof json !== 'object') throw new Error('응답이 JSON 이 아니다');
  if (json.error) throw new Error(`API 오류 ${json.error.code ?? ''} ${String(json.error.message ?? '').slice(0, 120)}`);
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const p = parts.find((x) => x?.inlineData?.data && /^audio\//i.test(x.inlineData.mimeType ?? ''));
  if (!p) throw new Error(`소리 없음 — ${json.candidates?.[0]?.finishReason ?? ''} ${String(parts.find((x) => x?.text)?.text ?? '').slice(0, 60)}`);
  const buf = Buffer.from(p.inlineData.data, 'base64');
  if (!buf.length) throw new Error('소리가 비었다');
  const mime = p.inlineData.mimeType.toLowerCase();
  if (/wav/.test(mime)) return buf;
  const rate = Number(/rate=(\d+)/.exec(mime)?.[1] ?? 24000);
  if (/l16|pcm/.test(mime)) return Buffer.concat([wavHeader(buf.length, rate), buf]);
  throw new Error(`모르는 소리 형식 ${mime}`);
}

/**
 * 어느 엔진으로 읽나. gemini 는 **KO_TTS_ENGINE=gemini 일 때만**(키도 있어야) — 기본은 melo.
 *   2026-10-22 실측: 이 키는 무료 등급이다 — 429 GenerateRequestsPerMinutePerProjectPerModel-FreeTier, quotaValue 3(분당 3회).
 *   하루 ~120문장(쇼츠 9편·시장 요약 2편)을 문장마다 부르면 무료 등급으로는 회차 대부분이 melo 로 떨어진다.
 *   유료 결제는 사장님 결정이라, 켜지면 .env.local 에 KO_TTS_ENGINE=gemini 한 줄로 바꾼다.
 */
export function koEngine({ env = process.env, hasKey }) {
  const want = String(env.KO_TTS_ENGINE ?? '').toLowerCase();
  if (want === 'gemini') return hasKey ? 'gemini' : 'melo';
  return want || 'melo';
}
