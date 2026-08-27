#!/usr/bin/env node
/**
 * flow-models.mjs — Flow 설정의 **동영상 모델 목록**을 확인한다.
 *
 * 설정 보기 → "동영상 생성 기본값" 의 모델 드롭다운(기본 Omni Flash)을 열어 선택지를 찍는다.
 * Veo 3.1 Lite [Lower Priority] 는 0 크레딧이라 매일 발행에 이 항목이 있어야 한다.
 * 생성은 하지 않는다 — 무엇을 고를 수 있는지부터 안다.
 */
import { openFlow, FLOW_URL, sessionCookiesPresent } from './lib/flow.mjs';
import { mkdirSync } from 'fs';

const SHOTS = process.argv[2] ?? '/tmp/flow-models';
mkdirSync(SHOTS, { recursive: true });
if (!sessionCookiesPresent()) { console.error('❌ 로그인 세션 없음'); process.exit(1); }

const { ctx, page } = await openFlow({ headless: false });
await page.goto(FLOW_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => {});
await page.waitForTimeout(3500);
for (const t of ['Agree', '동의']) {
  const b = page.locator(`button:has-text("${t}")`).first();
  if (await b.count().catch(() => 0)) { await b.click({ timeout: 4000 }).catch(() => {}); break; }
}
const existing = page.locator('a[href*="/project/"]').first();
if (await existing.count().catch(() => 0)) await existing.click({ timeout: 8000 }).catch(() => {});
else await page.locator('button:has-text("새 프로젝트"), button:has-text("New project")').first()
  .click({ timeout: 8000 }).catch(() => {});
await page.waitForTimeout(6000);

// 설정 보기
await page.locator('button[aria-label*="설정"], button:has-text("settings_2")').first()
  .click({ timeout: 8000 }).catch((e) => console.log(`설정 열기 실패 ${e.message.slice(0, 50)}`));
await page.waitForTimeout(2500);
await page.screenshot({ path: `${SHOTS}/1-settings.png` }).catch(() => {});

// 모델 드롭다운. 이미지용(Nano Banana)과 동영상용(Omni Flash)이 둘 다 있으므로 **마지막 것**이 동영상이다.
const drops = page.locator('button:has-text("arrow_drop_down")');
const n = await drops.count().catch(() => 0);
console.log(`  드롭다운 ${n}개`);
for (let i = n - 1; i >= 0; i--) {
  const label = (await drops.nth(i).innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  console.log(`\n>> 드롭다운 ${i}: "${label}"`);
  await drops.nth(i).click({ timeout: 6000 }).catch((e) => console.log(`   실패 ${e.message.slice(0, 50)}`));
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${SHOTS}/2-drop-${i}.png` }).catch(() => {});
  const opts = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    return [...document.querySelectorAll('[role=option],[role=menuitem],li,[role=menuitemradio]')]
      .filter(vis).map((el) => (el.innerText ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 40);
  }).catch(() => []);
  console.log('   선택지:', JSON.stringify(opts, null, 0));
  if (opts.some((o) => /veo/i.test(o))) { console.log('   ✅ Veo 발견'); break; }
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(1200);
}

console.log('\n  창 유지 5분.');
await new Promise((r) => setTimeout(r, 300_000));
await ctx.close().catch(() => {});
