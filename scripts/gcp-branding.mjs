#!/usr/bin/env node
/**
 * gcp-branding.mjs — OAuth 동의 화면의 **브랜딩 3개 링크**를 채우고, 저장된 것을 확인한다.
 *
 * 왜 필요한가: OAuth 앱이 '테스트' 상태면 갱신 토큰이 **7일마다 폐기된다**.
 *   2026-09-04 에 그것 때문에 네 회차가 죽었다. 프로덕션으로 올리려면
 *   홈페이지·개인정보처리방침·서비스 약관 링크가 있어야 한다.
 *
 * 왜 다시 짰나 (2026-09-06): 같은 일을 하는 스크립트가 여섯 개로 흩어져 있었고
 *   (gcp-brand-all·fill·probe·save·branding·fill-branding — .backup 에 넣었다),
 *   **저장이 됐는지 확인하는 것이 하나도 없었다.**
 *   지난 실행 기록을 보면 세 칸을 채우고 나서 저장 버튼 클릭이 8초에 타임아웃났다.
 *   즉 "채웠다" 는 로그만 남고 실제로는 저장되지 않았을 수 있다.
 *
 * 그래서 이 스크립트는 **채우고 → 저장하고 → 새로고침해서 다시 읽는다.**
 *   되읽어서 값이 그대로 있어야 성공이라고 말한다.
 *
 * 사용:
 *   node scripts/gcp-branding.mjs            # 채우고 저장하고 확인
 *   node scripts/gcp-branding.mjs --check    # 지금 값만 읽는다(바꾸지 않는다)
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';

const CHECK_ONLY = process.argv.includes('--check');
const PROJECT = process.env.GCP_PROJECT || 'tagextract';
const SITE = process.env.BRAND_SITE || 'https://flowvium.net';

/**
 * 채울 칸들. 라벨은 주변 텍스트로 찾는다 — Material 입력창이라 placeholder·aria 가 비어 있다.
 *
 * 앱 이름이 왜 여기 있나 (2026-09-06): 값이 **"데스크톱 클라이언트 1"** 이었다.
 *   OAuth 클라이언트를 만들 때 붙는 기본 이름이 그대로 남은 것인데,
 *   그 문구가 **동의 화면에 그대로 뜬다** — 사용자는 "데스크톱 클라이언트 1이
 *   내 유튜브 계정에 접근하려 합니다" 를 보게 된다.
 *   사이트 표기를 그대로 쓴다: flowvium.net 의 <title> 이 "Flowvium — …" 이다.
 */
const APP_NAME = process.env.BRAND_APP_NAME || 'Flowvium';
const WANT = [
  { name: '앱 이름', near: /앱 이름|App name/i, url: APP_NAME, isUrl: false },
  { name: '홈페이지', near: /애플리케이션 홈페이지|Application home page/i, url: SITE, isUrl: true },
  { name: '개인정보처리방침', near: /개인정보처리방침|Privacy policy/i, url: SITE + '/privacy', isUrl: true },
  { name: '서비스 약관', near: /서비스 약관|Terms of service/i, url: SITE + '/terms', isUrl: true },
];

const OUT = resolve(ROOT, 'logs/gcp-branding.log');
const lines = [];
const log = (...a) => {
  const s = a.join(' ');
  lines.push(s); console.log(' ', s);
  try { mkdirSync(resolve(ROOT, 'logs'), { recursive: true }); writeFileSync(OUT, lines.join('\n')); } catch { /* noop */ }
};

/** 주소가 실제로 살아 있는지 먼저 본다 — 없는 주소를 넣으면 심사에서 떨어진다. */
async function alive(url) {
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
    return r.status;
  } catch { return 0; }
}

/** 입력창 주변 텍스트. 어느 칸인지 순서가 아니라 **문구로** 판단한다. */
const around = (el) => el.evaluate((e) => {
  let p = e, t = '';
  for (let up = 0; up < 4 && p; up += 1) { p = p.parentElement; if (p) t = (p.innerText || '').replace(/\s+/g, ' '); if (t.length > 12) break; }
  return t;
}).catch(() => '');

/** 지금 페이지에 들어 있는 세 값을 읽는다. */
async function readValues(page) {
  const inputs = page.locator('input:not([type=hidden]):not([type=file])');
  const n = await inputs.count();
  const got = {};
  for (const w of WANT) {
    for (let i = 0; i < n; i += 1) {
      const el = inputs.nth(i);
      if (!w.near.test(await around(el))) continue;
      got[w.name] = (await el.inputValue().catch(() => '')) || '';
      break;
    }
  }
  return got;
}

const browser = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/gcp-profile'), {
  channel: 'chrome', headless: false, viewport: { width: 1440, height: 1000 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = browser.pages()[0] ?? await browser.newPage();

try {
  if (!CHECK_ONLY) {
    for (const w of WANT.filter((x) => x.isUrl)) {
      const st = await alive(w.url);
      log(`${st === 200 ? '✓' : '⚠'} ${w.name} ${w.url} → HTTP ${st}`);
      if (st !== 200) throw new Error(`${w.url} 가 200 이 아니다 — 없는 주소를 넣지 않는다`);
    }
  }

  const open = async () => {
    await page.goto(`https://console.cloud.google.com/auth/branding?project=${PROJECT}`,
      { waitUntil: 'domcontentloaded', timeout: 90000 });
    for (const n of [/^확인$/, /^Accept all$/i]) {
      const b = page.getByRole('button', { name: n }).first();
      if (await b.count().catch(() => 0)) { await b.click({ timeout: 5000 }).catch(() => {}); }
    }
    await page.getByText(/앱 이름|App name/).first().waitFor({ timeout: 90000 });
    await page.waitForTimeout(3000);
  };
  await open();

  const before = await readValues(page);
  for (const w of WANT) log(`현재 ${w.name}: ${before[w.name] || '(비어 있음)'}`);
  // 되돌릴 수 있게 이전 값을 파일로 남긴다 — 남의 콘솔 설정을 복구 불가능하게 만들면 안 된다.
  try {
    writeFileSync(resolve(ROOT, 'logs/gcp-branding-before.json'), JSON.stringify(before, null, 2));
  } catch { /* noop */ }
  if (CHECK_ONLY) {
    // 세 링크 말고 **무엇이 더 비어 있는지**도 본다 — 프로덕션 게시를 막는 건 대개 나머지다.
    const body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    const inputs = page.locator('input:not([type=hidden]):not([type=file])');
    const n = await inputs.count();
    log(`— 입력칸 ${n}개 —`);
    for (let i = 0; i < n; i += 1) {
      const el = inputs.nth(i);
      const lab = (await around(el)).slice(0, 40);
      const val = (await el.inputValue().catch(() => '')) || '(비어 있음)';
      if (lab) log(`  ${lab} = ${val.slice(0, 60)}`);
    }
    const pub = body.match(/게시 상태[^가-힣]*(테스트|프로덕션|Testing|In production)/)
      ?? body.match(/(Publishing status|게시 상태)[^|]{0,40}/);
    log(`게시 상태: ${pub ? pub[0].slice(0, 60) : '(페이지에서 못 찾음)'}`);
    await page.screenshot({ path: resolve(ROOT, 'logs/gcp-branding.png'), fullPage: true }).catch(() => {});
    log('--check — 바꾸지 않는다');
    await browser.close(); process.exit(0);
  }

  const inputs = page.locator('input:not([type=hidden]):not([type=file])');
  const n = await inputs.count();
  let changed = 0;
  for (const w of WANT) {
    if (before[w.name] === w.url) { log(`= ${w.name} 이미 맞다`); continue; }
    let filled = false;
    for (let i = 0; i < n; i += 1) {
      const el = inputs.nth(i);
      if (!w.near.test(await around(el))) continue;
      await el.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await el.fill(w.url, { timeout: 10000 });
      filled = (await el.inputValue().catch(() => '')) === w.url;
      log(filled ? `✎ ${w.name} ← ${w.url}` : `⚠ ${w.name} 입력이 안 들어갔다`);
      if (filled) changed += 1;
      break;
    }
    if (!filled) log(`❌ ${w.name} 칸을 못 찾았다`);
  }
  if (!changed) { log('바꿀 것이 없다'); await browser.close(); process.exit(0); }

  // 저장. 2026-09-06: 여기서 8초 타임아웃이 났었다 — 버튼이 페이지 아래라 보이지 않았고,
  //   Material 버튼은 값이 바뀌기 전까지 disabled 다. **보이게 만들고, 눌릴 때까지 기다린다.**
  const save = page.getByRole('button', { name: /^\s*(저장|SAVE)\s*$/i }).first();
  if (!(await save.count().catch(() => 0))) throw new Error('저장 버튼이 없다');
  await save.scrollIntoViewIfNeeded({ timeout: 10000 }).catch(() => {});
  await save.waitFor({ state: 'visible', timeout: 20000 });
  for (let i = 0; i < 20 && await save.isDisabled().catch(() => false); i += 1) await page.waitForTimeout(1000);
  await save.click({ timeout: 20000 });
  log('저장 눌렀다');
  await page.waitForTimeout(8000);

  // **되읽어서 확인한다.** 저장을 눌렀다는 것과 저장됐다는 것은 다르다.
  await open();
  const after = await readValues(page);
  let ok = 0;
  for (const w of WANT) {
    const good = after[w.name] === w.url;
    if (good) ok += 1;
    log(`${good ? '✅' : '❌'} 되읽음 ${w.name}: ${after[w.name] || '(비어 있음)'}`);
  }
  await page.screenshot({ path: resolve(ROOT, 'logs/gcp-branding.png'), fullPage: false }).catch(() => {});
  log(ok === WANT.length ? '세 링크 모두 저장됐다' : `${ok}/${WANT.length} 만 저장됐다 — 남은 것은 사람이 확인해야 한다`);
  await browser.close();
  process.exit(ok === WANT.length ? 0 : 1);
} catch (e) {
  log(`오류: ${String(e?.message).slice(0, 160)}`);
  await page.screenshot({ path: resolve(ROOT, 'logs/gcp-branding.png') }).catch(() => {});
  await browser.close().catch(() => {});
  process.exit(1);
}
