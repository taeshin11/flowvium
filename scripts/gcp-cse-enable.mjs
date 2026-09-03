#!/usr/bin/env node
/** Custom Search API 를 프로젝트에 사용 설정한다.
 *  2026-09-04: 앞서 '관리' 버튼이 보인다고 켜져 있다고 판단했는데 틀렸다 —
 *  실제 호출은 403 "This project does not have the access to Custom Search JSON API".
 *  버튼 이름으로 짐작하지 말고 **사용 설정 버튼이 있는지**로 판정한다. */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
const PROFILE = resolve(ROOT, 'secrets/gcp-profile');
const OUT = resolve(ROOT, 'logs/gcp-cse-enable.log');
const lines = [];
const log = (...a) => { lines.push(a.join(' ')); writeFileSync(OUT, lines.join('\n')); };

const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome', headless: false, viewport: null,
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
try {
  await page.goto('https://console.cloud.google.com/apis/library/customsearch.googleapis.com?project=tagextract', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(9000);
  // 쿠키 배너가 화면을 덮으면 아래 버튼을 못 찾는다(실측). 먼저 치운다.
  for (const name of [/^확인$/, /^Accept all$/i, /^모두 수락$/]) {
    const b = page.getByRole('button', { name }).first();
    if (await b.count().catch(() => 0)) { await b.click({ timeout: 5000 }).catch(() => {}); log('쿠키 배너 닫음'); await page.waitForTimeout(3000); break; }
  }
  const enable = page.getByRole('button', { name: /^\s*(사용|ENABLE|Enable)\s*$/ }).first();
  const cnt = await enable.count().catch(() => 0);
  log(`사용 설정 버튼: ${cnt ? '있음' : '없음'}`);
  if (cnt) {
    await enable.click({ timeout: 10000 });
    log('클릭함 — 반영 대기');
    await page.waitForTimeout(15000);
    log(`이동한 주소: ${page.url().slice(0, 110)}`);
  } else {
    const txt = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    const btns = [...new Set((await page.locator('button:visible').allInnerTexts().catch(() => [])).map((b) => b.replace(/\s+/g, ' ').trim()).filter((b) => b && b.length < 30))];
    log(`버튼 없음. 보이는 버튼: ${btns.slice(0, 20).join(' | ')}`);
    log(`화면: ${txt.slice(0, 200)}`);
  }
  log('완료');
} catch (e) { log(`오류: ${String(e?.message).slice(0, 150)}`); }
await page.waitForTimeout(600000);
