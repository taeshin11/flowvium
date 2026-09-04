#!/usr/bin/env node
/** '앱 게시' 를 누르고 **결과를 정확히** 확인한다.
 *  2026-09-04: 앞 스크립트가 화면 다른 곳의 '프로덕션' 글자를 잡고 성공이라 했다 — 오판이었다.
 *  '게시 상태' 바로 뒤 문자열만 본다. */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
const OUT = resolve(ROOT, 'logs/gcp-pub2.log');
const lines = [];
const log = (...a) => { lines.push(a.join(' ')); writeFileSync(OUT, lines.join('\n')); };
const status = async (page) => {
  const t = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
  const m = t.match(/게시 상태\s*([^\s]+(?:\s*중)?)/);
  return m ? m[1] : '(못 읽음)';
};
const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/gcp-profile'), {
  channel: 'chrome', headless: false, viewport: { width: 1440, height: 1000 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
try {
  await page.goto('https://console.cloud.google.com/auth/audience?project=tagextract', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(20000);
  for (const n of [/^확인$/, /^Accept all$/i]) { const b = page.getByRole('button', { name: n }).first(); if (await b.count().catch(() => 0)) { await b.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(2500); } }
  log(`전: 게시 상태 = ${await status(page)}`);
  const pub = page.locator('button:visible').filter({ hasText: /^\s*앱 게시\s*$/ }).first();
  const clicked = await pub.count().catch(() => 0);
  if (clicked) { await pub.click({ timeout: 10000 }).catch((e) => log(`클릭 실패: ${String(e.message).slice(0,40)}`)); log('앱 게시 클릭'); }
  else log('❌ 앱 게시 버튼 없음');
  if (clicked) {
    await page.waitForTimeout(4000);
    // 대화상자에 무엇이 있는지 먼저 적는다 — 짐작으로 누르지 않는다.
    const dlg = await page.locator('[role=dialog]:visible').innerText().catch(() => '');
    log(`대화상자: ${dlg.replace(/\s+/g, ' ').slice(0, 160) || '(없음)'}`);
    const dbtns = await page.locator('[role=dialog]:visible button:visible').allInnerTexts().catch(() => []);
    log(`대화상자 버튼: ${dbtns.map((b) => b.trim()).filter(Boolean).join(' | ') || '(없음)'}`);
    const conf = page.locator('[role=dialog]:visible button:visible').filter({ hasText: /확인|Confirm|게시|OK/ }).last();
    if (await conf.count().catch(() => 0)) { await conf.click({ timeout: 8000 }).catch(() => {}); log('확인 클릭'); }
    else log('확인 버튼 없음');
    // 2026-09-05: 클릭은 들어가는데 상태가 안 바뀌었다. 반영이 느릴 수 있어 충분히 기다린다.
    for (let k = 0; k < 6; k++) {
      await page.waitForTimeout(10000);
      const st = await status(page);
      log(`  대기 ${(k + 1) * 10}s → ${st}`);
      if (!/테스트/.test(st)) break;
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(12000);
    }
  }
  log(`후: 게시 상태 = ${await status(page)}`);
  await page.screenshot({ path: resolve(ROOT, 'logs/gcp-pub2.png') }).catch(() => {});
  log('완료');
} catch (e) { log(`오류: ${String(e?.message).slice(0, 120)}`); }
await page.waitForTimeout(180000);
