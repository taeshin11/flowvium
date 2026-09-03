#!/usr/bin/env node
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
const PROFILE = resolve(ROOT, 'secrets/gcp-profile');
const OUT = resolve(ROOT, 'logs/gcp-cse-read.log');
const SHOT = resolve(ROOT, 'logs/gcp-cse-screen.png');
const lines = [];
const log = (...a) => { lines.push(a.join(' ')); writeFileSync(OUT, lines.join('\n'), { mode: 0o600 }); };

const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome', headless: false, viewport: null,
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
try {
  await page.goto('https://console.cloud.google.com/apis/credentials?project=tagextract', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);
  const row = page.locator('tr', { hasText: /Custom Search API/i }).first();
  const link = row.getByText(/키 표시|Show key/i).first();
  if (await link.count().catch(() => 0)) { await link.click({ timeout: 8000 }); await page.waitForTimeout(6000); }
  else log('키 표시 링크 없음 — 현재 화면만 기록');

  // innerText 로는 안 보인다 — 입력창의 value 와 전체 HTML 을 함께 훑는다.
  const found = await page.evaluate(() => {
    const re = /AIza[0-9A-Za-z_\-]{30,}/;
    for (const el of document.querySelectorAll('input, textarea')) {
      const m = String(el.value ?? '').match(re); if (m) return m[0];
    }
    const m2 = document.documentElement.innerHTML.match(re);
    return m2 ? m2[0] : null;
  }).catch(() => null);
  if (found) log(`KEY=${found}`);
  else {
    await page.screenshot({ path: SHOT, fullPage: false }).catch(() => {});
    const dlg = await page.locator('[role=dialog]:visible').innerText().catch(() => '(대화상자 없음)');
    log(`❌ 못 읽음. 대화상자: ${dlg.replace(/\s+/g, ' ').slice(0, 200)}`);
    log(`화면 캡처: ${SHOT}`);
  }
} catch (e) { log(`오류: ${String(e?.message).slice(0, 150)}`); }
await page.waitForTimeout(600000);
