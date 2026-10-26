#!/usr/bin/env node
/**
 * make-track-record-video.mjs — 지난 매수 추천 성적을 다시 채점한 결과를 설명하는 가로 롱폼(3~4분) + 끝에 FlowVium 광고. 2026-10-26 신설.
 *
 * 왜: 사장님 10/26 "이거 관련 영상 만들어서 롱폼으로 올려 · 분석 한것들 flowvium 광고 넣고 · fear and greed가 영향이 있었다 등등".
 *   대본은 사람이 쓴 JSON(--script) — 숫자는 그날 잰 것만(분석: 성적표 data/scorecard.json + 뉴스·공포지수·손절 재계산).
 *   ChatGPT·agy·Claude 세 검토를 거친 대본만 넣는다(2명 이상 동의한 고침 반영).
 * 지키는 것:
 *   - 미국·한국 카드 숫자는 data/scorecard.json 과 대조한다 — 대본의 숫자와 화면 숫자가 성적표와 다르면 만들지 않는다.
 *   - 정리 장면은 지금 사이트(flowvium.net/ko/track-record)를 찍은 화면. 지어낸 화면 없음.
 *   - 보고서 생성 중이면 렌더하지 않는다 · 쇼츠와 같은 렌더 락(logs/video-publish.lock).
 *   - 끝 광고 = assets/outro/brief-ad-flowvium.mp4(make-brief-ads). 숫자는 성적표의 20% 이상 적중만(없으면 브랜드만).
 *
 * 사용: node scripts/video/make-track-record-video.mjs --script <json> [--out <폴더>] [--upload public|private]
 */
import ffmpegPath from 'ffmpeg-static';
import { chromium } from 'playwright';
import { spawnSync, spawn } from 'child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync, copyFileSync, openSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { ROOT } from '../lib/project-root.mjs';
import { licensedBeds } from '../lib/bgm-beds.mjs';
import { mixBgm } from '../lib/bgm-mix.mjs';

const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const SCRIPT = arg('script');
const OUT = resolve(arg('out', join(tmpdir(), 'flowvium-track-record-video')));
const UPLOAD = arg('upload');
const SITE = arg('site', 'https://flowvium.net');
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 19), '[track-video]', ...a);
const die = (m) => { log(`❌ ${m} — 만들지 않는다`); process.exit(1); };
const ff = (args, what, timeout = 900_000) => { const r = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { encoding: 'utf8', timeout }); if (r.status !== 0) throw new Error(`${what}: ${String(r.stderr || r.error?.message).slice(-300)}`); };
const probe = (f) => { const s = spawnSync(ffmpegPath, ['-hide_banner', '-i', f], { encoding: 'utf8' }).stderr ?? ''; const m = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(s); return { dur: m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null }; };
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
if (!SCRIPT || !existsSync(SCRIPT)) die('--script <json> 이 없다');
const S = JSON.parse(readFileSync(SCRIPT, 'utf8'));

// ── 0. 성적표 대조 — 대본의 미국·한국 숫자가 오늘 성적표와 같아야 한다 ─────────────────────
const sc = JSON.parse(readFileSync(join(ROOT, 'data/scorecard.json'), 'utf8'));
const M = { us: sc.markets.us, kr: sc.markets.kr };
const need = [
  ['us', `${M.us.finished}건`], ['us', `${M.us.profitShare}%`], ['us', `평균 수익은 ${Math.round(M.us.meanPct)}%`],
  ['kr', `${M.kr.finished}건`], ['kr', `${M.kr.profitShare}%`], ['kr', `마이너스 ${Math.abs(M.kr.meanPct)}%`], ['kr', `${M.kr.stopShare}%가 손절`],
];
for (const [m, s] of need) { const t = S.chapters.find((c) => c.card === m)?.say.join(' ') ?? ''; if (!t.includes(s)) die(`대본 ${m} 장에 성적표 숫자 "${s}" 가 없다(성적표가 바뀌었거나 대본이 틀렸다)`); }
if (!sc.gate?.kr?.reduce) die('성적표상 한국 축소가 풀렸다 — 대본("절반으로 줄였습니다")이 낡았다');

// ── 1. 돌아도 되나 ────────────────────────────────────────────────────────────
const { isReportPipelineRunning } = await import('../lib/report-running.mjs');
if (await isReportPipelineRunning(ROOT)) die('보고서 생성 중(렌더는 보고서와 겹치지 않는다)');
const { acquireRunLock } = await import('../lib/run-lock.mjs');
const lock = await acquireRunLock(join(ROOT, 'logs/video-publish.lock'), { waitMs: 20 * 60_000, label: 'track-record-video' });
if (!lock.ok) die(`렌더 락을 못 잡았다(${JSON.stringify(lock.holder)})`);

// ── 2. 화면 ───────────────────────────────────────────────────────────────────
const FONT = "'Apple SD Gothic Neo',sans-serif";
const BRAND = '#4F8FBF', Y = '#FFD400', RED = '#ff4d4f', BLUE = '#3b82f6', GRN = '#22c55e';
const BASE = `*{margin:0;box-sizing:border-box}body{width:1920px;height:1080px;font-family:${FONT};background:#0b1220;color:#fff;position:relative;overflow:hidden}
.top{position:absolute;left:0;right:0;top:0;height:14px;background:${BRAND}}.brand{position:absolute;left:70px;top:44px;font-size:30px;font-weight:900;color:${BRAND};letter-spacing:2px}
.h{position:absolute;left:70px;top:100px;font-size:64px;font-weight:900}.wrap{position:absolute;left:70px;right:70px;top:230px;bottom:230px;display:flex;align-items:center;justify-content:center;gap:70px}
.big{font-size:150px;font-weight:900;line-height:1;font-variant-numeric:tabular-nums}.lab{font-size:42px;color:#cbd5e1;font-weight:700;margin-top:18px}.box{text-align:center}
.note{position:absolute;left:70px;right:70px;bottom:215px;text-align:center;font-size:36px;color:#94a3b8;font-weight:700}`;
const page = (heading, body, note = '') => `<!doctype html><meta charset="utf-8"><style>${BASE}</style><div class="top"></div><div class="brand">FLOWVIUM · 지난 추천 성적</div><div class="h">${esc(heading)}</div>${body}${note ? `<div class="note">${esc(note)}</div>` : ''}`;
const stat = (v, l, c = '#fff') => `<div class="box"><div class="big" style="color:${c}">${esc(v)}</div><div class="lab">${esc(l)}</div></div>`;
// 가로 막대 — 값 비교(같은 축). 음수는 왼쪽으로.
const bars = (rows, { unit = '%', max } = {}) => { const mx = max ?? Math.max(...rows.map((r) => Math.abs(r.v))); return `<div style="width:1500px">${rows.map((r) => `<div style="display:flex;align-items:center;margin:26px 0">
<div style="width:420px;font-size:44px;font-weight:800;text-align:right;padding-right:30px">${esc(r.l)}</div><div style="flex:1;height:76px;position:relative;background:#111827;border-radius:10px">
<div style="position:absolute;left:0;top:0;bottom:0;width:${(100 * Math.abs(r.v) / mx).toFixed(1)}%;background:${r.c};border-radius:10px"></div></div>
<div style="width:260px;font-size:56px;font-weight:900;text-align:right;font-variant-numeric:tabular-nums;color:${r.c}">${r.v > 0 && unit === '%p' ? '+' : ''}${esc(r.txt ?? `${r.v}${unit}`)}</div></div>`).join('')}</div>`; };
const C = S.cards ?? {};
const CARDS = {
  intro: () => `<!doctype html><meta charset="utf-8"><style>${BASE}body{display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center}</style><div class="top"></div>
<div style="font-size:54px;color:#cbd5e1;font-weight:800">AI가 추천한 한국 주식</div><div style="font-size:190px;font-weight:900;color:${Y};margin-top:10px">10건 중 6건</div><div style="font-size:120px;font-weight:900;color:${RED}">손절</div>
<div style="font-size:46px;color:#cbd5e1;font-weight:700;margin-top:40px">미국 주식은 시장과 비슷 · 추천 ${M.us.finished + M.kr.finished}건 다시 채점</div>`,
  how: () => page('어떻게 채점했나', `<div class="wrap" style="flex-direction:column;align-items:flex-start;gap:30px;padding-left:120px">${['추천 뒤 14일 동안 따라감', '매수 가격까지 내려와야 산 것', '손절가·목표가는 실제로 닿았을 때만', '하루에 둘 다 닿으면 손절로', '끝까지 안 닿으면 14일째 종가'].map((t, i) => `<div style="font-size:58px;font-weight:800"><span style="color:${Y};margin-right:26px">${i + 1}</span>${esc(t)}</div>`).join('')}</div>`, '수수료·세금 빼기 전 · 같은 종목 2주 안 재추천은 한 번'),
  us: () => page(`미국 종목 ${M.us.finished}건`, `<div class="wrap">${stat(`${M.us.profitShare}%`, '돈을 번 추천')}${stat(`${M.us.meanPct > 0 ? '+' : ''}${M.us.meanPct}%`, '평균 수익')}${stat(`${M.us.stopShare}%`, '손절로 끝남')}</div>`, 'S&P 500 과 거의 같았다'),
  kr: () => page(`한국 종목 ${M.kr.finished}건`, `<div class="wrap">${stat(`${M.kr.profitShare}%`, '돈을 번 추천')}${stat(`${M.kr.meanPct}%`, '평균 수익', BLUE)}${stat(`${M.kr.stopShare}%`, '손절로 끝남', RED)}</div>`, '10월 25일부터 한국 매수 추천 수 절반으로'),
  news: () => page('미국 · 추천 전 일주일 안에 그 회사 뉴스', `<div class="wrap">${bars(C.news, { max: 100 })}</div>`, C.newsNote),
  fg: () => page('미국 · 공포·탐욕 구간별 돈을 번 비율', `<div class="wrap">${bars(C.fg, { max: 100 })}</div>`, C.fgNote),
  stops: () => page('한국 · 지난 추천에 다른 기준을 적용하면', `<div class="wrap">${bars(C.stops, { max: 5 })}</div>`, C.stopsNote),
};
const br = await chromium.launch({ headless: true });
const pg = await br.newPage({ viewport: { width: 1920, height: 1080 } });
for (const [i, c] of S.chapters.entries()) {
  c.img = join(OUT, `c${i}.png`);
  if (c.card === 'site') continue;
  await pg.setContent(CARDS[c.card]()); await pg.waitForTimeout(150); await pg.screenshot({ path: c.img });
}
// 정리 장면 = 지금 사이트 화면(1280×720 을 1.5배 — site-tour 와 같은 크기 규칙)
{
  const sp = await br.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5, locale: 'ko-KR' });
  await sp.goto(`${SITE}/ko/track-record`, { waitUntil: 'networkidle', timeout: 90_000 }).catch(() => {});
  await sp.waitForTimeout(3000);
  const ok = await sp.getByText('지난 추천 성적', { exact: false }).count();
  if (!ok) { await br.close(); die('사이트 성적 페이지에서 "지난 추천 성적" 을 못 찾았다'); }
  for (const c of S.chapters.filter((x) => x.card === 'site')) await sp.screenshot({ path: c.img });
  await sp.close();
}
// 썸네일 — 채널 규칙(노랑·빨강 큰 글씨), 왼쪽 짙은 판 + 오른쪽 사이트 화면
const THUMB = join(OUT, 'thumb.jpg');
{
  const tp = await br.newPage({ viewport: { width: 1280, height: 720 } });
  const b64 = readFileSync(S.chapters.find((c) => c.card === 'site').img).toString('base64');
  await tp.setContent(`<!doctype html><meta charset="utf-8"><style>*{margin:0;box-sizing:border-box}body{width:1280px;height:720px;background:#0E1A2B;font-family:${FONT};position:relative;overflow:hidden}
.ph{position:absolute;right:0;top:0;width:620px;height:720px;object-fit:cover;object-position:left top;filter:brightness(.85)}.pan{position:absolute;left:0;top:0;width:780px;height:720px;background:#0E1A2B;clip-path:polygon(0 0,100% 0,86% 100%,0 100%)}
.b{position:absolute;left:50px;top:40px;font-size:30px;font-weight:900;color:${BRAND};letter-spacing:2px}.l{position:absolute;left:46px;font-weight:900;white-space:nowrap;letter-spacing:-4px;-webkit-text-stroke:3px #000;paint-order:stroke fill}</style>
<img class="ph" src="data:image/png;base64,${b64}"><div class="pan"></div><div class="b">FLOWVIUM 성적 공개</div>
<div class="l" style="top:110px;font-size:96px;color:#fff">AI 한국 주식 추천</div><div class="l" style="top:240px;font-size:150px;color:${Y}">10건 중 6건</div><div class="l" style="top:420px;font-size:150px;color:${RED}">손절</div>
<div class="l" style="top:610px;font-size:44px;color:#cbd5e1;letter-spacing:0;-webkit-text-stroke:0">추천 ${M.us.finished + M.kr.finished}건 다시 채점</div>`);
  await tp.evaluate(() => { for (const el of document.querySelectorAll('.l')) { let f = parseFloat(getComputedStyle(el).fontSize); while (el.getBoundingClientRect().right > 740 && f > 40) { f -= 4; el.style.fontSize = `${f}px`; } } });
  await tp.screenshot({ path: THUMB, type: 'jpeg', quality: 90 }); await tp.close();
}
await br.close();

// ── 3. 소리 ───────────────────────────────────────────────────────────────────
const { synthesizeKoreanAuto } = await import('../lib/tts-korean.mjs');
// 낭독: 라틴 글자·기호는 한글 소리로(채널 관례 — '플로비움 닷넷'). 자막은 원문.
const speak = (s) => s.replace(/S&P 500/g, '에스앤피 오백').replace(/AI/g, '에이아이').replace(/%포인트/g, '퍼센트포인트');
const sents = S.chapters.flatMap((c, ci) => c.say.map((s) => ({ ci, s })));
const voice = synthesizeKoreanAuto(sents.map((x) => speak(x.s)), { outPrefix: join(OUT, 'v'), log: (m) => log(`[음성] ${m}`) });
sents.forEach((x, i) => { x.audio = voice[i].path; x.dur = voice[i].durationSec; x.alignment = voice[i].alignment; });

// ── 4. 조각 + 자막 ────────────────────────────────────────────────────────────
const { cuesFromAlignment, toAss } = await import('../lib/subtitle.mjs');
const GAP = 0.3, venc = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '1'];
const parts = [], cues = [], timeline = []; let t = 0;
for (const [ci, c] of S.chapters.entries()) {
  const ss = sents.filter((x) => x.ci === ci);
  const wav = join(OUT, `a${ci}.wav`);
  const filt = ss.map((_, i) => `[${i}:a]aresample=44100,aformat=channel_layouts=mono,apad=pad_dur=${GAP}[s${i}]`).join(';') + `;${ss.map((_, i) => `[s${i}]`).join('')}concat=n=${ss.length}:v=0:a=1[a]`;
  ff([...ss.flatMap((x) => ['-i', x.audio]), '-filter_complex', filt, '-map', '[a]', wav], `음성 ${ci}`);
  // 자막은 원문 글자(낭독용 바꿈 전)로 — 정렬 글자 수가 다르면 문장 하나를 통째로 한 자막으로
  let off = t;
  for (const x of ss) {
    const cs = cuesFromAlignment(x.alignment, { maxChars: 30, maxLines: 1, maxDur: 3.2, offset: off });
    const same = cs.map((q) => q.text).join('').replace(/\s/g, '') === x.s.replace(/\s/g, '');
    if (same) cues.push(...cs);
    else { const parts2 = x.s.match(/.{1,28}(\s|$)|.{1,28}/g).map((p) => p.trim()).filter(Boolean); const tot = parts2.reduce((a, p) => a + p.length, 0); let tt = off;
      for (const p of parts2) { const d = x.dur * p.length / tot; cues.push({ start: tt, end: tt + d, text: p }); tt += d; } }
    off += x.dur + GAP;
  }
  const d = probe(wav).dur, out = join(OUT, `p${ci}.mp4`), fr = Math.round(d * 30);
  timeline.push({ title: c.heading, start: Math.round(t) });
  // 밝은 사이트 화면 위 자막이 표 글자와 겹쳐 안 읽혔다(10/26 눈검증) — 사이트 장면만 아래 띠를 어둡게.
  const band = c.card === 'site' ? ',drawbox=x=0:y=ih-230:w=iw:h=230:color=black@0.72:t=fill' : '';
  ff(['-loop', '1', '-i', c.img, '-i', wav, '-filter_complex', `[0:v]scale=3840:2160,zoompan=z='min(1+0.03*on/${fr},1.03)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${fr}:s=1920x1080:fps=30${band},format=yuv420p[v]`,
    '-map', '[v]', '-map', '1:a', '-t', d.toFixed(3), ...venc, out], `장면 ${ci}`);
  parts.push(out); t += probe(out).dur;
}
const AD = join(ROOT, 'assets/outro/brief-ad-flowvium.mp4');
if (!existsSync(AD)) die('끝 광고(brief-ad-flowvium.mp4)가 없다 — node scripts/video/make-brief-ads.mjs --brand flowvium');
ff(['-i', AD, '-vf', 'scale=1920:1080,fps=30,format=yuv420p', '-af', 'aresample=44100,aformat=channel_layouts=mono', ...venc, join(OUT, 'p_ad.mp4')], '끝 광고');
const bodyLen = t;
parts.push(join(OUT, 'p_ad.mp4'));
writeFileSync(join(OUT, 'list.txt'), parts.map((p) => `file '${p}'`).join('\n'));
const JOINED = join(OUT, 'joined.mp4');
ff(['-f', 'concat', '-safe', '0', '-i', join(OUT, 'list.txt'), '-c', 'copy', JOINED], '이어 붙이기');
writeFileSync(join(OUT, 'subs.ass'), toAss(cues, { font: 'Apple SD Gothic Neo', fontSize: 56, marginV: 60, playResX: 1920, playResY: 1080 }));
const SUBBED = join(OUT, 'subbed.mp4');
const { beds } = licensedBeds(join(ROOT, 'assets/bgm'));
const NOBGM = beds.length ? join(OUT, 'subbed-nobgm.mp4') : SUBBED;
ff(['-i', JOINED, '-vf', `subtitles=${join(OUT, 'subs.ass').replace(/:/g, '\\:')}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'copy', NOBGM], '자막', 1_200_000);
if (beds.length) {
  const bed = beds[Math.floor(Date.now() / 864e5) % beds.length];
  const r = mixBgm({ input: NOBGM, bed: join(ROOT, 'assets/bgm', bed), output: SUBBED, workDir: OUT });
  if (r.ok) log(`[소리] 배경음 ${bed} — 내레이션 ${r.voiceI.toFixed(1)} · 배경 ${r.bedI.toFixed(1)} LUFS (${r.gap.toFixed(1)}dB 아래)`);
  else { log(`[소리] ⚠ 배경음 실패 — 음악 없이: ${r.reason}`); copyFileSync(NOBGM, SUBBED); }
}
const FINAL = join(OUT, 'track-record.mp4');
{
  const { measure, normalize } = await import('../lib/loudness.mjs');
  const r = normalize(SUBBED, FINAL, -14, { extraOut: ['-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart'] });
  const after = r.ok ? measure(['-i', FINAL]) : null;
  if (r.ok && after && Math.abs(after.I - -14) <= 1.5) log(`[소리] ${r.before.toFixed(1)} → ${after.I.toFixed(1)} LUFS`);
  else { log(`[소리] ⚠ 음량 맞추기 실패 — 원래 크기로: ${r.reason ?? after?.I}`); copyFileSync(SUBBED, FINAL); }
}
const LEN = probe(FINAL).dur;
log(`✅ ${FINAL} · ${LEN?.toFixed(0)}초 (본편 ${bodyLen.toFixed(0)}초)`);
if (!(LEN >= 120 && LEN <= 420)) die(`길이 ${LEN?.toFixed(0)}초 — 2~7분 밖`);

// ── 5. 설명 · 올리기 ──────────────────────────────────────────────────────────
const { chapterLines } = await import('../lib/roundup.mjs');
const description = [S.chapters[0].say.join(' '), '',
  '📊 매일 새로 계산하는 지난 추천 성적: https://flowvium.net/ko/track-record',
  '📈 매일 무료 AI 투자 리포트: https://flowvium.net/ko/report', '',
  ...chapterLines(timeline), '',
  ...(S.descriptionNotes ?? []), '',
  '※ 이 영상은 특정 종목의 매수·매도를 권하는 내용이 아닙니다. 과거 성적은 미래 수익을 보장하지 않습니다. 수익률은 수수료·세금을 빼기 전입니다.',
  '#주식 #AI주식추천 #손절 #공포탐욕지수 #코스피 #미국주식 #Flowvium'].join('\n').slice(0, 4800);
writeFileSync(join(OUT, 'meta.json'), JSON.stringify({ title: S.title, description, seconds: LEN, timeline }, null, 2));
log(`[메타] "${S.title}"`);
if (UPLOAD) {
  const { upload, setThumbnail, currentChannel, channelMismatch } = await import('../lib/youtube.mjs');
  const { loadEnvLocal } = await import('../lib/llm-config.mjs'); loadEnvLocal();
  const bad = channelMismatch(await currentChannel(), process.env.YOUTUBE_CHANNEL_ID);
  if (bad) die(bad);
  const u = await upload({ file: FINAL, title: S.title, description, privacy: UPLOAD,
    tags: ['AI주식추천', '주식', '손절', '익절', '공포탐욕지수', '코스피', '미국주식', 'S&P500', '추천성적', 'Flowvium'] });
  const th = await setThumbnail(u.id, THUMB);
  log(`✅ 올림 ${u.url} (${UPLOAD}) · 썸네일 ${th.ok ? '적용' : `실패 ${th.reason}`}`);
  writeFileSync(join(OUT, 'uploaded.json'), JSON.stringify({ ...u, privacy: UPLOAD, at: new Date().toISOString() }, null, 2));
  if (UPLOAD === 'public') {
    const o = openSync(join(ROOT, 'logs/pin-comment.log'), 'a');
    spawn(process.execPath, [join(ROOT, 'scripts/yt-pin-comment.mjs'), '--ids', u.id, '--kind', 'long', '--then-verify', '600'], { detached: true, stdio: ['ignore', o, o] }).unref();
  }
}
lock.release();
