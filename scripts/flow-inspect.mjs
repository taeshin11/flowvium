#!/usr/bin/env node
/**
 * flow-inspect.mjs — Flow 앱 화면의 실제 DOM 을 단계별로 찍는다.
 *
 * 셀렉터를 추측해서 자동화를 쓰면 반드시 깨진다. 이 스크립트의 출력이 flow.mjs 의 근거다.
 * 스크린샷도 같이 남긴다 — DOM 만 봐서는 "무엇이 화면 어디에 있는지" 를 알 수 없다.
 *
 * 사용: node scripts/flow-inspect.mjs [--headless] [--shots <dir>]
 */
import { openFlow, FLOW_URL } from './lib/flow.mjs';
import { mkdirSync } from 'fs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const SHOTS = arg('--shots', null);
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const { ctx, page } = await openFlow({ headless: argv.includes('--headless') });

let step = 0;
const snap = async (label, p = page) => {
  step++;
  const d = await p.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const g = (sel, n = 40) => [...document.querySelectorAll(sel)].filter(vis).slice(0, n).map((el) => {
      const r = el.getBoundingClientRect();
      return {
        t: el.tagName.toLowerCase(),
        x: (el.innerText ?? el.value ?? '').trim().replace(/\s+/g, ' ').slice(0, 46) || null,
        a: el.getAttribute('aria-label'), p: el.getAttribute('placeholder'),
        r: el.getAttribute('role'), i: el.id || null,
        at: `${Math.round(r.x)},${Math.round(r.y)}`,
      };
    });
    return {
      url: location.href, title: document.title,
      btn: g('button,[role=button],a[href*="project"]'),
      inp: g('input:not([type=file]),textarea,[contenteditable=true]'),
      sel: g('select,[role=combobox],[role=listbox],[role=menuitem],[role=option]'),
      file: [...document.querySelectorAll('input[type=file]')].map((e) => ({ accept: e.accept, id: e.id || null })),
    };
  }).catch((e) => ({ error: e.message }));
  console.log(`\n### ${step}. ${label} — ${d.url ?? d.error}`);
  console.log(JSON.stringify(d, null, 1));
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/flow-${step}-${label.replace(/\W+/g, '_')}.png` }).catch(() => {});
  return d;
};

const click = async (label, sels, p = page) => {
  for (const sel of sels) {
    const el = p.locator(sel).first();
    if (await el.count().catch(() => 0)) {
      console.log(`\n>> 클릭 [${label}] ${sel}`);
      await el.click({ timeout: 10_000 }).catch((e) => console.log(`   실패: ${e.message.slice(0, 60)}`));
      await p.waitForTimeout(5000);
      return true;
    }
  }
  console.log(`\n>> 없음 [${label}]`);
  return false;
};

await page.goto(FLOW_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => {});
await page.waitForTimeout(4000);
await click('동의', ['button:has-text("Agree")', 'button:has-text("Accept all")', 'button:has-text("동의")']);
await snap('landing');

await click('앱 진입', [
  'button:has-text("Create with Google Flow")', 'a:has-text("Create with Google Flow")',
  'button:has-text("Try in Google Flow")',
]);
// 새 탭으로 열릴 수 있다.
const p2 = ctx.pages().length > 1 ? ctx.pages()[ctx.pages().length - 1] : page;
if (p2 !== page) { console.log(`\n>> 새 탭: ${p2.url()}`); await p2.waitForTimeout(4000); }
await snap('app', p2);

// 프로젝트 만들기 → 프롬프트 화면
await click('새 프로젝트', [
  'button:has-text("New project")', 'button:has-text("새 프로젝트")',
  'button:has-text("Create")', '[role=button]:has-text("New")',
], p2);
await snap('project', p2);

console.log('\n  창 유지 5분 — 필요하면 직접 클릭해 보세요.');
await new Promise((r) => setTimeout(r, 300_000));
await ctx.close().catch(() => {});
