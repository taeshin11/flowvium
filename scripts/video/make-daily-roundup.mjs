#!/usr/bin/env node
/**
 * make-daily-roundup.mjs — 하루치 쇼츠를 묶어 가로 롱폼 '뉴스 총정리'를 만든다. (2026-10-06)
 *
 * 사장님 "숏폼 내용 묶어서 롱폼도 좀 만들까? 뉴스채널들 차용해봐". 차용 근거·제목 규칙은 lib/roundup.test.mjs 머리말.
 * 구성: 1920×1080. 왼쪽에 그날 쇼츠(9:16) 원본, 오른쪽에 그날 목록(지금 꼭지 노랑). 블러 채우기 없음(9/21 사장님).
 *   쇼츠 끝 2초 광고 카드는 편마다 잘라 내고 마지막에 한 번만 둔다. 순서는 그날 조회수 큰 편부터(첫 장 = 가장 큰 뉴스).
 *   쇼츠는 우리 채널에 이미 공개된 것을 yt-dlp 로 받는다(로컬 렌더 파일은 발행 뒤 지워진다).
 *
 * 사용: node scripts/video/make-daily-roundup.mjs [--date 2026-10-05] [--out <폴더>] [--upload private|unlisted|public]
 */
import { chromium } from 'playwright';
import ffmpegPath from 'ffmpeg-static';
import { spawnSync } from 'child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir, homedir } from 'os';
import { ROOT } from '../lib/project-root.mjs';
import { orderByViews, chapterLines, roundupTitle, cleanHeadline } from '../lib/roundup.mjs';

const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const kstDay = (t = Date.now()) => new Date(t + 9 * 3600e3).toISOString().slice(0, 10);
const DATE = arg('date', kstDay());
const OUT = resolve(arg('out', join(tmpdir(), 'flowvium-roundup')));
const UPLOAD = arg('upload');
const MIN = Number(arg('min', 4));
const CARD_SEC = 2.0;   // 쇼츠 끝 광고 카드 길이(make-shorts "2초 광고 카드")
const log = (...a) => console.log(new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 19), '[roundup]', ...a);
const ff = (args, what) => { const r = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8', timeout: 600_000 }); if (r.status !== 0) throw new Error(`${what}: ${String(r.stderr).slice(-300)}`); };
const dur = (f) => { const r = spawnSync(ffmpegPath, ['-hide_banner', '-i', f], { encoding: 'utf8' }); const m = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(r.stderr ?? ''); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null; };

const { openDb } = await import('../lib/db.mjs');
const rows = openDb().prepare(`SELECT p.video_id, p.headline, p.headlines_json, p.published_at,
    (SELECT s.views FROM shorts_stats s WHERE s.video_id = p.video_id ORDER BY s.checked_at DESC LIMIT 1) views
  FROM shorts_published p WHERE p.retracted_at IS NULL AND p.video_id IS NOT NULL
   AND date(datetime(p.published_at, '+9 hours')) = ?`).all(DATE);
if (rows.length < MIN) { log(`${DATE} 쇼츠 ${rows.length}편 — ${MIN}편 미만이면 만들지 않는다`); process.exit(0); }
// 쇼츠 한 편은 2~4꼭지 브리핑이다 — 대표 제목만 쓰면 화면(둘째 꼭지)과 목록이 어긋난다(첫 시험판 눈검증). 꼭지 제목을 같이 싣는다.
// 같은 사건의 (종합)·속보판이 꼭지로 겹쳐 들어온다(10/06 첫 공개판 06번) — 앞 12자가 같으면 한 꼭지로 본다.
const sameStory = (a, b) => a.replace(/\s/g, '').slice(0, 12) === b.replace(/\s/g, '').slice(0, 12);
const items = (r) => { let a; try { a = JSON.parse(r.headlines_json ?? '[]').map(cleanHeadline).filter(Boolean); } catch { a = []; }
  if (!a.length) a = [cleanHeadline(r.headline)];
  return a.filter((x, i) => !a.slice(0, i).some((y) => sameStory(x, y))); };
const list = orderByViews(rows).map((r) => { const it = items(r); return { ...r, items: it, title: it[0] }; });
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
log(`${DATE} 쇼츠 ${list.length}편 → ${OUT}`);

// 1) 받기 + 광고 카드 잘라 내기
const YT = existsSync(join(homedir(), '.flowvium-tools/melo-venv/bin/yt-dlp')) ? join(homedir(), '.flowvium-tools/melo-venv/bin/yt-dlp') : 'yt-dlp';
for (const [i, s] of list.entries()) {
  const raw = join(OUT, `raw${i}.mp4`);
  const r = spawnSync(YT, ['-q', '--no-warnings', '--ffmpeg-location', ffmpegPath, '-f', 'bv*[height<=1920]+ba/b', '--merge-output-format', 'mp4', '-o', raw, `https://youtube.com/shorts/${s.video_id}`], { encoding: 'utf8', timeout: 300_000 });
  if (r.status !== 0 || !existsSync(raw)) throw new Error(`${s.video_id} 받기 실패: ${String(r.stderr).slice(-200)}`);
  s.raw = raw; s.dur = Math.max(5, (dur(raw) ?? 0) - CARD_SEC);
}

// 2) 오른쪽 목록 패널(꼭지마다 1장) + 오프닝·끝 카드
const [, M, D] = DATE.split('-').map(Number);
const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const panelHtml = (cur, mode = 'list') => `<!doctype html><meta charset="utf-8"><style>*{margin:0;box-sizing:border-box}
body{width:1920px;height:1080px;background:#06090f;font-family:'Apple SD Gothic Neo',sans-serif;color:#fff;position:relative;overflow:hidden}
.v{position:absolute;left:120px;top:0;width:608px;height:1080px;background:#000}
.p{position:absolute;left:800px;top:70px;width:1040px}
.h{font-size:58px;font-weight:900}.h span{color:#ffd400}.sub{font-size:28px;color:#8a99b3;margin:10px 0 34px}
.i{display:flex;gap:18px;align-items:flex-start;font-size:33px;font-weight:700;color:#7d8aa3;line-height:1.3;padding:14px 18px;border-radius:14px;margin-bottom:6px}
.i b{min-width:46px;color:#56627a}.i.on{background:#151d2c;color:#fff}.i.on b{color:#ffd400}
.sx{font-size:25px;font-weight:600;color:#9fb0c8;margin-top:8px;line-height:1.35}
.f{position:absolute;left:800px;bottom:56px;font-size:30px;font-weight:800;color:#cbd5e1}.f span{color:#ffd400}
.big{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center}
.big .t{font-size:110px;font-weight:900}.big .t span{color:#ffd400}.big .s{font-size:44px;color:#cbd5e1;margin-top:26px}</style>
${mode === 'list' ? `<div class="v"></div><div class="p"><div class="h">${M}월 ${D}일 <span>뉴스 총정리</span></div><div class="sub">오늘 Flowvium 쇼츠 ${list.length}편 · 많이 본 순</div>
${list.map((s, k) => `<div class="i${k === cur ? ' on' : ''}"><b>${String(k + 1).padStart(2, '0')}</b><div>${esc(s.title.length > 46 ? `${s.title.slice(0, 45)}…` : s.title)}${k === cur && s.items.length > 1 ? s.items.slice(1).map((x) => `<div class="sx">· ${esc(x.length > 50 ? `${x.slice(0, 49)}…` : x)}</div>`).join('') : ''}</div></div>`).join('')}</div>
<div class="f">매일 AI 투자 리포트 · <span>flowvium.net</span></div>`
  : `<div class="big"><div class="t">${M}월 ${D}일 <span>뉴스 총정리</span></div><div class="s">${mode === 'intro' ? `오늘 뉴스 ${list.reduce((a, s) => a + s.items.length, 0)}건을 한 번에` : '구독하면 매일 받아보실 수 있습니다 · flowvium.net'}</div></div>`}`;
const b = await chromium.launch({ headless: true });
const pg = await b.newPage({ viewport: { width: 1920, height: 1080 } });
const shot = async (html, f) => { await pg.setContent(html); await pg.waitForTimeout(150); await pg.screenshot({ path: f }); };
for (let k = 0; k < list.length; k++) await shot(panelHtml(k), join(OUT, `panel${k}.png`));
await shot(panelHtml(0, 'intro'), join(OUT, 'intro.png'));
await shot(panelHtml(0, 'outro'), join(OUT, 'outro.png'));
await b.close();

// 3) 조각 만들기 — 같은 규격(1920×1080·30fps·AAC 44.1k 스테레오)으로 다시 인코딩해 이어 붙인다
const parts = [];
const still = (png, sec, out) => ff(['-loop', '1', '-t', String(sec), '-i', png, '-f', 'lavfi', '-t', String(sec), '-i', 'anullsrc=r=44100:cl=stereo',
  '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-shortest', out], `정지 화면 ${png}`);
still(join(OUT, 'intro.png'), 3, join(OUT, 'p_intro.mp4')); parts.push(join(OUT, 'p_intro.mp4'));
for (const [k, s] of list.entries()) {
  const out = join(OUT, `p${k}.mp4`);
  ff(['-loop', '1', '-i', join(OUT, `panel${k}.png`), '-t', s.dur.toFixed(2), '-i', s.raw,
    '-filter_complex', `[1:v]scale=608:1080:force_original_aspect_ratio=decrease,pad=608:1080:(ow-iw)/2:(oh-ih)/2:black[v];[0:v][v]overlay=120:0,fps=30,format=yuv420p[o];[1:a]aresample=44100,aformat=channel_layouts=stereo[a]`,
    '-map', '[o]', '-map', '[a]', '-t', s.dur.toFixed(2), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', out], `꼭지 ${k + 1}`);
  parts.push(out);
}
still(join(OUT, 'outro.png'), 4, join(OUT, 'p_outro.mp4')); parts.push(join(OUT, 'p_outro.mp4'));
writeFileSync(join(OUT, 'list.txt'), parts.map((p) => `file '${p}'`).join('\n'));
const FINAL = join(OUT, 'roundup.mp4');
ff(['-f', 'concat', '-safe', '0', '-i', join(OUT, 'list.txt'), '-c', 'copy', '-movflags', '+faststart', FINAL], '이어 붙이기');

// 4) 챕터·제목·설명
let t = 0; const chapters = [];
for (const [k, s] of list.entries()) { chapters.push({ title: `${s.title.slice(0, 60)}${s.items.length > 1 ? ` 外 ${s.items.length - 1}` : ''}`, start: k === 0 ? 0 : Math.round(t) }); t += (k === 0 ? 3 : 0) + s.dur; }
const total = dur(FINAL);
const NEWS = list.reduce((a, s) => a + s.items.length, 0);   // 제목·썸네일의 'N건' 은 쇼츠 편수가 아니라 실제 꼭지 수
const title = roundupTitle({ lead: list[0].title, n: NEWS, date: DATE });
const { trackedUrl } = await import('../lib/site-link.mjs');
const description = [`${M}월 ${D}일 Flowvium 쇼츠 ${list.length}편(뉴스 ${NEWS}건)을 많이 본 순서로 한 번에 모았습니다.`, '',
  ...chapterLines(chapters), '',
  `📈 매일 AI 투자 리포트(무료): ${trackedUrl({ source: 'youtube', medium: 'roundup', campaign: DATE })}`,
  '', '※ 뉴스 요약이며 특정 종목의 매수·매도 권유가 아닙니다.', '#뉴스 #오늘의뉴스 #뉴스총정리 #경제뉴스'].join('\n');
// 썸네일: 첫 꼭지(가장 많이 본) 첫 화면 + 큰 글씨
const frame = join(OUT, 'lead.jpg');
// 쇼츠 화면 전체(위 제목 띠·아래 자막 포함)를 쓰면 글자가 겹쳐 지저분하다 — 사진 자리(세로 30~64%)만 오린다(classic·zoom 둘 다 그 안).
ff(['-ss', '0.4', '-i', list[0].raw, '-frames:v', '1', '-vf', 'crop=iw:ih*0.34:0:ih*0.30', frame], '썸네일 원화');
const tb = await chromium.launch({ headless: true }); const tp = await tb.newPage({ viewport: { width: 1280, height: 720 } });
await tp.setContent(`<!doctype html><meta charset="utf-8"><style>*{margin:0}body{width:1280px;height:720px;background:#06090f;font-family:'Apple SD Gothic Neo',sans-serif;position:relative;overflow:hidden}
img{position:absolute;right:0;top:0;width:640px;height:720px;object-fit:cover}
.g{position:absolute;right:640px;top:0;width:160px;height:720px;background:linear-gradient(90deg,#06090f,rgba(6,9,15,0))}.t{position:absolute;left:56px;top:120px;width:760px;font-weight:900;line-height:1.08}
.a{font-size:96px;color:#ffd400;-webkit-text-stroke:4px #000;paint-order:stroke fill}.b{font-size:120px;color:#ff3b30;-webkit-text-stroke:5px #000;paint-order:stroke fill}.c{font-size:40px;color:#fff;margin-top:24px;width:560px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}</style>
<img src="data:image/jpeg;base64,${readFileSync(frame).toString('base64')}"><div class="g"></div><div class="t"><div class="a">${M}월 ${D}일</div><div class="b">뉴스 ${NEWS}건</div><div class="a">총정리</div><div class="c">${esc(list[0].title)}</div></div>`);
const THUMB = join(OUT, 'roundup-thumb.jpg');
await tp.screenshot({ path: THUMB, type: 'jpeg', quality: 88 }); await tb.close();
writeFileSync(join(OUT, 'roundup-meta.json'), JSON.stringify({ date: DATE, title, description, seconds: total, videos: list.map((s) => s.video_id) }, null, 2));
log(`✅ ${FINAL} · ${total?.toFixed(1)}초 · "${title}"`);

if (UPLOAD) {
  const { upload, setThumbnail, currentChannel, channelMismatch } = await import('../lib/youtube.mjs');
  const { loadEnvLocal } = await import('../lib/llm-config.mjs'); loadEnvLocal();
  const bad = channelMismatch(await currentChannel(), process.env.YOUTUBE_CHANNEL_ID);
  if (bad) { log(`❌ ${bad}`); process.exit(1); }
  const u = await upload({ file: FINAL, title, description, tags: ['뉴스', '오늘의뉴스', '뉴스총정리', '경제뉴스', 'Flowvium'], privacy: UPLOAD });
  const th = await setThumbnail(u.id, THUMB);
  log(`✅ 올림 ${u.url} (${UPLOAD}) · 썸네일 ${th.ok ? '적용' : `실패 ${th.reason}`}`);
  writeFileSync(join(ROOT, 'logs', `roundup-${DATE}.json`), JSON.stringify({ ...u, privacy: UPLOAD, title, at: new Date().toISOString() }, null, 2));
}
