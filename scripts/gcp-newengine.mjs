#!/usr/bin/env node
/**
 * 새 프로그래밍 검색엔진 생성 — 전체 웹 검색.
 * 2026-09-04: 기존 엔진(Sakgamnono)은 cx 형식은 통과하는데 403 이 난다.
 *   가짜 cx 는 400 인데 이건 403 이므로 **엔진은 존재하되 이 키로 못 쓰는 것**이다
 *   (다른 계정/프로젝트 소유로 보인다). 같은 계정에서 새로 만든다.
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
const OUT = resolve(ROOT, 'logs/gcp-newengine.log');
const lines = [];
const log = (...a) => { lines.push(a.join(' ')); writeFileSync(OUT, lines.join('\n'), { mode: 0o600 }); };
const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/gcp-profile'), {
  channel: 'chrome', headless: false, viewport: { width: 1440, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
try {
  await page.goto('https://programmablesearchengine.google.com/controlpanel/create', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(9000);
  // 이름
  const nameBox = page.locator('input[type=text]:visible').first();
  if (await nameBox.count().catch(() => 0)) { await nameBox.fill('flowvium-news', { timeout: 8000 }).catch(() => {}); log('이름 입력'); }
  else log('❌ 이름 입력창 없음');
  // '전체 웹 검색' 라디오/체크
  const web = page.getByText(/전체 웹 검색|Search the entire web/i).first();
  if (await web.count().catch(() => 0)) { await web.click({ timeout: 8000 }).catch(() => {}); log('전체 웹 검색 선택'); }
  else log('전체 웹 옵션 못 찾음(기본값일 수 있음)');
  await page.waitForTimeout(1500);
  // 버튼 이름이 화면마다 다르다. 보이는 버튼을 적어 두고 그중에서 고른다(짐작으로 좌표를 누르지 않는다).
  const btns = [...new Set((await page.locator('button:visible').allInnerTexts().catch(() => [])).map((b) => b.replace(/\s+/g, ' ').trim()).filter(Boolean))];
  log(`보이는 버튼: ${btns.join(' | ').slice(0, 200)}`);
  const create = page.locator('button:visible').filter({ hasText: /만들기|Create|다음|Next/i }).last();
  if (!(await create.count().catch(() => 0))) log('❌ 만들기 버튼 없음');
  else {
    await create.click({ timeout: 10000 }).catch(() => {});
    log('만들기 클릭');
    await page.waitForTimeout(12000);
    const cx = await page.evaluate(() => {
      const m = document.documentElement.innerHTML.match(/[?&"]cx["=:\s]*["']?([0-9a-zA-Z_:-]{15,})/);
      return m ? m[1] : null;
    }).catch(() => null);
    log(cx ? `NEWCX=${cx}` : '❌ cx 를 못 읽음');
    await page.screenshot({ path: resolve(ROOT, 'logs/gcp-newengine.png') }).catch(() => {});
  }
  log('완료');
} catch (e) { log(`오류: ${String(e?.message).slice(0, 150)}`); }
await page.waitForTimeout(900000);
