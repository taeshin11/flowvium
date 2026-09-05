#!/usr/bin/env node
/** 실수로 만들어진 빈 프로젝트를 지운다. 앞선 시도에서 이름 칸을 못 찾아 기본 이름으로
 *  "My Project 58269"(brave-healer-507723-h9)가 생겼다. 아무것도 안 들어 있다.
 *  프로젝트 할당량이 2개뿐이라 남겨 두면 다음에 못 만든다. */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
const PID = process.env.DELETE_PROJECT_ID || 'brave-healer-507723-h9';
const out = [];
const log = (...a) => { out.push(a.join(' ')); writeFileSync(resolve(ROOT, 'logs/gcp-proj-delete.log'), out.join('\n')); console.log(a.join(' ')); };
const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/gcp-profile'), {
  channel: 'chrome', headless: false, viewport: { width: 1500, height: 1000 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
try {
  await page.goto(`https://console.cloud.google.com/iam-admin/settings?project=${PID}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(14000);
  // 지우기 전에 **무엇을 지우는지 확인한다.** 엉뚱한 프로젝트를 지우면 되돌릴 수 없다.
  const t = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
  log(`화면의 프로젝트: ${(t.match(/프로젝트 ID[^A-Za-z0-9]*([a-z0-9-]+)/) ?? [])[1] ?? '?'}`);
  if (!t.includes(PID)) { log(`❌ 화면에 ${PID} 가 없다 — 안전을 위해 중단`); throw new Error('mismatch'); }
  const del = page.locator('button:visible').filter({ hasText: /^\s*종료\s*$|^\s*SHUT DOWN\s*$|프로젝트 삭제/ }).first();
  if (!(await del.count().catch(() => 0))) { log('종료 버튼 없음'); }
  else {
    const b = await del.boundingBox().catch(() => null);
    if (b) await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    log('종료 눌렀다');
    await page.waitForTimeout(4000);
    // 확인 대화상자: 프로젝트 ID 를 타이핑해야 한다
    const inp = page.locator('input:visible').last();
    if (await inp.count().catch(() => 0)) {
      await inp.click({ timeout: 6000 }).catch(() => {});
      await inp.pressSequentially(PID, { delay: 40 }).catch(() => {});
      await page.waitForTimeout(1500);
    }
    const ok = page.locator('button:visible').filter({ hasText: /^\s*종료\s*$|^\s*SHUT DOWN\s*$/ }).last();
    const ob = await ok.boundingBox().catch(() => null);
    if (ob) { await page.mouse.click(ob.x + ob.width / 2, ob.y + ob.height / 2); log('확인 눌렀다'); }
    await page.waitForTimeout(8000);
    const after = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    log(`결과: ${/예약됨|삭제 예정|scheduled|종료 예정/.test(after) ? '✅ 삭제 예약됨' : after.slice(0, 150)}`);
  }
  await page.screenshot({ path: resolve(ROOT, 'logs/gcp-proj-delete.png') }).catch(() => {});
} catch (e) { log(`오류: ${String(e?.message).slice(0, 140)}`); }
writeFileSync(resolve(ROOT, 'logs/gcp-proj-delete.done'), 'x');
await ctx.close().catch(() => {});
