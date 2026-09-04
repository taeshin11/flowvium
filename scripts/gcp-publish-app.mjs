#!/usr/bin/env node
/** OAuth 동의 화면을 '프로덕션' 으로 올린다.
 *  2026-09-04: '테스트' 상태라 갱신 토큰이 7일 만에 폐기됐다(8/28 발급 → 9/4 만료).
 *  오늘 네 회차가 그렇게 죽었다. 프로덕션으로 올려야 반복이 멈춘다. */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
const OUT = resolve(ROOT, 'logs/gcp-publish.log');
const lines = [];
const log = (...a) => { lines.push(a.join(' ')); writeFileSync(OUT, lines.join('\n')); };
const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/gcp-profile'), {
  channel: 'chrome', headless: false, viewport: { width: 1440, height: 1000 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
try {
  await page.goto('https://console.cloud.google.com/auth/audience?project=tagextract', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(20000);
  for (const n of [/^확인$/, /^Accept all$/i]) { const b = page.getByRole('button', { name: n }).first(); if (await b.count().catch(() => 0)) { await b.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(2500); } }
  const t = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
  log(`화면: ${t.slice(0, 300)}`);
  // Playwright locator 가 이 콘솔의 버튼을 자주 못 잡는다 — DOM 에서 직접 누른다(일반 button 은 먹는다).
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /앱 게시|PUBLISH APP/i.test((x.innerText || '').trim()) && !x.disabled);
    if (!b) return false; b.click(); return true;
  }).catch(() => false);
  if (clicked) { log('앱 게시 클릭(DOM)'); await page.waitForTimeout(3000);
    await page.evaluate(() => { const c=[...document.querySelectorAll('button')].find(x=>/^(확인|확인하기|Confirm|OK)$/.test((x.innerText||'').trim())&&!x.disabled); if(c) c.click(); }).catch(()=>{});
    await page.waitForTimeout(8000);
    const t2 = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    log(/프로덕션|In production/i.test(t2) ? '✅ 프로덕션' : `상태: ${t2.slice(0, 160)}`);
  }
  const btn = page.getByRole('button', { name: /앱 게시|PUBLISH APP|게시/i }).first();
  if (clicked) { /* 이미 처리 */ } else if (!(await btn.count().catch(() => 0))) {
    const btns = [...new Set((await page.locator('button:visible').allInnerTexts().catch(() => [])).map((b) => b.replace(/\s+/g, ' ').trim()).filter((b) => b && b.length < 26))];
    log(`❌ 게시 버튼 없음. 보이는 버튼: ${btns.join(' | ').slice(0, 200)}`);
  } else {
    await btn.click({ timeout: 8000 }).catch(() => {});
    log('게시 버튼 클릭');
    await page.waitForTimeout(3000);
    const ok = page.getByRole('button', { name: /^\s*(확인|확인하기|Confirm|OK)\s*$/ }).last();
    if (await ok.count().catch(() => 0)) { await ok.click({ timeout: 6000 }).catch(() => {}); log('확인'); }
    await page.waitForTimeout(6000);
    const after = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    log(`이후: ${/프로덕션|In production/i.test(after) ? '✅ 프로덕션' : '⚠ 아직 테스트로 보임'}`);
  }
  await page.screenshot({ path: resolve(ROOT, 'logs/gcp-publish.png') }).catch(() => {});
  log('완료');
} catch (e) { log(`오류: ${String(e?.message).slice(0, 120)}`); }
await page.waitForTimeout(300000);
