#!/usr/bin/env node
// scripts/visual/post-publish-recheck.mjs
// 발행 → 라이브 반영되면 *즉시* 로그인(회원) 상태의 읽을 수 있는 보고서 슬라이스를 캡처하고 재검하는 절차.
//   (2026-06-16 사용자 "보고서 올린후 올라오면 바로 라이브 읽을수있는 슬라이스 재검 절차 만들어놔".)
//
// 단계: (1) 라이브 API 가 발행본(generatedAt) 반영할 때까지 폴링(최대 90s)
//       (2) MEMBER_EMAIL 로 로그인 → /ko/report 끝까지 스크롤 → 읽을 수 있는 슬라이스 PNG
//       (3) verify-report 내러티브/전체 probe 로 발행 JSON 재검(결함→hallucination_history 는 생성기 담당)
//       (4) 몽타주 합성 + logs/recheck-status.json 기록 (session-spotcheck 가 surface)
// 출력 1줄: "RECHECK OK ..." / "RECHECK ALERT: ...". exit 0/1.
// 사용: MEMBER_EMAIL=.. node scripts/visual/post-publish-recheck.mjs [reportFile] [--base=https://flowvium.net]
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyReport, pickLatestReport } from '../verify-report.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=').slice(1).join('=') : d; };
const BASE = arg('base', 'https://flowvium.net').replace(/\/$/, '');
const EMAIL = process.env.MEMBER_EMAIL || '';
const reportFile = process.argv.slice(2).find((a) => a.endsWith('.json')) || pickLatestReport(resolve(ROOT, 'reports'));

const out = (line, code) => { console.log(line); process.exitCode = code; setTimeout(() => process.exit(code), 1500).unref(); };
if (!reportFile) { out('RECHECK ALERT: 보고서 파일 없음', 1); }

const report = JSON.parse(readFileSync(resolve(ROOT, reportFile), 'utf8'));
const wantGen = report.generatedAt;
const alerts = [];
const info = [];

// (1) 라이브 반영 폴링 — source/generatedAt 가 발행본과 일치할 때까지(최대 240s)
//   2026-07-01: 90s→240s. investment-strategy 는 memory 23h/Redis 24h 캐시라 발간이 캐시를 bust 하지 않으면
//   라이브 전파가 수분~수십분(자연 refresh) — 90s 는 자주 미반영 → 아래 렌더감사가 stale 페이지를 이 발간본으로 오귀속.
let liveConfirmed = false;
for (let i = 0; i < 48; i++) {
  try {
    const r = await fetch(`${BASE}/api/investment-strategy`, { signal: AbortSignal.timeout(9000), headers: { connection: 'close' } });
    if (r.ok) { const j = await r.json(); if (j.generatedAt === wantGen || (j.session === report.session && j.source === report.source)) { liveConfirmed = true; break; } }
  } catch { /* 폴링 블립 무시 */ }
  await new Promise((res) => setTimeout(res, 5000));
}
if (liveConfirmed) info.push('live반영✓'); else alerts.push('라이브 미반영(240s 내 generatedAt 불일치 — 캐시 미bust/publish 지연). ▶렌더감사는 stale 페이지라 skip(오귀속 방지)');

// (2) 로그인 슬라이스 캡처
const tsDir = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const shotDir = `${ROOT}/logs/screenshots/recheck-${tsDir}`;
mkdirSync(shotDir, { recursive: true });
let nSlices = 0, authState = 'anon';
let bodyText = '';           // (2.5) 렌더↔발간본 대조용 — 캡처 페이지의 실제 innerText
const sliceSizes = [];       // (2.5) 빈(단색) 슬라이스 감지용 PNG byte size
const SLICE_H = 1000, WIDTH = 1280;
try {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: SLICE_H }, locale: 'ko-KR' });
  if (EMAIL) {
    try { const pr = await ctx.request.post(`${BASE}/api/member`, { data: { email: EMAIL }, timeout: 12000 }); authState = (pr.ok()) ? 'member' : `auth실패${pr.status()}`; } catch { authState = 'auth오류'; }
  }
  const page = await ctx.newPage();
  await page.goto(`${BASE}/ko/report`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
  await page.evaluate(async () => { await new Promise((res) => { let y = 0; const t = setInterval(() => { window.scrollTo(0, y); y += 600; if (y >= document.body.scrollHeight) { clearInterval(t); window.scrollTo(0, 0); res(); } }, 100); }); });
  await page.waitForTimeout(900);
  const total = await page.evaluate(() => document.body.scrollHeight);
  bodyText = (await page.evaluate(() => document.body?.innerText || '')).trim();
  const bodyLen = bodyText.length;
  if (authState === 'member' && bodyLen < 5000) alerts.push(`로그인 보고서 본문 ${bodyLen}자 (게이트 미해제/렌더 실패 의심)`);
  const n = Math.ceil(total / SLICE_H);
  for (let i = 0; i < n; i++) {
    await page.evaluate((y) => window.scrollTo(0, y), i * SLICE_H); await page.waitForTimeout(200);
    const p = `${shotDir}/slice_${String(i).padStart(2, '0')}.png`;
    await page.screenshot({ path: p });
    try { sliceSizes.push(statSync(p).size); } catch { sliceSizes.push(0); }
  }
  nSlices = n;
  await browser.close();
  info.push(`슬라이스 ${nSlices}장(${authState},${bodyLen}자)`);
} catch (e) { alerts.push(`슬라이스 캡처 실패: ${String(e?.message || e).slice(0, 60)}`); }

// (2.5) 캡처물 *검증* (2026-07-03, 사용자 "캡쳐만 하면 안되고 검증하라") — "찍혔다" ≠ "발간본이 렌더됐다".
//   (a) 렌더↔발간본 대조: 페이지 innerText 에 발간본 핵심 사실이 실제로 존재하는지 — portfolio 종목
//       커버리지(US=티커, KR=회사명 표기 기준) ≥70% + thesis 앞부분 문자열. stale/부분 렌더를 잡는다.
//   (b) 빈 슬라이스: 단색 PNG 는 초소형으로 압축됨 — 8KB 미만 슬라이스 = 렌더 실패 의심.
if (authState === 'member' && liveConfirmed && bodyText) {
  const norm = (s) => String(s ?? '').replace(/\s+/g, '');
  const bodyNorm = norm(bodyText);
  const port = (report.portfolio ?? []).filter((p) => p?.ticker);
  if (port.length) {
    const shown = port.filter((p) => {
      const isKR = /\.(KS|KQ)$/.test(p.ticker);
      const keys = isKR ? [p.koreanName, p.name, p.ticker.replace(/\.(KS|KQ)$/, '')] : [p.ticker, p.name];
      return keys.filter(Boolean).some((k) => bodyNorm.includes(norm(k)));
    });
    const pct = Math.round((shown.length / port.length) * 100);
    if (pct < 70) alerts.push(`렌더↔발간본 불일치: portfolio ${port.length}종목 중 ${shown.length}개만 렌더(${pct}%) — stale/부분 렌더 의심`);
    else info.push(`렌더대조 portfolio ${pct}%✓`);
  }
  const thesisKey = norm(report.thesis).slice(0, 24);
  if (thesisKey.length >= 12 && !bodyNorm.includes(thesisKey)) alerts.push('렌더↔발간본 불일치: thesis 앞부분이 페이지에 없음 (stale 콘텐츠 의심)');
  else if (thesisKey.length >= 12) info.push('렌더대조 thesis✓');
}
{
  const blank = sliceSizes.map((s, i) => [i, s]).filter(([, s]) => s > 0 && s < 8000);
  if (blank.length) alerts.push(`빈 슬라이스 의심 ${blank.length}장 (${blank.map(([i]) => i).join(',')} — PNG<8KB, 단색/렌더실패)`);
  else if (sliceSizes.length) info.push('빈슬라이스 0');
}

// (3) 발행 JSON 재검 (verify-report 전체 probe — 내러티브 probe 포함)
let defects = [];
try { ({ defects } = await verifyReport(resolve(ROOT, reportFile), { silent: true })); } catch (e) { alerts.push(`verify 실패: ${String(e?.message).slice(0, 50)}`); }
const high = defects.filter((d) => d.severity === 'high');
if (high.length) alerts.push(`발행본 high 결함 ${high.length}건: ${high.map((d) => d.defect_type).join(',')}`);
else if (defects.length) info.push(`결함 ${defects.length}건(high 0)`);
else info.push('결함 0');

// (3.5) 렌더 계층 전수감사 — audit-pages 로 /ko/report 의 렌더 텍스트 garble(이중부호·라벨오류·복사·콘탱고 등)
//   검출 (2026-06-16: 데이터 probe 가 못 보는 렌더 사각지대). 생성기 sanitizer 가 발간 전 고쳤으면 0 이어야.
let pageAudit = null;
if (!liveConfirmed) {
  // ★라이브가 발간본을 아직 안 보여주면(stale) 렌더감사를 이 발간본에 귀속하면 안 됨 — 옛 리포트 결함을
  //   신규 nan_undef 로 오보고하던 false-negative 근원(2026-07-01 evening 사건). skip + 명시.
  pageAudit = 'skip: 라이브 미반영(stale 페이지 — 이 발간본 아님, 오귀속 방지)';
  info.push('렌더감사 skip(stale)');
} else {
  try {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath, [`${__dirname}/audit-pages.mjs`, '--pages=/ko/report'], { encoding: 'utf8', timeout: 60000, env: process.env });
    const out = (r.stdout || '').trim().split('\n').pop() || '';
    pageAudit = out;
    if (/PAGE-AUDIT ALERT/.test(out)) alerts.push(`렌더감사 ALERT: ${out.replace(/^.*ALERT:\s*/, '').slice(0, 80)}`);
    else if (out) info.push('렌더감사✓');
  } catch (e) { info.push(`렌더감사 skip:${String(e?.message).slice(0, 30)}`); }
}

// (4) 몽타주 합성 (빠른 육안용)
let montage = null;
try {
  const files = readdirSync(shotDir).filter((f) => /^slice_\d+\.png$/.test(f)).sort();
  if (files.length) {
    const cells = files.map((f, i) => `<div class=c><div class=l>slice ${i}</div><img src="data:image/png;base64,${readFileSync(`${shotDir}/${f}`).toString('base64')}"></div>`).join('');
    const html = `<html><head><meta charset=utf8><style>body{margin:0;background:#0d1117}.g{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;padding:8px}.c{background:#161b22;border:1px solid #30363d}.l{color:#8b949e;font:12px sans-serif;padding:4px 8px;background:#21262d}.c img{width:100%;display:block}</style></head><body><div class=g>${cells}</div></body></html>`;
    const b = await chromium.launch({ headless: true });
    const pg = await b.newPage({ viewport: { width: 1500, height: 1000 } });
    await pg.setContent(html, { waitUntil: 'load' }); await pg.waitForTimeout(300);
    montage = `${shotDir}/montage.png`;
    await pg.screenshot({ path: montage, fullPage: true });
    await b.close();
  }
} catch { /* 몽타주 실패는 비치명 */ }

// (5) 상태 기록 — session-spotcheck 가 읽어 surface
const status = {
  ts: new Date().toISOString(), reportFile, generatedAt: wantGen, session: report.session,
  liveConfirmed, authState, nSlices, shotDir, montage, pageAudit,
  defectCount: defects.length, highDefects: high.map((d) => ({ type: d.defect_type, value: String(d.llm_value).slice(0, 60) })),
  verdict: alerts.length ? 'alert' : 'ok',
};
try { writeFileSync(`${ROOT}/logs/recheck-status.json`, JSON.stringify(status, null, 2)); } catch {}

out(alerts.length ? `RECHECK ALERT: ${alerts.join(' | ')}  [ok: ${info.join(', ')}]  shots=${shotDir}`
  : `RECHECK OK  ${info.join(' / ')}  shots=${shotDir}`, alerts.length ? 1 : 0);
