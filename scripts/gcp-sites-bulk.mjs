#!/usr/bin/env node
/**
 * 프로그래밍 검색엔진에 사이트를 등록한다.
 *
 * 2026-09-05 두 번의 실패에서 배운 것:
 *   1차 — '추가' 를 도메인마다 눌렀고 로그에 "49개 등록" 이라 적었지만 **하나도 안 들어갔다**.
 *          대화상자가 input 이 아니라 **textarea** ("한 줄에 하나씩") 였는데 선택자가 input 만 봤다.
 *   2차 — textarea 에 49줄을 한 번에 넣었더니 **앞 12개만** 저장됐다. 저장이 순차 처리인데
 *          9초 기다리고 끝냈다. 목록 순서대로 정확히 끊긴 것이 증거다.
 *   그래서 지금은 **작게 나눠 넣고, 넣을 때마다 표에서 실제 개수를 세어 확인**한다.
 *   화면 문구가 아니라 표의 행을 세는 이유: "저장됨" 표시는 저장을 보장하지 않는다.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';

const CX = process.env.GOOGLE_CSE_CX || '91fa62a5516ea4d7a';
const BATCH = Number(process.env.CSE_BATCH || 8);
const LOG = resolve(ROOT, 'logs/gcp-sites-bulk.log');
const out = [];
const log = (...a) => { out.push(a.join(' ')); writeFileSync(LOG, out.join('\n')); console.log(a.join(' ')); };

const cfg = JSON.parse(readFileSync(resolve(ROOT, 'data/cse-sites.json'), 'utf8'));
const want = [...cfg.safe, ...cfg.press];

/** 표에 실제로 남아 있는 사이트 패턴을 페이지를 넘겨가며 센다. */
async function listSites(page) {
  const seen = new Set();
  for (let p = 0; p < 15; p++) {
    const t = await page.locator('body').innerText().catch(() => '');
    for (const m of t.match(/\*?\.?[a-z0-9][a-z0-9.-]*\.(co\.kr|go\.kr|or\.kr|kr|com|org|net)\/\*/g) ?? []) {
      seen.add(m.replace(/^\*\./, '').replace(/\/\*$/, ''));
    }
    const next = page.locator('button:has-text("chevron_right")').first();
    if (await next.isDisabled().catch(() => true)) break;
    await next.click().catch(() => {});
    await page.waitForTimeout(2200);
  }
  // 표를 첫 페이지로 되돌린다 — 다음 확인이 뒷페이지에서 시작하면 안 된다.
  for (let p = 0; p < 15; p++) {
    const prev = page.locator('button:has-text("chevron_left")').first();
    if (await prev.isDisabled().catch(() => true)) break;
    await prev.click().catch(() => {});
    await page.waitForTimeout(1200);
  }
  return seen;
}

const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/gcp-profile'), {
  channel: 'chrome', headless: false, viewport: { width: 1440, height: 1000 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
try {
  await page.goto(`https://programmablesearchengine.google.com/controlpanel/overview?cx=${CX}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(13000);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(2500);

  let have = await listSites(page);
  log(`시작: ${have.size}개 등록돼 있다`);

  for (let round = 0; round < 12; round++) {
    const left = want.filter((d) => !have.has(d));
    if (!left.length) { log('남은 것 없음'); break; }
    const batch = left.slice(0, BATCH);
    log(`\n[${round + 1}회차] 남은 ${left.length}개 중 ${batch.length}개 시도: ${batch.join(', ')}`);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);
    const add = page.locator('button:visible').filter({ hasText: /^\s*추가\s*$|^\s*Add\s*$/ }).first();
    await add.click({ timeout: 10000 });
    await page.waitForTimeout(2500);

    const ta = page.locator('textarea:visible').first();
    if (!(await ta.count().catch(() => 0))) { log('  ❌ textarea 없음 — 중단'); break; }
    await ta.click({ timeout: 6000 }).catch(() => {});
    await ta.fill(batch.map((d) => `*.${d}/*`).join('\n'), { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1000);

    const save = page.locator('button:visible').filter({ hasText: /^\s*저장\s*$|^\s*Save\s*$/ }).last();
    await save.click({ timeout: 10000 }).catch((e) => log(`  저장 클릭 실패: ${String(e.message).slice(0, 40)}`));
    // 순차 저장이 끝날 때까지 넉넉히. 여기를 짧게 잡아 2차 시도가 12개에서 끊겼다.
    await page.waitForTimeout(4000 + batch.length * 2500);

    const now = await listSites(page);
    const added = batch.filter((d) => now.has(d));
    const missed = batch.filter((d) => !now.has(d));
    log(`  → 들어감 ${added.length}/${batch.length}${missed.length ? ` · 안 들어감: ${missed.join(', ')}` : ''}`);
    if (!added.length) {
      // 한 개도 안 들어가면 같은 방식으로 더 눌러봐야 소용없다. 왜인지를 남기고 멈춘다.
      await page.screenshot({ path: resolve(ROOT, 'logs/gcp-sites-stuck.png') }).catch(() => {});
      log('  ❌ 이 회차에 하나도 안 들어갔다 — logs/gcp-sites-stuck.png 확인');
      break;
    }
    have = now;
    log(`  현재 총 ${have.size}개`);
  }

  const final = await listSites(page);
  const missing = want.filter((d) => !final.has(d));
  log(`\n최종 ${final.size}/${want.length}개${missing.length ? ` · 빠짐: ${missing.join(', ')}` : ' — 전부 등록'}`);
} catch (e) {
  log(`오류: ${String(e?.message).slice(0, 160)}`);
}
writeFileSync(resolve(ROOT, 'logs/gcp-sites-bulk.done'), 'x');
await ctx.close().catch(() => {});
