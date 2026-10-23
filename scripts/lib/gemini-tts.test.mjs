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
// [10] 문장 묶기 — 10/23 12:07 하루 한도 429(GenerateRequestsPerDayPerProjectPerModel=100). 롱폼이 문장마다 한 번씩 불러
//   한 편 33회 + 되듣기 재호출 → 하루 롱폼 3편·쇼츠·광고가 100회에 못 들어간다. 이어진 문장을 글자 수 한도까지 한 호출로 묶는다.
{
  const { batchTexts } = await import('./gemini-tts.mjs');
  const g = batchTexts(['가'.repeat(100), '나'.repeat(100), '다'.repeat(100), '라'.repeat(250), '마'.repeat(50)], { maxChars: 320 });
  (JSON.stringify(g) === JSON.stringify([[0, 1, 2], [3, 4]])) ? ok('[10] 순서 그대로, 한도 안에서 묶는다') : bad(`[10] ${JSON.stringify(g)}`);
  (JSON.stringify(batchTexts(['가'.repeat(500), '나'], { maxChars: 320 })) === JSON.stringify([[0], [1]])) ? ok('[10b] 한도보다 긴 문장은 혼자') : bad('[10b]');
}
// [11] 묶음 소리를 문장으로 자른다 — 자르는 자리는 whisper 글자 시각(±0.2초 흔들림) 근처의 가장 조용한 곳.
//   정렬이 문장 경계를 못 잡으면(순서 뒤집힘·너무 짧은 조각) 던진다 — 부르는 쪽이 그 묶음만 문장별로 다시 부른다.
{
  const { splitBatch } = await import('./gemini-tts.mjs');
  const rate = 1000; const seg = (sec, amp) => Array.from({ length: Math.round(sec * rate) }, (_, k) => (amp ? Math.round(amp * Math.sin(k)) : 0));
  // 말 1.0초 · 쉼 0.4초 · 말 1.5초 · 쉼 0.4초 · 말 0.8초
  const pcm = Int16Array.from([...seg(1.0, 8000), ...seg(0.4, 0), ...seg(1.5, 8000), ...seg(0.4, 0), ...seg(0.8, 8000)]);
  const texts = ['가나다.', '라마바사.', '아자.'];
  const joined = texts.join(' ');   // 가나다. 라마바사. 아자.
  // whisper 같은 시각: 실제 경계보다 0.15초 늦게·이르게 흔들림
  const st = []; const en = [];
  const span = (from, to, n) => { for (let k = 0; k < n; k++) { st.push(from + (to - from) * k / n); en.push(from + (to - from) * (k + 1) / n); } };
  span(0, 1.15, 4); st.push(1.15); en.push(1.15); span(1.25, 2.95, 5); st.push(2.95); en.push(2.95); span(3.15, 3.7, 3);
  const pieces = splitBatch({ pcm, rate, texts, alignment: { characters: [...joined], character_start_times_seconds: st, character_end_times_seconds: en } });
  const cuts = pieces.slice(1).map((p) => p.start / rate);
  (pieces.length === 3 && cuts[0] > 1.0 && cuts[0] < 1.4 && cuts[1] > 2.9 && cuts[1] < 3.3)
    ? ok(`[11] 쉼 안에서 자른다(${cuts.map((c) => c.toFixed(2)).join(', ')})`) : bad(`[11] ${JSON.stringify(cuts)}`);
  (pieces[1].alignment.characters.join('') === '라마바사.' && pieces[1].alignment.character_start_times_seconds[0] >= 0 && pieces[1].alignment.character_start_times_seconds[0] < 0.2)
    ? ok('[11b] 조각마다 자기 글자·시각(조각 처음 기준)') : bad(`[11b] ${JSON.stringify(pieces[1].alignment).slice(0, 200)}`);
  (pieces[2].end === pcm.length && pieces[0].start === 0) ? ok('[11c] 처음·끝까지 빠짐없이') : bad('[11c]');
  // [11d] 쉼이 없는 소리(문장이 붙어 나옴)는 자를 곳이 없다 → 던진다. (정렬 시각이 엉터리여도 진짜 쉼이 있으면 [11f] 처럼 쉼으로 자른다.)
  let threw = false;
  const flat = Int16Array.from(seg(3.7, 8000));
  try { splitBatch({ pcm: flat, rate, texts, alignment: { characters: [...joined], character_start_times_seconds: st, character_end_times_seconds: en } }); } catch { threw = true; }
  threw ? ok('[11d] 쉼이 없으면 던진다') : bad('[11d] 쉼 없는 소리를 그냥 잘랐다');
}
// [11e] 10/23 실측(Kore 광고 두 문장 이음): whisper 가 앞 문장 끝 "요" 를 1.1초 늦게(다음 문장 첫 낱말에) 붙였다.
//   좁은 창(경계 −0.1~+0.3초)은 진짜 쉼(6.4~7.3초)을 못 보고 "종목" 안의 짧은 틈을 잘랐다 → 앞 조각 끝에 "종목!" 이 들림.
//   문장 사이 쉼은 길고(0.3초↑) 낱말 사이 틈은 짧다(0.1초↓) — 넓게 보고 긴 쉼을 고른다.
{
  const { splitBatch } = await import('./gemini-tts.mjs');
  const rate = 1000; const seg = (sec, amp) => Array.from({ length: Math.round(sec * rate) }, (_, k) => (amp ? Math.round(amp * Math.sin(k)) : 0));
  // 말 6.4초 · 쉼 0.9초 · 말 0.3초 · 틈 0.07초 · 말 3.33초
  const pcm = Int16Array.from([...seg(6.4, 8000), ...seg(0.9, 0), ...seg(0.3, 8000), ...seg(0.07, 0), ...seg(3.33, 8000)]);
  const texts = ['가'.repeat(20) + '.', '나'.repeat(10) + '.'];
  const joined = [...texts.join(' ')];
  const st = []; const en = [];
  for (let k = 0; k < 19; k++) { st.push(k * 0.33); en.push((k + 1) * 0.33); }
  st.push(7.36); en.push(7.48); st.push(7.48); en.push(7.6); st.push(7.6); en.push(7.72);   // "가"(마지막)·"."·" " 가 늦게 붙음
  for (let k = 0; k < 10; k++) { st.push(7.72 + k * 0.3); en.push(7.72 + (k + 1) * 0.3); }
  st.push(10.7); en.push(10.8);
  const ps = splitBatch({ pcm, rate, texts, alignment: { characters: joined, character_start_times_seconds: st, character_end_times_seconds: en } });
  const cut = ps[1].start / rate;
  (cut > 6.5 && cut < 7.2) ? ok(`[11e] 정렬이 늦어도 긴 쉼에서 자른다(${cut.toFixed(2)})`) : bad(`[11e] ${cut.toFixed(2)} — 진짜 쉼은 6.4~7.3`);
}
// [11f] 10/23 16:03 실호출(Kore, 4문장 29초 한 묶음): 문장 사이 쉼 7.46(+0.78)·15.43(+0.83)·22.21(+0.75), 문장 안 쉼은 0.28초 이하.
//   whisper 는 긴 소리에서 2·3번 경계를 13.75초로 2.1초 일찍 짚었다 → ±1.2초 창에 쉼이 없어 던짐(묶음 통째 문장별 재호출 = 호출 5번).
//   넓게(±3초) 보되 경계마다 다른 쉼을, 순서대로 배정한다(합이 가장 좋은 조합).
{
  const { splitBatch } = await import('./gemini-tts.mjs');
  const rate = 1000; const seg = (sec, amp) => Array.from({ length: Math.round(sec * rate) }, (_, k) => (amp ? Math.round(amp * Math.sin(k)) : 0));
  const plan = [[0, 0.32, 0], [0.32, 4.21, 1], [4.21, 4.43, 0], [4.43, 7.46, 1], [7.46, 8.24, 0], [8.24, 10.97, 1], [10.97, 11.2, 0], [11.2, 15.43, 1],
    [15.43, 16.26, 0], [16.26, 19.52, 1], [19.52, 19.75, 0], [19.75, 22.21, 1], [22.21, 22.96, 0], [22.96, 25.95, 1], [25.95, 26.18, 0], [26.18, 29.08, 1]];
  const pcm = Int16Array.from(plan.flatMap(([a, b, on]) => seg(b - a, on ? 8000 : 0)));
  const texts = ['가'.repeat(30) + '.', '나'.repeat(30) + '.', '다'.repeat(30) + '.', '라'.repeat(30) + '.'];
  // whisper 경계 짐작: 7.6 · 13.75(2.1초 이름) · 22.4
  const bounds = [[0.4, 7.5], [7.7, 13.7], [13.8, 22.3], [22.5, 28.9]];
  const st = []; const en = [];
  bounds.forEach(([a, b], k) => { for (let j = 0; j < 31; j++) { st.push(a + (b - a) * j / 31); en.push(a + (b - a) * (j + 1) / 31); } if (k < 3) { st.push(b); en.push(b); } });
  let cuts = null; let err = null;
  try { cuts = splitBatch({ pcm, rate, texts, alignment: { characters: [...texts.join(' ')], character_start_times_seconds: st, character_end_times_seconds: en } }).slice(1).map((p) => p.start / rate); } catch (e) { err = e.message; }
  (cuts && cuts[0] > 7.46 && cuts[0] < 8.24 && cuts[1] > 15.43 && cuts[1] < 16.26 && cuts[2] > 22.21 && cuts[2] < 22.96)
    ? ok(`[11f] 정렬이 2초 어긋나도 문장 쉼에 배정(${cuts.map((c) => c.toFixed(2)).join(', ')})`) : bad(`[11f] ${err ?? JSON.stringify(cuts)}`);
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
