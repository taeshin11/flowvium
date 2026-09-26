#!/usr/bin/env node
/**
 * youtube-post.mjs — 매일 게시물(이미지) 한 편: 오늘 가장 많이 본 쇼츠의 썸네일 + 제목 + 링크 + 구독 권유. (2026-09-27 신설)
 *
 * 사장님 "구독자 올릴수있는건 다 해봐 웹검색, 레퍼런스 검색 다 해봐".
 * 근거: 게시물은 모든 채널이 쓸 수 있고(구독자 문턱 없음), 이미지 게시물은 쇼츠 피드에서 비구독자에게도
 *   추천된다(Help Center · Made on YouTube 2026-09). Data API 에 게시물 작성 창구가 **없어** 브라우저로 한다
 *   (전용 프로필 secrets/youtube-profile — 채널 소유 계정. 로그인은 사람이 한 번 해 둔 것).
 * 원칙: 이미 낸 쇼츠의 사실만 — 설문(편드는 것으로 보일 수 있다)·지어낸 문장 없음. 하루 한 번(logs/yt-posts.json).
 *
 * 사용: node scripts/youtube-post.mjs [--dry]   (--dry: 글·이미지를 채우고 스크린샷만, 게시 안 누름)
 */
import { chromium } from 'playwright';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { ROOT } from './lib/project-root.mjs';
import { buildPostText, pickPostVideo } from './lib/yt-post-text.mjs';

const DRY = process.argv.includes('--dry');
const log = (...a) => console.log(new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 19), '[post]', ...a);
const STATE = resolve(ROOT, 'logs/yt-posts.json');
const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const state = (() => { try { return JSON.parse(readFileSync(STATE, 'utf8')); } catch { return {}; } })();
if (state[day] && !DRY) { log(`오늘(${day}) 이미 올렸다 — ${state[day].videoId}`); process.exit(0); }

// ① 대상: 최근 24시간에 낸 쇼츠 중 조회 최고(내린 편 제외)
const { openDb } = await import('./lib/db.mjs');
const rows = openDb().prepare(`
  SELECT p.video_id, p.retracted_at, s.views, s.title
    FROM shorts_published p JOIN shorts_stats s ON s.video_id = p.video_id
   WHERE datetime(p.published_at) >= datetime('now','-24 hours')
     AND s.checked_at = (SELECT MAX(checked_at) FROM shorts_stats WHERE video_id = p.video_id)`).all();
const pick = pickPostVideo(rows);
if (!pick) { log('최근 24시간에 올릴 쇼츠가 없다 — 쉰다'); process.exit(0); }
const text = buildPostText({ title: pick.title, videoId: pick.video_id });
log(`대상 ${pick.video_id} · 조회 ${pick.views} · "${String(pick.title).slice(0, 40)}"`);

// ② 이미지: 유튜브 공개 썸네일(세로 → 가로 순). 너무 작거나 못 읽으면 다음 것.
const work = join(tmpdir(), 'yt-post'); mkdirSync(work, { recursive: true });
const img = join(work, `${pick.video_id}.jpg`);
let got = null;
for (const name of ['oar2.jpg', 'maxresdefault.jpg', 'hqdefault.jpg']) {
  try {
    const r = await fetch(`https://i.ytimg.com/vi/${pick.video_id}/${name}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) continue;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 8000) continue;
    writeFileSync(img, buf);
    const pr = spawnSync(ffmpegPath, ['-hide_banner', '-i', img], { encoding: 'utf8' }).stderr ?? '';
    const m = /,\s(\d{3,5})x(\d{3,5})[,\s]/.exec(pr);
    if (m && Number(m[1]) >= 400) { got = { name, w: +m[1], h: +m[2] }; break; }
  } catch { /* 다음 */ }
}
if (!got) { log('썸네일을 못 받았다 — 쉰다'); process.exit(1); }
log(`이미지 ${got.name} ${got.w}x${got.h}`);

// ③ 게시(브라우저)
const shots = join(work, 'shots'); mkdirSync(shots, { recursive: true });
const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/youtube-profile'), {
  channel: 'chrome', headless: true, viewport: { width: 1280, height: 1000 }, args: ['--disable-blink-features=AutomationControlled'] });
const page = ctx.pages()[0] ?? await ctx.newPage();
const shot = (n) => page.screenshot({ path: join(shots, `${n}.png`) }).catch(() => {});
const die = async (m) => { log(`❌ ${m}`); await shot('fail'); await ctx.close(); process.exit(1); };
try {
  await page.goto('https://www.youtube.com/@flowvium/posts', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  // 작성 칸은 접혀 있다(#contenteditable-root 폭 0). 보이는 안내 글을 눌러 펼친다 — 안내 글은 로드마다 바뀐다
  //   ("인사를 건네보세요…" / "어떤 생각을 하고 계신가요?", 2026-09-27 실측). 글자 대신 둘 다 받는다.
  //   글자로 찾기는 실패했다 — 안내 글은 #commentbox-placeholder(yt-formatted-string) 에 있다(DOM 실측).
  const hint = page.locator('#commentbox-placeholder').first();
  if (!(await hint.count())) await die('게시물 작성 칸을 못 찾았다(로그인·권한 확인)');
  await hint.click();
  const editor = page.locator('#contenteditable-root').first();
  await editor.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  if (!(await editor.isVisible().catch(() => false))) await die('작성 칸이 펼쳐지지 않았다');
  await editor.click();
  await page.keyboard.type(text, { delay: 15 });
  // '이미지 추가' 버튼은 같은 이름이 둘(하나는 숨김) — 보이는 것을 누른다(2026-09-27 실측: 숨김 쪽을 눌러 아무 일도 없었다).
  await page.locator('button[aria-label="이미지 추가"]:visible').first().click().catch(() => {});
  await page.waitForTimeout(2000);
  await shot('1-image-menu');
  // 이미지 칸이 열리면 그 안의 '컴퓨터에서 선택' 을 눌러 파일 선택 창에 넣는다.
  //   2026-09-27 실측: 페이지의 첫 input[type=file] 에 넣었더니 이미지 칸이 비어 있었다(다른 입력이었다).
  const pickLink = page.locator('text=컴퓨터에서 선택').filter({ visible: true }).last();
  await pickLink.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15000 }).catch(() => null),
    pickLink.click().catch(() => {}),
  ]);
  if (!chooser) await die('이미지 파일 선택 창이 안 열렸다');
  await chooser.setFiles(img);
  await page.waitForTimeout(6000);
  await shot('2-filled');
  if (DRY) { log(`--dry — 게시 안 누름. 스크린샷: ${shots}`); await ctx.close(); process.exit(0); }
  const post = page.locator('button[aria-label="게시"]:not([disabled])').first();
  if (!(await post.count())) await die('게시 버튼이 켜지지 않았다(글·이미지가 안 들어갔을 수 있다)');
  await post.click();
  await page.waitForTimeout(8000);
  await shot('3-posted');
  // 확인: '게시됨' 목록 맨 위에 방금 링크가 보이는가
  await page.goto('https://www.youtube.com/@flowvium/posts', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  const seen = await page.getByText(pick.video_id, { exact: false }).count();
  await shot('4-verify');
  if (!seen) await die('게시 뒤 목록에서 방금 글을 못 찾았다 — 스크린샷 확인');
  state[day] = { videoId: pick.video_id, at: new Date().toISOString() };
  writeFileSync(STATE, JSON.stringify(state, null, 2));
  log(`✅ 게시했다 — ${pick.video_id} (목록에서 확인)`);
} finally { await ctx.close().catch(() => {}); }
