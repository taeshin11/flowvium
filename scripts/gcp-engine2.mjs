#!/usr/bin/env node
/**
 * 검색엔진 생성 — 이미지 검색을 켜고, reCAPTCHA 는 사람이 누르길 기다린다.
 * 2026-09-04: 폼에 '전체 웹 검색' 토글이 없다. 사이트를 안 넣으면 전체 웹이 기본이다.
 *   이미지 검색은 기본이 꺼짐이라 켜야 한다 — 우리가 쓸 것이 이미지다.
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
const OUT = resolve(ROOT, 'logs/gcp-engine2.log');
const lines = [];
const log = (...a) => { lines.push(a.join(' ')); writeFileSync(OUT, lines.join('\n'), { mode: 0o600 }); };
const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/gcp-profile'), {
  channel: 'chrome', headless: false, viewport: { width: 1440, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
try {
  await page.goto('https://programmablesearchengine.google.com/controlpanel/create', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(9000);
  await page.locator('input[type=text]:visible').first().fill('flowvium-news').catch(() => {});
  // 이미지 검색 토글 — 라벨 옆의 스위치를 누른다. 좌표가 아니라 라벨 기준으로 찾는다.
  const imgRow = page.locator('div,tr,li').filter({ hasText: /^\s*이미지 검색\s*$|Image search/i }).last();
  const sw = imgRow.locator('[role=switch], button[role=switch], input[type=checkbox]').first();
  if (await sw.count().catch(() => 0)) {
    const on = await sw.getAttribute('aria-checked').catch(() => null);
    if (on !== 'true') { await sw.click({ timeout: 6000 }).catch(() => {}); log('이미지 검색 켬'); }
    else log('이미지 검색 이미 켜져 있음');
  } else {
    const t = page.getByText(/^\s*이미지 검색\s*$/).first();
    if (await t.count().catch(() => 0)) { await t.click({ timeout: 5000 }).catch(() => {}); log('이미지 검색 라벨 클릭'); }
    else log('❌ 이미지 검색 토글을 못 찾음');
  }
  await page.waitForTimeout(2000);
  await page.screenshot({ path: resolve(ROOT, 'logs/gcp-engine2.png') }).catch(() => {});
  log('READY — reCAPTCHA 를 사람이 눌러 주면 만들기를 진행한다');
  writeFileSync(resolve(ROOT, 'logs/gcp-engine2.ready'), 'ok');

  // 캡차가 풀릴 때까지 기다린다. 풀리면 만들기를 누르고 cx 를 읽는다.
  for (let i = 0; i < 120; i++) {
    const solved = await page.evaluate(() => {
      const el = document.querySelector('textarea[name="g-recaptcha-response"]');
      return !!(el && el.value && el.value.length > 20);
    }).catch(() => false);
    if (solved) { log('캡차 확인됨'); break; }
    await page.waitForTimeout(5000);
  }
  const create = page.locator('button:visible').filter({ hasText: /만들기|Create/i }).last();
  if (await create.count().catch(() => 0)) { await create.click({ timeout: 10000 }).catch(() => {}); log('만들기 클릭'); }
  await page.waitForTimeout(12000);
  const cx = await page.evaluate(() => {
    const m = document.documentElement.innerHTML.match(/[?&]cx=([0-9a-zA-Z_:-]{15,})/)
      || document.documentElement.innerHTML.match(/"cx"\s*:\s*"([0-9a-zA-Z_:-]{15,})"/);
    return m ? m[1] : null;
  }).catch(() => null);
  log(cx ? `NEWCX=${cx}` : `❌ cx 못 읽음 · 주소 ${page.url().slice(0, 90)}`);
  await page.screenshot({ path: resolve(ROOT, 'logs/gcp-engine2-after.png') }).catch(() => {});
  log('완료');
} catch (e) { log(`오류: ${String(e?.message).slice(0, 150)}`); }
await page.waitForTimeout(900000);
