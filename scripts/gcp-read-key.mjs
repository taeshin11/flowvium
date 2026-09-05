#!/usr/bin/env node
/** 이미 있는 Custom Search API 키를 "키 표시" 로 읽어 온다. 새로 만들 필요가 없었다 —
 *  자격증명 화면에 Custom Search API 로 제한된 키가 이미 둘 있다(2026-05-11, 2026-09-04). */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
const out = [];
const log = (...a) => { out.push(a.join(' ')); writeFileSync(resolve(ROOT, 'logs/gcp-read-key.log'), out.join('\n')); console.log(a.join(' ')); };
const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/gcp-profile'), {
  channel: 'chrome', headless: false, viewport: { width: 1500, height: 1000 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
const keys = [];
try {
  const PID = process.env.GCP_PROJECT_ID || '';
  await page.goto(`https://console.cloud.google.com/apis/credentials${PID ? `?project=${PID}` : ''}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(13000);
  await page.keyboard.press('Escape').catch(() => {});
  // Custom Search API 로 제한된 행만 본다. 다른 키(Gemini·YouTube)를 건드리면 안 된다.
  const rows = page.locator('tr').filter({ hasText: 'Custom Search API' });
  const n = await rows.count();
  log(`Custom Search 키 행 ${n}개`);
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i);
    const name = (await row.innerText().catch(() => '')).split('\n')[0]?.trim() ?? '?';
    // "키 표시" 는 포커스만 잡히고 모달이 안 떴다(실측). 키 이름을 눌러 상세 화면으로 간다 —
    //   거기에는 키가 처음부터 펼쳐져 있다.
    const link = row.locator('a:visible').first();
    if (!(await link.count().catch(() => 0))) { log(`  ${name}: 이름 링크 없음`); continue; }
    await link.click({ timeout: 10000 }).catch((e) => log(`  ${name}: 클릭 실패 ${String(e.message).slice(0, 40)}`));
    await page.waitForTimeout(9000);
    let body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    let m = body.match(/AIza[0-9A-Za-z_\-]{30,}/);
    if (!m) {
      // 상세 화면에서도 가려져 있으면 거기 있는 "표시" 를 누른다
      const sh = page.locator('button:visible, a:visible').filter({ hasText: /표시|Show/ }).first();
      if (await sh.count().catch(() => 0)) { await sh.click({ timeout: 6000 }).catch(() => {}); await page.waitForTimeout(5000); }
      // 값이 input 안에 있을 수도 있다 — 화면 글자만 보면 놓친다
      const vals = await page.locator('input:visible, textarea:visible').evaluateAll(
        (els) => els.map((e) => e.value || '')).catch(() => []);
      body += ' ' + vals.join(' ');
      m = body.match(/AIza[0-9A-Za-z_\-]{30,}/);
    }
    if (m && !keys.includes(m[0])) { keys.push(m[0]); log(`  ${name}: ${m[0].slice(0, 10)}…${m[0].slice(-4)}`); }
    else if (!m) log(`  ${name}: 상세 화면에도 키가 안 보인다`);
    await page.goBack({ timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(7000);
  }
  if (keys.length) { writeFileSync(resolve(ROOT, process.env.KEY_OUT || 'secrets/cse-keys.txt'), keys.join('\n')); log(`✅ ${keys.length}개 저장`); }
  await page.screenshot({ path: resolve(ROOT, 'logs/gcp-readkey.png') }).catch(() => {});
} catch (e) { log(`오류: ${String(e?.message).slice(0, 160)}`); }
writeFileSync(resolve(ROOT, 'logs/gcp-read-key.done'), 'x');
await ctx.close().catch(() => {});
