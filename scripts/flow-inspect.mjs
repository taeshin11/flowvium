#!/usr/bin/env node
/**
 * flow-inspect.mjs — Flow 앱 화면의 실제 DOM 을 단계별로 찍는다.
 *
 * 셀렉터를 추측해서 자동화를 쓰면 반드시 깨진다. 이 스크립트의 출력이 flow.mjs 의 근거다.
 * 사용: node scripts/flow-inspect.mjs [--headless]
 */
import { openFlow, FLOW_URL } from './lib/flow.mjs';

const { ctx, page } = await openFlow({ headless: process.argv.includes('--headless') });

const snap = async (label) => {
  const d = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const g = (sel, n = 30) => [...document.querySelectorAll(sel)].filter(vis).slice(0, n).map((el) => ({
      t: el.tagName.toLowerCase(),
      x: (el.innerText ?? el.value ?? '').trim().replace(/\s+/g, ' ').slice(0, 50) || null,
      a: el.getAttribute('aria-label'), p: el.getAttribute('placeholder'),
      r: el.getAttribute('role'), i: el.id || null,
      d: Object.keys(el.dataset ?? {}).slice(0, 3).join(',') || null,
    }));
    return {
      url: location.href, title: document.title,
      btn: g('button,[role=button]'),
      inp: g('input:not([type=file]),textarea,[contenteditable=true]'),
      sel: g('select,[role=combobox],[role=listbox],[role=menu]'),
      file: [...document.querySelectorAll('input[type=file]')].map((e) => ({ accept: e.accept, id: e.id || null })),
    };
  }).catch((e) => ({ error: e.message }));
  console.log(`\n### ${label} — ${d.url ?? ''}`);
  console.log(JSON.stringify(d, null, 1));
  return d;
};

await page.goto(FLOW_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => {});
await page.waitForTimeout(4000);

// 쿠키/약관 동의가 있으면 치운다 — 이게 떠 있으면 그 아래 UI 를 못 만진다.
for (const t of ['Agree', 'Accept all', '동의', 'I agree']) {
  const b = page.locator(`button:has-text("${t}")`).first();
  if (await b.count().catch(() => 0)) { await b.click({ timeout: 5000 }).catch(() => {}); break; }
}
await page.waitForTimeout(2000);
await snap('1. 랜딩');

// 앱으로 진입
for (const t of ['Create with Google Flow', 'Try in Google Flow', 'New project', 'Go to Flow']) {
  const b = page.locator(`button:has-text("${t}"), a:has-text("${t}")`).first();
  if (await b.count().catch(() => 0)) {
    console.log(`\n>> 클릭: ${t}`);
    await b.click({ timeout: 8000 }).catch((e) => console.log(`   실패 ${e.message.slice(0, 50)}`));
    await page.waitForTimeout(6000);
    break;
  }
}
await snap('2. 진입 후');

// 새 탭이 열렸을 수 있다
const pages = ctx.pages();
if (pages.length > 1) {
  console.log(`\n>> 탭 ${pages.length}개 — 마지막 탭 확인`);
  const p2 = pages[pages.length - 1];
  await p2.waitForTimeout(3000);
  console.log(`   ${p2.url()}`);
}

console.log('\n  창 유지 4분 — 필요하면 직접 클릭해 보세요.');
await new Promise((r) => setTimeout(r, 240_000));
await ctx.close().catch(() => {});
