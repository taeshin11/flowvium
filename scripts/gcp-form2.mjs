#!/usr/bin/env node
/** 폼을 '사이트 또는 페이지 입력' 까지 채운다. 만들기는 사람이 누른다(사용자 요청 2026-09-04).
 *  사이트를 korea.kr 로 두는 이유: 폼이 사이트를 하나는 요구하는데,
 *  그대로 둬도 정부 보도자료가 잡혀 쓸모가 있다. 만든 뒤 설정에서 '전체 웹 검색' 을 켜면 넓어진다. */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
const OUT = resolve(ROOT, 'logs/gcp-form2.log');
const lines = [];
const log = (...a) => { lines.push(a.join(' ')); writeFileSync(OUT, lines.join('\n'), { mode: 0o600 }); };
const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/gcp-profile'), {
  channel: 'chrome', headless: false, viewport: { width: 1440, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
try {
  await page.goto('https://programmablesearchengine.google.com/controlpanel/create', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(9000);

  const boxes = page.locator('input[type=text]:visible');
  const n = await boxes.count().catch(() => 0);
  log(`텍스트 입력창 ${n}개`);
  await boxes.first().fill('flowvium-news').catch(() => {});
  log('① 이름: flowvium-news');

  // 사이트 칸은 자리표시자로 찾는다 — 순서에 기대지 않는다.
  const site = page.locator('input[placeholder*="사이트"], input[placeholder*="페이지"], input[placeholder*="site" i]').first();
  if (await site.count().catch(() => 0)) {
    await site.fill('www.korea.kr/*').catch(() => {});
    log('② 사이트: www.korea.kr/*');
    const add = page.locator('button:visible').filter({ hasText: /^\s*추가\s*$|^\s*Add\s*$/i }).first();
    if (await add.count().catch(() => 0)) { await add.click({ timeout: 6000 }).catch(() => {}); log('③ 추가 클릭'); }
    else log('③ 추가 버튼 못 찾음 — 값은 입력해 두었습니다');
  } else {
    log(`❌ 사이트 입력창 못 찾음 (창 ${n}개)`);
    if (n >= 2) { await boxes.nth(1).fill('www.korea.kr/*').catch(() => {}); log('② 두 번째 입력창에 넣음'); }
  }
  await page.waitForTimeout(2000);

  // 이미지 검색 상태를 확인만 한다(임의로 뒤집지 않는다).
  const state = await page.evaluate(() => {
    const els = [...document.querySelectorAll('*')].filter((e) => e.children.length === 0 && /이미지 검색/.test(e.textContent || ''));
    const row = els[0]?.closest('div');
    const sw = row?.parentElement?.querySelector('[role=switch], input[type=checkbox]');
    return sw ? (sw.getAttribute('aria-checked') ?? String(sw.checked)) : 'unknown';
  }).catch(() => 'unknown');
  log(`이미지 검색 토글: ${state}`);

  await page.screenshot({ path: resolve(ROOT, 'logs/gcp-form2.png') }).catch(() => {});
  log('여기까지 — 캡차와 만들기는 사람이');
  log('완료');
} catch (e) { log(`오류: ${String(e?.message).slice(0, 150)}`); }
await page.waitForTimeout(900000);
