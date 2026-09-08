#!/usr/bin/env node
/**
 * suno-download.mjs — Suno 곡을 **UI 다운로드 경로로** 받는다.
 *
 * 왜 UI 인가 (2026-09-08 실측): API 의 media_urls 로 받은 파일은 **암호화**돼 있다.
 *   크기는 맞는데(38초에 724KB) 앞부분이 `37 c3 83 71 …` 로 m4a·ogg 어느 헤더도 아니고,
 *   ffmpeg 가 mp4·ogg·opus·mp3·aac 어느 것으로도 못 읽는다.
 *   브라우저 안에서 브라우저 자격으로 받아도 같은 바이트가 나온다.
 *   `⋯ → Download → WAV → Unlock & Download` 만 정상 파일을 준다(ftypisom · Opus 48kHz).
 *
 * 좌표로 누르지 않는다 — 목록이 바뀌면 엉뚱한 것을 누른다.
 *   ⋯ 버튼은 aria-label="More options" 로 잡히고, 메뉴 항목은 글자로 잡는다.
 *
 * 사용: node scripts/suno-download.mjs [받을개수]
 *   먼저 `bash scripts/suno-open.sh` 로 로그인된 창을 띄워 둔다.
 */
import { chromium } from 'playwright';
import { mkdirSync, readdirSync } from 'fs';

const WANT = Number(process.argv[2] || 2);
const DIR = process.env.SUNO_DL_DIR || '/tmp/suno-dl';
const PORT = process.env.SUNO_CDP_PORT || '9333';
mkdirSync(DIR, { recursive: true });

const done = () => readdirSync(DIR).filter((f) => !f.endsWith('.crdownload'));

let browser;
try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); }
catch { console.error(`❌ :${PORT} 에 크롬이 없다 — bash scripts/suno-open.sh`); process.exit(1); }

const ctx = browser.contexts()[0];
const page = ctx.pages()[0];
await page.setViewportSize({ width: 1440, height: 950 }).catch(() => {});
const cdp = await ctx.newCDPSession(page);
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DIR }).catch(() => {});

await page.goto('https://suno.com/create?wid=default', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(6000);
// 쿠키 배너가 목록을 덮는다
for (const n of [/Accept All Cookies/i]) {
  const b = page.getByRole('button', { name: n }).first();
  if (await b.count().catch(() => 0)) { await b.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(1200); }
}

const dots = page.locator('button[aria-label="More options"]');
const total = await dots.count();
console.log(`  ⋯ 버튼 ${total}개`);
let got = done().length;
for (let i = 0; i < total && got < WANT; i += 1) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(600);
  await dots.nth(i).click({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1800);
  const dl = page.getByText(/^\s*Download\s*$/).first();
  if (!(await dl.count().catch(() => 0))) { console.log(`   ${i + 1}번: 메뉴에 Download 없음 — 건너뜀`); continue; }
  await dl.click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(2200);
  const wav = page.getByText(/^\s*WAV\s*$/).first();
  if (await wav.count().catch(() => 0)) { await wav.click({ timeout: 6000 }).catch(() => {}); await page.waitForTimeout(900); }
  const go = page.getByRole('button', { name: /Unlock & Download|^\s*Download\s*$/i }).first();
  if (!(await go.count().catch(() => 0))) { console.log(`   ${i + 1}번: 받기 버튼 없음`); continue; }
  await go.click({ timeout: 10000 }).catch(() => {});
  // 파일이 늘어날 때까지 기다린다
  const before = got;
  for (let t = 0; t < 20 && done().length === before; t += 1) await page.waitForTimeout(2500);
  got = done().length;
  console.log(got > before ? `   ${i + 1}번 받음 → ${done().at(-1)}` : `   ${i + 1}번: 시간 안에 안 받아졌다`);
}
console.log(`  받은 파일 ${got}개: ${done().join(' · ')}`);
await browser.close().catch(() => {});
