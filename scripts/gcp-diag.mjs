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
const out = [];
for (const [name, url] of [
  ['결제', 'https://console.cloud.google.com/billing/linkedaccount?project=tagextract'],
  ['사용설정API', 'https://console.cloud.google.com/apis/dashboard?project=tagextract'],
]) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(9000);
  const t = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
  out.push(`[${name}] ${t.slice(0, 400)}`);
  await page.screenshot({ path: resolve(ROOT, `logs/gcp-${name}.png`) }).catch(() => {});
}
writeFileSync(resolve(ROOT, 'logs/gcp-diag.log'), out.join('\n\n'));
writeFileSync(resolve(ROOT, 'logs/gcp-diag.done'), 'ok');
await page.waitForTimeout(600000);
