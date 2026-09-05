#!/usr/bin/env node
/** 도메인 하나만 넣어 보고 **되는 방법**을 찾는다. 되면 그 방법으로 나머지를 돌린다.
 *  2026-09-05: 앞서 49번 '추가' 를 눌렀다고 로그에 남겼는데 하나도 저장되지 않았다. */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
const CX = '91fa62a5516ea4d7a';
const OUT = resolve(ROOT, 'logs/gcp-site-one.log');
const lines = [];
const log = (...a) => { lines.push(a.join(' ')); writeFileSync(OUT, lines.join('\n')); };
const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/gcp-profile'), {
  channel: 'chrome', headless: false, viewport: { width: 1440, height: 1000 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
try {
  await page.goto(`https://programmablesearchengine.google.com/controlpanel/overview?cx=${CX}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(12000);
  // '검색할 사이트' 영역까지 스크롤
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(3000);
  await page.screenshot({ path: resolve(ROOT, 'logs/gcp-full.png'), fullPage: true }).catch(() => {});
  const heads = await page.evaluate(() => [...document.querySelectorAll('h1,h2,h3,h4')].map(e=>(e.innerText||'').trim()).filter(Boolean)).catch(()=>[]);
  log(`섹션: ${heads.join(' | ').slice(0,200)}`);
  const btns0 = [...new Set((await page.locator('button:visible').allInnerTexts().catch(()=>[])).map(b=>b.replace(/\s+/g,' ').trim()).filter(b=>b&&b.length<20))];
  log(`버튼: ${btns0.join(' | ').slice(0,200)}`);

  const add = page.locator('button:visible').filter({ hasText: /^\s*추가\s*$|^\s*Add\s*$/ }).first();
  if (!(await add.count().catch(() => 0))) { log('❌ 추가 버튼 없음'); }
  else {
    await add.click({ timeout: 8000 });
    log('추가 클릭');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: resolve(ROOT, 'logs/gcp-site-dialog.png') }).catch(() => {});
    // 대화상자 구조를 그대로 적는다 — 짐작하지 않는다
    const dlg = await page.locator('[role=dialog]:visible').innerText().catch(() => '(대화상자 없음)');
    log(`대화상자: ${dlg.replace(/\s+/g, ' ').slice(0, 200)}`);
    const inputs = await page.evaluate(() => [...document.querySelectorAll('[role=dialog] input, input:not([type=hidden])')]
      .map((e, i) => ({ i, ph: e.placeholder || '', aria: e.getAttribute('aria-label') || '', val: String(e.value || '').slice(0, 30) }))).catch(() => []);
    log(`입력창: ${JSON.stringify(inputs).slice(0, 400)}`);
    const btns = await page.locator('[role=dialog]:visible button:visible').allInnerTexts().catch(() => []);
    log(`대화상자 버튼: ${btns.map((b) => b.trim()).filter(Boolean).join(' | ')}`);
  }
  log('완료');
} catch (e) { log(`오류: ${String(e?.message).slice(0, 120)}`); }
await page.waitForTimeout(180000);
