#!/usr/bin/env node
/** Custom Search 행의 '키 표시' 대화상자 **안에서만** 키를 읽는다.
 *  2026-09-04: 처음엔 페이지 전체 HTML 에서 정규식으로 잡았는데, 키가 3개라 엉뚱한 것을 집었다
 *  (403 — 이 프로젝트는 Custom Search JSON API 접근 권한이 없습니다). 범위를 좁힌다. */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
const PROFILE = resolve(ROOT, 'secrets/gcp-profile');
const OUT = resolve(ROOT, 'logs/gcp-cse-read2.log');
const lines = [];
const log = (...a) => { lines.push(a.join(' ')); writeFileSync(OUT, lines.join('\n'), { mode: 0o600 }); };

const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome', headless: false, viewport: null,
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
try {
  await page.goto('https://console.cloud.google.com/apis/credentials?project=tagextract', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(9000);
  const rows = page.locator('table tbody tr');
  const n = await rows.count().catch(() => 0);
  log(`행 ${n}개`);
  for (let i = 0; i < n; i++) {
    const t = (await rows.nth(i).innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    if (!/키 표시|Show key/i.test(t)) { log(`  [${i}] ${t.slice(0, 70)} (키 아님)`); continue; }
    log(`  [${i}] ${t.slice(0, 70)}`);
    const link = rows.nth(i).getByText(/키 표시|Show key/i).first();
    if (!(await link.count().catch(() => 0))) continue;
    await link.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(4000);
    // 대화상자 안에서만 읽는다
    const key = await page.evaluate(() => {
      const dlg = document.querySelector('[role=dialog]');
      if (!dlg) return null;
      const re = /AIza[0-9A-Za-z_\-]{30,}/;
      for (const el of dlg.querySelectorAll('input, textarea')) { const m = String(el.value ?? '').match(re); if (m) return m[0]; }
      const m2 = (dlg.innerText || '').match(re); return m2 ? m2[0] : null;
    }).catch(() => null);
    if (key) log(`      KEY[${i}]=${key}`);
    // 닫기 — 대화상자의 닫기 버튼만 누른다(좌표 클릭 금지)
    await page.locator('[role=dialog] button:has-text("닫기"), [role=dialog] button:has-text("Close"), [role=dialog] button[aria-label*="닫기"]').first().click({ timeout: 4000 }).catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(1500);
  }
  log('완료');
} catch (e) { log(`오류: ${String(e?.message).slice(0, 150)}`); }
await page.waitForTimeout(600000);
