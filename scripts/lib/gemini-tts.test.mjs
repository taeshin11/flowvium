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
// [7] 429 는 어떤 한도에 걸렸는지(quotaId·값)와 기다리라는 시간(retryDelay)을 이유에 싣는다.
//   10/23 유료 키로 32문장(동시 3)을 부르자 429 "exceeded your current quota" 만 남아 무슨 한도인지 몰랐다.
{
  const { geminiError } = await import('./gemini-tts.mjs');
  const e = geminiError({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota', details: [
    { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel', quotaValue: '10' }] },
    { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '17s' }] } });
  (e.code === 429 && e.quotaId === 'GenerateRequestsPerMinutePerProjectPerModel' && e.quotaValue === 10 && e.retryMs === 17000 && /PerMinute.*10/.test(e.message))
    ? ok('[7] 429 → quotaId·값·retryDelay') : bad(`[7] ${JSON.stringify(e)}`);
  (geminiError({ candidates: [] }) === null) ? ok('[7b] 오류 없으면 null') : bad('[7b]');
}
// [8] 분당 한도 지키기 — 10/23 실측: 유료(Tier 1) 키 한도는 GenerateRequestsPerMinutePerProjectPerModel=10.
//   문장마다 동시 3개로 부르면 32문장 중 9개째에 429. 프로세스가 여럿(쇼츠·롱폼·광고)이라 파일 하나로 같이 센다.
//   최근 60초 안 호출이 rpm 개면 가장 오래된 것이 60초를 넘길 때까지 기다린다.
{
  const { slotWaitMs } = await import('./gemini-tts.mjs');
  const now = 100_000;
  (slotWaitMs([], { rpm: 9, now }) === 0) ? ok('[8] 기록 없으면 바로') : bad('[8]');
  const full = Array.from({ length: 9 }, (_, k) => now - 50_000 + k * 1000);   // 50초 전부터 9번
  (slotWaitMs(full, { rpm: 9, now }) === 10_000) ? ok('[8b] 60초 안 9번이면 가장 오래된 것이 빠질 때까지(10초)') : bad(`[8b] ${slotWaitMs(full, { rpm: 9, now })}`);
  (slotWaitMs(full.slice(1), { rpm: 9, now }) === 0) ? ok('[8c] 8번이면 바로') : bad('[8c]');
  (slotWaitMs([now - 70_000, ...full.slice(1)], { rpm: 9, now }) === 0) ? ok('[8d] 60초 지난 기록은 안 센다') : bad('[8d]');
}
// [9] 키·엔진은 .env.local 파일이 이긴다 — 10/23: 오래 떠 있는 cron-runner 가 시작할 때 읽은 옛 무료 키를 자식에게 물려준다
//   (loadEnvLocal·runner 둘 다 '이미 있으면 안 덮는다'). 파일을 바꿔도 러너가 다시 뜰 때까지 옛 키·엔진 없음으로 돌았다.
{
  const { ttsSettings } = await import('./gemini-tts.mjs');
  const file = '# c\nGEMINI_API_KEY=NEWKEY\nKO_TTS_ENGINE=gemini\n';
  const r = ttsSettings({ fileText: file, env: { GEMINI_API_KEY: 'OLDKEY' } });
  (r.key === 'NEWKEY' && r.engine === 'gemini') ? ok('[9] 파일 값이 물려받은 환경보다 먼저') : bad(`[9] ${JSON.stringify(r)}`);
  const r2 = ttsSettings({ fileText: '', env: { GEMINI_API_KEY: 'ENVKEY', KO_TTS_ENGINE: 'melo' } });
  (r2.key === 'ENVKEY' && r2.engine === 'melo') ? ok('[9b] 파일에 없으면 환경 값') : bad(`[9b] ${JSON.stringify(r2)}`);
  const r3 = ttsSettings({ fileText: 'KO_TTS_ENGINE=gemini\n', env: {} });
  (r3.key === '' && r3.engine === 'gemini') ? ok('[9c] 키가 없으면 빈 값(엔진은 koEngine 이 melo 로 돌린다)') : bad(`[9c] ${JSON.stringify(r3)}`);
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
