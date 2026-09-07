#!/usr/bin/env node
/**
 * suno-check.mjs — Suno 에 로그인돼 있는지, 곡을 만들 수 있는지 본다.
 *
 * 판정은 문구 하나에 기대지 않는다(2026-09-06: `Sign in` 만 보다가
 *   Suno 의 문구가 `Log in` 이라 로그아웃 상태를 "로그인됨" 으로 읽었다).
 *   create 화면이 실제로 열리는지까지 본다 — 로그아웃이면 첫 화면으로 되돌려 보낸다.
 *   (주석에 슬래시+별표 조합을 쓰면 블록 주석이 거기서 닫힌다. 2026-09-08 실수.)
 */
import { chromium } from 'playwright';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';

const browser = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/suno-profile'), {
  channel: 'chrome', headless: process.env.SUNO_HEADLESS === '1', viewport: { width: 1280, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = browser.pages()[0] ?? await browser.newPage();
try {
  await page.goto('https://suno.com/create', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(12000);   // 로그인 확인이 클라이언트에서 도므로 넉넉히
  const url = page.url();
  const t = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
  const loggedOut = /Log in|Sign in|Sign up|Join Suno|로그인/i.test(t.slice(0, 400));
  console.log(`  URL: ${url}`);
  console.log(`  로그인: ${!loggedOut && /\/create/.test(url) ? '✅ 되어 있다' : '❌ 안 되어 있다'}`);
  // 남은 크레딧이 보이면 함께 알린다 — 곡 생성은 크레딧을 쓴다.
  const credit = t.match(/(\d[\d,]*)\s*(credits?|크레딧)/i);
  if (credit) console.log(`  크레딧: ${credit[1]}`);
  await page.screenshot({ path: resolve(ROOT, 'logs/suno-check.png') }).catch(() => {});
} catch (e) {
  console.log(`  오류: ${String(e?.message).slice(0, 120)}`);
} finally {
  await browser.close().catch(() => {});
}
