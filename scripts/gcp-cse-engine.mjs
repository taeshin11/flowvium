#!/usr/bin/env node
/** 프로그래밍 검색엔진(cx) — 이미 있으면 그걸 쓰고, 없으면 화면 상태를 적고 멈춘다. */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
const PROFILE = resolve(ROOT, 'secrets/gcp-profile');
const OUT = resolve(ROOT, 'logs/gcp-cse-engine.log');
const lines = [];
const log = (...a) => { lines.push(a.join(' ')); writeFileSync(OUT, lines.join('\n'), { mode: 0o600 }); };

const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome', headless: false, viewport: null,
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
try {
  await page.goto('https://programmablesearchengine.google.com/controlpanel/all', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);
  log(`주소: ${page.url().slice(0, 100)}`);
  const body = await page.locator('body').innerText().catch(() => '');
  log(`화면: ${body.replace(/\s+/g, ' ').slice(0, 260)}`);
  // cx 는 보통 목록 링크의 쿼리스트링에 있다.
  const cx = await page.evaluate(() => {
    for (const a of document.querySelectorAll('a[href]')) {
      const m = a.href.match(/[?&]cx=([0-9a-zA-Z_:-]{8,})/); if (m) return m[1];
    }
    const m2 = document.documentElement.innerHTML.match(/"cx"\s*:\s*"([0-9a-zA-Z_:-]{8,})"/);
    return m2 ? m2[1] : null;
  }).catch(() => null);
  log(cx ? `CX=${cx}` : '기존 검색엔진 없음 — 새로 만들어야 함');
} catch (e) { log(`오류: ${String(e?.message).slice(0, 150)}`); }
await page.waitForTimeout(600000);
