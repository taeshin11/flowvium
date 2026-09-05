#!/usr/bin/env node
/** flowvium-search 프로젝트에서 Custom Search API 를 켜고 키를 만든다.
 *  기존 TagExtract 의 키 두 개는 프로젝트 수준 403 이라 쓸 수 없다(둘 다 확인). */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
const PID = process.env.GCP_PROJECT_ID || 'flowvium-search';
const out = [];
const log = (...a) => { out.push(a.join(' ')); writeFileSync(resolve(ROOT, 'logs/gcp-key-in-proj.log'), out.join('\n')); console.log(a.join(' ')); };
const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/gcp-profile'), {
  channel: 'chrome', headless: false, viewport: { width: 1500, height: 1000 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
try {
  await page.goto(`https://console.cloud.google.com/apis/library/customsearch.googleapis.com?project=${PID}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(15000);
  let t = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
  log(`API 화면: ${/사용 설정됨|관리/.test(t) ? '이미 켜짐' : '꺼짐'}`);
  const enable = page.locator('button:visible').filter({ hasText: /^\s*사용\s*$|^\s*사용 설정\s*$|^\s*ENABLE\s*$/ }).first();
  if (await enable.count().catch(() => 0)) {
    // Playwright click 이 이 콘솔에서 자주 타임아웃 난다 — 보이고 활성이면 DOM 클릭이 통한다.
    await enable.evaluate((el) => el.click()).catch((e) => log(`  사용 클릭 실패: ${String(e.message).slice(0, 50)}`));
    log('  "사용" 눌렀다 — 반영을 기다린다');
    await page.waitForTimeout(30000);
    t = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    log(`  이후: ${/사용 설정됨|관리|사용 중지/.test(t) ? '✅ 켜짐' : '아직 안 켜짐'}`);
  }
  await page.screenshot({ path: resolve(ROOT, 'logs/gcp-proj-api.png') }).catch(() => {});

  await page.goto(`https://console.cloud.google.com/apis/credentials?project=${PID}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(14000);
  const cc = page.locator('button:visible, a:visible').filter({ hasText: /사용자 인증 정보 만들기|CREATE CREDENTIALS/ }).first();
  await cc.evaluate((el) => el.click()).catch((e) => log(`인증정보 만들기 실패: ${String(e.message).slice(0, 50)}`));
  await page.waitForTimeout(3500);
  // 메뉴 항목: role=menuitem 이 아닐 수 있다. 정확히 "API 키" 인 가장 안쪽 요소를 누른다.
  const hit = await page.evaluate(() => {
    const els = [...document.querySelectorAll('*')].filter((e) => {
      const tx = (e.innerText || '').trim();
      if (tx !== 'API 키' && tx !== 'API key') return false;
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && e.children.length === 0;
    });
    if (!els.length) return false;
    (els[els.length - 1].closest('[role=menuitem]') ?? els[els.length - 1]).click();
    return true;
  }).catch(() => false);
  log(`API 키 메뉴 클릭: ${hit}`);
  await page.waitForTimeout(6000);
  // 이 콘솔은 키를 바로 발급하지 않고 "API 키 만들기" 패널을 연다(화면으로 확인).
  //   기본값(제한 없음)으로 두고 만들기만 누르면 된다 — 제한은 발급 뒤에 걸 수 있다.
  // 이 프로젝트는 "API 제한사항 선택" 이 필수다 — 비워 두면 "API를 선택해야 합니다" 로 막힌다
  //   (그냥 만들기를 눌렀다가 이 오류를 봤다). Custom Search API 를 골라 준다.
  // 2026-09-05: `.first()` 로 잡았더니 상단 **검색창**(474,14)을 눌렀다.
  //   "API 키 만들기" 패널은 화면 오른쪽(x>900)에 열린다 — 그 안의 것만 본다.
  //   이 콘솔에서는 선택자보다 **화면 위치**가 믿을 만하다(같은 착오를 여러 번 했다).
  const ddAll = page.locator('mat-select:visible, [role=combobox]:visible');
  let dd = null;
  for (let k = 0; k < await ddAll.count(); k++) {
    const b = await ddAll.nth(k).boundingBox().catch(() => null);
    if (b && b.x > 900 && b.y > 100) { dd = ddAll.nth(k); log(`  패널 드롭다운 #${k} (${Math.round(b.x)},${Math.round(b.y)})`); break; }
  }
  if (dd) {
    // Material 의 select 는 **DOM click 을 무시한다**(이 콘솔의 토글에서 이미 겪었다).
    //   실제 마우스 이벤트가 필요하므로 Playwright 의 click 을 쓴다.
    // Playwright 의 click 도 타임아웃 났다 — 이 콘솔은 actionability 검사를 계속 실패시킨다.
    //   요소 위치를 재서 **실제 마우스**로 누른다. 눈에 보이는 자리를 그대로 클릭하는 셈이다.
    const bb = await dd.boundingBox().catch(() => null);
    if (bb) {
      await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
      log(`  드롭다운 좌표 클릭 (${Math.round(bb.x)},${Math.round(bb.y)})`);
    } else log('  드롭다운 위치를 못 쟀다');
    await page.waitForTimeout(5000);
    const opts = await page.locator('mat-option:visible, [role=option]:visible').evaluateAll(
      (els) => els.map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean)).catch(() => []);
    log(`  선택지 ${opts.length}개: ${opts.slice(0, 8).join(' | ')}`);
    const target = page.locator('mat-option:visible, [role=option]:visible')
      .filter({ hasText: /Custom Search API/i }).first();
    if (await target.count().catch(() => 0)) {
      // 좌표로 눌렀더니 선택이 안 됐다 — 23개짜리 목록이라 항목이 스크롤 밖에 있었다.
      //   먼저 보이게 스크롤한 뒤 좌표를 다시 잰다.
      await target.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(1200);
      const tb = await target.boundingBox().catch(() => null);
      if (tb) {
        await page.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2);
        log(`  Custom Search API 클릭 (${Math.round(tb.x)},${Math.round(tb.y)})`);
      }
      await page.waitForTimeout(2000);
      // 정말 골라졌는가 — 화면 문구로 확인한다. "선택된 API가 없습니다" 면 실패다.
      const sel = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
      if (/선택된 API가 없습니다/.test(sel)) {
        log('  좌표 클릭이 안 먹었다 — 키보드로 고른다');
        // Material select 는 타이핑하면 해당 항목으로 이동한다. Enter 로 확정.
        await page.keyboard.type('Custom Search', { delay: 90 });
        await page.waitForTimeout(1500);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1800);
      }
    } else log('  ❌ 목록에 Custom Search API 가 없다');
    await page.waitForTimeout(1500);
    // 2026-09-05: "패널 안 빈 곳" 이라며 (1200,660) 을 눌렀는데 그 자리가 목록의 다른 항목이라
    //   Google Cloud Storage JSON API 까지 체크됐다. 목록은 여전히 열려 만들기 버튼을 가렸다.
    //   이 목록은 **여러 개를 고르는 형태**고 아래에 "확인" 이 있다 — 그걸 누르는 게 맞다.
    //   내가 잘못 넣은 항목이 있으면 먼저 뺀다. 필요 없는 권한을 키에 붙이지 않는다.
    const extra = page.locator('[role=option]:visible, mat-option:visible')
      .filter({ hasText: /Google Cloud Storage JSON API/i }).first();
    if (await extra.count().catch(() => 0)) {
      const checked = await extra.evaluate((el) =>
        el.getAttribute('aria-selected') === 'true' || !!el.querySelector('input:checked, .mat-checkbox-checked')
        || /true/.test(el.getAttribute('aria-checked') || '')).catch(() => false);
      if (checked) {
        const eb = await extra.boundingBox().catch(() => null);
        if (eb) { await page.mouse.click(eb.x + eb.width / 2, eb.y + eb.height / 2); log('  잘못 체크된 Storage JSON API 해제'); }
        await page.waitForTimeout(1200);
      }
    }
    const okBtn = page.locator('button:visible').filter({ hasText: /^\s*확인\s*$|^\s*OK\s*$/ }).last();
    if (await okBtn.count().catch(() => 0)) {
      const ob = await okBtn.boundingBox().catch(() => null);
      if (ob) { await page.mouse.click(ob.x + ob.width / 2, ob.y + ob.height / 2); log('  목록의 "확인" 눌렀다'); }
    } else log('  "확인" 버튼 없음');
    await page.waitForTimeout(3000);
    const after = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    log(`  선택 결과: ${/선택된 API가 없습니다/.test(after) ? '❌ 아직 없음' : '✅ 선택됨'}`);
  }
  const mkAll = page.locator('button:visible').filter({ hasText: /^\s*만들기\s*$|^\s*CREATE\s*$/ });
  let mk = null;
  for (let k = 0; k < await mkAll.count(); k++) {
    const b = await mkAll.nth(k).boundingBox().catch(() => null);
    if (b && b.x > 900) { mk = mkAll.nth(k); break; }
  }
  if (mk) {
    await page.screenshot({ path: resolve(ROOT, 'logs/gcp-before-create.png') }).catch(() => {});
    const mb = await mk.boundingBox().catch(() => null);
    log(`  만들기 위치=${mb ? `${Math.round(mb.x)},${Math.round(mb.y)} ${Math.round(mb.width)}x${Math.round(mb.height)}` : '없음'} 비활성=${await mk.isDisabled().catch(() => '?')}`);
    if (mb) {
      // 클릭이 확실히 닿도록 이동 후 누른다. 한 번에 안 되면 DOM 클릭으로 한 번 더.
      await page.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2);
      await page.waitForTimeout(400);
      await page.mouse.click(mb.x + mb.width / 2, mb.y + mb.height / 2);
      log('  "만들기" 좌표 클릭');
      await page.waitForTimeout(6000);
      const still = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
      if (/API 키 만들기/.test(still) && !/AIza/.test(still)) {
        log('  패널이 그대로다 — DOM 클릭으로 한 번 더');
        await mk.evaluate((el) => el.click()).catch(() => {});
        await page.waitForTimeout(6000);
      }
    }
  } else log('  만들기 버튼 없음');
  await page.waitForTimeout(20000);
  let body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
  const vals = await page.locator('input:visible, textarea:visible').evaluateAll((els) => els.map((e) => e.value || '')).catch(() => []);
  body += ' ' + vals.join(' ');
  const m = body.match(/AIza[0-9A-Za-z_\-]{30,}/);
  if (m) { writeFileSync(resolve(ROOT, 'secrets/cse-key-new.txt'), m[0]); log(`✅ 새 키: ${m[0].slice(0, 10)}…${m[0].slice(-4)}`); }
  else log(`❌ 키 못 읽음: ${body.slice(0, 220)}`);
  await page.screenshot({ path: resolve(ROOT, 'logs/gcp-proj-key.png') }).catch(() => {});
} catch (e) { log(`오류: ${String(e?.message).slice(0, 160)}`); }
writeFileSync(resolve(ROOT, 'logs/gcp-key-in-proj.done'), 'x');
await ctx.close().catch(() => {});
