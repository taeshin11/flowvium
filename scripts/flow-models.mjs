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

// 생성 기본값 패널은 상단 기어(설정 보기)가 아니라 **프롬프트 입력창의 슬라이더(tune) 아이콘**이 연다.
//   기어는 "보기 모드"(그리드 크기 등)만 연다 — 실측으로 구분했다.
const tune = page.locator('button:has-text("tune")').first();
if (await tune.count().catch(() => 0)) {
  await tune.click({ timeout: 8000 }).catch((e) => console.log(`tune 실패 ${e.message.slice(0, 50)}`));
} else {
  console.log('  ⚠ tune 아이콘 없음 — 프롬프트 상자를 먼저 눌러 본다');
  await page.locator('[contenteditable=true]:visible, textarea:visible').last().click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.locator('button:has-text("tune")').first().click({ timeout: 8000 }).catch(() => {});
}
await page.waitForTimeout(2500);
await page.screenshot({ path: `${SHOTS}/1-defaults.png` }).catch(() => {});

// 모델 드롭다운은 이름으로 직접 잡는다. 이미지=Nano Banana, 동영상=Omni Flash(기본값).
const known = ['Omni Flash', 'Veo', 'Nano Banana'];
let opened = false;
for (const name of known) {
  const d = page.locator(`button:has-text("${name}")`).last();
  if (!(await d.count().catch(() => 0))) continue;
  const label = (await d.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  console.log(`\n>> 드롭다운 열기: "${label}"`);
  await d.click({ timeout: 8000 }).catch((e) => console.log(`   실패 ${e.message.slice(0, 50)}`));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/2-drop-${name.replace(/\W+/g, '_')}.png` }).catch(() => {});
  const opts = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    return [...document.querySelectorAll('[role=option],[role=menuitem],[role=menuitemradio],li')]
      .filter(vis).map((el) => (el.innerText ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 40);
  }).catch(() => []);
  console.log('   선택지:', JSON.stringify(opts));
  opened = true;
  if (opts.some((o) => /veo/i.test(o))) { console.log('   ✅ Veo 발견'); break; }
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(1200);
}
if (!opened) {
  console.log('\n  ⚠ 모델 드롭다운을 못 찾음 — 패널 전체를 덤프한다');
  const all = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    return [...document.querySelectorAll('button,[role=button]')].filter(vis)
      .map((el) => `${(el.innerText ?? '').replace(/\s+/g, ' ').trim()}|${el.getAttribute('aria-label') ?? ''}`)
      .filter((t) => t !== '|').slice(0, 80);
  }).catch(() => []);
  console.log(JSON.stringify(all, null, 0));
}

console.log('\n  창 유지 5분.');
await new Promise((r) => setTimeout(r, 300_000));
await ctx.close().catch(() => {});
