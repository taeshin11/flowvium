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
await page.goto('https://console.cloud.google.com/auth/branding?project=tagextract', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(8000);
for (const n of [/^확인$/, /^Accept all$/i]) { const b = page.getByRole('button', { name: n }).first(); if (await b.count().catch(() => 0)) { await b.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(2500); } }
// 폼이 그려질 때까지 기다린다 — 앞서 20초를 그냥 세다가 빈 DOM 을 읽었다.
await page.getByText(/앱 이름|App name/).first().waitFor({ timeout: 60000 }).catch(() => {});
await page.getByText(/개인정보처리방침|Privacy policy/).first().scrollIntoViewIfNeeded({ timeout: 10000 }).catch(() => {});
await page.waitForTimeout(4000);
// 모든 입력창을 주변 텍스트와 함께 뽑는다 — placeholder 로는 못 잡았다(Material)
const fields = await page.evaluate(() => [...document.querySelectorAll('input:not([type=hidden]):not([type=file])')].map((e, i) => {
  let ctxText = '';
  let n = e;
  for (let up = 0; up < 4 && n; up++) { n = n.parentElement; if (n) ctxText = (n.innerText || '').replace(/\s+/g, ' ').slice(0, 70); if (ctxText.length > 12) break; }
  return { i, type: e.type, ph: e.placeholder || '', aria: e.getAttribute('aria-label') || '', val: String(e.value || '').slice(0, 40), ctx: ctxText };
})).catch(() => []);
writeFileSync(resolve(ROOT, 'logs/gcp-brand-probe.log'),
  fields.map((f) => `[${f.i}] ph="${f.ph}" aria="${f.aria}" val="${f.val}"\n     ctx: ${f.ctx}`).join('\n'));
writeFileSync(resolve(ROOT, 'logs/gcp-brand-probe.done'), 'ok');
await page.waitForTimeout(600000);
