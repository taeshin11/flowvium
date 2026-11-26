#!/usr/bin/env node
/**
 * yt-channel-links.mjs — 채널 프로필 링크 순서를 바꾼다(2026-11-26 사장님 수익 지시 → 3-AI 3/3 안 A).
 *   쇼츠에서 눌리는 곳은 프로필 링크뿐이고 채널 머리엔 첫 링크만 보인다(lib/channel-links.test 머리말).
 *   Studio 는 mini2 가 준 슬롯 안에서만 돈다. youtube-profile 은 고정 댓글 잡과 같이 쓰므로 같은 잠금을 잡는다.
 *   끌어 옮기기 대신 링크 칸의 값을 새 순서대로 다시 쓰고, 다시 읽어 확인한 뒤 게시한다. 주소(UTM)는 그대로다.
 *
 *   node scripts/yt-channel-links.mjs --dry                  지금 링크 순서만 읽는다
 *   node scripts/yt-channel-links.mjs --first aisviagent.com  그 링크를 첫째로
 *   --shots <dir>  화면 저장 위치(기본 logs/channel-links)
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
import { envValue } from './lib/footage.mjs';
import { planLinkFirst } from './lib/channel-links.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const DRY = argv.includes('--dry');
const FIRST = arg('--first', null);
if (!DRY && !FIRST) { console.error('--dry 또는 --first <주소 일부>'); process.exit(2); }
const CHANNEL = envValue('YOUTUBE_CHANNEL_ID');
const SHOTS = resolve(ROOT, arg('--shots', 'logs/channel-links'));
mkdirSync(SHOTS, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const { YT_PROFILE_LOCK } = await import('./lib/site-tour-video.mjs');
const plock = await (await import('./lib/run-lock.mjs')).acquireRunLock(resolve(ROOT, YT_PROFILE_LOCK), { waitMs: 5 * 60_000, pollMs: 10_000, label: 'yt-channel-links' });
if (!plock.ok) { log('유튜브 프로필을 다른 작업이 쓰고 있다 — 이번엔 안 한다'); process.exit(1); }

const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/youtube-profile'), {
  channel: 'chrome', headless: true, viewport: { width: 1280, height: 1600 }, args: ['--disable-blink-features=AutomationControlled'] });
let code = 1;
try {
  if (!(await ctx.cookies('https://www.youtube.com')).some((c) => c.name === 'SID')) throw new Error('youtube-profile 로그아웃 — 사람 로그인 필요');
  const page = ctx.pages()[0] ?? await ctx.newPage();

  // 링크 칸: 값이 http 로 시작하고 youtube.com 이 아닌 입력이 주소 칸, 그 바로 앞 입력이 제목 칸.
  const readRows = () => page.evaluate(() => {
    const ins = [...document.querySelectorAll('input')].filter((x) => x.offsetParent !== null);
    const rows = [];
    ins.forEach((x, i) => {
      if (/^https?:\/\//.test(x.value || '') && !/youtube\.com/.test(x.value) && i > 0) rows.push({ ti: i - 1, ui: i, title: ins[i - 1].value, url: x.value });
    });
    return rows;
  });
  const open = async () => {
    await page.goto(`https://studio.youtube.com/channel/${CHANNEL}/editing/details`, { waitUntil: 'commit', timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(10_000);
  };
  await open();
  const rows = await readRows();
  await page.screenshot({ path: `${SHOTS}/before.png`, fullPage: true }).catch(() => {});
  log('지금 링크 순서:', rows.map((r, i) => `${i + 1}. ${r.title} → ${r.url}`).join(' | ') || '(못 읽음)');
  if (!rows.length) throw new Error('링크 칸을 못 찾았다 — before.png 를 본다');
  if (DRY) { code = 0; throw null; }

  const plan = planLinkFirst(rows, FIRST);
  if (!plan.changed) { log('바꿀 것 없음 —', plan.why); code = plan.why === '이미 첫 링크다' ? 0 : 1; throw null; }

  const write = async (idx, val) => {
    const el = page.locator('input').filter({ visible: true }).nth(idx);
    await el.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
    await el.evaluate((x) => { x.focus(); x.setSelectionRange(0, x.value.length); });
    await page.keyboard.insertText(val);
    await page.waitForTimeout(700);
    const got = await el.inputValue();
    if (got !== val) throw new Error(`칸 ${idx} 반영 안 됨 — 기대 "${val}", 실제 "${got}"`);
  };
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].title !== plan.order[i].title) await write(rows[i].ti, plan.order[i].title);
    if (rows[i].url !== plan.order[i].url) await write(rows[i].ui, plan.order[i].url);
  }
  const mid = await readRows();
  if (mid.map((r) => r.url).join('\n') !== plan.order.map((r) => r.url).join('\n')) throw new Error('게시 전 다시 읽은 순서가 계획과 다르다');

  const pub = page.locator('#publish-button').last();
  await pub.click({ timeout: 8000 });
  let settled = false;
  for (let k = 0; k < 15 && !settled; k++) {
    await page.waitForTimeout(4000);
    settled = await pub.evaluate((n) => n.hasAttribute('disabled') || n.getAttribute('aria-disabled') === 'true').catch(() => false);
  }
  if (!settled) throw new Error('게시 버튼이 계속 활성 — 반영 안 됐을 수 있다');

  await open();
  const after = await readRows();
  await page.screenshot({ path: `${SHOTS}/after.png`, fullPage: true }).catch(() => {});
  log('게시 뒤 다시 읽은 순서:', after.map((r, i) => `${i + 1}. ${r.title} → ${r.url}`).join(' | '));
  code = after[0]?.url === plan.order[0].url && after.length === plan.order.length ? 0 : 1;
  log(code === 0 ? '✅ 첫 링크 바뀜' : '❌ 다시 읽은 순서가 다르다');
} catch (e) {
  if (e) log('❌', String(e.message ?? e).slice(0, 160));
} finally {
  await ctx.close().catch(() => {});
  plock.release();
}
process.exit(code);
