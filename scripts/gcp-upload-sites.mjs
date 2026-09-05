#!/usr/bin/env node
/** 사이트 목록을 XML 로 한 번에 올린다.
 *  2026-09-05: '추가' 버튼을 49번 눌렀다고 로그에 남겼는데 실제로는 하나도 저장되지 않았다
 *  (엔진에 www.korea.kr 하나뿐). 한 건씩 누르는 방식은 못 믿는다 — XML 업로드를 쓴다. */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
const CX = '91fa62a5516ea4d7a';
const OUT = resolve(ROOT, 'logs/gcp-upload-sites.log');
const lines = [];
const log = (...a) => { lines.push(a.join(' ')); writeFileSync(OUT, lines.join('\n')); };
const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/gcp-profile'), {
  channel: 'chrome', headless: false, viewport: { width: 1440, height: 1000 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
try {
  await page.goto(`https://programmablesearchengine.google.com/controlpanel/overview?cx=${CX}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(12000);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(2500);
  // "XML 파일로 사이트설정 업로드/다운로드" 영역의 업로드
  const up = page.getByText(/XML 파일로 사이트설정/i).first();
  if (!(await up.count().catch(() => 0))) { log('❌ XML 업로드 항목 없음'); }
  else {
    await up.scrollIntoViewIfNeeded({ timeout: 6000 }).catch(() => {});
    const row = up.locator('xpath=ancestor::*[self::div][1]');
    const btn = row.locator('button:visible').filter({ hasText: /업로드|Upload/i }).first();
    const target = (await btn.count().catch(() => 0)) ? btn : page.locator('button:visible').filter({ hasText: /업로드|Upload/i }).first();
    if (!(await target.count().catch(() => 0))) { log('❌ 업로드 버튼 없음'); }
    else {
      // 파일 선택 대화상자를 가로채 XML 을 넣는다
      const [fc] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 15000 }).catch(() => null),
        target.click({ timeout: 8000 }).catch(() => {}),
      ]);
      if (!fc) {
        const inp = page.locator('input[type=file]').first();
        if (await inp.count().catch(() => 0)) { await inp.setInputFiles('/tmp/cse-sites.xml'); log('파일 입력에 직접 넣음'); }
        else log('❌ 파일 선택창이 안 열림');
      } else { await fc.setFiles('/tmp/cse-sites.xml'); log('XML 선택'); }
      await page.waitForTimeout(9000);
      const t = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
      log(`이후: ${t.slice(0, 200)}`);
    }
  }
  await page.screenshot({ path: resolve(ROOT, 'logs/gcp-upload-sites.png') }).catch(() => {});
  log('완료');
} catch (e) { log(`오류: ${String(e?.message).slice(0, 120)}`); }
await page.waitForTimeout(180000);
