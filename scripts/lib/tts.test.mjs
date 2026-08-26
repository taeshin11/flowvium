#!/usr/bin/env node
/**
 * tts.test.mjs — 앵커 음성 합성이 공급자 교체 가능한 한 칸인가.
 *
 * 배경(2026-08-27): 유튜브 이슈채널용 앵커 목소리.
 *   맥 내장 TTS(Yuna)로 실물을 뽑아 들려드렸고(33.6s/30.9s/28.1s, 실제 FlowVium 데이터 대본),
 *   사용자 판정 "별로" → ElevenLabs 로 결정.
 *   실측으로 확인된 맥 TTS 의 한계: ko_KR 로 9종이 나열되지만 **실제로 한국어를 말하는 건 Yuna 뿐**
 *   (나머지는 같은 입력에 4,800 bytes 고정 = 무음). 감정·강조 제어 없음.
 *
 * 그래서 공급자를 갈아끼울 수 있어야 한다. 파이프라인에서 TTS 는 한 칸이고,
 *   품질 판단이 바뀔 때마다 상류(대본)와 하류(합성)를 건드리면 안 된다.
 *
 * 키는 .env.local 에서 읽는다(gitignore 확인됨: .gitignore:26 `.env*.local`).
 *   코드에 박거나 인자로 넘기지 않는다 — 로그·프로세스 목록에 남는다.
 */
import { existsSync, rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const M = await import('./tts.mjs')
  .catch(e => { bad(`tts.mjs 없음: ${String(e.message).slice(0,60)}`); return null; });
if (!M) { console.log('\n❌ 실패'); process.exit(1); }

// [1] 공급자가 등록돼 있고 교체 가능한가
{
  const p = M.listProviders();
  p.includes('mac') && p.includes('elevenlabs')
    ? ok(`공급자 등록: ${p.join(', ')}`)
    : bad(`공급자 목록이 부족하다: ${p.join(', ')}`);
}
// [2] 키가 없으면 조용히 실패하지 않고 무엇이 없는지 말하는가
{
  const r = await M.synthesize('테스트', { provider: 'elevenlabs', apiKey: '', outPath: '/tmp/x.mp3' })
    .then(() => null).catch(e => e);
  r && /ELEVENLABS_API_KEY|키/.test(String(r.message))
    ? ok(`키 없음을 명시: ${String(r.message).slice(0, 60)}`)
    : bad(`키 없이 조용히 넘어가거나 원인을 안 밝힌다: ${r && r.message}`);
}
// [3] 맥 공급자는 키 없이 실제로 소리를 만든다 (파일 크기로 무음 판별)
{
  const out = '/tmp/tts-mac-test.m4a';
  try { rmSync(out); } catch {}
  const r = await M.synthesize('플로비움 마켓 브리핑입니다.', { provider: 'mac', voice: 'Yuna', outPath: out }).catch(e => e);
  if (r instanceof Error) bad(`맥 합성 실패: ${r.message}`);
  else {
    const { statSync } = await import('fs');
    const sz = existsSync(out) ? statSync(out).size : 0;
    sz > 10_000 ? ok(`맥 합성 실동작 (${(sz/1024).toFixed(0)}KB)`) : bad(`무음 의심 (${sz} bytes) — 설치 안 된 음성`);
    try { rmSync(out); } catch {}
  }
}
// [4] 무음 공급자(설치 안 된 음성)를 성공으로 보고하지 않는가
{
  const out = '/tmp/tts-silent.m4a';
  const r = await M.synthesize('테스트 문장', { provider: 'mac', voice: 'Sandy', outPath: out }).catch(e => e);
  r instanceof Error && /무음|silent/.test(String(r.message))
    ? ok(`무음 출력을 실패로 잡는다: ${String(r.message).slice(0, 50)}`)
    : bad('무음 파일을 성공으로 돌려준다 — 소리 없는 영상이 나간다');
  try { rmSync(out); } catch {}
}
// [5] 키를 인자·로그로 흘리지 않는가
{
  const { readFileSync } = await import('fs');
  const src = readFileSync(resolve(ROOT, 'scripts/lib/tts.mjs'), 'utf8');
  /console\.log\([^)]*apiKey|console\.warn\([^)]*apiKey/.test(src)
    ? bad('키를 로그에 찍는다') : ok('키를 로그에 찍지 않는다');
  /process\.argv[^\n]*apiKey|--api-key/.test(src)
    ? bad('키를 CLI 인자로 받는다 — 프로세스 목록에 남는다') : ok('키를 CLI 인자로 받지 않는다');
  /\.env\.local|ELEVENLABS_API_KEY/.test(src) ? ok('키를 env 에서 읽는다') : bad('키 출처가 불명확하다');
}

// [6] 언어별 앵커 음성이 env 로 고정되는가 (2026-08-27 선정: ko=Salang, en=Adam)
//   같은 대본을 6종 한국어 + 2종 영어로 뽑아 들려드리고 사용자가 고른 결과다.
//   ID 를 코드에 박으면 음성을 바꿀 때마다 코드를 고쳐야 하고, 공유 음성은 제작자가 내릴 수도 있다.
{
  const { readFileSync } = await import('fs');
  const src = readFileSync(resolve(ROOT, 'scripts/lib/tts.mjs'), 'utf8');
  /ELEVENLABS_VOICE_ID_KO|ELEVENLABS_VOICE_ID_EN/.test(src)
    ? ok('언어별 음성 ID 를 env 에서 읽는다')
    : bad('언어별 음성 지정 경로가 없다');
  /mYk0rAapHek2oTw18z8x|pNInz6obpgDQGcFmaJgB/.test(src)
    ? bad('음성 ID 가 코드에 박혀 있다 — 교체 시 코드를 고쳐야 한다')
    : ok('음성 ID 하드코딩 없음');

  // locale 로 음성이 갈리는가 (키 없이도 선택 로직은 검증 가능해야 한다)
  if (typeof M.voiceForLocale !== 'function') bad('voiceForLocale() 없음 — locale→음성 매핑이 테스트 불가');
  else {
    const ko = M.voiceForLocale('ko', { ELEVENLABS_VOICE_ID_KO: 'KO_ID', ELEVENLABS_VOICE_ID_EN: 'EN_ID' });
    const en = M.voiceForLocale('en', { ELEVENLABS_VOICE_ID_KO: 'KO_ID', ELEVENLABS_VOICE_ID_EN: 'EN_ID' });
    ko === 'KO_ID' && en === 'EN_ID' ? ok('locale 로 음성이 갈린다') : bad(`매핑 오류: ko=${ko} en=${en}`);
    const ja = M.voiceForLocale('ja', { ELEVENLABS_VOICE_ID_EN: 'EN_ID' });
    ja === 'EN_ID' ? ok('미지정 로케일은 영어 앵커로 폴백') : bad(`폴백 없음: ja=${ja}`);
  }
}

console.log(fail === 0 ? '\n✅ tts 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
