#!/usr/bin/env node
/**
 * 검색엔진에 도메인을 등록한다.
 *
 * 2026-09-04: 구글이 '전체 웹 검색' 을 2026-03 에 폐지했다(2027-01-01 완전 종료).
 *   새 엔진은 사이트를 최소 하나 요구하고, 고유 도메인 50개까지만 넣을 수 있다.
 *   그래서 "전체 웹" 대신 **어디를 볼지 우리가 고른다** — data/cse-sites.json.
 *   사용자 선택은 '섞기': 정부·지자체·안전한 이미지 소스 + 주요 언론.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
const CX = process.env.GOOGLE_CSE_CX || '91fa62a5516ea4d7a';
const OUT = resolve(ROOT, 'logs/gcp-addsites.log');
const lines = [];
const log = (...a) => { lines.push(a.join(' ')); writeFileSync(OUT, lines.join('\n')); };
const cfg = JSON.parse(readFileSync(resolve(ROOT, 'data/cse-sites.json'), 'utf8'));
const all = [...cfg.safe, ...cfg.press];

const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/gcp-profile'), {
  channel: 'chrome', headless: false, viewport: { width: 1440, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
try {
  await page.goto(`https://programmablesearchengine.google.com/controlpanel/overview?cx=${CX}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(9000);
  // 사이트 목록은 페이지 아래쪽에 있다 — 스크롤해야 '추가' 가 보인다(실측).
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(2500);

  // 이미 등록된 도메인을 화면에서 읽는다. 앞선 실행이 중간에 끊겨도 이어서 할 수 있어야 한다.
  //   (2026-09-04: 10개 넣고 브라우저가 닫혔다)
  let body0 = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
  for (let pageNo = 0; pageNo < 6; pageNo++) {
    const next = page.locator('button:visible').filter({ hasText: /chevron_right/ }).first();
    if (!(await next.count().catch(() => 0))) break;
    const dis = await next.isDisabled().catch(() => true);
    if (dis) break;
    await next.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1500);
    body0 += ' ' + (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
  }
  log(`이미 등록된 것으로 보이는 도메인: ${all.filter((d) => body0.includes(d)).length}개`);
  let added = 0, skipped = 0, failed = 0;
  for (const d of all) {
    if (body0.includes(d)) { skipped++; continue; }
    const addBtn = page.locator('button:visible').filter({ hasText: /^\s*추가\s*$|^\s*Add\s*$/i }).first();
    if (!(await addBtn.count().catch(() => 0))) { log(`❌ '추가' 버튼 없음 (${added}개 등록 후)`); break; }
    await addBtn.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1800);
    // 대화상자의 입력창에 도메인을 넣는다
    const box = page.locator('[role=dialog] input:visible, input:visible').last();
    if (!(await box.count().catch(() => 0))) { log(`❌ 입력창 없음 (${d})`); failed++; break; }
    await box.fill(`*.${d}/*`).catch(() => {});
    await page.waitForTimeout(600);
    const ok = page.locator('[role=dialog] button:visible, button:visible')
      .filter({ hasText: /^\s*(추가|저장|Add|Save)\s*$/i }).last();
    await ok.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1600);
    added++;
    if (added % 10 === 0) log(`  …${added}개`);
  }
  log(`등록 ${added} · 건너뜀 ${skipped} · 실패 ${failed}`);
  await page.screenshot({ path: resolve(ROOT, 'logs/gcp-addsites.png') }).catch(() => {});
  log('완료');
} catch (e) { log(`오류: ${String(e?.message).slice(0, 150)}`); }
await page.waitForTimeout(900000);
