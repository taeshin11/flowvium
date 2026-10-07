#!/usr/bin/env node
/**
 * yt-pin-comment.mjs — 우리 영상에 aisviagent.com 홍보 댓글을 달고 고정한다. (2026-10-08 신설)
 *
 * 사장님 "aisviagent.com 광고를 쿠팡파트너스 링크 달듯이 이 채널에서는 댓글에 링크 광고를 달자".
 * 사실 확인: 쇼츠 댓글·설명의 링크는 2023-08-31 부터 눌리지 않는다(유튜브 스팸 대책) — 쇼츠에서는 주소를 읽고
 *   복사하게 하는 글이다. 롱폼(사이트 소개·뉴스 총정리)에서는 링크가 눌리므로 utm 을 붙인다.
 * Data API 토큰에 댓글 권한이 없어(ACCESS_TOKEN_SCOPE_INSUFFICIENT, 10/05 실측) 로그인된 전용 브라우저 프로필
 *   (secrets/youtube-profile — 게시물·관련 동영상과 같은 것, 같은 잠금)로 한다. 이미 우리 고정 댓글이 있으면 건너뛴다.
 *
 * 사용: node scripts/yt-pin-comment.mjs --ids a,b [--dry]      |  --recent 24 (최근 N시간 발행분 + 그날 총정리)
 */
import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { ROOT } from './lib/project-root.mjs';

const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const DRY = argv.includes('--dry');
const VERIFY_ONLY = argv.includes('--verify-only');   // 달지 않고 시청자 화면 재확인만(--then-verify 초 뒤, 기본 0)
const log = (...a) => console.log(new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 19), '[pin]', ...a);
const STATE = resolve(ROOT, 'logs/yt-pinned.json');
const state = (() => { try { return JSON.parse(readFileSync(STATE, 'utf8')); } catch { return {}; } })();

const { trackedUrl } = await import('./lib/site-link.mjs');
export const commentFor = (kind) => kind === 'long'
  ? `🤖 나만의 AI 비서 AISVI — 무료로 내 AI 비서를 만들어 보세요\n👉 ${trackedUrl({ source: 'youtube', medium: 'comment', campaign: 'flowvium', path: '/', site: 'https://aisviagent.com' })}`
  : '🤖 나만의 AI 비서 AISVI — 무료로 만들어 보세요\n👉 aisviagent.com (주소창에 입력)';

let targets = [];
const ids = (arg('ids', '') ?? '').split(',').filter(Boolean);
if (ids.length) targets = ids.map((id) => ({ id, kind: arg('kind', 'short') }));
else {
  const H = Number(arg('recent', 24));
  const { openDb } = await import('./lib/db.mjs');
  targets = openDb().prepare(`SELECT video_id id FROM shorts_published WHERE video_id IS NOT NULL AND retracted_at IS NULL
      AND datetime(published_at) >= datetime('now', ?) ORDER BY published_at`).all(`-${H} hours`).map((r) => ({ id: r.id, kind: 'short' }));
  // 그날 총정리 롱폼(링크가 눌린다)
  for (const d of [0, 1]) {
    const day = new Date(Date.now() + 9 * 3600e3 - d * 864e5).toISOString().slice(0, 10);
    try { const r = JSON.parse(readFileSync(resolve(ROOT, `logs/roundup-${day}.json`), 'utf8')); if (r.privacy === 'public' && r.id) targets.push({ id: r.id, kind: 'long' }); } catch { /* 그날 총정리 없음 */ }
  }
}
targets = targets.filter((t) => DRY || VERIFY_ONLY || !state[t.id]);
log(`대상 ${targets.length}편${DRY ? ' (dry — 글만 채우고 안 올림)' : ''}`);
if (!targets.length) process.exit(0);

let done = 0, failed = 0;
if (!VERIFY_ONLY) {
const { YT_PROFILE_LOCK } = await import('./lib/site-tour-video.mjs');
const plock = await (await import('./lib/run-lock.mjs')).acquireRunLock(resolve(ROOT, YT_PROFILE_LOCK), { waitMs: 20 * 60_000, pollMs: 10_000, label: 'yt-pin-comment' });
if (!plock.ok) { log('유튜브 프로필을 다른 작업이 쓰고 있다 — 다음에 한다'); process.exit(0); }
const shots = join(ROOT, 'logs/pin-shots'); mkdirSync(shots, { recursive: true });
const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/youtube-profile'), {
  channel: 'chrome', headless: true, viewport: { width: 1280, height: 1400 }, args: ['--disable-blink-features=AutomationControlled'] });
const page = ctx.pages()[0] ?? await ctx.newPage();
try {
  for (const t of targets) {
    try {
      await page.goto(`https://www.youtube.com/watch?v=${t.id}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(5000);
      for (let k = 0; k < 6 && !(await page.locator('#simplebox-placeholder').count()); k++) { await page.mouse.wheel(0, 900); await page.waitForTimeout(1500); }
      const ph = page.locator('#simplebox-placeholder').first();
      if (!(await ph.count())) throw new Error('댓글 입력 칸이 없다(댓글 꺼짐?)');
      // 우리 홍보 댓글이 이미 있나(@flowvium + aisviagent). 있으면 다시 달지 않는다 — 고정만 확인/보정한다.
      //   #pinned-comment-badge 는 모든 댓글에 숨겨진 채로 있다(10/08 DOM 실측) — '보이는가' 로 판정한다.
      const mineSel = 'ytd-comment-view-model:has-text("@flowvium"):has-text("aisviagent")';
      const pinnedVisible = async () => page.evaluate((sel) => [...document.querySelectorAll('ytd-comment-thread-renderer')]
        .some((th) => /@flowvium/.test(th.innerText) && /aisviagent/.test(th.innerText) && [...th.querySelectorAll('#pinned-comment-badge')].some((b) => b.offsetWidth || b.offsetHeight)), mineSel);
      let mine = page.locator(mineSel).first();
      if (await mine.count() && await pinnedVisible()) { log(`${t.id} 이미 우리 댓글이 고정돼 있다 — 건너뜀`); state[t.id] = { at: new Date().toISOString(), kind: t.kind, skipped: 'already' }; writeFileSync(STATE, JSON.stringify(state, null, 1)); continue; }
      if (!(await mine.count())) {
        await ph.scrollIntoViewIfNeeded(); await ph.click(); await page.waitForTimeout(1200);
        const box = page.locator('#contenteditable-root').first();
        await box.click(); await page.keyboard.insertText(commentFor(t.kind)); await page.waitForTimeout(800);
        if (DRY) { await page.screenshot({ path: join(shots, `dry-${t.id}.png`) }); log(`${t.id} dry — 글 채움(안 올림) → logs/pin-shots/dry-${t.id}.png`); continue; }
        await page.locator('#submit-button:not([disabled])').first().click(); await page.waitForTimeout(5000);
        mine = page.locator(mineSel).first();
        if (!(await mine.count())) throw new Error('올렸는데 우리 댓글이 화면에 없다');
      } else if (DRY) { log(`${t.id} dry — 우리 댓글은 있고 고정만 안 됨`); continue; }
      // ⋮(작업 메뉴) → 고정 → 확인
      await mine.hover(); await mine.locator('button[aria-label="작업 메뉴"]').first().click(); await page.waitForTimeout(1500);
      const pinItem = page.getByRole('menuitem', { name: '고정' }).filter({ visible: true }).first();
      const pinAlt = page.locator('tp-yt-paper-listbox :text-is("고정"), yt-list-item-view-model:has-text("고정")').filter({ visible: true }).first();
      const item = (await pinItem.count()) ? pinItem : pinAlt;
      if (!(await item.count())) throw new Error('메뉴에 "고정" 이 없다');
      await item.click(); await page.waitForTimeout(1500);
      const ok = page.locator('tp-yt-paper-dialog button:has-text("고정"), yt-confirm-dialog-renderer button:has-text("고정"), #confirm-button button').filter({ visible: true }).last();
      if (await ok.count()) { await ok.click(); await page.waitForTimeout(3000); }
      // 되읽기 — 다시 열어서 우리 댓글에 고정 표시가 **보이는지**
      await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(5000);
      for (let k = 0; k < 6 && !(await pinnedVisible()); k++) { await page.mouse.wheel(0, 900); await page.waitForTimeout(1500); }
      if (!(await pinnedVisible())) throw new Error('다시 읽었더니 우리 댓글에 고정 표시가 없다');
      done++; state[t.id] = { at: new Date().toISOString(), kind: t.kind }; log(`${t.id} ✅ 댓글·고정`);
      writeFileSync(STATE, JSON.stringify(state, null, 1));
    } catch (e) {
      failed++; log(`${t.id} 실패: ${String(e?.message ?? e).slice(0, 100)}`); await page.screenshot({ path: join(shots, `fail-${t.id}.png`) }).catch(() => {});
    }
    await page.waitForTimeout(6000);
  }
} finally { await ctx.close(); plock.release(); }
log(`끝 — 고정 ${done} · 실패 ${failed}`);
}

// 재확인(사장님 원칙): 링크 댓글은 스팸 필터로 사라질 수 있다 — N초 뒤 **로그아웃 브라우저(시청자 화면)** 로
//   ①우리 댓글이 보이는가 ②작성자가 @flowvium 인가 ③고정 표시가 보이는가. 주인 화면엔 걸러진 댓글도 보일 수 있다.
const AFTER = Number(arg('then-verify', 0));
if ((AFTER > 0 || VERIFY_ONLY) && !DRY) {
  log(`${AFTER}초 뒤 시청자 화면에서 다시 확인한다`);
  await new Promise((r) => setTimeout(r, AFTER * 1000));
  const vb = await chromium.launch({ headless: true });
  const vp = await vb.newPage({ viewport: { width: 1280, height: 1400 }, locale: 'ko-KR' });
  let bad = 0;
  for (const t of targets) {
    try {
      await vp.goto(`https://www.youtube.com/watch?v=${t.id}`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await vp.waitForTimeout(5000);
      const seen = async () => vp.evaluate(() => [...document.querySelectorAll('ytd-comment-thread-renderer')].map((th) => ({
        mine: /@flowvium/.test(th.innerText) && /aisviagent/.test(th.innerText),
        pinned: [...th.querySelectorAll('#pinned-comment-badge')].some((b) => b.offsetWidth || b.offsetHeight) })).find((x) => x.mine) ?? null);
      let r = null;
      for (let k = 0; k < 8 && !r; k++) { await vp.mouse.wheel(0, 900); await vp.waitForTimeout(1500); r = await seen(); }
      const okv = !!(r?.mine && r?.pinned);
      state[t.id] = { ...(state[t.id] ?? {}), verifiedAt: new Date().toISOString(), visibleToViewers: !!r?.mine, pinnedToViewers: !!r?.pinned };
      if (!okv) bad++;
      log(`[verify] ${t.id} ${okv ? '✅ 시청자 화면에 우리 고정 댓글' : `❌ ${r ? '보이지만 고정 표시 없음' : '우리 댓글이 안 보인다(스팸 필터?)'}`}`);
      if (!okv) await vp.screenshot({ path: join(shots, `verify-fail-${t.id}.png`) }).catch(() => {});
    } catch (e) { bad++; log(`[verify] ${t.id} ❌ 확인 실패: ${String(e?.message ?? e).slice(0, 80)}`); }
  }
  await vb.close();
  writeFileSync(STATE, JSON.stringify(state, null, 1));
  log(`[verify] 끝 — 문제 ${bad}편`);
  process.exit(bad ? 1 : 0);
}
process.exit(failed && !done ? 1 : 0);
