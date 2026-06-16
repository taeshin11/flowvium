// 시각결함 probe 스크린샷들을 라벨 그리드 1장 몽타주로 합성 (Playwright 렌더).
// 사용: node montage.mjs <screenshotDir> [outPng]
import { chromium } from 'playwright';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const out = process.argv[3] || `${dir}/montage.png`;
if (!dir) { console.error('need dir'); process.exit(1); }

const LABELS = {
  ko: '홈 /ko', ko_report: '보고서 /ko/report', ko_signals: '시그널 /ko/signals',
  ko_short: '숏 /ko/short', ko_explore: '탐색 /ko/explore', ko_cascade: '캐스케이드 /ko/cascade',
};
const files = readdirSync(dir).filter((f) => f.endsWith('.png') && f !== 'montage.png');
const order = Object.keys(LABELS).filter((k) => files.includes(`${k}.png`));
for (const f of files.map((f) => f.replace('.png', ''))) if (!order.includes(f)) order.push(f);

const cells = order.map((key) => {
  const b64 = readFileSync(join(dir, `${key}.png`)).toString('base64');
  const label = LABELS[key] || key;
  return `<div class=cell><div class=lbl>${label}</div><img src="data:image/png;base64,${b64}"></div>`;
}).join('');

const html = `<html><head><meta charset=utf8><style>
body{margin:0;background:#0d1117;font-family:Segoe UI,sans-serif}
h1{color:#58a6ff;padding:14px 18px;margin:0;font-size:20px}
.grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;padding:10px}
.cell{background:#161b22;border:1px solid #30363d;border-radius:6px;overflow:hidden}
.lbl{color:#c9d1d9;font-size:14px;padding:6px 10px;background:#21262d;font-weight:600}
.cell img{width:100%;display:block}
</style></head><body>
<h1>FlowVium 시각결함 probe — flowvium.net (${order.length}p)</h1>
<div class=grid>${cells}</div></body></html>`;

const b = await chromium.launch({ headless: true });
const pg = await b.newPage({ viewport: { width: 1500, height: 1000 } });
await pg.setContent(html, { waitUntil: 'load' });
await pg.waitForTimeout(400);
await pg.screenshot({ path: out, fullPage: true });
await b.close();
console.log(`MONTAGE_OK ${out} ${statSync(out).size}bytes`);
