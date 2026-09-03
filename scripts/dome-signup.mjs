#!/usr/bin/env node
/**
 * dome-signup.mjs — Dome API 대시보드를 열어 무료 키 발급까지 간다.
 *
 * 왜 자동화가 아니라 *보이는* 브라우저인가:
 *   dashboard.domeapi.io 는 Cloudflare 봇 검증(403 "Just a moment")이 걸려 있어 curl 로는 못 뚫는다.
 *   그리고 가입은 사람의 계정을 만드는 일이다 — 약관 동의·이메일 인증·OAuth 가 낀다.
 *   그래서 headless 를 쓰지 않는다. 창을 띄워 두고, 자동으로 갈 수 있는 데까지 가고,
 *   사람이 눌러야 하는 지점에서 멈춰 무엇을 눌러야 하는지 알린다.
 *   youtube-studio.mjs 와 같은 방식(persistent context + channel:'chrome')이라
 *   이미 로그인된 구글 세션이 있으면 OAuth 가 그대로 통과한다.
 *
 * 프로필은 secrets/ 아래에 둔다(.gitignore:120 확인함) — 쿠키·세션이 저장소에 들어가면 안 된다.
 *
 * 사용:
 *   node scripts/dome-signup.mjs            # 창 띄우고 상태 보고, 사람 조작 대기
 *   node scripts/dome-signup.mjs --close    # 확인만 하고 바로 닫기
 */
import { chromium } from 'playwright';
import { resolve } from 'path';
import { mkdirSync, existsSync, readFileSync, appendFileSync } from 'fs';
import { ROOT } from './lib/project-root.mjs';

const PROFILE = resolve(ROOT, 'secrets/dome-profile');
const ENV_LOCAL = resolve(ROOT, '.env.local');
const CLOSE = process.argv.includes('--close');
const log = (m) => console.log(`[dome] ${m}`);

mkdirSync(PROFILE, { recursive: true });

// 이미 키가 있으면 굳이 창을 띄우지 않는다.
if (existsSync(ENV_LOCAL) && /^DOME_API_KEY=\S+/m.test(readFileSync(ENV_LOCAL, 'utf8'))) {
  log('.env.local 에 DOME_API_KEY 가 이미 있다 — 창을 띄우지 않는다.');
  log('교체하려면 그 줄을 지우고 다시 실행하라.');
  process.exit(0);
}

log('크롬 창을 띄운다 (headless 아님 — 직접 보시면서 진행하시면 됩니다)');
const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome', headless: false, viewport: null,
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();

try {
  await page.goto('https://accounts.domeapi.io/sign-up', { waitUntil: 'domcontentloaded', timeout: 60_000 });
} catch (e) {
  log(`이동 실패: ${String(e.message).slice(0, 120)}`);
}

// Cloudflare 검증은 몇 초 걸린다. 통과를 기다리되 무한정 붙잡지 않는다.
for (let i = 0; i < 20; i++) {
  const t = await page.title().catch(() => '');
  if (!/just a moment|attention required|잠시만/i.test(t)) break;
  if (i === 0) log('Cloudflare 검증 통과 대기…');
  await page.waitForTimeout(1500);
}

// SPA 다 — 폼이 그려질 때까지 기다린다. 종전엔 렌더 전에 읽어 버튼 0개로 보고했다.
await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
await page.waitForSelector('button, input, form', { timeout: 20_000 }).catch(() => {});
await page.waitForTimeout(1500);

const title = await page.title().catch(() => '(제목 없음)');
const url = page.url();
log(`현재: ${title}  ${url}`);

// 화면에 뭐가 있는지 사람이 읽을 수 있게 요약한다. 임의로 누르지 않는다 —
// 가입은 약관 동의가 따르는 행위라 사람이 봐야 한다.
const buttons = await page.$$eval(
  'button, a[role="button"], a[href], [role="button"]',
  (els) => els.map((e) => (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim())
    .filter((t) => t && t.length <= 40),
).catch(() => []);
const inputs = await page.$$eval('input',
  (els) => els.map((e) => `${e.type || 'text'}${e.name ? `[${e.name}]` : ''}${e.placeholder ? ` "${e.placeholder}"` : ''}`),
).catch(() => []);
const uniq = [...new Set(buttons)].slice(0, 25);
log(`버튼/링크 ${uniq.length}개:`);
for (const b of uniq) console.log(`    · ${b}`);
log(`입력칸 ${inputs.length}개: ${inputs.join(' | ') || '(없음)'}`);
const bodyText = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 400)).catch(() => '');
log(`본문: ${bodyText || '(비어 있음)'}`);

const shot = resolve(ROOT, 'logs/dome-dashboard.png');
await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
log(`스크린샷 → ${shot}`);

if (CLOSE) { await ctx.close(); process.exit(0); }

// 이 인증은 Clerk 이고 소셜 버튼이 아이콘뿐이라 클래스명으로 고른다(텍스트가 없다).
//   cl-socialButtonsIconButton__google / __github / __discord / __metamask
// 구글 버튼까지만 눌러 드린다. **비밀번호는 사용자가 직접 친다** —
// 남의 자격증명을 스크립트가 타이핑하게 만들지 않는다. 창이 보이므로 그대로 진행하시면 된다.
const google = await page.$('button[class*="socialButtonsIconButton__google"]');
if (google) {
  log('구글 로그인 버튼을 누릅니다 — 이어지는 구글 화면에서 직접 로그인해 주세요.');
  await google.click().catch((e) => log(`클릭 실패: ${String(e.message).slice(0, 80)}`));
} else {
  log('구글 버튼을 못 찾았습니다 — 창에서 직접 가입/로그인해 주세요.');
}

log('');
log('로그인이 끝나 대시보드에 도착하면 자동으로 API 키를 찾아 보겠습니다. 기다립니다…');

// 대시보드 도착을 기다린다. 사람이 하는 일이라 넉넉히 두되, 무한정 붙잡지는 않는다.
const DEADLINE = Date.now() + 10 * 60_000;
let arrived = false;
while (Date.now() < DEADLINE) {
  if (page.isClosed()) break;
  if (/dashboard\.domeapi\.io/.test(page.url())) { arrived = true; break; }
  await page.waitForTimeout(2000);
}

if (!arrived) {
  log(page.isClosed() ? '창이 닫혔습니다 — 키를 받으셨으면 알려주세요.' : '10분 안에 대시보드에 도착하지 않았습니다.');
  log(`키를 직접 넣으시려면:  echo 'DOME_API_KEY=받은키' >> ${ENV_LOCAL}`);
  await ctx.close().catch(() => {});
  process.exit(0);
}

log(`대시보드 도착: ${page.url()}`);
await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
await page.waitForTimeout(2000);

// 키를 화면에서 찾는다. 형태를 모르므로 '키처럼 생긴 긴 문자열' 을 본문에서 훑는다.
const found = await page.evaluate(() => {
  const txt = document.body.innerText || '';
  const cands = txt.match(/\b[A-Za-z0-9_-]{24,80}\b/g) || [];
  // 흔한 영문 단어 나열은 제외 — 키는 대소문자·숫자가 섞인다
  return cands.filter((c) => /[0-9]/.test(c) && /[a-z]/i.test(c)).slice(0, 5);
}).catch(() => []);

const shot2 = resolve(ROOT, 'logs/dome-dashboard-in.png');
await page.screenshot({ path: shot2, fullPage: true }).catch(() => {});
log(`대시보드 스크린샷 → ${shot2}`);

if (found.length) {
  log(`키 후보 ${found.length}개를 찾았습니다:`);
  for (const f of found) log(`    ${f}`);
  log('맞는 것을 알려주시면 .env.local 에 넣겠습니다 (제가 임의로 저장하지 않습니다).');
} else {
  log('화면에서 키를 못 찾았습니다 — "API Keys" 메뉴에서 발급 후 알려주세요.');
}

log('');
log('창은 열어 둡니다. 다 되시면 닫으시면 됩니다.');
await page.waitForEvent('close', { timeout: 0 }).catch(() => {});
await ctx.close().catch(() => {});
log('창이 닫혔습니다.');
