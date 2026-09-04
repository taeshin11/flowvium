#!/usr/bin/env node
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/gcp-profile'), {
  channel: 'chrome', headless: false, viewport: { width: 1280, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.goto('https://myaccount.google.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(12000);
const t = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
const mail = (t.match(/[\w.+-]+@[\w.-]+\.\w+/g) ?? []).slice(0, 4);
writeFileSync(resolve(ROOT, 'logs/gcp-whoami.log'), `이메일: ${mail.join(', ') || '(못 찾음)'}\n\n${t.slice(0, 200)}`);
writeFileSync(resolve(ROOT, 'logs/gcp-whoami.done'), 'ok');
await page.waitForTimeout(60000);
