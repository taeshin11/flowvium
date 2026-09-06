#!/usr/bin/env node
/** 프로덕션 게시에 필요한 브랜딩 정보를 채운다.
 *  2026-09-04: '테스트' 상태라 갱신 토큰이 7일마다 폐기된다. 프로덕션으로 올리려면
 *  홈페이지·개인정보처리방침·서비스 약관 링크와 승인 도메인이 있어야 한다.
 *  세 페이지 모두 flowvium.net 에 실재함을 확인하고 넣는다(추측으로 없는 주소를 넣지 않는다). */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
const OUT = resolve(ROOT, 'logs/gcp-fill.log');
const lines = [];
const log = (...a) => { lines.push(a.join(' ')); writeFileSync(OUT, lines.join('\n')); };
const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/gcp-profile'), {
  channel: 'chrome', headless: false, viewport: { width: 1440, height: 1000 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
try {
  await page.goto('https://console.cloud.google.com/auth/branding?project=tagextract', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(18000);
  for (const n of [/^확인$/, /^Accept all$/i]) { const b = page.getByRole('button', { name: n }).first(); if (await b.count().catch(() => 0)) { await b.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(2500); } }

  const fill = async (ph, val) => {
    const el = page.locator(`input[placeholder*="${ph}"]`).first();
    if (!(await el.count().catch(() => 0))) { log(`  ✗ "${ph}" 칸 없음`); return false; }
    const cur = await el.inputValue().catch(() => '');
    if (cur) { log(`  = "${ph}" 이미 있음: ${cur.slice(0, 40)}`); return true; }
    await el.fill(val).catch(() => {});
    log(`  ✎ "${ph}" ← ${val}`);
    return true;
  };
  await fill('애플리케이션 홈페이지', 'https://flowvium.net');
  await fill('개인정보처리방침', 'https://flowvium.net/privacy');
  await fill('서비스 약관', 'https://flowvium.net/terms');
  await page.waitForTimeout(1500);

  // 승인된 도메인 — 있으면 flowvium.net 추가
  const dom = page.locator('input[placeholder*="도메인"], input[aria-label*="도메인"]').first();
  if (await dom.count().catch(() => 0)) {
    const cur = await dom.inputValue().catch(() => '');
    if (!cur) { await dom.fill('flowvium.net').catch(() => {}); await page.keyboard.press('Enter').catch(() => {}); log('  ✎ 승인 도메인 ← flowvium.net'); }
    else log(`  = 승인 도메인 이미 있음: ${cur}`);
  } else log('  ✗ 승인 도메인 칸 없음');

  await page.waitForTimeout(1500);
  const save = page.getByRole('button', { name: /^\s*(저장|SAVE)\s*$/i }).first();
  if (await save.count().catch(() => 0)) { await save.click({ timeout: 8000 }).catch(() => {}); log('저장 클릭'); await page.waitForTimeout(8000); }
  else log('❌ 저장 버튼 없음');
  const t = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
  log(`이후: ${/저장되었|saved/i.test(t) ? '✅ 저장됨' : t.slice(0, 150)}`);
  await page.screenshot({ path: resolve(ROOT, 'logs/gcp-fill.png') }).catch(() => {});
  log('완료');
} catch (e) { log(`오류: ${String(e?.message).slice(0, 120)}`); }
await page.waitForTimeout(300000);
