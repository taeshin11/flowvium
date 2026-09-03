#!/usr/bin/env node
/**
 * gcp-cse-setup.mjs — Google Custom Search 키·검색엔진 ID를 받아 온다.
 *
 * 사용자(2026-09-04): "로그인만해줄게 너가해"
 *   로그인 세션은 secrets/gcp-profile 에 남는다. 두 번째 실행부터는 안 물어본다.
 *
 * ⚠ 남의 계정 설정을 만지는 일이다. Flow 자동화에서 좌표 맹목 클릭으로 사용자의 보기 설정을
 *   바꿔 놓은 적이 있다(2026-09-03). 여기서는 **좌표 클릭을 쓰지 않는다.**
 *   찾는 버튼이 없으면 화면 상태를 적고 멈춘다 — 짐작으로 누르지 않는다.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';

const PROFILE = resolve(ROOT, 'secrets/gcp-profile');
const OUT = resolve(ROOT, 'logs/gcp-cse-setup.log');
const lines = [];
const log = (...a) => { const s = a.join(' '); lines.push(s); console.log(' ', s); writeFileSync(OUT, lines.join('\n')); };

mkdirSync(PROFILE, { recursive: true, mode: 0o700 });
const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome', headless: false, viewport: null,
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();

try {
  await page.goto('https://console.cloud.google.com/apis/library/customsearch.googleapis.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  log(`주소: ${page.url().slice(0, 110)}`);
  log(`제목: ${(await page.title().catch(() => '?')).slice(0, 80)}`);

  if (/accounts\.google\.com|ServiceLogin/i.test(page.url())) {
    log('❌ 아직 로그인 화면입니다 — 로그인 후 다시 실행해 주세요');
  } else {
    // 화면에 보이는 주요 버튼을 적는다. 짐작하지 않고 실제 있는 것만 다룬다.
    const btns = await page.locator('button:visible, a[role=button]:visible').allInnerTexts().catch(() => []);
    const uniq = [...new Set(btns.map((b) => b.replace(/\s+/g, ' ').trim()).filter((b) => b && b.length < 40))];
    log(`보이는 버튼 ${uniq.length}개: ${uniq.slice(0, 18).join(' | ')}`);
    const enabled = await page.getByText(/API 사용 설정됨|API enabled|사용 중지|Disable/i).first().count().catch(() => 0);
    log(enabled ? '→ Custom Search API 가 이미 켜져 있는 것으로 보입니다' : '→ 아직 꺼져 있는 것으로 보입니다');
  }
} catch (e) {
  log(`오류: ${String(e?.message).slice(0, 120)}`);
}
log('브라우저는 열어 둡니다.');
await page.waitForTimeout(900000);
