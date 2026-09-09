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
import { mkdirSync, existsSync } from 'fs';
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
const SAY = `말하는 대로 내 컴퓨터를 조종하는 ${SPOKEN}. 나만의 자비스입니다.`;

console.log(`  대사: ${SAY}`);
const [voice] = synthesizeKoreanBatch([SAY], { outPrefix: `${WORK}/v` });
console.log(`  음성 ${voice.durationSec.toFixed(1)}초`);

// 화면 — 본편 마무리와 같은 결로 만든다(어두운 남색 + 노란 주소).
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.setContent(`<!doctype html><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${W}px;height:${H}px}
body{background:radial-gradient(900px 700px at 50% 40%,#20305c 0%,rgba(0,0,0,0) 68%),
  linear-gradient(160deg,#05070f,#0e1730 55%,#05070f);
  font-family:-apple-system,'Apple SD Gothic Neo',Helvetica,sans-serif;color:#eef3ff;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:30px;padding:0 70px}
.t{font-size:64px;font-weight:800;color:#7fd4ff;letter-spacing:.04em}
.w{font-size:104px;font-weight:900;letter-spacing:.20em;text-indent:.20em;color:#fff}
.r{width:150px;height:8px;background:linear-gradient(90deg,#38bdf8,#2563eb)}
.d{font-size:44px;font-weight:700;line-height:1.45;text-align:center;color:#dbe6ff}
.u{font-size:64px;font-weight:900;color:#ffd400;letter-spacing:.01em;
  -webkit-text-stroke:5px #0a0a0a;paint-order:stroke fill;margin-top:8px}
.c{font-size:30px;color:#93a7cc;letter-spacing:.06em}
</style>
<div class="t">나만의 자비스</div>
<div class="w">AISVI</div><div class="r"></div>
<div class="d">말하는 대로<br>내 컴퓨터를 조종합니다</div>
<div class="u">aisviagent.com</div>
<div class="c">화면을 보고 프로그램을 열고 눌러 줍니다</div>`);
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
