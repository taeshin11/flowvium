#!/usr/bin/env node
/** API 키 생성 — 사용자 인증 정보 화면에서 '사용자 인증 정보 만들기 → API 키'. */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
const PROFILE = resolve(ROOT, 'secrets/gcp-profile');
const OUT = resolve(ROOT, 'logs/gcp-cse-key.log');
const lines = [];
const log = (...a) => { lines.push(a.join(' ')); writeFileSync(OUT, lines.join('\n')); };

const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome', headless: false, viewport: null,
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
try {
  await page.goto('https://console.cloud.google.com/apis/credentials?project=tagextract', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(7000);
  log(`주소: ${page.url().slice(0, 100)}`);

  // 이미 만들어 둔 키가 있는지 먼저 본다 — 없는데 만드는 게 아니라, 있으면 그걸 쓴다.
  const rows = await page.locator('table tbody tr').allInnerTexts().catch(() => []);
  log(`기존 사용자 인증 정보 ${rows.length}행`);
  rows.slice(0, 6).forEach((r) => log(`  · ${r.replace(/\s+/g, ' ').slice(0, 90)}`));

  const create = page.getByRole('button', { name: /사용자 인증 정보 만들기|CREATE CREDENTIALS/i }).first();
  if (!(await create.count().catch(() => 0))) {
    const btns = [...new Set((await page.locator('button:visible').allInnerTexts().catch(() => [])).map((b) => b.replace(/\s+/g, ' ').trim()).filter(Boolean))];
    log(`❌ '사용자 인증 정보 만들기' 버튼을 못 찾음. 보이는 버튼: ${btns.slice(0, 20).join(' | ')}`);
  } else {
    await create.click({ timeout: 8000 });
    await page.waitForTimeout(2000);
    const apiKey = page.getByRole('menuitem', { name: /API 키|API key/i }).first();
    if (!(await apiKey.count().catch(() => 0))) {
      const items = await page.locator('[role=menuitem]:visible').allInnerTexts().catch(() => []);
      log(`❌ 'API 키' 메뉴 없음. 메뉴: ${items.join(' | ').slice(0, 160)}`);
    } else {
      await apiKey.click({ timeout: 8000 });
      await page.waitForTimeout(9000);
      const body = await page.locator('body').innerText().catch(() => '');
      const m = body.match(/AIza[0-9A-Za-z_\-]{30,}/);
      log(m ? `✅ KEY=${m[0]}` : `❌ 키를 화면에서 못 읽음. 화면: ${body.replace(/\s+/g, ' ').slice(0, 220)}`);
    }
  }
} catch (e) { log(`오류: ${String(e?.message).slice(0, 150)}`); }
await page.waitForTimeout(600000);
