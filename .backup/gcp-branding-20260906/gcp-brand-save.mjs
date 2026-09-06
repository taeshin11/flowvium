#!/usr/bin/env node
/** 이미 채워진 브랜딩 폼을 저장한다. 저장 버튼은 페이지 아래쪽이라 스크롤이 필요하다. */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
const OUT = resolve(ROOT, 'logs/gcp-brand-save.log');
const lines = [];
const log = (...a) => { lines.push(a.join(' ')); writeFileSync(OUT, lines.join('\n')); };
const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/gcp-profile'), {
  channel: 'chrome', headless: false, viewport: { width: 1440, height: 1000 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
try {
  // 이미 열려 있는 탭을 쓴다(값이 남아 있다). 없으면 새로 연다.
  if (!/auth\/branding/.test(page.url())) {
    await page.goto('https://console.cloud.google.com/auth/branding?project=tagextract', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(12000);
    log('⚠ 새로 열었다 — 입력값이 비어 있을 수 있다');
  }
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(2500);
  const btns = [...new Set((await page.locator('button:visible').allInnerTexts().catch(() => [])).map((b) => b.replace(/\s+/g, ' ').trim()).filter((b) => b && b.length < 24))];
  log(`보이는 버튼: ${btns.join(' | ').slice(0, 200)}`);
  const save = page.locator('button:visible').filter({ hasText: /^\s*(저장|SAVE|Save)\s*$/ }).last();
  if (!(await save.count().catch(() => 0))) { log('❌ 저장 버튼 없음'); }
  else {
    await save.scrollIntoViewIfNeeded({ timeout: 6000 }).catch(() => {});
    await save.click({ timeout: 10000 });
    log('저장 클릭');
    await page.waitForTimeout(9000);
    const t = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    log(/저장되었|saved/i.test(t) ? '✅ 저장됨' : `상태: ${t.slice(0, 160)}`);
  }
  await page.screenshot({ path: resolve(ROOT, 'logs/gcp-brand-save.png') }).catch(() => {});
  log('완료');
} catch (e) { log(`오류: ${String(e?.message).slice(0, 120)}`); }
await page.waitForTimeout(300000);
