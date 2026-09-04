#!/usr/bin/env node
/** '전체 웹 검색' 토글을 켠다.
 *  2026-09-04: 웹 검색으로는 "2026-03 폐지" 라고 나왔는데 **이 엔진에는 토글이 남아 있다**(실측).
 *  스크롤 밖에 있어서 앞서 못 찾았다. 문서보다 화면이 사실이다. */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
const CX = process.env.GOOGLE_CSE_CX || '91fa62a5516ea4d7a';
const OUT = resolve(ROOT, 'logs/gcp-toggle.log');
const lines = [];
const log = (...a) => { lines.push(a.join(' ')); writeFileSync(OUT, lines.join('\n')); };
const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/gcp-profile'), {
  channel: 'chrome', headless: false, viewport: { width: 1440, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
try {
  await page.goto(`https://programmablesearchengine.google.com/controlpanel/overview?cx=${CX}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(9000);
  const label = page.getByText(/^\s*전체 웹 검색\s*$|^\s*Search the entire web\s*$/).first();
  if (!(await label.count().catch(() => 0))) { log('❌ 항목 없음'); }
  else {
    await label.scrollIntoViewIfNeeded({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(1200);
    // 라벨과 같은 줄의 스위치를 찾는다 — 좌표로 누르지 않는다.
    // 2026-09-04: evaluate 안의 el.click() 은 **신뢰된 이벤트가 아니라** Material 토글이 무시한다.
    //   Playwright 로 직접 눌러야 한다. 요소는 라벨 위쪽 묶음에서 찾아 표시해 둔다.
    await page.evaluate(() => {
      const w = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && /^\s*전체 웹 검색\s*$/.test(e.textContent || ''));
      let n = w;
      for (let i = 0; i < 6 && n; i++) {
        n = n.parentElement;
        const sw = n?.querySelector('[role=switch], input[type=checkbox], button[aria-pressed], button.VfPpkd-scr2fc');
        if (sw) { sw.setAttribute('data-flowvium', 'target'); return true; }
      }
      return false;
    }).catch(() => false);
    const target = page.locator('[data-flowvium=target]').first();
    if (!(await target.count().catch(() => 0))) { log('❌ 토글 요소 표시 실패'); }
    else {
      const before = await target.getAttribute('aria-checked').catch(() => null);
      log(`토글 상태(전): ${before}`);
      await target.scrollIntoViewIfNeeded({ timeout: 6000 }).catch(() => {});
      await target.click({ timeout: 8000, force: true }).catch((e) => log(`클릭 실패: ${String(e.message).slice(0, 50)}`));
      await page.waitForTimeout(6000);
      const after = await target.getAttribute('aria-checked').catch(() => null);
      log(`토글 상태(후): ${after}`);
    }
  }
  await page.screenshot({ path: resolve(ROOT, 'logs/gcp-toggle.png') }).catch(() => {});
  log('완료');
} catch (e) { log(`오류: ${String(e?.message).slice(0, 150)}`); }
await page.waitForTimeout(600000);
