#!/usr/bin/env node
/** 생성 폼을 '사이트 또는 페이지 입력' 직전까지 채워 놓고 멈춘다 (사용자 요청 2026-09-04).
 *  이미 만들어진 엔진이 있으면 목록을 먼저 보여 준다. */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
const OUT = resolve(ROOT, 'logs/gcp-form.log');
const lines = [];
const log = (...a) => { lines.push(a.join(' ')); writeFileSync(OUT, lines.join('\n'), { mode: 0o600 }); };
const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/gcp-profile'), {
  channel: 'chrome', headless: false, viewport: { width: 1440, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
try {
  // ① 이미 만들어졌는지 먼저 확인
  await page.goto('https://programmablesearchengine.google.com/controlpanel/all', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);
  const names = (await page.locator('table, [role=table]').innerText().catch(() => '')).replace(/\s+/g, ' ');
  log(`엔진 목록: ${names.slice(0, 200)}`);
  const cxs = await page.evaluate(() => [...new Set([...document.querySelectorAll('a[href]')]
    .map((a) => (a.href.match(/[?&]cx=([0-9a-zA-Z_:-]{10,})/) || [])[1]).filter(Boolean))]).catch(() => []);
  log(`발견한 cx ${cxs.length}개: ${cxs.join(', ')}`);

  // ② 새 폼을 열어 이름까지만 채운다
  await page.goto('https://programmablesearchengine.google.com/controlpanel/create', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);
  await page.locator('input[type=text]:visible').first().fill('flowvium-news').catch(() => {});
  const t = page.getByText(/^\s*이미지 검색\s*$/).first();
  if (await t.count().catch(() => 0)) { await t.click({ timeout: 5000 }).catch(() => {}); log('이미지 검색 켬'); }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: resolve(ROOT, 'logs/gcp-form.png') }).catch(() => {});
  log('폼을 사이트 입력 직전까지 채워 두었습니다 — 나머지는 사람이');
  log('완료');
} catch (e) { log(`오류: ${String(e?.message).slice(0, 150)}`); }
await page.waitForTimeout(900000);
