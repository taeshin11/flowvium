#!/usr/bin/env node
/**
 * flow-probe.mjs — Flow 프로젝트 화면의 조작 지점을 하나씩 확인한다.
 *
 * 목적: image-to-video 자동화를 붙이기 전에 (1) 모델 선택 UI, (2) 이미지 첨부, (3) 생성 버튼을
 *   **실제 DOM 으로** 확인한다. 셀렉터를 추측하면 반드시 깨진다.
 * 생성은 하지 않는다 — 크레딧을 쓰기 전에 모델이 Veo 3.1 Lite(0 크레딧)로 잡히는지부터 봐야 한다.
 */
import { openFlow, FLOW_URL, sessionCookiesPresent } from './lib/flow.mjs';
import { mkdirSync } from 'fs';

const SHOTS = process.argv[2] ?? '/tmp/flow-probe';
mkdirSync(SHOTS, { recursive: true });
if (!sessionCookiesPresent()) { console.error('❌ 로그인 세션 없음 — node scripts/flow-login.mjs'); process.exit(1); }

const { ctx, page } = await openFlow({ headless: false });
let step = 0;
const shot = async (label) => { step++; await page.screenshot({ path: `${SHOTS}/${step}-${label}.png` }).catch(() => {}); };

const dump = async (label, root = 'body') => {
  const d = await page.evaluate((sel) => {
    const scope = document.querySelector(sel) ?? document.body;
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const g = (q, n = 60) => [...scope.querySelectorAll(q)].filter(vis).slice(0, n).map((el) => {
      const r = el.getBoundingClientRect();
      return { t: el.tagName.toLowerCase(),
        x: (el.innerText ?? '').trim().replace(/\s+/g, ' ').slice(0, 40) || null,
        a: el.getAttribute('aria-label'), p: el.getAttribute('placeholder') || el.dataset?.placeholder || null,
        r: el.getAttribute('role'), at: `${Math.round(r.x)},${Math.round(r.y)}` };
    });
    return { url: location.href,
      btn: g('button,[role=button],[role=menuitem],[role=option],[role=radio],[role=switch]'),
      inp: g('input:not([type=file]),textarea,[contenteditable=true]'),
      file: [...scope.querySelectorAll('input[type=file]')].map((e) => ({ accept: e.accept })) };
  }, root).catch((e) => ({ error: e.message }));
  console.log(`\n### ${label} — ${d.url ?? d.error}`);
  console.log(' btn:', (d.btn ?? []).map((x) => `${x.x || x.a || x.r}@${x.at}`).join(' | '));
  console.log(' inp:', JSON.stringify(d.inp));
  console.log(' file:', JSON.stringify(d.file));
  return d;
};

await page.goto(FLOW_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => {});
await page.waitForTimeout(3500);
for (const t of ['Agree', '동의', 'Accept all']) {
  const b = page.locator(`button:has-text("${t}")`).first();
  if (await b.count().catch(() => 0)) { await b.click({ timeout: 4000 }).catch(() => {}); break; }
}
// 기존 프로젝트가 있으면 그걸 열고, 없으면 새로 만든다. 매번 새 프로젝트를 만들면 목록이 쓰레기가 된다.
const existing = page.locator('a[href*="/project/"]').first();
if (await existing.count().catch(() => 0)) {
  await existing.click({ timeout: 8000 }).catch(() => {});
} else {
  await page.locator('button:has-text("새 프로젝트"), button:has-text("New project")').first()
    .click({ timeout: 8000 }).catch(() => {});
}
await page.waitForTimeout(6000);
await shot('project'); await dump('프로젝트');

// 프롬프트 상자 주변의 컨트롤(모델 선택이 여기 숨어 있다)
console.log('\n>> 프롬프트 상자 주변 탐색');
const box = page.locator('[contenteditable=true]:visible, textarea:visible').last();
if (await box.count().catch(() => 0)) {
  await box.click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await shot('prompt-focus'); await dump('프롬프트 포커스');
}

// 설정/튜닝 아이콘 후보를 하나씩 눌러 메뉴를 연다
for (const sel of ['button[aria-label*="설정"]', 'button[aria-label*="Settings"]',
                   'button[aria-label*="모델"]', 'button[aria-label*="tune"]',
                   'button:has-text("tune")', 'button:has-text("settings")',
                   'button:has-text("settings_2")', 'button:has-text("더 생성하기")']) {
  const b = page.locator(sel).first();
  if (!(await b.count().catch(() => 0))) continue;
  console.log(`\n>> 클릭 ${sel}`);
  await b.click({ timeout: 6000 }).catch((e) => console.log(`   실패 ${e.message.slice(0, 50)}`));
  await page.waitForTimeout(2500);
  await shot(`menu-${sel.replace(/\W+/g, '_').slice(0, 24)}`);
  const d = await dump(`메뉴 ${sel}`);
  if ((d.btn ?? []).some((x) => /veo/i.test(`${x.x} ${x.a}`))) { console.log('   ✅ Veo 모델 목록 발견'); break; }
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(1000);
}

console.log('\n  창 유지 6분.');
await new Promise((r) => setTimeout(r, 360_000));
await ctx.close().catch(() => {});
