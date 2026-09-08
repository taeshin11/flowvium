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

// 2026-09-08: 프로필을 **다시 열면** 쿠키를 못 읽는다 —
//   크롬이 키체인 키로 암호화해 두기 때문이다(로그인은 됐는데 로그아웃으로 보였다).
//   그래서 로그인한 그 창에 **CDP 로 붙는다.** scripts/suno-open.sh 로 먼저 띄운다.
const PORT = process.env.SUNO_CDP_PORT || '9333';
let browser; let page;
try {
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const ctx = browser.contexts()[0];
  page = ctx.pages()[0] ?? await ctx.newPage();
} catch {
  console.log(`  ❌ :${PORT} 에 크롬이 없다 — 먼저 \`bash scripts/suno-open.sh\` 로 창을 띄우세요`);
  process.exit(1);
}
try {
  // 2026-09-08: 바로 /create 로 가면 인증이 붙기 전에 첫 화면으로 되돌려 보낸다.
  //   Suno 는 Clerk 를 쓰고 세션 쿠키가 auth.suno.com 에 있다 —
  //   앱이 그 도메인과 핸드셰이크를 마쳐야 로그인 상태가 된다.
  //   첫 화면에서 기다렸다가 옮겨 간다.
  await page.goto('https://suno.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(10000);
  await page.goto('https://suno.com/create', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(12000);
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
