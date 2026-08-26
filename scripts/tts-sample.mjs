#!/usr/bin/env node
/**
 * tts-sample.mjs — 앵커 음성 후보를 뽑아 귀로 비교한다.
 *
 * 2026-08-27: 맥 내장(Yuna)으로 실물을 들려드리고 "별로" 판정 → ElevenLabs 로 전환.
 *   품질 판단은 사람이 해야 하므로, 같은 대본으로 후보를 뽑아 나란히 두는 게 이 스크립트의 일이다.
 *
 * 사용:
 *   node scripts/tts-sample.mjs --voices           ElevenLabs 음성 목록(키 필요)
 *   node scripts/tts-sample.mjs                    기본 대본으로 샘플 생성
 *   node scripts/tts-sample.mjs --text "..."       대본 지정
 *   node scripts/tts-sample.mjs --provider mac     맥 내장으로
 *
 * 키는 .env.local 의 ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID 에서 읽는다.
 *   인자로 넘기지 않는다 — `ps` 에 남는다.
 */
import { synthesize, listElevenVoices } from './lib/tts.mjs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };

// 실제 FlowVium 데이터로 쓴 앵커 대본. 숫자는 한글로 푼다 — TTS 가 "6,727억" 을 잘못 읽는다.
const DEFAULT_TEXT = [
  '플로비움 마켓 브리핑입니다.',
  '오늘 한국 시장은 외국인 순매수가 육천칠백억 원 유입되며 코스피가 영 점 구 퍼센트 올랐습니다.',
  '반면 코스닥은 사 점 육 퍼센트 급락했습니다. 대형주로 수급이 쏠린 하루였습니다.',
  '저희가 어제 매수 후보로 제시한 종목 가운데, 삼성전자는 손절선 이십육만 원을 지켜냈습니다.',
  '공급망 신호에서는 엔비디아의 변화가 에스케이하이닉스, 마이크론, 티에스엠씨로 이어질 수 있다는 점이 포착됐습니다.',
].join(' ');

if (argv.includes('--voices')) {
  try {
    const vs = await listElevenVoices();
    console.log(`음성 ${vs.length}개:`);
    for (const v of vs) {
      const l = v.labels ?? {};
      console.log(`  ${v.id}  ${String(v.name).padEnd(18)} ${[l.gender, l.accent, l.age, l.use_case].filter(Boolean).join('/')}`);
    }
    console.log('\n고른 id 를 .env.local 의 ELEVENLABS_VOICE_ID 에 넣어라.');
  } catch (e) { console.error(`❌ ${e.message}`); process.exit(1); }
  process.exit(0);
}

const provider = arg('--provider', 'elevenlabs');
const text = arg('--text', DEFAULT_TEXT);
const voice = arg('--voice', provider === 'mac' ? 'Yuna' : undefined);
const model = arg('--model', 'eleven_multilingual_v2');
const ext = provider === 'mac' ? 'm4a' : 'mp3';
const out = arg('--out', resolve(ROOT, `reports/tts/anchor-${provider}-${voice ?? 'default'}.${ext}`));

try {
  const t0 = Date.now();
  await synthesize(text, { provider, voice, model, outPath: out, rate: Number(arg('--rate', 200)) });
  const { statSync } = await import('fs');
  console.log(`✅ ${out}  (${(statSync(out).size / 1024).toFixed(0)}KB, ${((Date.now() - t0) / 1000).toFixed(1)}s, ${text.length}자)`);
} catch (e) {
  console.error(`❌ ${e.message}`);
  process.exit(1);
}
