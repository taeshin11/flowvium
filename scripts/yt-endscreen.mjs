#!/usr/bin/env node
/**
 * yt-endscreen.mjs — 새 롱폼에 최종 화면(관련 영상 '시청자 맞춤' 1 + 구독 1)을 단다. 11/02 사장님(Mac mini2 경유), 11/16 클릭률 측정.
 *
 * 왜 브라우저인가: Data API 에 최종 화면 리소스가 없다. 스튜디오 편집기 '최종 화면' → 템플릿 '동영상 1개, 구독 1개' → 저장.
 *   헤드리스 secrets/youtube-profile(이 맥 전용, 창 없음) — 다른 유튜브 프로필 작업과 같은 잠금(YT_PROFILE_LOCK)을 잡는다.
 * 무엇을: logs/market-brief.json 의 공개 롱폼 중 11/02 이후 올린 편(lib/endscreen-due). 이미 최종 화면이 있으면 건드리지 않는다.
 * 확인: 저장한 뒤 편집기를 다시 열어 요소 둘(구독·동영상)이 보여야 '달았다'로 적는다(logs/endscreen.json).
 *
 *   node scripts/yt-endscreen.mjs            # 달 편 모두
 *   node scripts/yt-endscreen.mjs --video ID # 한 편(시험)
 *   node scripts/yt-endscreen.mjs --dry-run  # 고르기만
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
import { dueForEndscreen } from './lib/endscreen-due.mjs';

const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const STATE_F = resolve(ROOT, 'logs/endscreen.json');
const log = (m) => console.log(`${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 19).replace('T', ' ')} [endscreen] ${m}`);
const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
const state = readJson(STATE_F, { done: {}, tries: {} });
state.done ??= {}; state.tries ??= {};
const save = () => writeFileSync(STATE_F, JSON.stringify(state, null, 2));

const ids = arg('--video') ? [arg('--video')] : dueForEndscreen(readJson(resolve(ROOT, 'logs/market-brief.json'), []), state);
if (!ids.length) { log('달 편 없음'); process.exit(0); }
log(`달 편 ${ids.length}: ${ids.join(', ')}`);
if (argv.includes('--dry-run')) process.exit(0);

const { YT_PROFILE_LOCK } = await import('./lib/site-tour-video.mjs');
const { acquireRunLock } = await import('./lib/run-lock.mjs');
const plock = await acquireRunLock(resolve(ROOT, YT_PROFILE_LOCK), { waitMs: 10 * 60_000, pollMs: 10_000, label: 'yt-endscreen' });
if (!plock.ok) { log(`유튜브 프로필을 다른 작업(${plock.holder?.label ?? '?'})이 쓰고 있다 — 다음 회차에`); process.exit(0); }

const TEMPLATE = '[role=gridcell][aria-label="동영상 1개, 구독 1개"]';
const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/youtube-profile'), {
  channel: 'chrome', headless: true, viewport: { width: 1500, height: 1100 }, locale: 'ko-KR',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  args: ['--disable-blink-features=AutomationControlled'] });

/** 편집기를 열고 최종 화면 창까지. 지금 있는 요소 이름들을 돌려준다(없으면 []). */
async function openEditor(page, id) {
  await page.goto(`https://studio.youtube.com/video/${id}/edit`, { waitUntil: 'load', timeout: 60_000 });
  const link = page.locator('#endscreen-editor-link');
  await link.waitFor({ timeout: 45_000 });
  await link.click();
  await page.waitForTimeout(8000);
  // 타임라인(ytve-endscreen-editor-timeline)에 '구독: …' · '동영상: …' 줄이 요소다(11/02 실측).
  const t = await page.evaluate(() => document.querySelector('ytve-endscreen-editor-timeline')?.innerText ?? '');
  return t.split('\n').map((x) => x.trim()).filter((x) => /^(구독|동영상|재생목록|채널|링크)\s*:/.test(x));
}

let n = 0;
try {
  const page = ctx.pages()[0] ?? await ctx.newPage();
  for (const id of ids) {
    state.tries[id] = (state.tries[id] ?? 0) + 1; save();
    try {
      const before = await openEditor(page, id);
      const hasTemplate = (await page.locator(TEMPLATE).count()) > 0;
      if (!hasTemplate || before.length) { state.done[id] = { at: new Date().toISOString(), note: `이미 있음(${before.join('·') || '템플릿 없음'})` }; save(); log(`${id} — 이미 최종 화면이 있다, 건드리지 않음`); continue; }
      await page.locator(TEMPLATE).first().click();
      await page.waitForTimeout(4000);
      const dlgSave = page.locator('tp-yt-paper-dialog ytcp-button#save-button').first();
      await dlgSave.click();
      await page.waitForTimeout(4000);
      // 창의 저장 뒤 세부정보 화면의 저장이 켜지면 그것까지 누른다(꺼져 있으면 창 저장만으로 반영된 것).
      const pageSave = page.locator('ytcp-video-details-section ytcp-button#save').first();
      if (await pageSave.count() && !(await pageSave.getAttribute('disabled').then((v) => v !== null).catch(() => true))) { await pageSave.click(); await page.waitForTimeout(6000); }
      const after = await openEditor(page, id);
      const ok = after.some((x) => x.startsWith('구독')) && after.some((x) => x.startsWith('동영상'));
      if (!ok) throw new Error('저장 뒤 다시 열었는데 요소가 안 보인다');
      state.done[id] = { at: new Date().toISOString(), elements: after };
      save(); n++;
      log(`${id} ✅ 최종 화면 달았다(시청자 맞춤 동영상 + 구독, 끝 20초)`);
      await page.keyboard.press('Escape').catch(() => {});
    } catch (e) {
      log(`${id} 실패(${state.tries[id]}/3번째) — ${String(e?.message ?? e).split('\n')[0].slice(0, 120)}`);
      await page.screenshot({ path: resolve(ROOT, `logs/endscreen-fail-${id}.png`) }).catch(() => {});
    }
  }
} finally { await ctx.close(); plock.release(); }
log(`끝 · 단 편 ${n}/${ids.length}`);
