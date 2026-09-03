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
await page.goto('https://console.cloud.google.com/apis/credentials?project=tagextract', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(9000);
// 가장 최근에 만든 키(API 키 4개) 상세로 들어간다
const link = page.getByRole('link', { name: /API 키 4개/ }).first();
if (await link.count().catch(() => 0)) { await link.click({ timeout: 8000 }).catch(() => {}); await page.waitForTimeout(8000); }
const t = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
writeFileSync(resolve(ROOT, 'logs/gcp-keydetail.log'), t.slice(0, 900));
await page.screenshot({ path: resolve(ROOT, 'logs/gcp-keydetail.png') }).catch(() => {});
writeFileSync(resolve(ROOT, 'logs/gcp-keydetail.done'), 'ok');
await page.waitForTimeout(900000);
