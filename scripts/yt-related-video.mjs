#!/usr/bin/env node
/**
 * yt-related-video.mjs — 쇼츠의 '관련 동영상' 을 사이트 소개 롱폼으로 건다. (2026-10-02)
 *
 * 왜: 쇼츠 설명·댓글 링크는 2023-08-31 부터 안 눌린다(30일 조회 17.9만에 설명 링크 클릭 14건).
 *   쇼츠 화면에 뜨는 '관련 동영상' 은 눌린다 — 그 롱폼(OwRQLZ8DHzU "flowvium.net 2분 사용법")의 설명란 링크는 눌린다.
 * Data API 에 이 칸이 없어 스튜디오 화면으로 한다(전용 프로필 secrets/youtube-profile — 게시물 올리는 그 프로필).
 *   스튜디오는 헤드리스 UA 를 '지원 안 되는 브라우저' 로 막아 일반 크롬 UA 를 쓴다.
 * 편마다: 편집 화면 → 관련 동영상 → 대상 카드(제목 앞부분으로 찾는다) → 저장 → 칸에 그 제목이 보이는지 다시 읽는다.
 *   이미 걸려 있으면 건너뛴다. 편 사이 8초 쉰다. 실패하면 사유만 남기고 다음 편으로.
 *
 * 사용: node scripts/yt-related-video.mjs --target OwRQLZ8DHzU --match "AI가 매일 고르는" --ids a,b,c
 *       node scripts/yt-related-video.mjs ... --top 40 --days 14      (최근 N일 조회 상위 쇼츠)
 */
import { chromium } from 'playwright';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';

const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const { TOUR_VIDEO, YT_PROFILE_LOCK } = await import('./lib/site-tour-video.mjs');
const TARGET = arg('target', TOUR_VIDEO.id); const MATCH = arg('match', TOUR_VIDEO.match);
if (!TARGET || !MATCH) { console.error('--target <롱폼 id> --match <제목 앞부분> 이 필요하다'); process.exit(2); }
let ids = (arg('ids', '') ?? '').split(',').filter(Boolean);
if (!ids.length) {
  const { openDb } = await import('./lib/db.mjs');
  ids = openDb().prepare(`SELECT p.video_id, MAX(s.views) v FROM shorts_published p JOIN shorts_stats s ON s.video_id = p.video_id
    WHERE p.video_id IS NOT NULL AND p.retracted_at IS NULL AND datetime(p.published_at) >= datetime('now', ?)
    GROUP BY p.video_id ORDER BY v DESC LIMIT ?`).all(`-${Number(arg('days', 14))} days`, Number(arg('top', 40))).map((r) => r.video_id);
}
const log = (...a) => console.log(new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 19), '[related]', ...a);
log(`대상 ${ids.length}편 → 관련 동영상 ${TARGET} ("${MATCH}…")`);

// 같은 프로필을 쓰는 게시물 올리기(youtube-post)와 겹치지 않게 — 크롬 프로필은 한 번에 하나만 열린다.
const { acquireRunLock } = await import('./lib/run-lock.mjs');
const plock = await acquireRunLock(resolve(ROOT, YT_PROFILE_LOCK), { waitMs: 20 * 60_000, pollMs: 10_000, label: 'related-video' });
if (!plock.ok) { log(`유튜브 프로필을 다른 작업(${plock.holder?.label ?? '?'})이 20분 넘게 쓰고 있다 — 다음에 한다`); process.exit(0); }
const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/youtube-profile'), {
  channel: 'chrome', headless: true, viewport: { width: 1280, height: 1400 },
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  args: ['--disable-blink-features=AutomationControlled'] });
const page = ctx.pages()[0] ?? await ctx.newPage();
const fieldText = async () => (await page.locator('body').innerText()).split('\n').map((x) => x.trim())
  .reduce((acc, l, i, a) => (l === '관련 동영상' ? a[i + 1] ?? '' : acc), '');
let done = 0, skipped = 0, failed = 0;
try {
  for (const id of ids) {
    try {
      await page.goto(`https://studio.youtube.com/video/${id}/edit`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(5000);
      const skip = page.getByText(/스튜디오로 건너뛰기/).first();
      if (await skip.count()) { await skip.click(); await page.waitForTimeout(6000); }
      if ((await fieldText()).startsWith(MATCH.slice(0, 6))) { skipped++; log(`${id} 이미 걸려 있다`); continue; }
      await page.getByText('관련 동영상').first().click();
      await page.waitForTimeout(2500);
      const card = page.getByText(MATCH, { exact: false }).first();
      if (!(await card.count())) throw new Error('선택 창에서 대상 영상을 못 찾았다');
      await card.click();
      await page.waitForTimeout(1500);
      const save = page.locator('#save, ytcp-button#save').first();
      await save.click();
      await page.waitForTimeout(4000);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(6000);
      const now = await fieldText();
      if (!now.startsWith(MATCH.slice(0, 6))) throw new Error(`저장 뒤 칸이 "${now.slice(0, 30)}"`);
      done++; log(`${id} ✅`);
    } catch (e) {
      failed++; log(`${id} 실패: ${String(e?.message ?? e).slice(0, 100)}`);
      await page.screenshot({ path: resolve(ROOT, `logs/related-fail-${id}.png`) }).catch(() => {});
    }
    await page.waitForTimeout(8000);
  }
} finally { await ctx.close(); plock.release(); }
log(`끝 — 걸었다 ${done} · 이미 ${skipped} · 실패 ${failed}`);
process.exit(failed && !done ? 1 : 0);
