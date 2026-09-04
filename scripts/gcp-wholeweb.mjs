#!/usr/bin/env node
/** 검색엔진을 '전체 웹 검색' 으로 바꾼다. 만들 때는 사이트를 하나 요구해서 korea.kr 로 뒀다. */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
const CX = process.env.GOOGLE_CSE_CX || '91fa62a5516ea4d7a';
const OUT = resolve(ROOT, 'logs/gcp-wholeweb.log');
const lines = [];
const log = (...a) => { lines.push(a.join(' ')); writeFileSync(OUT, lines.join('\n')); };
const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/gcp-profile'), {
  channel: 'chrome', headless: false, viewport: { width: 1440, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
try {
  await page.goto(`https://programmablesearchengine.google.com/controlpanel/basics?cx=${CX}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(9000);
  const t = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
  log(`화면: ${t.slice(0, 300)}`);
  // '전체 웹 검색' 토글을 라벨로 찾는다 — 좌표로 누르지 않는다.
  const label = page.getByText(/전체 웹 검색|Search the entire web/i).first();
  if (!(await label.count().catch(() => 0))) { log('❌ 전체 웹 검색 항목 없음'); }
  else {
    const row = label.locator('xpath=ancestor::*[self::div or self::li][1]');
    const sw = row.locator('[role=switch], input[type=checkbox], button[role=switch]').first();
    if (await sw.count().catch(() => 0)) {
      const on = await sw.getAttribute('aria-checked').catch(() => null);
      log(`현재 상태: ${on}`);
      if (on !== 'true') { await sw.click({ timeout: 8000 }).catch(() => {}); log('토글 클릭'); await page.waitForTimeout(4000); }
      else log('이미 켜져 있음');
    } else { await label.click({ timeout: 6000 }).catch(() => {}); log('라벨 클릭'); await page.waitForTimeout(4000); }
    const after = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    log(`이후: ${after.slice(0, 240)}`);
  }
  await page.screenshot({ path: resolve(ROOT, 'logs/gcp-wholeweb.png') }).catch(() => {});
  log('완료');
} catch (e) { log(`오류: ${String(e?.message).slice(0, 150)}`); }
await page.waitForTimeout(900000);
