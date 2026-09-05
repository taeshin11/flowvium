#!/usr/bin/env node
/** 프로젝트가 실제로 생겼는지 목록에서 확인한다. 생성 후 URL 이 이전 프로젝트로 돌아가
 *  만들어졌는지 알 수 없었다 — 화면 문구가 아니라 목록으로 확인한다. */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
const out = [];
const log = (...a) => { out.push(a.join(' ')); writeFileSync(resolve(ROOT, 'logs/gcp-proj-list.log'), out.join('\n')); console.log(a.join(' ')); };
const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/gcp-profile'), {
  channel: 'chrome', headless: false, viewport: { width: 1500, height: 1000 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
try {
  await page.goto('https://console.cloud.google.com/cloud-resource-manager', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(15000);
  const t = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
  log(`본문: ${t.slice(0, 500)}`);
  await page.screenshot({ path: resolve(ROOT, 'logs/gcp-proj-list.png'), fullPage: true }).catch(() => {});
} catch (e) { log(`오류: ${String(e?.message).slice(0, 160)}`); }
writeFileSync(resolve(ROOT, 'logs/gcp-proj-list.done'), 'x');
await ctx.close().catch(() => {});
