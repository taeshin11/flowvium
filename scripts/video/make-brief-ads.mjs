#!/usr/bin/env node
/**
 * make-brief-ads.mjs — 증시 요약 롱폼(가로 1920×1080) 끝에 붙이는 **긴 광고**. 2026-10-23 신설.
 *
 * 왜(사장님 10/23): "롱폼 맨끝에 플로븀, 에이스비 광고 번갈아 붙여라 마찬가지로 쇼츠처럼" ·
 *   "좀 크기를 롱폼에 맞게 해서 광고 만들어서 붙여" · "롱폼에서는 광고 설명 긴버젼으로".
 *   쇼츠의 2초 카드(assets/outro/*-card.mp4)는 세로 1080×1920 이라 가로 영상에 그대로 못 붙인다.
 *
 * 문구는 지어내지 않는다 — 쇼츠 광고(make-outro-clip)·사이트에 이미 있는 말만:
 *   AISVI: "말하는 대로 컴퓨터를 조종합니다"(사이트) · "가입 없이 바로 무료 체험"(lib/ad-line) · 화면 = aisvi-demo.mp4(가로 시연, 폰에 말함 → 메일 작성 → 전송)
 *   FLOWVIUM: "하루 5번 AI 시장 리포트 · 무료"(쇼츠 카드) · 실제 최고 적중(lib/best-hit, 쇼츠 카드와 같은 날 같은 건)
 * 읽는 소리: 라틴 문자는 한글 음으로(flowvium.net → "플로우 비오모 …" 전례) — "에이스비"(사장님이 정한 발음) · "플로비움 닷넷"(채널이 쓰는 소리).
 *
 * 사용: node scripts/video/make-brief-ads.mjs --brand aisvi|flowvium
 *   결과: assets/outro/brief-ad-<brand>.mp4 (1920×1080 · 30fps · AAC 44.1kHz 모노). 임시 파일을 재고 맞을 때만 바꿔 끼운다.
 *   flowvium 은 refresh-flowvium-card(매일 07:45)가 같이 다시 굽는다 — 적중 건이 날마다 바뀐다.
 */
import { chromium } from 'playwright';
import ffmpegPath from 'ffmpeg-static';
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { ROOT } from '../lib/project-root.mjs';

const argv = process.argv.slice(2);
const BRAND = argv[argv.indexOf('--brand') + 1];
if (!['aisvi', 'flowvium'].includes(BRAND)) { console.error('--brand aisvi|flowvium'); process.exit(2); }
const OUT = resolve(ROOT, `assets/outro/brief-ad-${BRAND}.mp4`);
const TMP = resolve(ROOT, `assets/outro/.brief-ad-${BRAND}.tmp.mp4`);
const WORK = join(tmpdir(), `flowvium-brief-ad-${BRAND}`);
rmSync(WORK, { recursive: true, force: true }); mkdirSync(WORK, { recursive: true });
const log = (...a) => console.log(new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 19), `[brief-ad:${BRAND}]`, ...a);
const ff = (args, what) => { const r = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { encoding: 'utf8', timeout: 300_000 }); if (r.status !== 0) throw new Error(`${what}: ${String(r.stderr).slice(-300)}`); };
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const FONT = "'Apple SD Gothic Neo',sans-serif";

// ── 문구 ─────────────────────────────────────────────────────────────────────
let say; let panel; let video = null;
if (BRAND === 'aisvi') {
  say = ['말하는 대로 내 컴퓨터를 조종하는 나만의 AI 비서, 에이스비입니다.', '에이스비 에이전트 닷컴에서 가입 없이 바로 무료로 체험해 보세요.'];
  video = resolve(ROOT, 'assets/outro/aisvi-demo.mp4');
  if (!existsSync(video)) { log(`❌ 시연 영상 없음: ${video}`); process.exit(1); }
  panel = `<div class="k" style="color:#93c5fd">나만의 AI 비서</div><div class="w">AISVI</div><div class="bar" style="background:#3b82f6"></div>
<div class="d">말하는 대로<br>내 컴퓨터를 조종합니다</div><div class="u">aisviagent.com</div><div class="pill">가입 없이 바로 무료 체험</div>`;
} else {
  const { openDb } = await import('../lib/db.mjs');
  const { todaysHit } = await import('../lib/best-hit.mjs');
  const hit = todaysHit(openDb());
  say = ['플로비움 닷넷에서 하루 다섯 번, AI 시장 리포트를 무료로 받아 보세요.', '종목별 분석은 설명란 링크에서 바로 볼 수 있습니다.'];
  const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  const hitHtml = hit?.best ? `<div class="hk">AI 추천 실제 수익</div><div class="hp">+${hit.best.pnl}%</div>
<div class="hn">${esc(hit.best.name ?? hit.best.ticker)} <span>${esc(String(hit.best.ticker).replace(/\.(KS|KQ)$/, ''))}</span></div>
<div class="hd">${md(hit.best.from)} 추천 → ${md(hit.best.to)} ${hit.best.outcome === 'hit_target' ? '목표가 도달' : '매도'}</div>
<div class="hs">추천 ${hit.evaluated.toLocaleString('en-US')}건 평가 중 실제 수익 20% 이상 기록 · 과거 수익이 미래 수익을 보장하지 않습니다</div>` : '';
  log(hit?.best ? `적중 ${hit.best.ticker} +${hit.best.pnl}% (${hit.rank}/${hit.of})` : '적중 기록 없음 — 브랜드만');
  panel = `<div class="k" style="color:#c4b5fd">AI 투자 종목 추천</div><div class="w">FLOWVIUM</div><div class="bar" style="background:#7c3aed"></div>
<div class="u">flowvium.net</div><div class="pill">하루 5번 AI 시장 리포트 · 무료</div>`;
  video = null; panel = { left: hitHtml, right: panel };
}

// ── 소리(고정 클립 — 한 번 굽는다) ───────────────────────────────────────────
const { synthesizeKoreanAuto } = await import('../lib/tts-korean.mjs');
const voice = synthesizeKoreanAuto(say, { outPrefix: join(WORK, 'v'), log: (m) => log(`[음성] ${m}`) });
const VO = join(WORK, 'vo.wav');
ff([...voice.flatMap((v) => ['-i', v.path]), '-filter_complex', `${voice.map((_, i) => `[${i}:a]aresample=44100,aformat=channel_layouts=mono,apad=pad_dur=0.25[s${i}]`).join(';')};${voice.map((_, i) => `[s${i}]`).join('')}concat=n=${voice.length}:v=0:a=1[a]`, '-map', '[a]', VO], '낭독 잇기');
const voSec = voice.reduce((a, v) => a + v.durationSec + 0.25, 0);
const SEC = Math.max(5, voSec + 0.5);
log(`[음성] ${voice.length}문장 ${voSec.toFixed(1)}초 → 광고 ${SEC.toFixed(1)}초`);

// ── 화면 ─────────────────────────────────────────────────────────────────────
const BASE = `*{margin:0;box-sizing:border-box}body{width:1920px;height:1080px;font-family:${FONT};background:#0b0a1a;color:#fff;position:relative;overflow:hidden}
.r{position:absolute;right:0;top:0;width:${video ? 700 : 900}px;height:1080px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center}
.k{font-size:46px;font-weight:800}.w{font-size:108px;font-weight:900;letter-spacing:14px;margin-top:6px}.bar{width:140px;height:8px;border-radius:4px;margin:26px 0}
.d{font-size:44px;font-weight:700;color:#e2e8f0;line-height:1.4;margin-bottom:26px}.u{font-size:62px;font-weight:900;color:#FFD400;margin-bottom:28px}
.pill{font-size:38px;font-weight:800;background:#16a34a;padding:12px 30px;border-radius:40px}
.l{position:absolute;left:0;top:0;width:1020px;height:1080px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;background:radial-gradient(120% 90% at 50% 30%,#1d1b3a 0%,#0b0a1a 70%)}
.hk{font-size:50px;font-weight:800;color:#c4b5fd}.hp{font-size:210px;font-weight:900;color:#22c55e;line-height:1.05;letter-spacing:-4px}
.hn{font-size:56px;font-weight:800;margin-top:10px}.hn span{color:#94a3b8;font-weight:700}.hd{font-size:40px;color:#cbd5e1;margin-top:14px;font-weight:700}
.hs{font-size:24px;color:#64748b;margin-top:26px;padding:0 60px}`;
const html = video
  ? `<!doctype html><meta charset="utf-8"><style>${BASE}body{background:transparent}.bg{position:absolute;inset:0;background:#0b0a1a;clip-path:polygon(1220px 0,1920px 0,1920px 1080px,1220px 1080px)}</style><div class="bg"></div><div class="r">${panel}</div>`
  : `<!doctype html><meta charset="utf-8"><style>${BASE}</style><div class="l">${panel.left}</div><div class="r">${panel.right}</div>`;
const PNG = join(WORK, 'card.png');
{
  const br = await chromium.launch({ headless: true }); const pg = await br.newPage({ viewport: { width: 1920, height: 1080 } });
  await pg.setContent(html); await pg.waitForTimeout(150); await pg.screenshot({ path: PNG, omitBackground: !!video }); await br.close();
}
const venc = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '1'];
if (video) {
  // 시연(1280×720)을 왼쪽 1152×648 에, 끝나면 마지막 장면을 잡아 둔다(tpad). 오른쪽에 글 판.
  ff(['-i', video, '-loop', '1', '-i', PNG, '-i', VO, '-filter_complex',
    `color=c=0x0b0a1a:s=1920x1080:r=30:d=${SEC.toFixed(2)}[bg];[0:v]fps=30,scale=1152:648,tpad=stop_mode=clone:stop_duration=${SEC.toFixed(2)}[d];[bg][d]overlay=48:216:shortest=1[v1];[v1][1:v]overlay=0:0:shortest=1[v]`,
    '-map', '[v]', '-map', '2:a', '-t', SEC.toFixed(2), ...venc, TMP], '광고 합성');
} else {
  ff(['-loop', '1', '-i', PNG, '-i', VO, '-vf', 'fps=30,format=yuv420p', '-map', '0:v', '-map', '1:a', '-t', SEC.toFixed(2), ...venc, TMP], '광고 합성');
}

// ── 재고 바꿔 끼우기(렌더 중인 롱폼이 반쯤 쓴 파일을 붙이지 않게) ─────────────────
const info = String(spawnSync(ffmpegPath, ['-hide_banner', '-i', TMP], { encoding: 'utf8' }).stderr);
const sec = (() => { const m = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(info); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0; })();
const bad = [!(sec >= 4 && sec <= 15) && `길이 ${sec.toFixed(2)}초`, !/1920x1080/.test(info) && '규격', !/44100 Hz, mono/.test(info) && '음성 규격'].filter(Boolean);
if (bad.length) { rmSync(TMP, { force: true }); log(`❌ 재 보니 안 맞다(${bad.join(' · ')}) — 예전 광고를 그대로 쓴다`); process.exit(1); }
renameSync(TMP, OUT);
log(`✅ ${OUT} · ${sec.toFixed(1)}초`);
