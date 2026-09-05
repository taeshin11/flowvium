#!/usr/bin/env node
/** 등록된 사이트를 **페이지를 넘겨가며** 전부 센다. 한 화면만 보고 개수를 말하면 또 틀린다. */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
const CX = '91fa62a5516ea4d7a';
const out = [];
const log = (...a) => { out.push(a.join(' ')); writeFileSync(resolve(ROOT, 'logs/gcp-sites-count.log'), out.join('\n')); };
const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/gcp-profile'), {
  channel: 'chrome', headless: false, viewport: { width: 1440, height: 1000 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
const seen = new Set();
try {
  await page.goto(`https://programmablesearchengine.google.com/controlpanel/overview?cx=${CX}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(13000);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(2500);
  for (let p = 0; p < 12; p++) {
    const t = await page.locator('body').innerText().catch(() => '');
    for (const m of t.match(/\*?\.?[a-z0-9][a-z0-9.-]*\.(co\.kr|go\.kr|or\.kr|kr|com|org|net)\/\*/g) ?? []) seen.add(m);
    const next = page.locator('button:has-text("chevron_right")').first();
    const dis = await next.isDisabled().catch(() => true);
    if (dis) { log(`${p + 1}페이지에서 끝`); break; }
    await next.click().catch(() => {});
    await page.waitForTimeout(2500);
  }
  log(`총 ${seen.size}개`);
  log([...seen].sort().join('\n'));
} catch (e) { log(`오류: ${String(e?.message).slice(0, 120)}`); }
writeFileSync(resolve(ROOT, 'logs/gcp-sites-count.done'), 'x');
await ctx.close().catch(() => {});
