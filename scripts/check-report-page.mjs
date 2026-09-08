#!/usr/bin/env node
/**
 * check-report-page.mjs — 발간된 보고서를 **화면으로** 확인한다.
 *
 * 왜 (2026-09-09 사용자 "보고서 올리고나서 눈검증하고있지?"): 안 하고 있었다.
 *   쇼츠는 프레임과 dB 를 재면서, 보고서는 verify-report(내용 검사)만 믿고
 *   **사람이 보는 화면은 한 번도 안 봤다.** API 가 맞아도 페이지는 깨질 수 있다.
 *   실제로 이 스크립트를 만들며 처음 봤을 때 홈은 멀쩡했지만
 *   보고서 본문은 /ko 가 아니라 /ko/report 에 있었다 — 경로부터 몰랐다.
 *   (주석에 슬래시+별표가 붙으면 블록 주석이 거기서 닫힌다. 오늘 두 번째다.)
 *
 * 무엇을 보는가:
 *   · 라이브 generatedAt 이 로컬 최신과 같은가 (발간이 실제로 반영됐나)
 *   · 포트폴리오 종목이 화면에 **글자로** 나오는가 (데이터는 있는데 안 그리는 사각지대)
 *   · undefined · NaN · [object Object] 같은 깨진 값이 없는가
 *   · 페이지 오류가 없는가
 *
 * 사용: node scripts/check-report-page.mjs
 */
import { chromium } from 'playwright';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';

const SITE = process.env.SITE_URL_FULL || 'https://flowvium.net';
let fail = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.log(`  ✗ ${m}`); fail += 1; };

// 1) 라이브가 최신 보고서인가
const { openDb } = await import('./lib/db.mjs');
const db = openDb();
const local = db.prepare('SELECT id, generated_at, full_json FROM reports ORDER BY generated_at DESC LIMIT 1').get();
db.close();
if (!local) { console.error('로컬에 보고서가 없다'); process.exit(1); }

let live = {};
try {
  live = await (await fetch(`${SITE}/api/investment-strategy?locale=ko`, { signal: AbortSignal.timeout(25000) })).json();
} catch (e) { bad(`라이브 API 못 읽음 — ${String(e.message).slice(0, 60)}`); }
const sameReport = String(live.generatedAt ?? '').slice(0, 19) === String(local.generated_at).slice(0, 19);
sameReport ? ok(`라이브가 최신 보고서다 (${local.id})`)
  : bad(`라이브가 옛 보고서다 — 로컬 ${String(local.generated_at).slice(0, 19)} vs 라이브 ${String(live.generatedAt).slice(0, 19)}`);

// 2) 화면에 실제로 그려지는가
const wanted = (live.portfolio ?? []).map((x) => x.ticker).filter(Boolean).slice(0, 4);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 2200 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 80)));
try {
  const r = await page.goto(`${SITE}/ko/report`, { waitUntil: 'networkidle', timeout: 60000 });
  r.status() === 200 ? ok(`/ko/report HTTP 200`) : bad(`/ko/report HTTP ${r.status()}`);
  await page.waitForTimeout(4000);
  const txt = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
  txt.length > 3000 ? ok(`본문 ${txt.length}자`) : bad(`본문이 ${txt.length}자뿐 — 안 그려졌다`);
  const missing = wanted.filter((t) => !txt.includes(t));
  missing.length === 0
    ? ok(`포트폴리오 ${wanted.length}종목이 화면에 있다 (${wanted.join(' ')})`)
    : bad(`화면에 없는 종목: ${missing.join(' ')} — 데이터는 있는데 안 그린다`);
  const broken = ['undefined', 'NaN', '[object Object]', 'null원', 'Error:'].filter((x) => txt.includes(x));
  broken.length === 0 ? ok('깨진 값 없음') : bad(`깨진 값: ${broken.join(', ')}`);
  errs.length === 0 ? ok('페이지 오류 없음') : bad(`페이지 오류: ${errs.slice(0, 2).join(' | ')}`);
  await page.screenshot({ path: resolve(ROOT, 'logs/report-page.png') }).catch(() => {});
  console.log('  화면: logs/report-page.png');
} catch (e) {
  bad(`페이지 확인 실패 — ${String(e.message).slice(0, 80)}`);
} finally {
  await browser.close().catch(() => {});
}
console.log(fail === 0 ? '\n✅ 보고서 화면 정상' : `\n❌ ${fail}건 이상`);
process.exit(fail === 0 ? 0 : 1);
