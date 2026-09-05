#!/usr/bin/env node
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
const CX = '91fa62a5516ea4d7a';
const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/gcp-profile'), {
  channel: 'chrome', headless: false, viewport: { width: 1440, height: 1000 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.goto(`https://programmablesearchengine.google.com/controlpanel/overview?cx=${CX}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(3000);
const t = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
const sites = [...new Set((t.match(/[a-z0-9.-]+\.(?:kr|com|net|org|go\.kr|co\.kr)\/?\*?/g) ?? []))];
writeFileSync(resolve(ROOT, 'logs/gcp-sites.log'), `사이트로 보이는 것 ${sites.length}개:\n${sites.join('\n')}\n\n화면끝: ${t.slice(-400)}`);
writeFileSync(resolve(ROOT, 'logs/gcp-sites.done'), 'ok');
await page.waitForTimeout(120000);
