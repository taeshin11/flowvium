// 위젯이 주는 링크의 실제 모양을 본다. 13건이 잡히는데 필터가 전부 걸러냈다 — 왜인지 확인.
import { chromium } from 'playwright';
import { createServer } from 'http';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
const CX = '91fa62a5516ea4d7a';
const html = `<!doctype html><meta charset="utf-8">
<script async src="https://cse.google.com/cse.js?cx=${CX}"></script>
<div class="gcse-searchresults-only" data-queryParameterName="q"></div>`;
const srv = createServer((_, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(html); });
await new Promise((r) => srv.listen(0, r));
const port = srv.address().port;
const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/cse-profile'), {
  channel: 'chrome', headless: false, viewport: { width: 1100, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const p = ctx.pages()[0] ?? await ctx.newPage();
const q = '나경원';
await p.goto(`http://localhost:${port}/?q=${encodeURIComponent(q)}#gsc.tab=1&gsc.q=${encodeURIComponent(q)}`, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(9000);
const rows = await p.evaluate(() => {
  const out = [];
  for (const box of document.querySelectorAll('.gs-image-box, .gs-result')) {
    const a = box.querySelector('a[href]');
    const img = box.querySelector('img');
    if (!a || !img) continue;
    out.push({ href: a.href, thumb: img.src, alt: img.alt || '', cls: box.className });
  }
  return out;
});
console.log(`총 ${rows.length}건`);
for (const r of rows.slice(0, 8)) {
  console.log(`  href : ${r.href.slice(0, 100)}`);
  console.log(`  thumb: ${r.thumb.slice(0, 70)} | alt="${r.alt.slice(0, 30)}" | ${r.cls.slice(0, 28)}`);
}
await ctx.close(); srv.close();
