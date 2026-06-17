// 페이지를 *읽을 수 있는* 고해상도 가로 슬라이스로 분할 캡처 (수치 전수검토용).
// 사용: MEMBER_EMAIL=.. node capture-slices.mjs <path> [sliceH] [width]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const PATH = process.argv[2] || '/ko/report';
const SLICE_H = parseInt(process.argv[3] || '1100', 10);
const WIDTH = parseInt(process.argv[4] || '1440', 10);
const BASE = (process.env.BASE || 'https://flowvium.net').replace(/\/$/, '');
const EMAIL = process.env.MEMBER_EMAIL || '';
const outDir = `D:/Flowvium/logs/screenshots/slices-${PATH.replace(/[^a-z0-9]/gi, '_')}`;
mkdirSync(outDir, { recursive: true });

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: WIDTH, height: SLICE_H }, locale: 'ko-KR', deviceScaleFactor: 1 });
if (EMAIL) {
  const pr = await ctx.request.post(`${BASE}/api/member`, { data: { email: EMAIL }, timeout: 12000 });
  console.log('auth:', pr.ok() ? 'member' : `fail ${pr.status()}`);
}
const page = await ctx.newPage();
await page.goto(`${BASE}${PATH}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
// lazy-load 위해 끝까지 스크롤
await page.evaluate(async () => {
  await new Promise((res) => { let y = 0; const t = setInterval(() => { window.scrollTo(0, y); y += 600; if (y >= document.body.scrollHeight) { clearInterval(t); window.scrollTo(0, 0); res(); } }, 100); });
});
await page.waitForTimeout(1000);
const total = await page.evaluate(() => document.body.scrollHeight);
const n = Math.ceil(total / SLICE_H);
console.log(`total=${total}px → ${n} slices (${WIDTH}x${SLICE_H})`);
for (let i = 0; i < n; i++) {
  const y = i * SLICE_H;
  await page.evaluate((yy) => window.scrollTo(0, yy), y);
  await page.waitForTimeout(250);
  // 뷰포트(=SLICE_H 높이) 캡처 — clip 없이. 스크롤 끝에선 자동 클램프(약간 겹침은 무방).
  await page.screenshot({ path: `${outDir}/slice_${String(i).padStart(2, '0')}.png` });
}
await b.close();
console.log(`OK → ${outDir} (${n} slices)`);
