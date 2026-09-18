#!/usr/bin/env node
/**
 * make-outro-clip.mjs — 영상 끝에 붙일 **고정 홍보 클립**을 한 번 만든다.
 *
 * 왜 고정인가 (2026-09-09 사용자 "고정 영상 하나 만들어놓고 계속 붙이면될듯"):
 *   회차마다 합성하면 같은 문장인데도 소리가 미묘하게 달라지고, 매번 TTS 시간을 쓴다.
 *   한 번 만들어 두고 이어 붙이면 언제나 같은 소리·같은 화면이 나간다.
 *
 * 읽는 소리 (2026-09-09 실측): 라틴 문자를 그대로 두면 한국어 TTS 가 제멋대로 읽는다.
 *   flowvium.net 이 "플로우 비오모 소삼드톤 네트" 로 나온 전례가 있다.
 *   AISVI 는 **"에이스비"** 로 적는다 — 사용자가 정한 발음이다.
 *   화면에는 aisviagent.com 이 크게 뜨므로 주소는 눈으로 전달된다.
 *
 * 문구는 지어내지 않고 사이트에서 가져왔다:
 *   "AISVI Agent — 컴퓨터 조종 에이전트"
 *   "말하는 대로 내 컴퓨터를 조종합니다. 화면을 보고 프로그램을 열고 눌러 줍니다."
 *
 * 사용: node scripts/video/make-outro-clip.mjs
 *   결과: assets/outro/aisvi.mp4 (1080x1920 · 30fps · AAC 24kHz 모노 — 본편과 같은 규격)
 */
import { chromium } from 'playwright';
import { spawnSync } from 'child_process';
import { mkdirSync, existsSync, readFileSync, copyFileSync } from 'fs';
import { measure as measureLoudness, normalize as normalizeLoudness } from '../lib/loudness.mjs';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
import { createRequire } from 'module';
import { ROOT } from '../lib/project-root.mjs';
import { synthesizeKoreanAuto } from '../lib/tts-korean.mjs';
import { audioArgs, AUDIO_SPEC } from '../lib/shorts-layout.mjs';

const ffmpeg = createRequire(import.meta.url)('ffmpeg-static');
const W = 1080; const H = 1920;
const WORK = join(tmpdir(), 'flowvium-outro');
mkdirSync(WORK, { recursive: true });
mkdirSync(resolve(ROOT, 'assets/outro'), { recursive: true });

// ── 로케일별 문구 (2026-09-15) ────────────────────────────────────────────────
//   같은 광고를 일본어로도 붙이게 됐다(K연예 채널). 사본을 뜨면 시간이 지나 어긋나므로
//   **문구만 갈아끼우고 구조는 하나로** 둔다. 색·크기·배치는 로케일과 무관하다.
//
//   주소를 라틴 문자로 읽히지 않는 원칙은 로케일과 무관하게 지킨다 —
//   2026-09-05 실측: flowvium.net → "플로우 비오모 소삼드톤 네트".
//   소리는 그 나라 글자로 음을 박고, 주소 자체는 화면에 크게 띄워 눈으로 전달한다.
// MeloTTS 로 소리를 만들 수 있는 로케일. 한국어는 위쪽 전용 경로(Qwen/Melo 자동 선택)를 쓴다.
// 여기 있어도 COPY 에 문구가 없으면 위(93행)에서 먼저 막힌다 — 문구가 진짜 관문이다.
const MELO_LANGS = new Set(['ja', 'en', 'zh', 'es', 'fr']);

const COPY = {
  ko: {
    spoken: '에이스비 에이전트',
    siteSpoken: '에이스비 에이전트 닷컴',
    // 2026-09-16 사용자 "나만의 자비스 말고 나만의 AI비서 로 바꾸자".
    //   소리와 화면을 가른다 — 라틴 문자를 한국어 TTS 에 그대로 주면 안 된다.
    //   실측(g2pkk): "나만의 AI비서입니다" → "나마늬 **아이**비서임니다". 한국에서 AI 는
    //   "에이아이" 로 읽지 "아이" 가 아니다. 주소가 "플로우 비오모 소삼드톤 네트" 로 읽힌
    //   2026-09-05 건과 같은 종류다. 소리는 한글로 음을 박고, 글자는 화면으로 전달한다.
    say: (b, site) => `말하는 대로 내 컴퓨터를 조종하는 ${b}. 나만의 에이아이 비서입니다. ${site}에서 지금 받으세요.`,
    tagline: '나만의 AI비서',
    // 2026-09-16 사용자 "핸드폰 들고 뭐라고 말하는지, 통화를 하는 건지 전혀 모르겠으니까".
    //   맞는 지적이다 — 사진만으로는 통화·음성 메모·AI 지시가 구분되지 않는다.
    //   무엇을 시키는 중인지 대사로 못박는다. 제품이 하는 일을 말로 설명하는 것보다
    //   실제로 시키는 한마디가 빠르다.
    // 2026-09-16 사용자 "거래처에 메일 보내줘 가 낫겠는데". 맞다 —
    //   요약은 읽어 주는 것이고 발송은 **대신 해 주는** 것이다. 아래 note("화면을 보고
    //   프로그램을 열고 눌러 줍니다")가 말하는 동작과 같은 것을 대사가 보여 줘야 한다.
    line: '거래처에 메일 보내줘',
    // 두 단계 구성의 앞단계 문구(2026-09-17). 위: 한 줄 요약 / 아래: 시연과 맞춰 바뀌는 상태
    demoHead: '폰에 말하면 컴퓨터가 알아서',
    demoSteps: ['말로 지시', '메일 작성 중…', '전송 완료 ✓'],
    desc: '말하는 대로<br>내 컴퓨터를 조종합니다',
    cta: '에서 다운로드',
    // 2026-09-18 사용자 "무료로 내 AI 비서를 만들어 보세요. 이렇게 좀 붙여 봐".
    //   **화면 문구로만 넣는다.** 소리로 넣으면 "AI" 가 "아이" 로 읽히고(위 say 주석 참고),
    //   무엇보다 가격 주장은 눈으로 확인되는 자리에 두는 편이 낫다.
    //   ⚠ 사이트에서 가격을 확인하지 못했다(자바스크립트로 그려져 본문을 못 읽음).
    //     유료 구간이 생기면 이 줄부터 고쳐야 한다 — 광고에서 가장 먼저 문제가 되는 문장이다.
    freeCta: '무료로 내 AI 비서를 만들어 보세요',
    // 2026-09-18 실측: 영상 어디에도 "구독" 이 없었다(대본 0회·화면 0회). 설명란에만 있는데
    //   쇼츠 시청자는 설명란을 거의 안 본다. 그런데 이 광고가 시작될 때 54%가 아직 보고 있고
    //   끝까지 35% 가 남는다 — 구독을 권할 가장 좋은 자리를 아무 말 없이 흘려보내고 있었다.
    //   광고 문구를 밀어내지 않게 맨 아래 작은 줄로 둔다.
    subCta: '구독하면 매일 받아보실 수 있습니다',
    note: '화면을 보고 프로그램을 열고 눌러 줍니다',
  },
  ja: {
    // 2026-09-15: 한국어판을 그대로 옮긴 것이다. **브랜드 발음(エイスビ)은 확정된 값이 아니다** —
    //   한국어 '에이스비' 도 사용자가 정한 것이지 철자 읽기가 아니다. 일본어 표기는
    //   사람이 확인한 뒤 AISVI_SPOKEN / AISVI_SITE_SPOKEN 로 덮어쓰는 것을 전제로 둔다.
    spoken: 'エイスビ エージェント',
    siteSpoken: 'エイスビ エージェント ドットコム',
    // 한국어판과 같이 바꾼다 — 같은 광고이고, 바꾼 이유(자비스는 남의 이름이다)도 같다.
    //   일본어도 AI 는 "エーアイ" 로 읽는다. 여기 say 는 사람이 읽거나 다른 TTS 에 줄 대본이므로
    //   소리 나는 대로 적고, 화면(tagline)에는 글자 그대로 AI 를 쓴다.
    say: (b, site) => `話すだけでパソコンを操作する、${b}。自分だけのエーアイ秘書です。${site}で今すぐ手に入れてください。`,
    tagline: '自分だけのAI秘書',
    line: '取引先にメール送っておいて',
    // 말풍선은 좁아서 두 줄이 된다. 브라우저가 단어 중간(送/っておいて)에서 끊었다 — 끊을 자리를 준다.
    lineBubble: '取引先に<br>メール送っておいて',
    demoHead: 'スマホに話すだけでPCが動く',
    demoSteps: ['声で指示', 'メール作成中…', '送信完了 ✓'],
    desc: '話すだけで<br>パソコンを操作します',
    cta: 'からダウンロード',
    // 한국어판과 같은 문구. 화면 폭에 맞게 짧게 끊는다.
    freeCta: '無料で自分だけのAI秘書を作ろう',
    subCta: 'チャンネル登録で毎日お届けします',
    note: '画面を見てアプリを開き、クリックします',
  },
};

const argOf = (k, d = '') => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const LOCALE = argOf('locale', process.env.AISVI_LOCALE || 'ko');
const T = COPY[LOCALE];
if (!T) {
  console.error(`❌ 모르는 로케일: ${LOCALE} (가능: ${Object.keys(COPY).join(', ')})`);
  process.exit(2);
}

// 한국어판은 종전 경로 그대로다 — make-shorts 가 assets/outro/aisvi.mp4 를 본다.
//   다른 로케일은 파일을 나눈다(aisvi-ja.mp4). --out 으로 덮어쓸 수 있다.
const OUT = resolve(ROOT, argOf('out', `assets/outro/aisvi${LOCALE === 'ko' ? '' : `-${LOCALE}`}.mp4`));
// 2026-09-17: 바깥에 넘기는 파일만 샘플레이트를 바꾼다(일본 채널 본편이 48kHz).
//   쇼츠에 붙는 assets/outro/aisvi.mp4 는 AUDIO_SPEC(44.1kHz)을 따라야 concat 이 안전하다 —
//   그래서 그 파일로 나가는데 이 옵션이 오면 멈춘다.
const AUDIO_RATE = Number(argOf('ar', process.env.AISVI_AR || '')) || null;
// 필터 안에서 먼저 이 값으로 맞춘다. 2026-09-17 까지 aresample=24000 이 남아 있었다(옛 24kHz 규격의 흔적) —
//   출력이 44.1/48kHz 여도 중간에 24kHz 를 거쳐 **12kHz 위가 잘려 나갔다.**
const OUT_RATE = AUDIO_RATE ?? AUDIO_SPEC.rate;
// 시연 영상은 음성을 만들기 **전에** 확인한다 — 틀린 경로로 TTS 를 몇십 초 돌리고 나서 멈추지 않게.
{
  const d = argOf('demo', process.env.AISVI_DEMO || '');
  if (d && !existsSync(resolve(ROOT, d))) { console.error(`❌ 시연 영상이 없다: ${resolve(ROOT, d)}`); process.exit(2); }
}
if (AUDIO_RATE && ![44100, 48000].includes(AUDIO_RATE)) {
  console.error(`❌ --ar 는 44100 또는 48000 만 받는다: ${AUDIO_RATE}`); process.exit(2);
}
if (AUDIO_RATE && AUDIO_RATE !== 44100 && OUT === resolve(ROOT, 'assets/outro/aisvi.mp4')) {
  console.error('❌ 쇼츠에 붙는 광고(assets/outro/aisvi.mp4)는 44.1kHz 여야 한다 — --out 을 따로 주십시오.');
  process.exit(2);
}

const SPOKEN = process.env.AISVI_SPOKEN || T.spoken;
const SITE_SPOKEN = process.env.AISVI_SITE_SPOKEN || T.siteSpoken;
const SAY = T.say(SPOKEN, SITE_SPOKEN);

console.log(`  대사: ${SAY}`);
// 소리. 세 갈래다 — 받아 온 파일(--audio) · 한국어 전용 경로 · MeloTTS 다국어(ja 등).
//   모르는 로케일에서 한국어 경로를 그대로 부르면 한국어 발음으로 그 말을 읽는다 —
//   조용히 그렇게 나가는 게 제일 나쁘다. 그래서 막고, 대신 만들어 온 소리를 받는다.
let voice;
const AUDIO_IN = argOf('audio', process.env.AISVI_AUDIO || '');
if (AUDIO_IN) {
  if (!existsSync(AUDIO_IN)) { console.error(`❌ 음성 파일이 없다: ${AUDIO_IN}`); process.exit(2); }
  // -v error 를 붙이면 길이 줄까지 지워진다(2026-09-15 실측 — 그래서 "길이를 못 잰다" 가 났다).
  //   진행 표시(time=)가 아니라 헤더의 Duration 을 읽는다. 짧은 파일은 진행 줄이 안 나올 수도 있다.
  const probe = spawnSync(ffmpeg, ['-i', AUDIO_IN, '-f', 'null', '-'], { encoding: 'utf8' });
  const err = String(probe.stderr ?? '');
  const m = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(err) || /time=(\d+):(\d+):([\d.]+)/.exec(err);
  const secs = m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : 0;
  if (!(secs > 0)) { console.error(`❌ 음성 길이를 못 잰다: ${AUDIO_IN}`); process.exit(2); }
  // 2026-09-17: 받아 온 소리의 **크기를 맞춘다.** 사무실2 가 준 VoxCPM2 음성이 -34.7 LUFS 였다 —
  //   지금 쇼츠에 붙는 한국어 광고(-17.3 LUFS)보다 17dB 작아서, 그대로 쓰면 거의 안 들린다.
  //   종전엔 받아 온 파일을 손대지 않고 썼다(우리 TTS 출력은 원래 그 근처라 문제가 안 드러났다).
  //   곱하기(volume=)가 아니라 loudnorm 으로 맞춘다 — 목소리마다 기준 크기가 달라서
  //   배수를 정하면 다음 목소리에서 또 틀린다(배경음에서 이미 겪었다).
  //   loudnorm 은 내부에서 192kHz 로 올리므로 끝에 -ar 로 원래대로 내린다.
  const LUFS = Number(process.env.AISVI_VOICE_LUFS ?? -17);
  mkdirSync(WORK, { recursive: true });
  const normed = join(WORK, 'voice-norm.wav');
  const rateOf = (/(\d{4,6}) Hz/.exec(err) || [])[1] || '48000';
  const ln = spawnSync(ffmpeg, ['-y', '-v', 'error', '-i', AUDIO_IN,
    '-af', `loudnorm=I=${LUFS}:TP=-1.5:LRA=11`, '-ar', rateOf, '-ac', '1', normed], { encoding: 'utf8' });
  if (ln.status !== 0 || !existsSync(normed)) {
    console.error(`❌ 음량 맞춤 실패: ${String(ln.stderr ?? '').slice(0, 160)}`); process.exit(2);
  }
  voice = { path: normed, durationSec: secs };
  console.log(`  소리: 받아온 파일 ${AUDIO_IN} (${secs.toFixed(1)}초) → ${LUFS} LUFS 로 맞춤`);
} else if (LOCALE === 'ko') {
  [voice] = synthesizeKoreanAuto([SAY], { outPrefix: `${WORK}/v` });
} else if (MELO_LANGS.has(LOCALE)) {
  // 2026-09-16 사용자 "일본어판은 왜 발행용이 안되?" — 맞는 물음이었다.
  //   "수단이 없다" 고 적어 둔 건 사실이 아니라 **배선이 없었다**는 뜻이었다.
  //   MeloTTS 는 japanese/japanese_bert 를 갖고 있는데 파이썬 쪽이 language="KR" 로
  //   못박혀 있어서 쓰지 못했다. 이제 언어를 넘긴다 — 로컬이라 비용도 없다.
  const { synthesizeKoreanMelo, meloTtsReady } = await import('../lib/tts-korean.mjs');
  const ready = meloTtsReady();
  if (!ready.ok) {
    console.error(`❌ ${LOCALE} 음성을 만들 수 없다 — MeloTTS 준비 안 됨: ${ready.reason}`);
    console.error('   그 언어로 만든 wav 를 --audio <파일> 로 주십시오.');
    process.exit(2);
  }
  [voice] = synthesizeKoreanMelo([SAY], { outPrefix: `${WORK}/v`, lang: LOCALE });
  console.log(`  소리: MeloTTS ${LOCALE}`);
} else {
  console.error(`❌ ${LOCALE} 로케일에는 소리를 만들 수단이 없다 (아는 언어: ${[...MELO_LANGS].join(', ')}).`);
  console.error('   그 언어로 만든 wav 를 --audio <파일> 로 주십시오. 한국어 발음으로 읽히지 않게 막는다.');
  process.exit(2);
}
console.log(`  음성 ${voice.durationSec.toFixed(1)}초`);

// 배경 사진 — 2026-09-10 사용자 "자비스 되는 사진 넣어서".
//   Flow(Nano Banana)로 만든다: node scripts/flow-image.mjs --prompt "..." --out assets/outro/jarvis.jpg
//   **없으면 사진 없이 만든다** — 생성이 실패한 날 광고가 통째로 빠지는 편이 더 나쁘다.
//   setContent 는 about:blank 기준이라 file:// 이 막힐 수 있어 base64 로 심는다.
//
//   왜 잘라내지 않고 '띠' 로 쓰는가: Flow 의 이미지 crop 설정이 16:9 라 가로로 나온다.
//   9:16 로 가운데를 자르면 폭의 2/3이 날아가 구도가 무너진다(사람과 홀로그램이 좌우로 퍼진 그림이다).
//   위쪽에 온전한 비율로 얹고 아래로 자연스럽게 어두워지게 해 문구 자리를 만든다.
const PHOTO = resolve(ROOT, process.env.AISVI_PHOTO || 'assets/outro/jarvis.jpg');
// 2026-09-15 사용자 "사진 한장으로 쭉가니까 너무심심하다 … 영상으로 바꿔".
//   띠에 영상을 깐다. 영상이 있으면 글자판을 **투명 배경**으로 뽑아 영상 위에 얹는다.
//   없으면 종전대로 사진 한 장 — 영상이 없다고 광고를 못 만들면 안 된다.
// 2026-09-16 사용자 "가급적 그 한국인이랑 일본인으로 만들어가지고. 일본인 광고에는 일본인을,
//   한국 광고에는 한국인을". 띠 영상을 로케일별로 둔다 — 출력 파일과 같은 이름 규칙이라
//   새 로케일이 생겨도 규칙 하나만 지키면 된다(ko 는 접미사 없음).
//   Flow(Veo 3.1 - Lite [Lower Priority], 0 크레딧)로 만들었다.
const BGVID = argOf('bg-video', process.env.AISVI_BG_VIDEO
  || `assets/outro/aisvi-bg${LOCALE === 'ko' ? '' : `-${LOCALE}`}.mp4`);
// ── 두 단계 구성 (2026-09-17) ───────────────────────────────────────────────────
//   사용자 "화면에 좀 창이 팍 떠서 기능하는것도 잘 보여져야되".
//   띠가 화면의 34% 뿐이라 폰에서는 모니터 속 메일 창이 작아 기능이 안 보였다.
//   그렇다고 띠를 키우면 주소가 쇼츠 UI 가 덮는 67% 아래로 밀린다(실측으로 겪었다).
//   그래서 시간으로 나눈다 — 앞은 시연 영상을 화면 폭 가득, 뒤는 브랜드 카드.
//   뒤쪽 띠는 시연의 **마지막 프레임**(보낸 뒤 체크)으로 멈춰 둔다.
//   --demo 가 없으면 종전과 똑같다.
const PHOTO_DEFAULT = resolve(ROOT, 'assets/outro/jarvis.jpg');
const DEMO_IN = argOf('demo', process.env.AISVI_DEMO || '');
const DEMO = DEMO_IN ? resolve(ROOT, DEMO_IN) : null;
if (DEMO && !existsSync(DEMO)) { console.error(`❌ 시연 영상이 없다: ${DEMO}`); process.exit(2); }
// 시연 영상마다 편집이 다르다(사람 위치·단계 시각). 영상 옆 같은 이름의 .json 에 둔다.
//   2026-09-17: 한국 시연은 사람이 오른쪽, 일본 시연은 왼쪽이라 말풍선 자리가 반대였다 —
//   코드에 좌표를 박아 두면 영상을 바꿀 때마다 틀린다.
let DEMO_CFG = { steps: [2.4, 4.7], bubble: { x: 120, y: 12, maxW: 600, base: [[500, 82], [590, 72]], tip: [668, 196] } };
if (DEMO) {
  const cf = DEMO.replace(/\.[a-z0-9]+$/i, '.json');
  if (existsSync(cf)) {
    try { DEMO_CFG = { ...DEMO_CFG, ...JSON.parse(readFileSync(cf, 'utf8')) }; console.log(`  시연 설정: ${cf.split('/').pop()}`); }
    catch (e) { console.error(`❌ 시연 설정을 못 읽는다: ${cf} — ${e.message}`); process.exit(2); }
  } else console.log('  시연 설정 파일 없음 — 기본값(aisvi-demo.mp4 기준)을 쓴다');
}
let DEMO_SEC = 0;
if (DEMO) {
  const pr = spawnSync(ffmpeg, ['-i', DEMO], { encoding: 'utf8' });
  const m = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(String(pr.stderr ?? ''));
  DEMO_SEC = m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : 0;
  if (!(DEMO_SEC > 0)) { console.error(`❌ 시연 영상 길이를 못 잰다: ${DEMO}`); process.exit(2); }
  // 뒷단계(브랜드 카드) 사진 — 2026-09-17 사용자 "맨 마지막엔 자비스 사진 넣어야지".
  //   처음엔 시연의 마지막 프레임(체크)을 멈춰 뒀다. 자비스 사진은 폰에 대고 말하는 사람이다.
  //   원래의 jarvis.jpg 는 서양인이라, 로케일별 인물 영상(한국인/일본인)에서 한 장을 뽑는다 —
  //   1.5초 장면이 얼굴·폰·모니터가 함께 잡혔다(후보 프레임을 뽑아 보고 골랐다).
  //   AISVI_END_PHOTO 로 사진 파일을 직접 줄 수 있다.
  mkdirSync(WORK, { recursive: true });
  const still = join(WORK, 'end-photo.mp4');
  const endPng = join(WORK, 'end-photo.png');
  const given = process.env.AISVI_END_PHOTO ? resolve(ROOT, process.env.AISVI_END_PHOTO) : null;
  const src = given ?? resolve(ROOT, BGVID);
  let x;
  if (given) x = spawnSync(ffmpeg, ['-y', '-v', 'error', '-i', given, '-frames:v', '1', endPng], { encoding: 'utf8' });
  else if (existsSync(src)) x = spawnSync(ffmpeg, ['-y', '-v', 'error', '-ss', '1.5', '-i', src, '-frames:v', '1', endPng], { encoding: 'utf8' });
  else x = spawnSync(ffmpeg, ['-y', '-v', 'error', '-i', PHOTO_DEFAULT, '-frames:v', '1', endPng], { encoding: 'utf8' });
  const y = x.status === 0 && spawnSync(ffmpeg, ['-y', '-v', 'error', '-loop', '1', '-t', '1',
    '-i', endPng, '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', still], { encoding: 'utf8' });
  if (!y || y.status !== 0 || !existsSync(still)) { console.error(`❌ 마지막 사진을 못 만들었다: ${src}`); process.exit(2); }
  console.log(`  마지막 사진: ${given ? given : `${src.split('/').pop()} 의 1.5초`}`);
}
const bgVideo = DEMO ? join(WORK, 'end-photo.mp4')
  : (existsSync(resolve(ROOT, BGVID)) ? resolve(ROOT, BGVID) : null);
const hasPhoto = existsSync(PHOTO);
const photoB64 = hasPhoto ? readFileSync(PHOTO).toString('base64') : '';
console.log(hasPhoto ? `  배경 사진: ${PHOTO}` : '  배경 사진 없음 — 문구만으로 만든다');

// 사진 띠 높이. 원본은 16:9(607px)인데 그대로 얹으면 사진과 문구 사이가 400px 비어 허전하다.
//   세로로 조금 더 키워 채운다 — center/cover 라 위아래가 8%쯤 잘리지만 인물과 홀로그램은 가운데라 남는다.
//   9:16 로 통째로 자르면 폭의 2/3이 날아가 구도가 무너지므로 거기까지는 가지 않는다.
// 2026-09-16: 띠를 줄이고 문구를 위로 올린다.
//   쇼츠 앱이 **화면 아래 약 1/3**(제목·설명·공유 버튼)을 덮는데, 실측으로 주소가
//   y 1434~1555 = **75~81%** 에 있었다. 그 자리는 통째로 가려진다 —
//   광고에서 제일 중요한 한 줄이 안 보이고 있었다(옆 세션이 지적, 재서 확인).
//   중요한 문구는 67% 위에 둔다.
// 2026-09-17: 사용자가 보낸 실제 쇼츠 화면을 재니 채널 이름이 86%, 제목이 90% 에 있었다.
//   67% 기준은 지나치게 보수적이라 브랜드 카드 아래가 비었다. 두 단계 구성에서는 마지막 사진을
//   크게(42%) 잡는다 — 주소는 약 70% 로 내려가지만 가려지는 선보다 한참 위다.
const BAND = Math.round(H * Number(process.env.AISVI_BAND ?? (argOf('demo', process.env.AISVI_DEMO || '') ? 0.42 : 0.34)));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.setContent(`<!doctype html><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${W}px;height:${H}px}
/* 사진이 페이드로 녹아드는 색과 **같은 색**을 바닥에 깐다 —
   다르면 사진이 끝나는 자리에 가로줄이 보인다(2026-09-10 첫 시안에서 실제로 보였다). */
body{background:${bgVideo ? 'transparent' : '#05070f'};color:#eef3ff;
  font-family:-apple-system,'Apple SD Gothic Neo',Helvetica,sans-serif;
  display:flex;flex-direction:column;overflow:hidden}
.p{position:relative;width:${W}px;height:${BAND}px;flex:none;
  background:${bgVideo ? 'transparent' : `url(data:image/jpeg;base64,${photoB64}) center/cover no-repeat`}}
.p::after{content:'';position:absolute;inset:0;
  background:linear-gradient(180deg,rgba(5,7,15,.15) 0%,rgba(5,7,15,0) 40%,#05070f 100%)}
/* 대사 자막 — 2026-09-16 첫 시안은 말풍선이었는데 **얼굴과 폰을 덮었다**.
   띠 배경이 정지 사진이 아니라 영상(aisvi-bg.mp4)이라 인물이 화면 안에서 움직인다 —
   고정 위치 말풍선은 언젠가 반드시 인물을 가린다. 그래서 위치를 사람에 맞추지 않고
   **띠 맨 아래**에 자막으로 깐다. 그 자리는 ::after 페이드가 이미 어둡게 깔아 두어
   어떤 프레임에서도 글자가 읽히고, 인물은 가운데 위에 있으므로 겹치지 않는다. */
.say{position:absolute;left:0;right:0;bottom:4%;z-index:2;
  display:flex;align-items:center;justify-content:center;gap:16px;padding:0 60px;
  font-size:40px;font-weight:800;line-height:1.3;color:#eaf4ff;text-align:center;
  text-shadow:0 3px 14px rgba(0,0,0,.85)}
/* 마이크 표시 — 통화가 아니라 말로 시키는 중임을 알린다 */
.say i{flex:none;width:20px;height:20px;border-radius:50%;background:#7fd4ff;
  box-shadow:0 0 0 8px rgba(127,212,255,.22)}
/* 남은 아래 공간 전체를 쓰고 그 안에서 가운데 정렬 — 아래가 휑하게 비지 않는다. */
.body{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:26px;text-align:center;padding:0 70px ${Math.round(H * 0.32)}px}
.t{font-size:64px;font-weight:800;color:#7fd4ff;letter-spacing:.04em}
.w{font-size:112px;font-weight:900;letter-spacing:.20em;text-indent:.20em;color:#fff}
.r{width:150px;height:8px;background:linear-gradient(90deg,#38bdf8,#2563eb)}
.d{font-size:48px;font-weight:700;line-height:1.45;color:#dbe6ff}
.u{font-size:66px;font-weight:900;color:#ffd400;letter-spacing:.01em;
  -webkit-text-stroke:5px #0a0a0a;paint-order:stroke fill;margin-top:6px}
.c{font-size:38px;font-weight:700;color:#ffd400;letter-spacing:.04em;margin-top:-14px}
/* 무료 안내 — 주소 바로 아래. 주소(노랑)와 구분되게 흰 글씨에 초록 테두리를 준다. */
.f{font-size:44px;font-weight:900;color:#fff;background:#16a34a;border-radius:999px;
  padding:10px 34px;margin-top:14px;letter-spacing:.01em}
.c2{font-size:30px;color:#93a7cc;letter-spacing:.06em;margin-top:6px}
/* 구독 안내. 첫 판에서 이 규칙을 넣는 치환이 두 번 조용히 실패해 브라우저 기본 크기(16px)로
   나갔다 — 프레임을 눈으로 봤기에 잡았다. 문자열 치환은 실패해도 아무 말이 없다. */
.s{font-size:46px;font-weight:900;color:#fff;letter-spacing:.01em;margin-top:22px;
  border:3px solid rgba(207,227,255,.55);border-radius:999px;padding:10px 30px}
</style>
${hasPhoto ? `<div class="p">${T.line && !DEMO ? `<div class="say"><i></i>“${T.line}”</div>` : ''}</div>` : ''}
<div class="body">
<div class="t">${T.tagline}</div>
<div class="w">AISVI</div><div class="r"></div>
<div class="d">${T.desc}</div>
<div class="u">aisviagent.com</div>
<!-- cta 는 주소에 이어 읽히는 꼬리다("aisviagent.com 에서 다운로드").
     무료 안내를 그 사이에 끼웠더니 "에서 다운로드" 만 떨어져 나와 붕 떴다(2026-09-18 눈검증). -->
<div class="c">${T.cta}</div>
${T.freeCta ? `<div class="f">${T.freeCta}</div>` : ''}
<div class="c2">${T.note}</div>
${T.subCta ? `<div class="s">${T.subCta}</div>` : ''}
</div>`);
// 영상이면 알파를 살려 찍는다 — 띠 자리가 뚫려야 아래 영상이 보인다.
await page.screenshot({ path: `${WORK}/bg.png`, omitBackground: !!bgVideo });
// 앞단계 글자판. 영상 자리(VID_Y ~ VID_Y+VID_H)만 비워 둔다 — 그 아래로 영상이 보인다.
//   중요한 글자는 전부 67% 위에 둔다(쇼츠 UI).
const VID_H = Math.round(W * 9 / 16);           // 1080 → 608
const VID_Y = Math.round(H * 0.24);
// 상태 표시 자리 — bot 영역 안: padding 40 + 태그라인(≈70) + gap 14 + AISVI(≈105) + gap 14
const STEP_H = 110;
const STEP_Y = VID_Y + VID_H + 40 + 70 + 14 + 105 + 14;
// 시연 편집의 단계 경계(초). assets/outro/aisvi-demo.mp4 는 0~2.4 말함 · 2.4~ 메일 작성 ·
//   4.7~ 체크(크로스페이드 끝)로 편집했다. 다른 시연을 쓰면 AISVI_DEMO_STEPS="a,b" 로 준다.
const DEMO_STEPS_AT = process.env.AISVI_DEMO_STEPS
  ? String(process.env.AISVI_DEMO_STEPS).split(',').map(Number) : DEMO_CFG.steps;
if (DEMO) {
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${W}px;height:${H}px;background:transparent;overflow:hidden;
  font-family:-apple-system,'Apple SD Gothic Neo',Helvetica,sans-serif;color:#eef3ff}
.top{position:absolute;left:0;top:0;width:${W}px;height:${VID_Y}px;background:#05070f;
  display:flex;flex-direction:column;align-items:center;justify-content:flex-end;padding-bottom:34px;gap:22px}
.bot{position:absolute;left:0;top:${VID_Y + VID_H}px;width:${W}px;height:${H - VID_Y - VID_H}px;background:#05070f;
  display:flex;flex-direction:column;align-items:center;padding-top:40px;gap:14px}
.k{font-size:40px;font-weight:800;color:#7fd4ff;letter-spacing:.06em}
.say{display:flex;align-items:center;gap:18px;font-size:58px;font-weight:900;color:#fff;line-height:1.25;
  text-align:center;padding:0 60px}
.say i{flex:none;width:26px;height:26px;border-radius:50%;background:#7fd4ff;box-shadow:0 0 0 10px rgba(127,212,255,.22)}
.t{font-size:54px;font-weight:800;color:#7fd4ff}
.w{font-size:88px;font-weight:900;letter-spacing:.2em;text-indent:.2em;color:#fff}
.h{font-size:62px;font-weight:900;color:#fff;text-align:center;padding:0 50px;line-height:1.25}
.gap{height:${STEP_H}px}
.u{font-size:64px;font-weight:900;color:#ffd400;-webkit-text-stroke:4px #0a0a0a;paint-order:stroke fill}
.f{font-size:42px;font-weight:900;color:#fff;background:#16a34a;border-radius:999px;padding:9px 30px;margin-top:4px}
.s{font-size:40px;font-weight:900;color:#fff;margin-top:12px;border:3px solid rgba(207,227,255,.5);border-radius:999px;padding:8px 24px}
</style>
<div class="top"><div class="h">${T.demoHead ?? ''}</div></div>
<div class="bot"><div class="t">${T.tagline}</div><div class="w">AISVI</div>
<div class="gap"></div><div class="u">aisviagent.com</div>
${T.freeCta ? `<div class="f">${T.freeCta}</div>` : ''}
${T.subCta ? `<div class="s">${T.subCta}</div>` : ''}</div>`);
  await page.screenshot({ path: `${WORK}/bgA.png`, omitBackground: true });

  // 상태 표시 — 2026-09-17 사용자 "여기 왜 아무 문구가 없냐"(AISVI 아래 빈자리).
  //   빈자리를 비워 둔 건 "쇼츠 UI 가 아래 1/3 을 덮는다" 는 가정 때문이었는데, 사용자가 보낸
  //   실제 화면을 재 보니 채널 이름 86% · 제목 90% 에 있었다. 67% 는 지나치게 보수적이었다.
  //   그 자리에 시연과 맞춰 바뀌는 상태를 둔다 — 기능이 글자로도 보이게.
  //   (bot 영역 안의 .gap 자리. 위치는 아래 STEP_Y 로 정확히 맞춘다.)
  for (const [k, txt] of (T.demoSteps ?? []).entries()) {
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${W}px;height:${H}px;background:transparent;overflow:hidden;
  font-family:-apple-system,'Apple SD Gothic Neo',Helvetica,sans-serif}
.s{position:absolute;left:0;right:0;top:${STEP_Y}px;height:${STEP_H}px;display:flex;align-items:center;justify-content:center}
.p{display:flex;align-items:center;gap:20px;padding:14px 40px;border-radius:999px;
  background:${k === (T.demoSteps.length - 1) ? '#16a34a' : '#1e293b'};border:3px solid ${k === (T.demoSteps.length - 1) ? '#4ade80' : '#7fd4ff'};
  color:#fff;font-size:50px;font-weight:900}
.d{width:22px;height:22px;border-radius:50%;background:${k === (T.demoSteps.length - 1) ? '#bbf7d0' : '#7fd4ff'}}
.n{color:#93a7cc;font-size:40px;font-weight:800}
</style><div class="s"><div class="p"><span class="d"></span><span class="n">${k + 1}/${T.demoSteps.length}</span>${txt}</div></div>`);
    await page.screenshot({ path: `${WORK}/step${k}.png`, omitBackground: true });
  }

  // 말풍선 — 2026-09-17 사용자 "대사가 사람이 말을 할때 말풍선으로 나오면 좋겠는데".
  //   시연 첫 장면(0~2.4초, 폰에 대고 말하는 전체 화면)에만 톡 떴다 사라진다.
  //   자리는 모니터 위쪽 빈 벽(영상 좌표 x120~, y12~), 꼬리는 입(약 700,215)을 가리킨다 —
  //   영상 좌표는 첫 장면 프레임에 격자를 그려 재서 정했다. 얼굴(x690~)은 덮지 않는다.
  //   예전에 띠 전체에 고정 말풍선을 얹었다가 움직이는 얼굴을 덮은 적이 있어, 시간을 짧게 묶는다.
  const B = DEMO_CFG.bubble;
  const bx = B.x, by = VID_Y + B.y;
  const pts = [...B.base, B.tip].map(([px, py]) => `${px},${VID_Y + py}`).join(' ');
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${W}px;height:${H}px;background:transparent;overflow:hidden;
  font-family:-apple-system,'Apple SD Gothic Neo',Helvetica,sans-serif}
.b{position:absolute;left:${bx}px;top:${by}px;max-width:${B.maxW}px;background:#fff;color:#111;
  border-radius:40px;padding:20px 38px;font-size:46px;font-weight:900;line-height:1.25;
  box-shadow:0 10px 30px rgba(0,0,0,.35)}
svg{position:absolute;left:0;top:0}
</style>
<svg width="${W}" height="${H}"><polygon points="${pts}" fill="#fff"/></svg>
<div class="b">${T.lineBubble ?? T.line}</div>`);
  await page.screenshot({ path: `${WORK}/bubble.png`, omitBackground: true });
}
await browser.close();

// 음성 길이에 맞추되 최소 4초 — 너무 짧으면 읽히기 전에 지나간다.
const sec = Math.max(4, voice.durationSec + 0.6);
// 영상이 있으면 **두 단계**로 만든다. 한 그래프에 다 넣었더니 필터가 깨졌다
//   ("Error reinitializing filters" — tpad·trim·overlay 를 한 번에 물리면 불안정하다).
//   ① 띠 영상을 광고 길이에 맞춰 따로 렌더  ② 그 위에 글자판(알파)을 얹는다.
//   영상은 8초, 광고는 10.7초다. 마지막 프레임을 물린다(tpad=clone) —
//   되감거나 다시 트는 건 눈에 띈다. 끝난 화면은 그대로 두는 편이 자연스럽다.
//   Veo 가 넣은 소리는 버린다 — 우리 내레이션과 겹친다.
let bandFile = null;
if (bgVideo) {
  bandFile = `${WORK}/band.mp4`;
  const b = spawnSync(ffmpeg, [
    '-v', 'error', '-i', bgVideo,
    '-an',
    // scale 에 높이를 -2 로 주면 force_original_aspect_ratio 가 안 먹는다 —
    //   1280x720 이 1080x607 이 되어 806 높이로 자를 수 없다(실측 실패). 둘 다 적는다.
    '-vf', `scale=${W}:${BAND}:force_original_aspect_ratio=increase,crop=${W}:${BAND},`
      + `tpad=stop_mode=clone:stop_duration=${sec},fps=30`,
    '-t', String(sec), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-pix_fmt', 'yuv420p', '-y', bandFile,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  if (b.status !== 0) {
    console.log(`  ⚠ 띠 영상 렌더 실패 — 사진으로 간다: ${String(b.stderr).slice(0, 120)}`);
    bandFile = null;
  }
}

// 앞단계 길이: 시연을 다 보여 주되, 브랜드 카드가 최소 4초는 남게 한다.
const PHASE_A = DEMO ? Math.max(3, Math.min(DEMO_SEC + 0.4, sec - 4)) : 0;
// 상태 PNG 들을 시간 창으로 얹는 필터 조각. 입력 번호는 8 부터(0~7 은 위에서 쓴다).
function stepChain(inp, out) {
  const n = (T.demoSteps ?? []).length;
  if (!n) return `[${inp}]fps=30,format=yuv420p,setsar=1[${out}];`;
  const edges = [0, ...DEMO_STEPS_AT.slice(0, n - 1), PHASE_A];
  let f = ''; let cur = inp;
  for (let k = 0; k < n; k++) {
    const nx = k === n - 1 ? `${out}pre` : `st${k}`;
    f += `[${cur}][${8 + k}:v]overlay=0:0:enable='between(t,${edges[k]},${edges[k + 1]})'[${nx}];`;
    cur = nx;
  }
  return f + `[${cur}]fps=30,format=yuv420p,setsar=1[${out}];`;
}
if (DEMO) console.log(`  구성: 시연 ${PHASE_A.toFixed(1)}초 → 브랜드 카드 ${(sec - PHASE_A).toFixed(1)}초`);
const vArgs = DEMO && bandFile
  ? [
    '-f', 'lavfi', '-t', String(PHASE_A), '-i', `color=c=0x05070f:s=${W}x${H}:r=30`,
    '-i', DEMO,
    '-loop', '1', '-t', String(PHASE_A), '-i', `${WORK}/bgA.png`,
    '-f', 'lavfi', '-t', String(sec - PHASE_A), '-i', `color=c=0x05070f:s=${W}x${H}:r=30`,
    '-i', bandFile,
    '-loop', '1', '-t', String(sec - PHASE_A), '-i', `${WORK}/bg.png`,
    '-i', voice.path,
    '-loop', '1', '-t', String(PHASE_A), '-i', `${WORK}/bubble.png`,
    ...(T.demoSteps ?? []).flatMap((_, k) => ['-loop', '1', '-t', String(PHASE_A), '-i', `${WORK}/step${k}.png`]),
    '-filter_complex',
    // 시연: 폭에 맞춰 늘리고, 짧으면 마지막 프레임을 물린다. Veo 소리는 버린다.
    `[1:v]scale=${W}:${VID_H}:force_original_aspect_ratio=increase,crop=${W}:${VID_H},`
      + `tpad=stop_mode=clone:stop_duration=${PHASE_A},trim=0:${PHASE_A},setpts=PTS-STARTPTS,fps=30[d];`
      + `[7:v]format=rgba,fade=t=in:st=0.15:d=0.18:alpha=1,fade=t=out:st=${Math.max(0.5, DEMO_STEPS_AT[0] - 0.3)}:d=0.2:alpha=1[bub];`
      + `[0:v][d]overlay=0:${VID_Y}[a0];[a0][2:v]overlay=0:0[a1];`
      + `[a1][bub]overlay=0:0[a2];`
      + stepChain('a2', 'A')
      + `[4:v]trim=0:${sec - PHASE_A},setpts=PTS-STARTPTS[bb];`
      + `[3:v][bb]overlay=0:0[b0];[b0][5:v]overlay=0:0,fps=30,format=yuv420p,setsar=1,fade=t=in:st=0:d=0.25[B];`
      + `[A][B]concat=n=2:v=1:a=0[v];`
      + `[6:a]aresample=${OUT_RATE},apad=whole_dur=${sec}[a]`,
  ]
  : bandFile
  ? [
    '-f', 'lavfi', '-t', String(sec), '-i', `color=c=0x05070f:s=${W}x${H}:r=30`,
    '-i', bandFile,
    '-loop', '1', '-t', String(sec), '-i', `${WORK}/bg.png`,
    '-i', voice.path,
    '-filter_complex',
    `[0:v][1:v]overlay=0:0[bg];[bg][2:v]overlay=0:0,fps=30,format=yuv420p[v];`
      + `[3:a]aresample=${OUT_RATE},apad=whole_dur=${sec}[a]`,
  ]
  : [
    '-loop', '1', '-t', String(sec), '-i', `${WORK}/bg.png`,
    '-i', voice.path,
    '-filter_complex', `[0:v]scale=${W}:${H},fps=30,format=yuv420p[v];[1:a]aresample=${OUT_RATE},apad=whole_dur=${sec}[a]`,
  ];
console.log(bandFile ? `  띠 배경: 영상 ${bgVideo.split('/').pop()}` : '  띠 배경: 사진');
const r = spawnSync(ffmpeg, [
  '-v', 'error',
  ...vArgs,
  '-map', '[v]', '-map', '[a]',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
  // 본편 조각과 **같은 규격**이어야 concat -c copy 가 안전하다(2026-09-14: 어긋나서 클립이 사라졌다).
  ...audioArgs(AUDIO_RATE ? { rate: AUDIO_RATE } : {}),
  '-shortest', '-y', OUT,
], { stdio: ['ignore', 'ignore', 'pipe'] });
if (r.status !== 0) { console.error(`❌ 만들기 실패:\n${String(r.stderr).slice(0, 400)}`); process.exit(1); }

// 2026-09-17: 광고 파일 전체를 유튜브 기준 -14 LUFS 로 맞춘다.
//   이 파일은 다른 채널이 **가공 없이** 본편 끝에 붙인다(노트북 세션 · 맥미니 사무실2).
//   사무실2 가 본편을 -14 로 올리면서 광고도 -14 로 달라고 했다. 우리 쇼츠는 맨 끝에서 전체를
//   다시 맞추므로 이 값과 무관하다. AISVI_LUFS 로 바꿀 수 있다. 맞췄는지 다시 잰다.
{
  const target = Number(process.env.AISVI_LUFS ?? -14);
  const tmp = join(WORK, 'outro-loud.mp4');
  const n = normalizeLoudness(OUT, tmp, target, {
    ff: ffmpeg, extraOut: ['-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy', ...audioArgs({ rate: OUT_RATE })] });
  const m = n.ok ? measureLoudness(['-i', tmp], { ff: ffmpeg }) : null;
  if (n.ok && m && Math.abs(m.I - target) <= 1) {
    copyFileSync(tmp, OUT);
    console.log(`  음량 ${n.before.toFixed(1)} → ${m.I.toFixed(1)} LUFS (${n.mode}, 피크 ${m.TP.toFixed(1)} dBTP)`);
  } else {
    console.error(`❌ 음량을 ${target} LUFS 로 맞추지 못했다: ${n.reason ?? `결과 ${m?.I}`}`);
    process.exit(1);   // 광고 파일은 한 번 만들어 계속 쓴다 — 틀린 채로 남기지 않는다
  }
}
console.log(`✅ ${OUT} · ${sec.toFixed(1)}초`);
