#!/usr/bin/env node
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
const CX = process.env.GOOGLE_CSE_CX || '91fa62a5516ea4d7a';
const out = [];
const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/gcp-profile'), {
  channel: 'chrome', headless: false, viewport: { width: 1440, height: 1400 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.goto(`https://programmablesearchengine.google.com/controlpanel/overview?cx=${CX}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(9000);
// ① 전체 웹 검색 토글의 disabled 여부
const st = await page.evaluate(() => {
  const w = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && /^\s*전체 웹 검색\s*$/.test(e.textContent || ''));
  let n = w;
  for (let i = 0; i < 6 && n; i++) {
    n = n.parentElement;
    const sw = n?.querySelector('[role=switch], button.VfPpkd-scr2fc, input[type=checkbox]');
    if (sw) return { checked: sw.getAttribute('aria-checked'), disabled: sw.disabled ?? sw.getAttribute('aria-disabled'), cls: (sw.className||'').slice(0,60) };
  }
  return null;
}).catch(() => null);
out.push(`전체 웹 검색 토글: ${JSON.stringify(st)}`);
// ② 사이트 추가 UI 가 어디 있나 — 페이지 전체에서 '추가' 버튼과 사이트 표를 찾는다
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(3000);
const body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
out.push(`아래쪽 화면: ${body.slice(-500)}`);
const btns = [...new Set((await page.locator('button:visible').allInnerTexts().catch(() => [])).map((b) => b.replace(/\s+/g,' ').trim()).filter((b)=>b&&b.length<24))];
out.push(`버튼: ${btns.join(' | ').slice(0, 260)}`);
writeFileSync(resolve(ROOT, 'logs/gcp-probe.log'), out.join('\n\n'));
await page.screenshot({ path: resolve(ROOT, 'logs/gcp-probe.png'), fullPage: true }).catch(() => {});
writeFileSync(resolve(ROOT, 'logs/gcp-probe.done'), 'ok');
await page.waitForTimeout(600000);
