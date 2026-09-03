#!/usr/bin/env node
/** 새 API 키 생성. 기존 3개는 전부 403 (제약 또는 프로젝트 범위 문제)이라 새로 만든다. */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
const OUT = resolve(ROOT, 'logs/gcp-newkey.log');
const lines = [];
const log = (...a) => { lines.push(a.join(' ')); writeFileSync(OUT, lines.join('\n'), { mode: 0o600 }); };
const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/gcp-profile'), {
  channel: 'chrome', headless: false, viewport: { width: 1440, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
try {
  await page.goto('https://console.cloud.google.com/apis/credentials?project=tagextract', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(9000);
  for (const n of [/^확인$/, /^Accept all$/i]) {
    const b = page.getByRole('button', { name: n }).first();
    if (await b.count().catch(() => 0)) { await b.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(2500); }
  }
  const create = page.getByRole('button', { name: /사용자 인증 정보 만들기|CREATE CREDENTIALS/i }).first();
  if (!(await create.count().catch(() => 0))) { log('❌ 만들기 버튼 없음'); }
  else {
    await create.click({ timeout: 8000 }); await page.waitForTimeout(2500);
    // 메뉴 이름에 설명이 함께 읽힌다("API 키 . 할당량과 액세스…") — 정확일치는 실패한다.
    const item = page.locator('[role=menuitem]:visible').filter({ hasText: /^\s*API 키|^\s*API key/i }).first();
    if (!(await item.count().catch(() => 0))) log(`❌ API 키 메뉴 없음: ${(await page.locator('[role=menuitem]:visible').allInnerTexts().catch(()=>[])).join('|').slice(0,150)}`);
    else {
      await item.click({ timeout: 8000 });
      await page.waitForTimeout(6000);
      // 2026-09-04: 곧바로 키가 나오지 않고 **생성 폼**이 열린다(이름·API 제한·앱 제한).
      //   앱 제한은 기본이 '없음' 이라 그대로 두고 '만들기' 를 누른다.
      //   제한을 임의로 바꾸지 않는다 — 남의 계정 설정이다.
      // 2026-09-04: 이 조직은 키마다 **API 제한 선택이 필수**다("API를 선택해야 합니다").
      //   기존 키 3개가 전부 403 이던 이유이기도 하다 — 다른 API 로 제한돼 있다.
      //   Custom Search API 만 고른다. 다른 API 를 함께 켜지 않는다(권한은 최소로).
      const sel = page.getByRole('combobox').filter({ hasText: /선택된 API가 없습니다|Select APIs|API 제한사항/i }).first();
      if (await sel.count().catch(() => 0)) {
        await sel.click({ timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(2500);
        const opt = page.locator('[role=option]:visible, mat-option:visible').filter({ hasText: /Custom Search API/i }).first();
        if (await opt.count().catch(() => 0)) { await opt.click({ timeout: 8000 }).catch(() => {}); log('Custom Search API 선택'); }
        else log(`❌ 목록에 Custom Search API 없음: ${(await page.locator('[role=option]:visible').allInnerTexts().catch(()=>[])).join('|').slice(0,160)}`);
        // 2026-09-04: Escape 를 누르니 **선택이 취소**됐다(드롭다운이 여전히 '선택된 API가 없습니다').
        //   다중 선택 목록이라 확인 버튼으로 닫아야 반영된다. 없으면 제목을 눌러 닫는다.
        const okBtn = page.getByRole('button', { name: /^\s*(확인|OK|Apply|적용)\s*$/i }).last();
        if (await okBtn.count().catch(() => 0)) { await okBtn.click({ timeout: 6000 }).catch(() => {}); log('선택 확인'); }
        else { await page.getByText('API 키 만들기').first().click({ timeout: 5000 }).catch(() => {}); log('제목 클릭으로 목록 닫음'); }
        await page.waitForTimeout(2500);
        const shown = await sel.innerText().catch(() => '');
        log(`제한 상자 상태: ${shown.replace(/\s+/g, ' ').slice(0, 60)}`);
      } else log('API 제한 선택 상자를 못 찾음');
      const make = page.getByRole('button', { name: /^\s*만들기\s*$|^\s*CREATE\s*$/i }).last();
      if (await make.count().catch(() => 0)) { await make.click({ timeout: 10000 }).catch(() => {}); log('만들기 클릭'); await page.waitForTimeout(12000); }
      else log('만들기 버튼 없음 — 키가 바로 나온 경우일 수 있다');
      const key = await page.evaluate(() => {
        const re = /AIza[0-9A-Za-z_\-]{30,}/;
        const dlg = document.querySelector('[role=dialog]') ?? document.body;
        for (const el of dlg.querySelectorAll('input, textarea')) { const m = String(el.value ?? '').match(re); if (m) return m[0]; }
        const m2 = (dlg.innerText || '').match(re); return m2 ? m2[0] : null;
      }).catch(() => null);
      log(key ? `NEWKEY=${key}` : '❌ 새 키를 못 읽음');
      await page.screenshot({ path: resolve(ROOT, 'logs/gcp-newkey.png') }).catch(() => {});
    }
  }
  log('완료');
} catch (e) { log(`오류: ${String(e?.message).slice(0, 150)}`); }
await page.waitForTimeout(600000);
