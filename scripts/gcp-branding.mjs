#!/usr/bin/env node
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/gcp-profile'), {
  channel: 'chrome', headless: false, viewport: { width: 1440, height: 1000 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.goto('https://console.cloud.google.com/auth/branding?project=tagextract', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(20000);
for (const n of [/^확인$/, /^Accept all$/i]) { const b = page.getByRole('button', { name: n }).first(); if (await b.count().catch(() => 0)) { await b.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(2500); } }
const t = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
// 입력창 상태를 본다 — 무엇이 비었는가
const fields = await page.evaluate(() => [...document.querySelectorAll('input:not([type=hidden]), textarea')]
  .map((e) => ({ label: (e.getAttribute('aria-label') || e.placeholder || e.name || '?').slice(0, 40), value: String(e.value || '').slice(0, 50) }))
  .filter((x) => x.label !== '?')).catch(() => []);
writeFileSync(resolve(ROOT, 'logs/gcp-branding.log'),
  `화면: ${t.slice(0, 400)}\n\n입력창:\n` + fields.map((f) => `  ${f.label.padEnd(34)} = ${f.value || '(비어 있음)'}`).join('\n'));
await page.screenshot({ path: resolve(ROOT, 'logs/gcp-branding.png') }).catch(() => {});
writeFileSync(resolve(ROOT, 'logs/gcp-branding.done'), 'ok');
await page.waitForTimeout(300000);
