#!/usr/bin/env node
/**
 * suno-login.mjs — Suno 로그인 창을 띄운다. **사람이 로그인하면 세션이 남는다.**
 *
 * 2026-09-06 사용자 "수능 로그인 필요하면 얘기해. 근데 창을 태신 킴 11 Google 로그인된
 *   창으로 따로 띄워야 돼."
 *   그래서 시스템 Chrome 프로필을 건드리지 않고 **전용 프로필**(secrets/suno-profile)을 쓴다.
 *   시스템 프로필로 붙이려다 이미 실행 중인 Chrome 이 프로필을 잠가 6분을 멈춘 적이 있다.
 *
 * 로그인은 사람이 한다 — 구글 계정 taeshinkim11 로 들어가면 된다.
 * 창을 닫지 말고 로그인만 끝내면, 이후 자동화가 이 프로필로 곡을 만든다.
 */
import { chromium } from 'playwright';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';

const PROFILE = resolve(ROOT, 'secrets/suno-profile');
console.log(`프로필: ${PROFILE}`);
console.log('창이 뜨면 **taeshinkim11 구글 계정**으로 로그인해 주세요.');
console.log('로그인이 끝나면 이 창은 그대로 두셔도 되고 닫으셔도 됩니다 — 세션은 프로필에 남습니다.\n');

const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome', headless: false, viewport: { width: 1280, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.goto('https://suno.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});

// 로그인될 때까지 기다린다. 사람이 하는 일이라 넉넉히 둔다.
const until = Date.now() + 20 * 60_000;
let ok = false;
while (Date.now() < until) {
  await page.waitForTimeout(5000);
  const t = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
  if (!/Sign in|Sign up|로그인|Get started/i.test(t.slice(0, 300))) { ok = true; break; }
}
console.log(ok ? '✅ 로그인된 것으로 보입니다 — 세션이 프로필에 저장됐습니다.'
  : '⏳ 20분 동안 로그인이 확인되지 않았습니다. 다시 실행해 주세요.');
await ctx.close().catch(() => {});
