#!/usr/bin/env node
/** 프로젝트 생성 화면의 버튼 구조를 정확히 본다. 앞선 시도에서 "만들기" 클릭이 타임아웃 났다. */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
const out = [];
const log = (...a) => { out.push(a.join(' ')); writeFileSync(resolve(ROOT, 'logs/gcp-projcreate.log'), out.join('\n')); console.log(a.join(' ')); };
const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/gcp-profile'), {
  channel: 'chrome', headless: false, viewport: { width: 1500, height: 1000 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
try {
  await page.goto('https://console.cloud.google.com/projectcreate', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(14000);
  const btns = await page.locator('button:visible').evaluateAll((els) => els.map((e) => ({
    t: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 24),
    d: e.disabled || e.getAttribute('aria-disabled') === 'true',
    r: (() => { const b = e.getBoundingClientRect(); return `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)}`; })(),
  })).filter((x) => x.t));
  log('버튼들:');
  for (const b of btns) log(`  "${b.t}" 비활성=${b.d} 위치=${b.r}`);
  const inputs = await page.locator('input:visible').evaluateAll((els) => els.map((e) => `${e.name || e.id || '?'}="${e.value}"`));
  log(`입력칸: ${inputs.join(' | ')}`);
  log(`본문: ${(await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)}`);
  await page.screenshot({ path: resolve(ROOT, 'logs/gcp-projcreate.png'), fullPage: true }).catch(() => {});
} catch (e) { log(`오류: ${String(e?.message).slice(0, 160)}`); }
writeFileSync(resolve(ROOT, 'logs/gcp-projcreate.done'), 'x');
await ctx.close().catch(() => {});
