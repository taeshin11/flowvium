#!/usr/bin/env node
/**
 * 브랜딩 3개 링크를 채운다 (사용자 요청 2026-09-04, flowvium.net 기준).
 *
 * 왜 필요한가: OAuth 앱이 '테스트' 상태라 갱신 토큰이 7일마다 폐기된다 —
 *   오늘 네 회차가 그렇게 죽었다. 프로덕션으로 올리려면 이 정보가 있어야 한다.
 *
 * 왜 인덱스로 찾나: Material 입력창이라 placeholder·aria 가 비어 있다.
 *   **주변 텍스트로 확인한 뒤** 그 입력창을 채운다 — 순서만 믿고 넣지 않는다.
 *   세 주소 모두 실제로 200 을 확인했다(추측한 주소를 넣지 않는다).
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
const OUT = resolve(ROOT, 'logs/gcp-brand-fill.log');
const lines = [];
const log = (...a) => { lines.push(a.join(' ')); writeFileSync(OUT, lines.join('\n')); };
const WANT = [
  { ctx: /애플리케이션 홈페이지/, url: 'https://flowvium.net' },
  { ctx: /개인정보처리방침/, url: 'https://flowvium.net/privacy' },
  { ctx: /서비스 약관/, url: 'https://flowvium.net/terms' },
];
const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/gcp-profile'), {
  channel: 'chrome', headless: false, viewport: { width: 1440, height: 1000 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
try {
  await page.goto('https://console.cloud.google.com/auth/branding?project=tagextract', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);
  for (const n of [/^확인$/, /^Accept all$/i]) { const b = page.getByRole('button', { name: n }).first(); if (await b.count().catch(() => 0)) { await b.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(2500); } }
  await page.getByText(/앱 이름|App name/).first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(3000);

  const inputs = page.locator('input:not([type=hidden]):not([type=file])');
  const n = await inputs.count();
  for (const w of WANT) {
    let done = false;
    for (let i = 0; i < n; i++) {
      const el = inputs.nth(i);
      // 주변 텍스트로 그 칸이 맞는지 확인한 뒤에 넣는다
      const around = await el.evaluate((e) => {
        let p = e, t = '';
        for (let up = 0; up < 4 && p; up++) { p = p.parentElement; if (p) t = (p.innerText || '').replace(/\s+/g, ' '); if (t.length > 12) break; }
        return t;
      }).catch(() => '');
      if (!w.ctx.test(around)) continue;
      const cur = await el.inputValue().catch(() => '');
      if (cur) { log(`= 이미 있음 (${around.slice(0, 24)}): ${cur.slice(0, 40)}`); done = true; break; }
      await el.scrollIntoViewIfNeeded({ timeout: 6000 }).catch(() => {});
      await el.fill(w.url, { timeout: 8000 });
      const after = await el.inputValue().catch(() => '');
      log(after === w.url ? `✎ ${around.slice(0, 24)} ← ${w.url}` : `⚠ 입력 실패 (${around.slice(0, 24)})`);
      done = true; break;
    }
    if (!done) log(`❌ 칸 못 찾음: ${w.ctx}`);
  }
  await page.waitForTimeout(1500);
  const save = page.getByRole('button', { name: /^\s*(저장|SAVE)\s*$/i }).first();
  if (!(await save.count().catch(() => 0))) log('❌ 저장 버튼 없음');
  else { await save.click({ timeout: 8000 }); log('저장 클릭'); await page.waitForTimeout(9000); }
  await page.screenshot({ path: resolve(ROOT, 'logs/gcp-brand-fill.png') }).catch(() => {});
  log('완료');
} catch (e) { log(`오류: ${String(e?.message).slice(0, 120)}`); }
await page.waitForTimeout(300000);
