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

// HARD 마커 — 프레임워크 크래시 문자열. 산문에 안 나오므로 표시되면 즉시 ALERT.
const HARD_MARKERS = [
  'Application error: a client-side exception', 'Internal Server Error',
  'This page could not be found', 'Unhandled Runtime Error', 'ChunkLoadError',
  '500 - Internal', 'Something went wrong',
];
// SOFT 마커 — 일반 한글 오류문("문제가 발생"·"오류가 발생"). 리스크 서술 산문에도 흔히 등장하므로
//   *짧은 페이지*(에러가 곧 페이지 전체)일 때만 ALERT. (2026-06-16 로그인 보고서 산문 오탐 fix.)
const SOFT_MARKERS = ['오류가 발생', '문제가 발생했습니다', '페이지를 찾을 수 없', '다시 시도'];
const SOFT_MAX_BODY = 1200;
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

// 회원 인증 — 로그인 상태(게이트 해제) 보고서를 찍기 위해. 이메일은 env/인자로만(커밋에 미포함).
//   flowvium 회원은 비밀번호 없는 이메일 소프트게이트: POST /api/member {email} → HMAC 쿠키 → 게이트 해제.
//   ctx.request 와 page 가 쿠키 jar 공유 → 이후 모든 페이지가 로그인 상태로 렌더.
const MEMBER_EMAIL = getArg('member-email', process.env.MEMBER_EMAIL || '');
let authState = 'anon';
if (MEMBER_EMAIL) {
  try {
    const pr = await ctx.request.post(`${BASE}/api/member`, { data: { email: MEMBER_EMAIL }, timeout: 12000 });
    const j = await pr.json().catch(() => ({}));
    authState = (pr.ok() && j.member) ? `member(${MEMBER_EMAIL.replace(/^(.).*(@.*)$/, '$1***$2')})` : `auth실패(${pr.status()})`;
  } catch (e) { authState = `auth오류:${String(e?.message || e).slice(0, 40)}`; }
}

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

    const hardHit = HARD_MARKERS.filter((m) => bodyText.includes(m));
    const softHit = (rec.bodyLen < SOFT_MAX_BODY) ? SOFT_MARKERS.filter((m) => bodyText.includes(m)) : [];
    const hitErr = [...hardHit, ...softHit];
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
  ? `ALERT: 시각결함 ${alerts.length} — ${alerts.join(' | ')}  [ok: ${info.join(', ')}]  auth=${authState} shots=${shotDir}`
  : `OK  visual ${detail.length}p [auth=${authState}] — ${info.join(' / ')}  shots=${shotDir}`;
console.log(line);
process.exit(alerts.length ? 1 : 0);
