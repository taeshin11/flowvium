#!/usr/bin/env node
/**
 * suno-check.mjs — Suno 에 로그인돼 있는지, 자동화로 곡을 만들 수 있는지 확인만 한다.
 *
 * 2026-09-06 사용자 "우리가 지금 suno가 로그인되어 있잖아".
 *   MusicGen 으로 만든 것보다 Suno 쪽이 품질이 낫고, 유료 플랜이면 상업 이용 권리도 명확하다.
 *   먼저 **로그인 상태와 플랜**을 눈으로 확인한다 — 권리 없는 음원을 채널에 깔면 안 된다.
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';

const out = [];
const log = (...a) => { out.push(a.join(' ')); writeFileSync(resolve(ROOT, 'logs/suno-check.log'), out.join('\n')); console.log(a.join(' ')); };
const PROFILE = process.env.SUNO_PROFILE || `${process.env.HOME}/Library/Application Support/Google/Chrome`;
const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome', headless: false, viewport: { width: 1400, height: 950 },
  args: ['--profile-directory=Profile 1', '--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
try {
  await page.goto('https://suno.com/me', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(10000);
  const t = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
  log(`로그인 상태: ${/sign in|로그인|Get started/i.test(t.slice(0, 400)) ? '❌ 안 됨' : '✅ 된 듯'}`);
  log(`화면: ${t.slice(0, 260)}`);
  await page.screenshot({ path: resolve(ROOT, 'logs/suno.png') }).catch(() => {});
} catch (e) { log(`오류: ${String(e?.message).slice(0, 140)}`); }
writeFileSync(resolve(ROOT, 'logs/suno-check.done'), 'x');
await ctx.close().catch(() => {});
