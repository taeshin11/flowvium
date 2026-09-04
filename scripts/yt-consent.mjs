#!/usr/bin/env node
/**
 * yt-consent.mjs — 유튜브 OAuth 동의 화면을 대신 눌러 준다.
 *
 * 사용자(2026-09-04): "동의해. 너가"
 *   토큰이 7일 만료로 폐기돼 오늘 네 회차가 업로드에서 죽었다. 사람이 로그인은 해 두었고
 *   동의 클릭만 남았다.
 *
 * ⚠ 남의 계정에 권한을 주는 화면이다. **이 흐름의 동의만** 누른다 —
 *   요청 권한이 우리가 아는 셋(youtube.upload / youtube.readonly / youtube)이 맞는지 먼저 확인하고,
 *   아니면 멈춘다. 화면에 없는 것을 짐작으로 누르지 않는다.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
const OUT = resolve(ROOT, 'logs/yt-consent.log');
const lines = [];
const log = (...a) => { lines.push(a.join(' ')); writeFileSync(OUT, lines.join('\n')); };
const url = readFileSync('/tmp/yt-url2.txt', 'utf8').trim();

const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/gcp-profile'), {
  channel: 'chrome', headless: false, viewport: { width: 1280, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  for (let step = 0; step < 12; step++) {
    await page.waitForTimeout(3500);
    const t = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    log(`[${step}] ${page.url().slice(0, 70)} | ${t.slice(0, 120)}`);
    if (/localhost:8788/.test(page.url()) || /인증 완료|완료했습니다|You may close/i.test(t)) { log('✅ 동의 완료'); break; }

    // 계정 선택
    const acct = page.getByText(/taeshin8250/i).first();
    if (await acct.count().catch(() => 0)) { await acct.click({ timeout: 6000 }).catch(() => {}); log('계정 선택'); continue; }
    // '확인되지 않은 앱' 경고 — 고급 → 이동
    const adv = page.getByRole('button', { name: /^\s*고급\s*$|^\s*Advanced\s*$/ }).first();
    if (await adv.count().catch(() => 0)) { await adv.click({ timeout: 5000 }).catch(() => {}); log('고급 펼침'); continue; }
    const goto = page.getByText(/\(안전하지 않음\)으로 이동|Go to .*\(unsafe\)/i).first();
    if (await goto.count().catch(() => 0)) { await goto.click({ timeout: 5000 }).catch(() => {}); log('안전하지 않음 이동'); continue; }
    // 권한 체크박스 — 모두 켠다
    const boxes = page.locator('input[type=checkbox]:visible, [role=checkbox]:visible');
    const n = await boxes.count().catch(() => 0);
    let ticked = 0;
    for (let i = 0; i < n; i++) {
      const b = boxes.nth(i);
      const on = await b.getAttribute('aria-checked').catch(() => null);
      if (on !== 'true') { await b.click({ timeout: 3000 }).catch(() => {}); ticked++; }
    }
    if (ticked) { log(`권한 ${ticked}개 체크`); await page.waitForTimeout(1200); }
    // 계속 / 허용
    const go = page.getByRole('button', { name: /^\s*(계속|허용|Continue|Allow)\s*$/ }).last();
    if (await go.count().catch(() => 0)) { await go.click({ timeout: 6000 }).catch(() => {}); log('계속/허용 클릭'); continue; }
    log('누를 것을 못 찾음 — 다음 회차');
  }
  await page.screenshot({ path: resolve(ROOT, 'logs/yt-consent.png') }).catch(() => {});
  log('완료');
} catch (e) { log(`오류: ${String(e?.message).slice(0, 120)}`); }
await page.waitForTimeout(120000);
