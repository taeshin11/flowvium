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

/**
 * 문장 묶기(10/23). 하루 한도가 프로젝트·모델당 100회(12:07 429 GenerateRequestsPerDayPerProjectPerModel=100)라
 * 문장마다 부르면 롱폼 한 편이 33회다. 이어진 문장을 maxChars 까지 한 호출로 묶는다 — 순서는 그대로, 한도보다 긴 문장은 혼자.
 */
export const GEMINI_BATCH_CHARS = Number(process.env.KO_TTS_GEMINI_BATCH_CHARS || 320);
export function batchTexts(texts, { maxChars = GEMINI_BATCH_CHARS } = {}) {
  const groups = []; let cur = []; let n = 0;
  texts.forEach((t, i) => {
    const len = String(t).length;
    if (cur.length && n + len > maxChars) { groups.push(cur); cur = []; n = 0; }
    cur.push(i); n += len;
  });
  if (cur.length) groups.push(cur);
  return groups;
}
export const BATCH_SEP = ' ';

/**
 * 묶음 소리(texts 를 BATCH_SEP 로 이은 것)를 문장 조각으로 자른다. alignment 는 이은 글 전체의 글자 시각(whisper, ±0.2초 흔들림).
 * 경계마다 ±3초 안의 쉼(0.12초↑)을 순서대로 하나씩 배정한다(길고 가까울수록 좋음, 합이 최대인 조합). 쉼의 가운데를 자른다.
 * 못 믿을 때는 던진다: 그런 배정이 없거나, 조각 길이가 글자 수와 3배 넘게 어긋날 때.
 * 반환: [{ start, end (표본 번호), alignment(조각 처음 기준 시각) }]
 */
export function splitBatch({ pcm, rate, texts, alignment }) {
  const chars = alignment.characters; const st = alignment.character_start_times_seconds; const en = alignment.character_end_times_seconds;
  const n = texts.length; const total = pcm.length;
  if (n === 1) return [{ start: 0, end: total, alignment }];
  const ranges = []; let off = 0;
  for (const t of texts) { ranges.push([off, off + t.length]); off += t.length + BATCH_SEP.length; }
  if (chars.length !== off - BATCH_SEP.length) throw new Error(`정렬 글자 수 ${chars.length} ≠ 이은 글 ${off - BATCH_SEP.length}`);
  const spoken = (c) => /[^\s.,!?·…"'“”‘’()~-]/.test(c);
  const lastSpoken = ([a, b]) => { for (let k = b - 1; k >= a; k--) if (spoken(chars[k])) return k; return b - 1; };
  const firstSpoken = ([a, b]) => { for (let k = a; k < b; k++) if (spoken(chars[k])) return k; return a; };
  const frame = Math.max(1, Math.round(rate * 0.02));
  const level = (from) => { let sum = 0; const to = Math.min(total, from + frame); for (let k = from; k < to; k++) sum += Math.abs(pcm[k]); return sum / Math.max(1, to - from); };
  const levels = []; for (let k = 0; k + frame <= total; k += frame) levels.push(level(k));
  const loud = [...levels].sort((a, b) => a - b)[Math.floor(levels.length * 0.75)] || 1;   // 말소리 크기(상위 25% 경계)
  // 조용한 구간(말소리의 5% 아래)을 이어 붙여 쉼 목록을 만든다. 0.12초보다 짧은 것은 낱말 사이 틈이라 버린다.
  const hop = Math.max(1, frame >> 1); const quiet = loud * 0.05; const pauses = [];
  for (let x = 0, s0 = -1; x + frame <= total + hop; x += hop) {
    const q = x + frame <= total && level(x) <= quiet;
    if (q && s0 < 0) s0 = x;
    if (!q && s0 >= 0) { const e0 = Math.min(total, x - hop + frame); if ((e0 - s0) / rate >= 0.12) pauses.push([s0, e0]); s0 = -1; }
  }
  // whisper 는 긴 소리에서 경계를 1~2초 틀리게 짚는다(10/23 실측: 문장 끝 1.1초 늦게, 29초 묶음에서 2.1초 이르게).
  // 경계마다 ±3초 안의 쉼을 후보로, 경계마다 **다른** 쉼을 **순서대로** 배정하는 조합 중 점수 합이 가장 큰 것을 고른다
  // (점수 = 쉼 길이 − 0.3×짐작과의 거리). 문장 사이 쉼(0.75초↑)은 문장 안 쉼(0.3초↓)보다 길어서 대개 그쪽이 이긴다.
  const at = []; for (let k = 0; k < n - 1; k++) at.push((en[lastSpoken(ranges[k])] + st[firstSpoken(ranges[k + 1])]) / 2);
  const cand = pauses.filter(([p0, p1]) => p0 > 0 && p1 < total).map(([p0, p1]) => ({ mid: Math.round((p0 + p1) / 2), len: (p1 - p0) / rate }));
  const score = (k, c) => (Math.abs(c.mid / rate - at[k]) > 3 ? -Infinity : c.len - 0.3 * Math.abs(c.mid / rate - at[k]));
  // best[k][j] = 경계 0..k 를 배정하고 경계 k 에 후보 j 를 쓸 때의 최고 합
  const best = []; const from = [];
  for (let k = 0; k < n - 1; k++) {
    best.push(cand.map(() => -Infinity)); from.push(cand.map(() => -1));
    cand.forEach((c, j) => {
      const sc = score(k, c); if (sc === -Infinity) return;
      if (k === 0) { best[k][j] = sc; return; }
      for (let i = 0; i < j; i++) if (best[k - 1][i] + sc > best[k][j]) { best[k][j] = best[k - 1][i] + sc; from[k][j] = i; }
    });
  }
  let j = best.length ? best[n - 2].indexOf(Math.max(...best[n - 2])) : -1;
  if (j < 0 || best[n - 2][j] === -Infinity) throw new Error(`문장 경계 ${n - 1}곳에 맞는 쉼을 순서대로 못 찾음(짐작 ${at.map((x) => x.toFixed(2)).join(', ')}초)`);
  const picked = [];
  for (let k = n - 2; k >= 0; k--) { picked.unshift(cand[j].mid); j = from[k][j]; }
  const cuts = [0, ...picked];
  cuts.push(total);
  const perChar = total / rate / texts.reduce((s, t) => s + t.length, 0);
  return texts.map((t, k) => {
    const start = cuts[k]; const end = cuts[k + 1]; const sec = (end - start) / rate; const want = t.length * perChar;
    if (sec < want / 3 || sec > want * 3) throw new Error(`${k + 1}번 조각 ${sec.toFixed(2)}초 — 글자 수로 본 ${want.toFixed(2)}초와 3배 넘게 다르다`);
    const [a, b] = ranges[k]; const s0 = start / rate;
    const clip = (x) => Math.min(sec, Math.max(0, x - s0));
    return { start, end, alignment: { characters: chars.slice(a, b), character_start_times_seconds: st.slice(a, b).map(clip), character_end_times_seconds: en.slice(a, b).map(clip) } };
  });
}

/** 16비트 PCM wav 읽기·쓰기(조각 자르기용). 다른 형식이면 던진다. */
export function readWav16(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('wav 아님');
  let p = 12; let fmt = null;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4); const size = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(p + 8), channels: buf.readUInt16LE(p + 10), rate: buf.readUInt32LE(p + 12), bits: buf.readUInt16LE(p + 22) };
    if (id === 'data') {
      if (!fmt || fmt.format !== 1 || fmt.bits !== 16 || fmt.channels !== 1) throw new Error(`16비트 모노 PCM 아님: ${JSON.stringify(fmt)}`);
      const data = buf.subarray(p + 8, p + 8 + Math.min(size, buf.length - p - 8));
      return { rate: fmt.rate, pcm: new Int16Array(data.buffer.slice(data.byteOffset, data.byteOffset + (data.length & ~1))) };
    }
    p += 8 + size + (size & 1);
  }
  throw new Error('wav data 없음');
}
export function writeWav16(pcm, rate) {
  const body = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  return Buffer.concat([wavHeader(body.length, rate), body]);
}
