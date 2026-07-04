#!/usr/bin/env node
/**
 * scripts/visual/audit-company-render.mjs — 전 종목 회사페이지 *렌더* 전수검증 (2026-07-04 신설)
 *
 * 사각지대: audit-company-pages/coverage 는 API(JSON) 레벨 전수 — *렌더된 화면*은 대표 2건만 캡처검증됐었음.
 * 전 유니버스(candidate-tickers ~1,210)의 /ko/company/[ticker] 를 실제 브라우저 렌더로 검사:
 *   - detector: NaN/undefined/[object Object]/Application error/이중부호/한자 런
 *   - 구조 probe: 본문 길이(스켈레톤/빈 렌더 감지), 헤더 가격 렌더 여부(숫자 존재)
 *   - 캡처: 결함 페이지 전량 + 무작위 표본(--sample-shots, 육안용)
 * 출력: logs/company-render-audit.json + 1줄 요약. exit 1 = high 결함 존재.
 *
 * 사용: MEMBER_EMAIL=.. node scripts/visual/audit-company-render.mjs [--limit=N] [--conc=4] [--sample-shots=12]
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=').slice(1).join('=') : d; };
const BASE = arg('base', 'https://flowvium.net').replace(/\/$/, '');
const LIMIT = parseInt(arg('limit', '0'), 10) || 0;
const CONC = Math.max(1, Math.min(8, parseInt(arg('conc', '4'), 10) || 4));
const SAMPLE_SHOTS = parseInt(arg('sample-shots', '12'), 10) || 12;
const EMAIL = process.env.MEMBER_EMAIL || '';

const meta = JSON.parse(readFileSync(resolve(ROOT, 'data/candidate-tickers.json'), 'utf8')).meta ?? {};
let tickers = Object.keys(meta);
if (LIMIT) tickers = tickers.slice(0, LIMIT);

// 결정론 표본(육안용): 셔플 없이 균등 간격 — 재현 가능(무작위 seed 불필요)
const sampleSet = new Set();
for (let i = 0; i < SAMPLE_SHOTS && tickers.length; i++) sampleSet.add(tickers[Math.floor(i * tickers.length / SAMPLE_SHOTS)]);

const DETECTORS = [
  { name: 'render_error', sev: 'high', re: /Application error|Unhandled Runtime|500 Internal|__next_error__/ },
  { name: 'nan_undef', sev: 'high', re: /\bNaN\b|\bundefined\b|\[object Object\]/ },
  { name: 'double_sign', sev: 'high', re: /[+\-–][\-–]\s?\d/ },
  { name: 'cjk_run', sev: 'medium', re: /[㐀-䶿一-鿿]{4,}/ },
  { name: 'placeholder', sev: 'high', re: /\[TARGET_LANG\]|\{\{/ },
];

const shotDir = `${ROOT}/logs/screenshots/company-render-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
mkdirSync(shotDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, locale: 'ko-KR' });
let authState = 'anon';
if (EMAIL) { try { const pr = await ctx.request.post(`${BASE}/api/member`, { data: { email: EMAIL }, timeout: 12000 }); authState = pr.ok() ? 'member' : `auth${pr.status()}`; } catch { authState = 'autherr'; } }

const results = [];
let done = 0, flagged = 0, shots = 0;
const t0 = Date.now();

async function auditOne(page, ticker) {
  const rec = { ticker, bodyLen: 0, flags: [], err: null };
  try {
    await page.goto(`${BASE}/ko/company/${encodeURIComponent(ticker)}`, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(2600);  // 클라이언트 fetch 정착 (networkidle 은 스트림/폴링에 불안정)
    const text = (await page.evaluate(() => document.body?.innerText || '')).trim();
    rec.bodyLen = text.length;
    for (const d of DETECTORS) {
      const m = text.match(d.re);
      if (m) {
        const i = text.indexOf(m[0]);
        rec.flags.push({ detector: d.name, sev: d.sev, snip: text.slice(Math.max(0, i - 30), i + 40).replace(/\s+/g, ' ') });
      }
    }
    // 구조 probe: 스켈레톤/빈 렌더 — 2026-07-04 전수 실측 재보정: 페이지가 2계층(큐레이션 리치형 4,000자+
    //   / 다이나믹 경량형 1,700~2,500 / ETF 830~1,100)이라 2,500 임계는 오탐 757건. 정상 최소 실측 828자
    //   (PPLT ETF, 가격+차트+관련종목 육안 정상) → 진짜 빈/스켈레톤 수준(<650)만 high.
    if (text.length < 650) rec.flags.push({ detector: 'thin_render', sev: 'high', snip: `bodyLen=${text.length}` });
    // 헤더 가격 렌더: 상단 1,200자 내 숫자 가격 패턴(₩/$/소수점/천단위) 부재 = 가격 미렌더
    const head = text.slice(0, 1200);
    if (!/[\d,]+\.\d{2}|₩[\d,]+|\$[\d,]+/.test(head)) rec.flags.push({ detector: 'no_price_header', sev: 'medium', snip: head.slice(0, 60) });
  } catch (e) { rec.err = String(e?.message || e).slice(0, 60); rec.flags.push({ detector: 'nav_fail', sev: 'high', snip: rec.err }); }
  if (rec.flags.length || sampleSet.has(ticker)) {
    try { await page.screenshot({ path: `${shotDir}/${ticker.replace(/[^A-Z0-9.]/gi, '_')}${rec.flags.length ? '_FLAG' : '_sample'}.png`, fullPage: false }); shots++; } catch { /* */ }
  }
  if (rec.flags.length) flagged++;
  results.push(rec);
  done++;
  if (done % 100 === 0) console.log(`  ...${done}/${tickers.length} (flag ${flagged}, ${((Date.now() - t0) / 60000).toFixed(1)}분)`);
}

// 워커 CONC개 — 각자 페이지 1개 재사용
const queue = [...tickers];
await Promise.all(Array.from({ length: CONC }, async () => {
  const page = await ctx.newPage();
  while (queue.length) { const t = queue.shift(); if (t) await auditOne(page, t); }
  await page.close();
}));
await browser.close();

const high = results.filter((r) => r.flags.some((f) => f.sev === 'high'));
const med = results.filter((r) => !r.flags.some((f) => f.sev === 'high') && r.flags.length);
const byDet = {};
for (const r of results) for (const f of r.flags) byDet[f.detector] = (byDet[f.detector] ?? 0) + 1;
writeFileSync(`${ROOT}/logs/company-render-audit.json`, JSON.stringify({
  ts: new Date().toISOString(), base: BASE, authState, total: results.length,
  flagged, high: high.length, medium: med.length, byDetector: byDet, shotDir, shots,
  flaggedList: results.filter((r) => r.flags.length).map((r) => ({ ticker: r.ticker, bodyLen: r.bodyLen, flags: r.flags })),
}, null, 2));

console.log(`\nCOMPANY-RENDER ${high.length ? 'ALERT' : 'OK'}  ${results.length}종목 전수 — high ${high.length} / med ${med.length} / 캡처 ${shots} (auth=${authState}, ${((Date.now() - t0) / 60000).toFixed(1)}분)`);
console.log(`detector 분포: ${JSON.stringify(byDet)}`);
if (high.length) console.log(`high 예시: ${high.slice(0, 8).map((r) => `${r.ticker}(${r.flags[0].detector})`).join(', ')}`);
process.exitCode = high.length ? 1 : 0;
setTimeout(() => process.exit(process.exitCode), 1500).unref();
