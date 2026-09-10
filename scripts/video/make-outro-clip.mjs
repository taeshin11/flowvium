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
import { synthesizeKoreanBatch } from '../lib/tts-korean.mjs';

const ffmpeg = createRequire(import.meta.url)('ffmpeg-static');
const W = 1080; const H = 1920;
const OUT = resolve(ROOT, 'assets/outro/aisvi.mp4');
const WORK = join(tmpdir(), 'flowvium-outro');
mkdirSync(WORK, { recursive: true });
mkdirSync(resolve(ROOT, 'assets/outro'), { recursive: true });

const SPOKEN = process.env.AISVI_SPOKEN || '에이스비 에이전트';
// 2026-09-10 사용자 "aisviagent.com 에서 다운로드받으라고 광고에 나와야할듯".
//   주소를 라틴 문자로 읽히면 TTS 가 매번 다르게 깨진다(2026-09-05 실측: flowvium.net →
//   "플로우 비오모 소삼드톤 네트"). 한글로 적어 음을 고정하고, 주소 자체는 화면에 크게 띄운다.
const SITE_SPOKEN = process.env.AISVI_SITE_SPOKEN || '에이스비 에이전트 닷컴';
const SAY = `말하는 대로 내 컴퓨터를 조종하는 ${SPOKEN}. 나만의 자비스입니다. `
  + `${SITE_SPOKEN}에서 지금 받으세요.`;

console.log(`  대사: ${SAY}`);
const [voice] = synthesizeKoreanBatch([SAY], { outPrefix: `${WORK}/v` });
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
body{background:#05070f;color:#eef3ff;
  font-family:-apple-system,'Apple SD Gothic Neo',Helvetica,sans-serif;
  display:flex;flex-direction:column;overflow:hidden}
.p{position:relative;width:${W}px;height:${BAND}px;flex:none;
  background:url(data:image/jpeg;base64,${photoB64}) center/cover no-repeat}
.p::after{content:'';position:absolute;inset:0;
  background:linear-gradient(180deg,rgba(5,7,15,.15) 0%,rgba(5,7,15,0) 40%,#05070f 100%)}
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
${hasPhoto ? '<div class="p"></div>' : ''}
<div class="body">
<div class="t">나만의 자비스</div>
<div class="w">AISVI</div><div class="r"></div>
<div class="d">말하는 대로<br>내 컴퓨터를 조종합니다</div>
<div class="u">aisviagent.com</div>
<!-- 가격은 확인된 바 없어 적지 않는다. 광고에 확인 안 된 사실을 넣지 않는다. -->
<div class="c">에서 다운로드</div>
<div class="c2">화면을 보고 프로그램을 열고 눌러 줍니다</div>
</div>`);
await page.screenshot({ path: `${WORK}/bg.png` });
await browser.close();

// 음성 길이에 맞추되 최소 4초 — 너무 짧으면 읽히기 전에 지나간다.
const sec = Math.max(4, voice.durationSec + 0.6);
const r = spawnSync(ffmpeg, [
  '-v', 'error',
  '-loop', '1', '-t', String(sec), '-i', `${WORK}/bg.png`,
  '-i', voice.path,
  // 본편과 **같은 규격**으로 맞춘다 — 다르면 이어붙일 때 다시 인코딩해야 한다.
  '-filter_complex', `[0:v]scale=${W}:${H},fps=30,format=yuv420p[v];[1:a]aresample=24000,apad=whole_dur=${sec}[a]`,
  '-map', '[v]', '-map', '[a]',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
  '-c:a', 'aac', '-b:a', '128k', '-ac', '1', '-ar', '24000',
  '-shortest', '-y', OUT,
], { stdio: ['ignore', 'ignore', 'pipe'] });
if (r.status !== 0) { console.error(`❌ 만들기 실패:\n${String(r.stderr).slice(0, 400)}`); process.exit(1); }
console.log(`✅ ${OUT} · ${sec.toFixed(1)}초`);
