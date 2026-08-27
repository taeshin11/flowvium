#!/usr/bin/env node
/**
 * flow-login.mjs — Google Flow 전용 프로필에 **최초 1회** 로그인한다.
 *
 * 창이 뜨면 사람이 구글 계정으로 로그인하면 된다. 세션은 secrets/flow-profile 에 남아
 *   이후 실행에서 재사용된다. 브라우저를 닫거나 로그인이 확인되면 종료한다.
 *
 * 사용: node scripts/flow-login.mjs [--inspect]
 *   --inspect: 로그인 후 화면의 주요 컨트롤을 덤프한다(셀렉터 작성용).
 */
import { openFlow, isSignedIn, enterApp, FLOW_URL, PROFILE_DIR } from './lib/flow.mjs';

const INSPECT = process.argv.includes('--inspect');
const { ctx, page } = await openFlow({ headless: false });

console.log(`  프로필: ${PROFILE_DIR}`);
console.log(`  이동: ${FLOW_URL}`);
await page.goto(FLOW_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 }).catch((e) => {
  console.log(`  ⚠ 첫 이동 실패(${e.message.slice(0, 60)}) — 창에서 직접 열어도 된다`);
});

// 랜딩에 머물러 있으면 로그인 관문으로 밀어 넣는다 — 어디를 눌러야 할지 찾게 두지 않는다.
console.log(`  진입 시도… → ${await enterApp(page)}`);

console.log('\n  👉 열린 창에서 구글 계정으로 로그인하세요. (Flow 를 쓸 계정으로)');
console.log('     로그인이 확인되면 자동으로 다음 단계를 안내합니다.\n');

const DEADLINE = Date.now() + 10 * 60 * 1000;
let signed = false;
while (Date.now() < DEADLINE) {
  if (ctx.pages().length === 0) { console.log('  창이 닫혔습니다.'); break; }
  try { signed = await isSignedIn(page); } catch { /* 페이지 전환 중 */ }
  if (signed) break;
  // 로그인을 마치면 랜딩으로 되돌아오는 경우가 있다 — 그때 다시 앱으로 밀어 넣는다.
  if (/labs\.google\/fx\/tools\/flow\/?$/.test(page.url())) await enterApp(page).catch(() => {});
  // 구글이 자동화 브라우저를 막는 경우가 있다. 조용히 기다리지 말고 즉시 알린다.
  const blocked = await page.locator('text=/browser or app may not be secure|보안 수준이 낮은|Couldn.t sign you in/i')
    .count().catch(() => 0);
  if (blocked) {
    console.log('  ⚠ 구글이 이 브라우저를 막고 있습니다("보안 수준이 낮은 브라우저").');
    console.log('     → 이 경로는 포기하고 다른 방법을 써야 합니다. 창을 닫으세요.');
    break;
  }
  await page.waitForTimeout(2000);
}

if (!signed) {
  console.log('❌ 로그인 확인 안 됨 (10분 대기 종료)');
  await ctx.close().catch(() => {});
  process.exit(1);
}

console.log(`✅ 로그인 확인 — ${page.url()}`);

if (INSPECT) {
  // 셀렉터를 추측하지 않기 위해 실제 DOM 을 찍는다. 이 출력이 자동화 코드의 근거가 된다.
  const dump = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const grab = (sel) => [...document.querySelectorAll(sel)].filter(vis).slice(0, 40).map((el) => ({
      tag: el.tagName.toLowerCase(),
      text: (el.innerText ?? el.value ?? '').trim().slice(0, 60),
      aria: el.getAttribute('aria-label'),
      ph: el.getAttribute('placeholder'),
      role: el.getAttribute('role'),
      id: el.id || null,
      cls: (el.className && typeof el.className === 'string' ? el.className.slice(0, 60) : null),
    }));
    return {
      url: location.href,
      title: document.title,
      buttons: grab('button, [role="button"]'),
      inputs: grab('input, textarea, [contenteditable="true"]'),
      selects: grab('select, [role="combobox"], [role="listbox"]'),
      fileInputs: [...document.querySelectorAll('input[type=file]')].map((el) => ({
        accept: el.accept, hidden: !vis(el), id: el.id || null,
      })),
    };
  }).catch((e) => ({ error: e.message }));
  console.log('\n=== FLOW DOM ===');
  console.log(JSON.stringify(dump, null, 1));
}

console.log('\n  창은 열어둡니다. 확인이 끝나면 창을 닫으세요.');
await new Promise((r) => setTimeout(r, 5 * 60 * 1000));
await ctx.close().catch(() => {});
