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
import { mkdirSync, existsSync, readFileSync } from 'fs';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
import { createRequire } from 'module';
import { ROOT } from '../lib/project-root.mjs';
import { synthesizeKoreanAuto } from '../lib/tts-korean.mjs';
import { audioArgs } from '../lib/shorts-layout.mjs';

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
    line: '어제 온 메일 정리해서 요약해 줘',
    desc: '말하는 대로<br>내 컴퓨터를 조종합니다',
    cta: '에서 다운로드',
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
    line: '昨日のメール、整理して要約して',
    desc: '話すだけで<br>パソコンを操作します',
    cta: 'からダウンロード',
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

const SPOKEN = process.env.AISVI_SPOKEN || T.spoken;
const SITE_SPOKEN = process.env.AISVI_SITE_SPOKEN || T.siteSpoken;
const SAY = T.say(SPOKEN, SITE_SPOKEN);

console.log(`  대사: ${SAY}`);
// 소리. 우리 TTS 는 **한국어 전용**이다(MeloTTS 한국어 g2p).
//   다른 로케일에서 이걸 그대로 부르면 한국어 발음으로 일본어를 읽는다 —
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
  voice = { path: AUDIO_IN, durationSec: secs };
  console.log(`  소리: 받아온 파일 ${AUDIO_IN} (${secs.toFixed(1)}초)`);
} else if (LOCALE === 'ko') {
  [voice] = synthesizeKoreanAuto([SAY], { outPrefix: `${WORK}/v` });
} else {
  console.error(`❌ ${LOCALE} 로케일에는 소리를 만들 수단이 없다 — 우리 TTS 는 한국어 전용이다.`);
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
const BGVID = argOf('bg-video', process.env.AISVI_BG_VIDEO || 'assets/outro/aisvi-bg.mp4');
const bgVideo = existsSync(resolve(ROOT, BGVID)) ? resolve(ROOT, BGVID) : null;
const hasPhoto = existsSync(PHOTO);
const photoB64 = hasPhoto ? readFileSync(PHOTO).toString('base64') : '';
console.log(hasPhoto ? `  배경 사진: ${PHOTO}` : '  배경 사진 없음 — 문구만으로 만든다');

// 사진 띠 높이. 원본은 16:9(607px)인데 그대로 얹으면 사진과 문구 사이가 400px 비어 허전하다.
//   세로로 조금 더 키워 채운다 — center/cover 라 위아래가 8%쯤 잘리지만 인물과 홀로그램은 가운데라 남는다.
//   9:16 로 통째로 자르면 폭의 2/3이 날아가 구도가 무너지므로 거기까지는 가지 않는다.
const BAND = Math.round(H * 0.42);
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
  gap:30px;text-align:center;padding:0 70px 150px}
.t{font-size:64px;font-weight:800;color:#7fd4ff;letter-spacing:.04em}
.w{font-size:112px;font-weight:900;letter-spacing:.20em;text-indent:.20em;color:#fff}
.r{width:150px;height:8px;background:linear-gradient(90deg,#38bdf8,#2563eb)}
.d{font-size:48px;font-weight:700;line-height:1.45;color:#dbe6ff}
.u{font-size:66px;font-weight:900;color:#ffd400;letter-spacing:.01em;
  -webkit-text-stroke:5px #0a0a0a;paint-order:stroke fill;margin-top:6px}
.c{font-size:38px;font-weight:700;color:#ffd400;letter-spacing:.04em;margin-top:-14px}
.c2{font-size:30px;color:#93a7cc;letter-spacing:.06em;margin-top:6px}
</style>
${hasPhoto ? `<div class="p">${T.line ? `<div class="say"><i></i>“${T.line}”</div>` : ''}</div>` : ''}
<div class="body">
<div class="t">${T.tagline}</div>
<div class="w">AISVI</div><div class="r"></div>
<div class="d">${T.desc}</div>
<div class="u">aisviagent.com</div>
<!-- 가격은 확인된 바 없어 적지 않는다. 광고에 확인 안 된 사실을 넣지 않는다. -->
<div class="c">${T.cta}</div>
<div class="c2">${T.note}</div>
</div>`);
// 영상이면 알파를 살려 찍는다 — 띠 자리가 뚫려야 아래 영상이 보인다.
await page.screenshot({ path: `${WORK}/bg.png`, omitBackground: !!bgVideo });
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

const vArgs = bandFile
  ? [
    '-f', 'lavfi', '-t', String(sec), '-i', `color=c=0x05070f:s=${W}x${H}:r=30`,
    '-i', bandFile,
    '-loop', '1', '-t', String(sec), '-i', `${WORK}/bg.png`,
    '-i', voice.path,
    '-filter_complex',
    `[0:v][1:v]overlay=0:0[bg];[bg][2:v]overlay=0:0,fps=30,format=yuv420p[v];`
      + `[3:a]aresample=24000,apad=whole_dur=${sec}[a]`,
  ]
  : [
    '-loop', '1', '-t', String(sec), '-i', `${WORK}/bg.png`,
    '-i', voice.path,
    '-filter_complex', `[0:v]scale=${W}:${H},fps=30,format=yuv420p[v];[1:a]aresample=24000,apad=whole_dur=${sec}[a]`,
  ];
console.log(bandFile ? `  띠 배경: 영상 ${bgVideo.split('/').pop()}` : '  띠 배경: 사진');
const r = spawnSync(ffmpeg, [
  '-v', 'error',
  ...vArgs,
  '-map', '[v]', '-map', '[a]',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
  // 본편 조각과 **같은 규격**이어야 concat -c copy 가 안전하다(2026-09-14: 어긋나서 클립이 사라졌다).
  ...audioArgs(),
  '-shortest', '-y', OUT,
], { stdio: ['ignore', 'ignore', 'pipe'] });
if (r.status !== 0) { console.error(`❌ 만들기 실패:\n${String(r.stderr).slice(0, 400)}`); process.exit(1); }
console.log(`✅ ${OUT} · ${sec.toFixed(1)}초`);
