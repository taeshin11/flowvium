#!/usr/bin/env node
/**
 * suno-make.mjs — Suno 에서 뉴스용 배경음악을 만든다.
 *
 * 왜 (2026-09-06 사용자 "좀 뉴스 스러운 배경음악 돌려쓸수있는거 없니?" → Suno 지정):
 *   지금 쓰는 곡은 MusicGen 으로 만든 것인데 그 모델이 **CC-BY-NC(비상업)** 다.
 *   채널이 수익화되면 그대로 쓸 수 없다. Suno 유료 플랜은 상용 권리가 명확하다.
 *
 * 로그인된 창에 CDP 로 붙는다 — scripts/suno-open.sh 로 먼저 띄운다.
 *   (프로필을 다시 열면 쿠키를 못 읽는다. 2026-09-08 실측.)
 *
 * 사용: node scripts/suno-make.mjs "프롬프트"
 */
import { chromium } from 'playwright';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';

const PROMPT = process.argv.slice(2).join(' ')
  || 'Instrumental news broadcast background bed. Steady mid-tempo pulse, subtle strings and soft synth, '
   + 'no vocals, no melody in the 300-3000Hz voice range, calm and neutral, loops cleanly, 40 seconds.';
const PORT = process.env.SUNO_CDP_PORT || '9333';

let browser;
try {
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
} catch {
  console.error(`❌ :${PORT} 에 크롬이 없다 — 먼저 bash scripts/suno-open.sh`);
  process.exit(1);
}
const ctx = browser.contexts()[0];
const page = ctx.pages()[0] ?? await ctx.newPage();

try {
  await page.setViewportSize({ width: 1440, height: 950 }).catch(() => {});
  await page.goto('https://suno.com/create', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);
  // 쿠키 동의 배너가 입력창을 덮는다(2026-09-08 실측). 먼저 치운다.
  for (const n of [/Accept All Cookies/i, /Reject All/i, /^\s*확인\s*$/]) {
    const b = page.getByRole('button', { name: n }).first();
    if (await b.count().catch(() => 0)) { await b.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(1500); break; }
  }
  const body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
  if (/Log in|Sign up|Join Suno/i.test(body.slice(0, 300))) {
    console.error('❌ 로그인이 풀렸다 — 그 창에서 다시 로그인해 주세요');
    process.exit(1);
  }
  // 가사 없는 곡을 원한다. Instrumental 토글이 있으면 켠다.
  for (const name of [/instrumental/i]) {
    const t = page.getByRole('switch', { name }).first().or(page.getByText(name).first());
    if (await t.count().catch(() => 0)) { await t.click({ timeout: 4000 }).catch(() => {}); break; }
  }
  // textarea 가 여러 개고 숨은 것이 있다 — **보이는 것**을 고른다.
  const box = page.locator('textarea:visible').first();
  await box.waitFor({ timeout: 30000 });
  await box.fill(PROMPT);
  console.log(`  프롬프트 입력: ${PROMPT.slice(0, 60)}…`);
  // 2026-09-08: `getByRole('button', {name:/Create/})` 가 **왼쪽 메뉴의 Create** 를 먼저 집었다.
  //   만드는 버튼은 작성창 아래에 있는 큰 것이다 — 보이는 것 중 마지막을 쓴다.
  const create = page.locator('button:visible').filter({ hasText: /^\s*Create\s*$/ }).last();
  await create.waitFor({ state: 'visible', timeout: 30000 });
  await create.click({ timeout: 15000 });
  console.log('  Create 눌렀다 — 생성에 1~2분 걸린다');
  await page.waitForTimeout(20000);
  await page.screenshot({ path: resolve(ROOT, 'logs/suno-make.png') }).catch(() => {});
  console.log('  화면: logs/suno-make.png');
  // 2026-09-08: 여기서 닫지 않아 **프로세스가 안 끝났다**(CDP 연결이 살아 있으면 node 가 대기한다).
  //   작업은 다 됐는데 25분을 기다렸다 — 붙었으면 반드시 놓아야 한다.
  await browser.close().catch(() => {});
} catch (e) {
  console.error(`오류: ${String(e?.message).slice(0, 160)}`);
  await page.screenshot({ path: resolve(ROOT, 'logs/suno-make.png') }).catch(() => {});
  await browser.close().catch(() => {});
  process.exit(1);
}
