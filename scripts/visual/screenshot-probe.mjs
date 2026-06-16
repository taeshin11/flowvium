#!/usr/bin/env node
// scripts/visual/screenshot-probe.mjs
// 시각 결함 probe (Playwright/Chromium) — 데이터 감사(verify-report)가 못 잡는 *렌더/레이아웃* 결함 전용:
//   빈 페이지·스켈레톤 고착·앱 크래시("Application error")·404/500·클라이언트 예외·콘솔 에러 폭주.
//   (2026-06-16 신설 — 사용자 "로그인하니 안 나오잖아" 류 시각 결함은 JSON 감사로 안 잡힘.)
//
// 설치(최초 1회): cd scripts/visual && npm run setup   (= npm install && npx playwright install chromium)
// 실행: node scripts/visual/screenshot-probe.mjs [--pages=/ko,/ko/report] [--base=https://flowvium.net] [--headed]
// 출력: 1줄 "OK visual ..." 또는 "ALERT: ..." (session-spotcheck 와 동형). exit 0=OK / 1=ALERT.
// 산출: logs/screenshots/<ts>/<slug>.png  +  logs/visual-probe.json (페이지별 상세).
//
// ⚠️ 익명(로그아웃) 시야만 검증 — 로그인 게이트 콘텐츠는 미검증(자격증명 미보관). 로그인 벽은 'auth-gated' 로 표기만.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

const argv = process.argv.slice(2);
const getArg = (k, d) => { const a = argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=').slice(1).join('=') : d; };
const BASE = getArg('base', 'https://flowvium.net').replace(/\/$/, '');
const HEADED = argv.includes('--headed');
const PAGES = getArg('pages', '/ko,/ko/report,/ko/signals,/ko/short,/ko/explore,/ko/cascade')
  .split(',').map((s) => s.trim()).filter(Boolean);

// 시각 결함 마커 — 표시되면 즉시 ALERT (Next.js/일반 크래시 + 한글 오류문)
const ERROR_MARKERS = [
  'Application error', 'client-side exception', 'Internal Server Error',
  'This page could not be found', '404', '500 -', 'Something went wrong',
  'Unhandled Runtime Error', 'ChunkLoadError', '오류가 발생', '문제가 발생', '페이지를 찾을 수 없',
];
// 로그인 벽 마커 — 결함 아님(정상 게이트). ALERT 아님, 'auth-gated' 표기.
const AUTH_MARKERS = ['로그인', 'Sign in', 'Sign In', 'Log in', '구독', '후원'];
const MIN_BODY_TEXT = 220;     // 이보다 짧으면 빈/스켈레톤 고착 의심
const SETTLE_MS = 3500;        // 하이드레이션/데이터 fetch 대기

const slug = (p) => (p.replace(/^\//, '') || 'root').replace(/[^a-zA-Z0-9가-힣_-]/g, '_');
const tsParts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const shotDir = `${ROOT}/logs/screenshots/${tsParts}`;
mkdirSync(shotDir, { recursive: true });

const alerts = [];
const info = [];
const detail = [];

const browser = await chromium.launch({ headless: !HEADED });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ko-KR' });

for (const path of PAGES) {
  const url = `${BASE}${path}`;
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 120)); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e?.message || e).slice(0, 120)}`));

  const rec = { path, status: null, bodyLen: 0, errors: [], consoleErrors: 0, authGated: false, screenshot: null, verdict: 'ok' };
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    rec.status = resp?.status() ?? null;
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch { /* polling 페이지는 idle 안 옴 — 무시 */ }
    await page.waitForTimeout(SETTLE_MS);

    // 2026-06-16: 전체 스크롤 캡처(fullPage) — 첫 화면만이 아니라 페이지 끝까지. lazy-load 콘텐츠 위해
    //   끝까지 천천히 스크롤 후 원위치(차트/표가 viewport 진입해야 렌더되는 컴포넌트 대응).
    await page.evaluate(async () => {
      await new Promise((res) => {
        let y = 0; const step = 600;
        const t = setInterval(() => {
          window.scrollTo(0, y); y += step;
          if (y >= document.body.scrollHeight) { clearInterval(t); window.scrollTo(0, 0); res(); }
        }, 120);
      });
    });
    await page.waitForTimeout(800);
    const shotPath = `${shotDir}/${slug(path)}.png`;
    await page.screenshot({ path: shotPath, fullPage: true });
    rec.screenshot = shotPath;

    const bodyText = (await page.evaluate(() => document.body?.innerText || '')).trim();
    rec.bodyLen = bodyText.length;
    rec.consoleErrors = consoleErrors.length;
    rec.authGated = AUTH_MARKERS.some((m) => bodyText.includes(m)) && bodyText.length < 600;

    const hitErr = ERROR_MARKERS.filter((m) => bodyText.includes(m));
    if (rec.status && rec.status >= 400) { rec.errors.push(`HTTP ${rec.status}`); }
    if (hitErr.length) rec.errors.push(`오류문: ${hitErr.slice(0, 2).join(', ')}`);
    if (!rec.authGated && rec.bodyLen < MIN_BODY_TEXT) rec.errors.push(`본문 ${rec.bodyLen}자 (빈/스켈레톤 의심)`);

    if (rec.errors.length) {
      rec.verdict = 'alert';
      alerts.push(`${path}: ${rec.errors.join(' / ')}`);
    } else {
      info.push(`${path}${rec.authGated ? '(auth)' : ''} ${rec.bodyLen}자${rec.consoleErrors ? ` ⚠${rec.consoleErrors}콘솔` : ''}`);
    }
  } catch (e) {
    rec.verdict = 'alert';
    rec.errors.push(`nav 실패: ${String(e?.message || e).slice(0, 80)}`);
    alerts.push(`${path}: nav 실패 ${String(e?.message || e).slice(0, 60)}`);
  } finally {
    detail.push(rec);
    await page.close();
  }
}

await ctx.close();
await browser.close();

writeFileSync(`${ROOT}/logs/visual-probe.json`,
  JSON.stringify({ ts: new Date().toISOString(), base: BASE, shotDir, pages: detail }, null, 2));

const line = alerts.length
  ? `ALERT: 시각결함 ${alerts.length} — ${alerts.join(' | ')}  [ok: ${info.join(', ')}]  shots=${shotDir}`
  : `OK  visual ${detail.length}p — ${info.join(' / ')}  shots=${shotDir}`;
console.log(line);
process.exit(alerts.length ? 1 : 0);
