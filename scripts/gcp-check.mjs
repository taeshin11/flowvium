#!/usr/bin/env node
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/gcp-profile'), {
  channel: 'chrome', headless: false, viewport: { width: 1440, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.goto('https://console.cloud.google.com/apis/api/customsearch.googleapis.com/metrics?project=tagextract', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(10000);
for (const n of [/^확인$/, /^Accept all$/i]) {
  const b = page.getByRole('button', { name: n }).first();
  if (await b.count().catch(() => 0)) { await b.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(2500); }
}
const t = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
const btns = [...new Set((await page.locator('button:visible').allInnerTexts().catch(() => [])).map(b=>b.replace(/\s+/g,' ').trim()).filter(b=>b&&b.length<28))];
writeFileSync(resolve(ROOT, 'logs/gcp-check.log'), `버튼: ${btns.join(' | ')}\n\n화면: ${t.slice(0, 700)}`);
await page.screenshot({ path: resolve(ROOT, 'logs/gcp-check.png') }).catch(() => {});
writeFileSync(resolve(ROOT, 'logs/gcp-check.done'), 'ok');
await page.waitForTimeout(900000);
