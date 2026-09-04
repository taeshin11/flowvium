#!/usr/bin/env node
/** 브랜딩 3개 링크 입력 + 저장을 한 흐름으로. 새로 열면 입력값이 날아가므로 나누면 안 된다. */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
const OUT = resolve(ROOT, 'logs/gcp-brand-all.log');
const lines = [];
const log = (...a) => { lines.push(a.join(' ')); writeFileSync(OUT, lines.join('\n')); };
const WANT = [
  [/애플리케이션 홈페이지/, 'https://flowvium.net'],
  [/개인정보처리방침/, 'https://flowvium.net/privacy'],
  [/서비스 약관/, 'https://flowvium.net/terms'],
];
const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/gcp-profile'), {
  channel: 'chrome', headless: false, viewport: { width: 1440, height: 1000 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
try {
  await page.goto('https://console.cloud.google.com/auth/branding?project=tagextract', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);
  for (const n of [/^확인$/, /^Accept all$/i]) { const b = page.getByRole('button', { name: n }).first(); if (await b.count().catch(() => 0)) { await b.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(2500); } }
  await page.getByText(/앱 이름|App name/).first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(3000);

  // 앞선 실행에서 **개발자 연락처 이메일 칸**에 flowvium.net 이 잘못 들어갔다.
  //   칩(chip) 형태로 남아 있으면 저장이 계속 막힌다 — 그 칩의 x 를 눌러 지운다.
  {
    const removed = await page.evaluate(() => {
      let n = 0;
      for (const el of document.querySelectorAll('*')) {
        if (el.children.length !== 0) continue;
        if ((el.textContent || '').trim() !== 'flowvium.net') continue;
        const chip = el.closest('[role=button], .mat-mdc-chip, [class*=chip]');
        if (!chip) continue;
        const x = chip.querySelector('button, [role=button] svg, [aria-label*=삭제], [aria-label*=remove]');
        if (x) { x.click(); n++; }
      }
      return n;
    }).catch(() => 0);
    if (removed) { log(`이메일 칸의 잘못된 값 ${removed}개 제거`); await page.waitForTimeout(2000); }
  }

  const inputs = page.locator('input:not([type=hidden]):not([type=file])');
  const n = await inputs.count();
  for (const [rx, url] of WANT) {
    for (let i = 0; i < n; i++) {
      const el = inputs.nth(i);
      const around = await el.evaluate((e) => {
        let p = e, t = ''; for (let up = 0; up < 4 && p; up++) { p = p.parentElement; if (p) t = (p.innerText || '').replace(/\s+/g, ' '); if (t.length > 12) break; } return t;
      }).catch(() => '');
      if (!rx.test(around)) continue;
      const cur = await el.inputValue().catch(() => '');
      if (cur) { log(`= 이미: ${cur.slice(0, 40)}`); break; }
      await el.scrollIntoViewIfNeeded({ timeout: 6000 }).catch(() => {});
      // 2026-09-04: fill() 은 DOM 값만 바꾼다. Angular 가 '변경됨' 으로 인식하지 못해
      //   저장 버튼이 aria-disabled=true 로 남고 저장이 안 됐다(실측).
      //   사람처럼 눌러 입력해 input/change 이벤트를 실제로 발생시킨다.
      await el.click({ timeout: 6000 }).catch(() => {});
      await el.pressSequentially(url, { delay: 15, timeout: 20000 }).catch(() => {});
      await el.press('Tab').catch(() => {});
      await page.waitForTimeout(500);
      const got = await el.inputValue().catch(() => '');
      log(got === url ? `✎ ${around.slice(0, 22)} ← ${url}` : `⚠ 입력 어긋남: "${got.slice(0, 30)}"`);
      break;
    }
  }
  await page.waitForTimeout(1500);

  // 2026-09-04: 세 링크를 넣어도 저장이 회색이었다. 화면에 이유가 있었다 —
  //   "🔴 누락된 도메인: flowvium.net". 링크에 쓴 도메인은 **승인된 도메인**에도 있어야 한다.
  //   ⚠ 처음엔 '마지막 빈 칸' 을 찾아 넣었다가 **개발자 연락처 이메일 칸**에 들어갔다(실측).
  //   빈 칸 순서로 짐작하지 말고, 라벨이 '승인된 도메인' 인 칸만 쓴다.
  {
    const addDom = page.locator('button:visible').filter({ hasText: /도메인 추가|ADD DOMAIN/i }).first();
    if (await addDom.count().catch(() => 0)) {
      await addDom.scrollIntoViewIfNeeded({ timeout: 6000 }).catch(() => {});
      await addDom.click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(2500);
    }
    const all = page.locator('input:not([type=hidden]):not([type=file])');
    const cnt = await all.count();
    let done = false;
    for (let i = 0; i < cnt; i++) {
      const el = all.nth(i);
      const around = await el.evaluate((e) => {
        let p = e, t = ''; for (let up = 0; up < 4 && p; up++) { p = p.parentElement; if (p) t = (p.innerText || '').replace(/\s+/g, ' '); if (t.length > 8) break; } return t;
      }).catch(() => '');
      if (!/승인된 도메인/.test(around)) continue;
      const v = await el.inputValue().catch(() => 'x');
      if (v) { log(`= 승인 도메인 이미: ${v}`); done = true; break; }
      await el.click({ timeout: 5000 }).catch(() => {});
      await el.pressSequentially('flowvium.net', { delay: 20 }).catch(() => {});
      await el.press('Tab').catch(() => {});
      await page.waitForTimeout(800);
      const got = await el.inputValue().catch(() => '');
      log(got === 'flowvium.net' ? '✎ 승인 도메인 ← flowvium.net' : `⚠ 도메인 입력 어긋남: "${got}"`);
      done = true; break;
    }
    if (!done) log('❌ 승인된 도메인 칸을 못 찾음');
    await page.waitForTimeout(1500);
  }

  // 저장 — getByRole 이 못 잡았다(Material). 텍스트가 정확히 '저장' 인 버튼을 DOM 에서 표시해 누른다.
  const marked = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === '저장' && !x.disabled);
    if (!b) return false;
    b.setAttribute('data-fv', 'save');
    b.scrollIntoView({ block: 'center' });
    return true;
  }).catch(() => false);
  if (!marked) log('❌ 활성화된 저장 버튼 없음(변경사항이 없거나 비활성)');
  else {
    await page.waitForTimeout(800);
    // 2026-09-04: Playwright locator 가 이 버튼을 못 잡는다(Angular 재렌더로 속성이 날아간다).
    //   일반 <button> 은 프로그램 클릭이 먹는다 — Material 토글과 달리 포인터 이벤트가 필요 없다.
    const clicked = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === '저장' && !x.disabled);
      if (!b) return false; b.click(); return true;
    }).catch(() => false);
    log(clicked ? '저장 클릭(DOM)' : '❌ 저장 클릭 실패');
    await page.waitForTimeout(4000);
    // 오류 문구·필수 표시를 찾는다. 저장이 막히면 이유가 화면에 있다.
    const errs = await page.evaluate(() => [...document.querySelectorAll('*')]
      .filter((e) => e.children.length === 0 && /필수|입력해야|올바른|유효하지|오류|required|invalid/i.test(e.textContent || ''))
      .map((e) => (e.textContent || '').trim().slice(0, 60)).slice(0, 6)).catch(() => []);
    log(`오류 문구: ${errs.length ? errs.join(' | ') : '(없음)'}`);
    const still = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === '저장');
      return b ? { disabled: b.disabled, aria: b.getAttribute('aria-disabled') } : null;
    }).catch(() => null);
    log(`저장 버튼 상태: ${JSON.stringify(still)}`);
    await page.waitForTimeout(9000);
    const t = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    log(/저장되었|saved|업데이트/i.test(t) ? '✅ 저장됨' : `상태: ${t.slice(0, 140)}`);
  }
  await page.screenshot({ path: resolve(ROOT, 'logs/gcp-brand-all.png') }).catch(() => {});
  log('완료');
} catch (e) { log(`오류: ${String(e?.message).slice(0, 120)}`); }
await page.waitForTimeout(240000);
