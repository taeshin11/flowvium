#!/usr/bin/env node
/**
 * naver-login.mjs — 네이버 블로그 자동 게시용 **전용 크롬 프로필**에 사장님이 1회 로그인한다. 2026-10-26 신설.
 *
 * 왜: 사장님 10/26 "taeshin11@naver.com 으로 로그인하면 주식 관련 blog … AI주식분석 메뉴 하나 만들어서 … 하루 한번 올려라"
 *   → 네이버는 글쓰기 API 가 없다(2020-05 종료). 약관상 자동 게재는 제재 위험 — 사장님이 '완전 자동(제재 위험 감수)' 을 골랐다.
 *   기본 크롬 세션은 자동화가 빌려 쓸 수 없다(쿠키 앱 결속 암호화) → 계정 전용 프로필 secrets/naver-profile.
 * 로그인은 사람이 한다(비밀번호·2단계는 코드가 만지지 않는다). 이 스크립트는 창을 띄우고 로그인 쿠키가 생기길 기다렸다가
 *   내 블로그 주소(아이디)를 secrets/naver-blog.json 에 적고 창을 닫는다.
 *
 * 사용: node scripts/naver-login.mjs [--wait-min 30]
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { ROOT } from './lib/project-root.mjs';

const PROFILE = join(ROOT, 'secrets/naver-profile');
const OUT = join(ROOT, 'secrets/naver-blog.json');
const i = process.argv.indexOf('--wait-min');
const WAIT_MS = (i > 0 ? Number(process.argv[i + 1]) : 30) * 60_000;
const log = (...a) => console.log(new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 19), '[naver-login]', ...a);
mkdirSync(PROFILE, { recursive: true });

const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1200, height: 860 }, locale: 'ko-KR', channel: 'chrome' })
  .catch(() => chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1200, height: 860 }, locale: 'ko-KR' }));
const page = ctx.pages()[0] ?? await ctx.newPage();
const loggedIn = async () => (await ctx.cookies('https://naver.com')).some((c) => c.name === 'NID_AUT');
if (!(await loggedIn())) {
  await page.goto('https://nid.naver.com/nidlogin.login?url=https%3A%2F%2Fblog.naver.com%2FMyBlog.naver');
  log('로그인 창을 띄웠다 — 사람이 로그인할 때까지 기다린다');
  const t0 = Date.now();
  while (!(await loggedIn())) {
    if (Date.now() - t0 > WAIT_MS) { log('❌ 시간 안에 로그인되지 않았다'); await ctx.close(); process.exit(1); }
    await new Promise((r) => setTimeout(r, 3000));
  }
}
log('로그인 확인');
await page.goto('https://blog.naver.com/MyBlog.naver', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
const m = /blog\.naver\.com\/([A-Za-z0-9_-]+)/.exec(page.url());
const blogId = m && !/MyBlog/i.test(m[1]) ? m[1] : null;
writeFileSync(OUT, JSON.stringify({ blogId, at: new Date().toISOString() }, null, 2));
log(blogId ? `블로그 아이디 ${blogId} → ${OUT}` : `⚠ 블로그 주소를 못 읽었다(${page.url().replace(/[?#].*/, '')})`);
await ctx.close();
