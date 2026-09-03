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
await page.goto('https://console.cloud.google.com/apis/library/customsearch.googleapis.com?project=tagextract', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(10000);
for (const n of [/^확인$/, /^Accept all$/i]) {
  const b = page.getByRole('button', { name: n }).first();
  if (await b.count().catch(() => 0)) { await b.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(3000); }
}
await page.screenshot({ path: resolve(ROOT, 'logs/gcp-api-page.png') });
writeFileSync(resolve(ROOT, 'logs/gcp-shot.done'), 'ok');
await page.waitForTimeout(600000);
