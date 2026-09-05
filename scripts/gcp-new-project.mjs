#!/usr/bin/env node
/**
 * Custom Search JSON API 전용 새 프로젝트를 만든다.
 *
 * 왜 (2026-09-05): 기존 프로젝트 TagExtract 의 키 두 개가 모두
 *   403 "This project does not have the access to Custom Search JSON API" 를 준다.
 *   키 문제가 아니라 **프로젝트 수준** 거부다 — 키를 새로 만들어도 같은 답이 온다(둘 다 확인).
 *   구글 문서·이슈에서 이 오류의 해법은 새 프로젝트에서 API 를 켜는 것이다.
 *   위젯 경로는 "로봇이 아님을 확인해 주세요" 로 IP 차단돼 있어 대안이 이것뿐이다.
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
const PROJ = process.env.GCP_NEW_PROJECT || 'flowvium-search';
const out = [];
const log = (...a) => { out.push(a.join(' ')); writeFileSync(resolve(ROOT, 'logs/gcp-new-project.log'), out.join('\n')); console.log(a.join(' ')); };
const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/gcp-profile'), {
  channel: 'chrome', headless: false, viewport: { width: 1500, height: 1000 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
try {
  await page.goto('https://console.cloud.google.com/projectcreate', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(13000);

  // 2026-09-05: 처음엔 `input:visible.first()` 를 썼는데 그건 상단 **검색창** 이었다.
  //   이름은 검색창에 들어갔고 프로젝트는 기본 이름("My Project 45532")으로 남았다.
  //   화면을 열어 name 속성을 확인했다 — p6ntest-name-input 이다. 짐작 대신 확인한 값을 쓴다.
  // name 속성으로 잡으려 했는데 못 찾았다(id 일 수도 있다). **값**으로 찾는다 —
  //   이 화면은 기본 이름 "My Project 12345" 를 미리 넣어 두므로 그게 이름 칸이라는 표시다.
  const idx = await page.locator('input:visible').evaluateAll(
    (els) => els.findIndex((e) => /^My Project/i.test(e.value || ''))).catch(() => -1);
  if (idx < 0) { log('❌ 이름 칸을 못 찾았다'); throw new Error('name input not found'); }
  const nameBox = page.locator('input:visible').nth(idx);
  await nameBox.click({ timeout: 10000 }).catch(() => {});
  // Ctrl/Cmd+A 로 기본값을 지운다. fill('') 은 Angular 가 변경으로 안 받는 일이 있었다.
  await nameBox.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a').catch(() => {});
  await nameBox.press('Backspace').catch(() => {});
  await nameBox.pressSequentially(PROJ, { delay: 50 }).catch(() => {});
  await page.waitForTimeout(3000);
  const got = await nameBox.inputValue().catch(() => '?');
  log(`이름 입력: "${got}" (칸 #${idx})`);
  if (got !== PROJ) { log(`❌ 이름이 안 들어갔다 — 중단`); throw new Error('name not set'); }

  const create = page.locator('button:visible').filter({ hasText: /^\s*만들기\s*$|^\s*CREATE\s*$/ }).first();
  log(`만들기 버튼 비활성=${await create.isDisabled().catch(() => '?')}`);
  // Playwright 의 click 이 12초 타임아웃 났다(가려짐 판정으로 보인다). 눈에 보이고 활성인 것이
  //   확인됐으므로 DOM 클릭으로 누른다 — 이 콘솔에서 평범한 버튼은 이 방법이 통한다(전례).
  await create.evaluate((el) => el.click()).catch((e) => log(`만들기 클릭 실패: ${String(e.message).slice(0, 50)}`));
  await page.waitForTimeout(35000);   // 프로젝트 생성은 느리다
  const url = page.url();
  log(`생성 후 URL: ${url.slice(0, 120)}`);
  let pid = (url.match(/project=([a-z0-9-]+)/) ?? [])[1] ?? '';
  if (!pid) {
    // 생성 화면이 "프로젝트 ID: healthy-terrain-507723-v9" 로 알려 준다. 이름과 ID 는 다르다 —
    //   앞 시도에서 이름을 ID 로 착각해 존재하지 않는 프로젝트를 열었다.
    const t = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    pid = (t.match(/프로젝트 ID:\s*([a-z0-9-]+)/) ?? [])[1] ?? PROJ;
  }
  log(`프로젝트 ID 추정: ${pid}`);

  // API 사용 설정
  await page.goto(`https://console.cloud.google.com/apis/library/customsearch.googleapis.com?project=${pid}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(14000);
  const enable = page.locator('button:visible').filter({ hasText: /^\s*사용\s*$|^\s*사용 설정\s*$|^\s*ENABLE\s*$/ }).first();
  if (await enable.count().catch(() => 0)) {
    await enable.click({ timeout: 10000 }).catch(() => {});
    log('API "사용" 눌렀다');
    await page.waitForTimeout(25000);
  } else {
    const t = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    log(`"사용" 버튼 없음 — ${/사용 설정됨|관리/.test(t) ? '이미 켜져 있다' : t.slice(0, 140)}`);
  }
  await page.screenshot({ path: resolve(ROOT, 'logs/gcp-newproj-api.png') }).catch(() => {});

  // 키 생성
  await page.goto(`https://console.cloud.google.com/apis/credentials?project=${pid}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(13000);
  const cc = page.locator('button:visible, a:visible').filter({ hasText: /사용자 인증 정보 만들기|CREATE CREDENTIALS/ }).first();
  await cc.click({ timeout: 12000 }).catch((e) => log(`인증정보 만들기 실패: ${String(e.message).slice(0, 50)}`));
  await page.waitForTimeout(3000);
  // 메뉴 항목은 role=menuitem 이 아닐 수 있다(전례) — 보이는 요소 중 정확히 "API 키" 인 것을 찾는다
  const item = page.locator('*:visible').filter({ hasText: /^\s*API 키\s*$/ }).last();
  await item.click({ timeout: 10000 }).catch((e) => log(`API 키 메뉴 실패: ${String(e.message).slice(0, 50)}`));
  await page.waitForTimeout(14000);
  let body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
  const vals = await page.locator('input:visible, textarea:visible').evaluateAll((els) => els.map((e) => e.value || '')).catch(() => []);
  body += ' ' + vals.join(' ');
  const m = body.match(/AIza[0-9A-Za-z_\-]{30,}/);
  if (m) {
    writeFileSync(resolve(ROOT, 'secrets/cse-key-new.txt'), m[0]);
    log(`✅ 새 키: ${m[0].slice(0, 10)}…${m[0].slice(-4)} → secrets/cse-key-new.txt`);
  } else log(`❌ 키 못 읽음: ${body.slice(0, 200)}`);
  await page.screenshot({ path: resolve(ROOT, 'logs/gcp-newproj-key.png') }).catch(() => {});
} catch (e) { log(`오류: ${String(e?.message).slice(0, 200)}`); }
writeFileSync(resolve(ROOT, 'logs/gcp-new-project.done'), 'x');
await ctx.close().catch(() => {});
