#!/usr/bin/env node
/**
 * Custom Search JSON API 키를 만든다.
 *
 * 왜 (2026-09-05): cse.js 위젯이 "로봇이 아님을 확인해 주세요" 로 막혔다. 헤드리스도, 실제
 *   크롬 + 영속 프로필도 똑같이 막힌다 — IP 단위 차단이라 브라우저를 바꿔서 될 일이 아니다.
 *   JSON API 는 키로 인증하므로 봇 확인 자체가 없다. 예전에 403 을 봤다는 기록이 있지만
 *   지금 .env.local 에 키가 아예 없다 — 확인되지 않은 기억으로 포기하지 않고 실제로 만들어 본다.
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
const out = [];
const log = (...a) => { out.push(a.join(' ')); writeFileSync(resolve(ROOT, 'logs/gcp-make-key.log'), out.join('\n')); console.log(a.join(' ')); };
const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/gcp-profile'), {
  channel: 'chrome', headless: false, viewport: { width: 1500, height: 1000 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
try {
  // 1) Custom Search API 사용 설정 페이지
  await page.goto('https://console.cloud.google.com/apis/library/customsearch.googleapis.com', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(12000);
  const t = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
  log(`API 페이지: ${/사용 설정됨|API enabled|사용 중지/.test(t) ? '이미 사용 설정됨' : '미설정으로 보임'}`);
  log(`  프로젝트 표시: ${(t.match(/프로젝트[^·|]{0,40}/) ?? [''])[0].slice(0, 60)}`);
  const enable = page.locator('button:visible').filter({ hasText: /^\s*(사용|사용 설정|Enable)\s*$/ }).first();
  if (await enable.count().catch(() => 0)) {
    await enable.click({ timeout: 8000 }).catch(() => {});
    log('  "사용" 눌렀다');
    await page.waitForTimeout(15000);
  }
  await page.screenshot({ path: resolve(ROOT, 'logs/gcp-api-lib.png') }).catch(() => {});

  // 2) 사용자 인증 정보 → API 키 만들기
  await page.goto('https://console.cloud.google.com/apis/credentials', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(12000);
  const create = page.locator('button:visible, a:visible').filter({ hasText: /사용자 인증 정보 만들기|CREATE CREDENTIALS/ }).first();
  if (!(await create.count().catch(() => 0))) { log('❌ "사용자 인증 정보 만들기" 없음'); }
  else {
    await create.click({ timeout: 10000 });
    await page.waitForTimeout(2500);
    const apiKey = page.locator('[role=menuitem]:visible, li:visible').filter({ hasText: /^\s*API 키\s*$|^\s*API key\s*$/ }).first();
    await apiKey.click({ timeout: 8000 }).catch((e) => log(`  메뉴 클릭 실패: ${String(e.message).slice(0, 50)}`));
    await page.waitForTimeout(12000);
    const body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    const m = body.match(/AIza[0-9A-Za-z_\-]{30,}/);
    if (m) {
      log(`✅ 키 발급: ${m[0].slice(0, 10)}…${m[0].slice(-4)} (길이 ${m[0].length})`);
      writeFileSync(resolve(ROOT, 'secrets/cse-key.txt'), m[0]);
      log('   secrets/cse-key.txt 에 저장');
    } else {
      log(`❌ 키를 화면에서 못 찾음. 본문: ${body.slice(0, 200)}`);
    }
  }
  await page.screenshot({ path: resolve(ROOT, 'logs/gcp-key.png') }).catch(() => {});
} catch (e) { log(`오류: ${String(e?.message).slice(0, 160)}`); }
writeFileSync(resolve(ROOT, 'logs/gcp-make-key.done'), 'x');
await ctx.close().catch(() => {});
