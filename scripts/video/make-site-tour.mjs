#!/usr/bin/env node
/**
 * make-site-tour.mjs — flowvium.net 이 무엇을 해 주는지 **실제 사이트 화면**으로 보여 주는 2분 남짓 롱폼. (2026-10-02)
 *
 * 왜: 사장님 "aisviagent.com 과 flowvium.net 유입 … 제일 좋은 방법으로". 쇼츠 설명·댓글 링크는 2023-08-31 부터 안 눌린다 —
 *   30일 조회 17.9만에 설명 링크 클릭 14건. 롱폼 설명란 링크는 눌리고, 쇼츠는 '관련 동영상' 으로 롱폼을 가리킬 수 있다.
 * 원칙: 화면은 전부 **지금 사이트를 찍은 것**(지어낸 화면 없음). 대사는 FEATURES.md 에 있는 기능만 말한다 —
 *   수익률 약속·과장 없음. 장면마다 찍을 위치(글자)를 못 찾으면 그 장면 전체 화면으로 대신하고 로그에 남긴다.
 *
 * 사용: node scripts/video/make-site-tour.mjs --out <폴더>   → <폴더>/tour.mp4 · tour-thumb.jpg · tour-meta.json
 */
import { chromium } from 'playwright';
import { spawnSync } from 'child_process';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import ffmpegPath from 'ffmpeg-static';
import { ROOT } from '../lib/project-root.mjs';
import { synthesizeKoreanAuto } from '../lib/tts-korean.mjs';

const argOf = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const OUT = resolve(argOf('out', join(ROOT, 'reports/video/site-tour')));
const SITE = argOf('site', 'https://flowvium.net');
const W = 1920, H = 1080;
const SHOTS = join(OUT, 'shots'); mkdirSync(SHOTS, { recursive: true });
const log = (...a) => console.log('[tour]', ...a);

// 장면: 찍을 페이지 · 머무를 위치(화면에 보이는 글자) · 대사(소리용) · 자막(화면용)
const SCENES = [
  { url: '/ko', at: [null], title: 'FlowVium',
    say: '플로비움은 AI가 매일 시장을 읽고, 살 만한 종목과 그 근거를 정리해 주는 무료 투자 리서치 사이트입니다. 2분 동안 실제 화면으로, 무엇을 해 주는지 보여 드리겠습니다.' },
  { url: '/ko/report', at: [null], title: 'AI 투자 보고서',
    say: '가장 먼저 볼 곳은 AI 투자 보고서입니다. 하루 다섯 번, 한국장과 미국장 시간에 맞춰 새 보고서가 나옵니다. 맨 위에서 오늘 시장을 강세로 보는지, 위험은 어느 정도인지 한눈에 보여 줍니다.' },
  { url: '/ko/report', at: ['AI 추천 포트폴리오'], title: '추천 종목 · 진입 · 손절 · 목표',
    say: '아래로 내리면 추천 종목이 나옵니다. 종목마다 어디서 사고, 어디서 손절하고, 목표가는 얼마인지 숫자로 적혀 있고, 그렇게 판단한 근거도 함께 볼 수 있습니다.' },
  // 2026-10-02 눈검증: '지난 추천 성적' 장면은 뺐다 — 보고서 화면에 그 구획이 보이지 않았다(보여 주지 못하는 것은 말하지 않는다).
  { url: '/ko/company/NVDA', at: [null, '공급'], title: '기업 페이지 · 1,338개 기업',
    say: '궁금한 종목을 검색하면 기업 페이지로 갑니다. 1,338개 기업의 주가, 재무, 애널리스트 목표가, 공급망 관계를 한 화면에서 볼 수 있습니다.' },
  { url: '/ko/explore', at: [null], title: '공급망 탐색기',
    say: '공급망 탐색기에서는 반도체, AI, 배터리 같은 산업의 회사들이 서로 누구에게 납품하고 누구와 경쟁하는지 한 번에 찾아볼 수 있습니다.' },
  { url: '/ko/insider', at: [null], title: '내부자 매매 · 기관 보유',
    say: '내부자 매매와 기관 보유 변화도 볼 수 있습니다. 미국 증권거래위원회 공시를 바탕으로, 경영진이 자기 회사 주식을 사고판 기록을 정리합니다.' },
  { url: '/ko', at: [null], title: 'flowvium.net',
    say: '모두 무료입니다. 아침 보고서는 가입 없이 볼 수 있고, 이메일만 등록하면 장중 보고서까지 볼 수 있습니다. 투자 판단은 본인의 몫이지만, 판단에 필요한 자료는 플로비움이 매일 모아 드립니다. 플로비움 닷넷에서 확인해 보세요.' },
];

// ── 1. 화면 찍기 ─────────────────────────────────────────────────────────────
const browser = await chromium.launch({ headless: true });
// 1280×720 화면을 1.5배로 찍는다(=1920×1080) — 1920 폭으로 찍으면 사이트 글자가 너무 작았다(눈검증).
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5, locale: 'ko-KR' });
for (const [i, sc] of SCENES.entries()) {
  sc.imgs = [];
  await page.goto(SITE + sc.url, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(4000);
  for (const [j, a] of sc.at.entries()) {
    if (a) {
      const loc = page.getByText(a, { exact: false }).first();
      if (await loc.count()) { await loc.scrollIntoViewIfNeeded().catch(() => {}); await page.evaluate(() => window.scrollBy(0, -110)); }
      else log(`장면 ${i + 1}: "${a}" 를 못 찾았다 — 현재 화면으로 대신`);
    } else await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1500);
    const p = join(SHOTS, `s${i}-${j}.png`);
    await page.screenshot({ path: p });
    sc.imgs.push(p);
  }
}
await browser.close();

// ── 2. 소리 ─────────────────────────────────────────────────────────────────
const voices = synthesizeKoreanAuto(SCENES.map((s) => s.say), { outPrefix: join(OUT, 'v') });
voices.forEach((v, i) => { SCENES[i].voice = v; });
const PAD = 0.5;
for (const sc of SCENES) sc.dur = sc.voice.durationSec + PAD;
const total = SCENES.reduce((a, s) => a + s.dur, 0);
log(`장면 ${SCENES.length} · 길이 ${total.toFixed(1)}초`);

// ── 3. 자막(ASS) — 문장 단위, 글자 수 비례로 시간 배분 ───────────────────────
const t2 = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = (s % 60).toFixed(2).padStart(5, '0'); return `${h}:${String(m).padStart(2, '0')}:${x}`; };
// 상자는 진하게(&H28 = 84% 불투명) — 밝은 사이트 위 자막이 안 읽혔다(10/2 눈검증). 장 제목은 사이트 머리줄 아래(MarginV 130).
let ass = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n`
  + 'Style: Sub,Apple SD Gothic Neo,54,&H00FFFFFF,&H00FFFFFF,&H00000000,&H28000000,1,0,0,0,100,100,0,0,3,14,0,2,120,120,60,1\n'
  + 'Style: Ttl,Apple SD Gothic Neo,44,&H0000D4FF,&H0000D4FF,&H00000000,&H28000000,1,0,0,0,100,100,0,0,3,12,0,7,60,60,130,1\n'
  + '\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';
let t0 = 0;
for (const sc of SCENES) {
  ass += `Dialogue: 0,${t2(t0)},${t2(t0 + sc.dur)},Ttl,,0,0,0,,${sc.title}\n`;
  const sents = sc.say.split(/(?<=[.?!])\s+/);
  const chars = sents.reduce((a, s) => a + s.length, 0);
  let t = t0 + 0.15;
  for (const s of sents) {
    const d = (sc.voice.durationSec * s.length) / chars;
    ass += `Dialogue: 0,${t2(t)},${t2(t + d)},Sub,,0,0,0,,${s.replace(/플로비움 닷넷/g, 'flowvium.net')}\n`;
    t += d;
  }
  t0 += sc.dur;
}
writeFileSync(join(OUT, 'subs.ass'), ass);

// ── 4. 장면 영상 — 장면 안 그림들을 나눠 천천히 확대(움직임은 작게: 글자가 읽혀야 한다) ─────────────
const ff = (args, what) => { const r = spawnSync(ffmpegPath, ['-y', '-v', 'error', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); if (r.status !== 0) throw new Error(`${what}: ${String(r.stderr).slice(0, 300)}`); };
const parts = [];
for (const [i, sc] of SCENES.entries()) {
  const each = sc.dur / sc.imgs.length;
  for (const [j, img] of sc.imgs.entries()) {
    const out = join(OUT, `p${i}-${j}.mp4`);
    const frames = Math.round(each * 30);
    ff(['-loop', '1', '-i', img, '-vf', `scale=${W * 2}:${H * 2},zoompan=z='min(1+0.04*on/${frames},1.04)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=30,format=yuv420p`,
      '-frames:v', String(frames), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', out], `장면 ${i + 1}`);
    parts.push(out);
  }
}
writeFileSync(join(OUT, 'v.txt'), parts.map((p) => `file '${p}'`).join('\n'));
ff(['-f', 'concat', '-safe', '0', '-i', join(OUT, 'v.txt'), '-c', 'copy', join(OUT, 'video.mp4')], '영상 잇기');
// 소리: 장면마다 대사 + 무음 패딩
const ap = [];
for (const [i, sc] of SCENES.entries()) {
  const out = join(OUT, `a${i}.wav`);
  ff(['-i', sc.voice.path, '-af', `apad=pad_dur=${PAD}`, '-ar', '44100', '-ac', '1', out], `소리 ${i + 1}`);
  ap.push(out);
}
writeFileSync(join(OUT, 'a.txt'), ap.map((p) => `file '${p}'`).join('\n'));
ff(['-f', 'concat', '-safe', '0', '-i', join(OUT, 'a.txt'), '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '44100', join(OUT, 'audio.wav')], '소리 잇기');
ff(['-i', join(OUT, 'video.mp4'), '-i', join(OUT, 'audio.wav'), '-vf', `ass=${join(OUT, 'subs.ass')}`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
  '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', join(OUT, 'tour.mp4')], '합치기');

// ── 5. 썸네일 — 보고서 첫 화면 + 큰 글씨(노랑·빨강, 채널 규칙) ─────────────────────
const tb = await chromium.launch({ headless: true });
const tp = await tb.newPage({ viewport: { width: 1280, height: 720 } });
const bg = SCENES[1].imgs[0];
const b64 = (await import('fs')).readFileSync(bg).toString('base64');
await tp.setContent(`<!doctype html><meta charset="utf-8"><style>*{margin:0}body{width:1280px;height:720px;background:url(data:image/png;base64,${b64}) center/cover;font-family:'Apple SD Gothic Neo',sans-serif;position:relative}
.s{position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.88) 0%,rgba(0,0,0,.7) 55%,rgba(0,0,0,.25) 100%)}
.t{position:absolute;left:60px;top:150px;font-weight:900;line-height:1.12}.a{font-size:96px;color:#ffd400;-webkit-text-stroke:4px #000;paint-order:stroke fill}.b{font-size:96px;color:#ff3b30;-webkit-text-stroke:4px #000;paint-order:stroke fill}.c{font-size:44px;color:#fff;margin-top:22px}</style>
<div class="s"></div><div class="t"><div class="a">AI가 매일 고르는</div><div class="b">투자 종목, 무료</div><div class="c">flowvium.net 2분 사용법</div></div>`);
await tp.screenshot({ path: join(OUT, 'tour-thumb.jpg'), type: 'jpeg', quality: 90 });
await tb.close();

const meta = { seconds: Number(total.toFixed(1)), scenes: SCENES.map((s) => ({ url: s.url, title: s.title, dur: Number(s.dur.toFixed(1)) })), createdAt: new Date().toISOString() };
writeFileSync(join(OUT, 'tour-meta.json'), JSON.stringify(meta, null, 2));
log(`✅ ${join(OUT, 'tour.mp4')} (${total.toFixed(1)}초) · 썸네일 tour-thumb.jpg`);
if (!existsSync(join(OUT, 'tour.mp4'))) process.exit(1);
