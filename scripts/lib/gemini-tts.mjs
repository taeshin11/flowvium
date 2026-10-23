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
  { const e = geminiError(json); if (e) throw Object.assign(new Error(e.message), e); }
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

/**
 * API 오류 → {code, quotaId, quotaValue, retryMs, message}. 오류가 없으면 null.
 * 10/23 유료 키 32문장(동시 3)에서 429 "exceeded your current quota" 만 남아 어떤 한도인지 몰랐다 — 한도 이름·값·기다릴 시간을 싣는다.
 */
export function geminiError(json) {
  const e = json?.error; if (!e) return null;
  const det = Array.isArray(e.details) ? e.details : [];
  const v = det.find((d) => /QuotaFailure/.test(d?.['@type'] ?? ''))?.violations?.[0] ?? null;
  const delay = det.find((d) => /RetryInfo/.test(d?.['@type'] ?? ''))?.retryDelay ?? null;
  const retryMs = delay && /^[\d.]+s$/.test(delay) ? Math.round(parseFloat(delay) * 1000) : null;
  const quotaValue = v?.quotaValue != null && Number.isFinite(Number(v.quotaValue)) ? Number(v.quotaValue) : null;
  const msg = `API 오류 ${e.code ?? ''}${v?.quotaId ? ` ${v.quotaId}=${quotaValue ?? '?'}` : ''}${retryMs ? ` (${retryMs / 1000}초 뒤)` : ''} ${String(e.message ?? '').slice(0, 100)}`;
  return { code: e.code ?? null, quotaId: v?.quotaId ?? null, quotaValue, retryMs, message: msg };
}

/**
 * 분당 한도까지 남은 기다림(ms). 최근 60초 안 호출 시각들(stamps)이 rpm 개 이상이면, 그중 rpm 번째로 최근 것이 60초를 넘길 때까지.
 * 10/23 실측 한도: GenerateRequestsPerMinutePerProjectPerModel=10(유료 Tier 1). 쇼츠·롱폼·광고가 같은 프로젝트 한도를 쓴다.
 */
export function slotWaitMs(stamps, { rpm, now = Date.now() }) {
  const recent = (stamps ?? []).filter((t) => now - t < 60_000).sort((a, b) => b - a);
  if (recent.length < rpm) return 0;
  return Math.max(0, recent[rpm - 1] + 60_000 - now);
}

/** 프로세스 사이에서 같이 세는 호출 기록 파일. mkdir 잠금으로 읽고-쓰기를 한 번에 한다. */
export const GEMINI_RPM = Number(process.env.KO_TTS_GEMINI_RPM || 9);   // 한도 10 에서 하나 남긴다(다른 프로세스와 겹칠 틈)
export async function takeSlot(file, { rpm = GEMINI_RPM, log = () => {} } = {}) {
  const { readFileSync, writeFileSync, mkdirSync, rmdirSync, statSync } = await import('fs');
  const lock = `${file}.lock`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (;;) {
    try { mkdirSync(lock); } catch {
      // 주인이 죽어 남은 잠금(30초 넘음)은 걷는다 — 잠금 안에서는 파일 읽고 쓰기만 한다(수 ms).
      try { if (Date.now() - statSync(lock).mtimeMs > 30_000) rmdirSync(lock); } catch { /* 이미 없음 */ }
      await sleep(50); continue;
    }
    let stamps = [];
    try {
      try { stamps = JSON.parse(readFileSync(file, 'utf8')); } catch { stamps = []; }
      const now = Date.now();
      const wait = slotWaitMs(stamps, { rpm, now });
      if (wait === 0) {
        writeFileSync(file, JSON.stringify([...stamps.filter((t) => now - t < 60_000), now]));
        return;
      }
      log(`분당 한도(${rpm}) — ${Math.ceil(wait / 1000)}초 기다린다`);
      rmdirSync(lock);
      await sleep(wait + 50);
      continue;
    } finally { try { rmdirSync(lock); } catch { /* 이미 풂 */ } }
  }
}

/**
 * TTS 키·엔진 — .env.local 파일 값이 물려받은 환경보다 먼저(10/23). 오래 떠 있는 cron-runner 는 시작할 때 읽은 값을 자식에게 물려주고,
 * runner·loadEnvLocal 둘 다 '이미 있으면 안 덮는다'라서, 파일에서 키를 바꿔도 러너가 다시 뜰 때까지 옛 무료 키로 돌았다.
 */
export function ttsSettings({ fileText = '', env = process.env } = {}) {
  const file = {};
  for (const line of String(fileText).split('\n')) {
    const m = /^\s*(GEMINI_API_KEY|KO_TTS_ENGINE)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) file[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return { key: file.GEMINI_API_KEY || env.GEMINI_API_KEY || '', engine: env.KO_TTS_ENGINE_FORCE || file.KO_TTS_ENGINE || env.KO_TTS_ENGINE || '' };   // FORCE = 한 번만 바꿔 돌릴 때(시험·손 실행)
}
