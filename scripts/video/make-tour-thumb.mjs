#!/usr/bin/env node
/**
 * make-tour-thumb.mjs — 사이트 소개 롱폼 썸네일을 **실제 추천 기록**으로 만든다. (2026-10-03)
 *
 * 사장님 지시(Mac mini2 경유): 롱폼 썸네일은 CTR 분석 후 바로 적용. 실측(10/03): 노출 11 · 클릭 0 — 표본이 너무 작아
 *   CTR 로는 아무 말도 못 한다. 대신 첫 썸네일의 약점을 고친다:
 *   ① 배경이 글자 많은 보고서 화면 전체라 큰 글씨와 엉킨다 ② '무엇을 얻는지' 숫자가 없다 ③ 글줄 셋.
 * → 어두운 단색 + 큰 숫자 하나(실제 적중, lib/best-hit 의 20% 이상 기록) + 그 종목의 **실제 종가 선**(야후) + 짧은 두 줄.
 *   숫자는 지어내지 않는다(9/30 사장님 "실제 최고 적중 종목"). 날짜·종목명을 같이 적고 '과거 기록' 을 밝힌다.
 *
 * 사용: node scripts/video/make-tour-thumb.mjs --out <jpg> [--upload <videoId>]
 */
import { chromium } from 'playwright';
import { resolve } from 'path';
import { statSync } from 'fs';
import { ROOT } from '../lib/project-root.mjs';

const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const OUT = resolve(arg('out', resolve(ROOT, 'logs/tour-thumb.jpg')));

const { pickHits } = await import('../lib/best-hit.mjs');
const { openDb } = await import('../lib/db.mjs');
const { hits } = pickHits(openDb().prepare(`SELECT r.ticker, r.name, r.generated_at, o.evaluated_at, o.outcome, o.pnl_pct,
    r.entry_low, r.entry_high, r.price_at_gen, o.high_seen, o.low_seen
    FROM recommendation_outcomes o JOIN recommendations r ON r.id = o.recommendation_id`).all(), { min: 20 });
const best = hits.sort((a, b) => b.pnl - a.pnl)[0];
if (!best) { console.error('20% 이상 실제 적중이 없다 — 숫자 없는 썸네일은 만들지 않는다'); process.exit(1); }

// 그 종목의 실제 종가(추천 2주 전 ~ 매도 2주 뒤)
const t0 = Math.floor(Date.parse(best.from) / 1000) - 14 * 86400, t1 = Math.floor(Date.parse(best.to) / 1000) + 14 * 86400;
const j = await (await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(best.ticker)}?period1=${t0}&period2=${t1}&interval=1d`, { headers: { 'user-agent': 'Mozilla/5.0' } })).json();
const res = j?.chart?.result?.[0];
const pts = (res?.timestamp ?? []).map((t, i) => ({ d: new Date((t + 9 * 3600) * 1000).toISOString().slice(0, 10), c: res.indicators.quote[0].close[i] })).filter((p) => p.c != null);
if (pts.length < 5) { console.error(`${best.ticker} 종가를 못 받았다 — 그림 없이 만들지 않는다`); process.exit(1); }
const W = 560, H = 300, lo = Math.min(...pts.map((p) => p.c)), hi = Math.max(...pts.map((p) => p.c));
const x = (i) => 20 + (i / (pts.length - 1)) * (W - 40), y = (c) => H - 20 - ((c - lo) / (hi - lo || 1)) * (H - 40);
const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.c).toFixed(1)}`).join(' ');
// 추천은 주말에도 나간다(HPSP 6/13 토) — 추천 점은 그 날 **이전 마지막 거래일**(추천 기준가), 매도 점은 매도일 이후 첫 거래일.
const before = (d) => { let k = -1; pts.forEach((p, i) => { if (p.d <= d) k = i; }); return Math.max(0, k); };
const after = (d) => { const i = pts.findIndex((p) => p.d >= d); return i < 0 ? pts.length - 1 : i; };
const ib = before(best.from), is = Math.max(after(best.to), ib + 1);
const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <rect x="${x(ib)}" y="0" width="${Math.max(6, x(is) - x(ib))}" height="${H}" fill="rgba(255,212,0,.16)"/>
  <path d="${line}" fill="none" stroke="#34d399" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"/>
  <circle cx="${x(ib)}" cy="${y(pts[ib].c)}" r="13" fill="#ffd400" stroke="#000" stroke-width="3"/>
  <circle cx="${x(is)}" cy="${y(pts[is].c)}" r="13" fill="#ff3b30" stroke="#000" stroke-width="3"/>
</svg>`;
const md = (s) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
const html = `<!doctype html><meta charset="utf-8"><style>*{margin:0;box-sizing:border-box}
body{width:1280px;height:720px;background:radial-gradient(circle at 75% 40%,#13233f 0%,#070b14 70%);font-family:'Apple SD Gothic Neo',sans-serif;position:relative;overflow:hidden;color:#fff}
.l{position:absolute;left:64px;top:70px;width:640px}
.k{font-size:84px;font-weight:900;color:#ffd400;-webkit-text-stroke:3px #000;paint-order:stroke fill;line-height:1.05}
.n{font-size:210px;font-weight:900;color:#ff3b30;-webkit-text-stroke:6px #000;paint-order:stroke fill;line-height:1;margin-top:6px;letter-spacing:-6px}
.s{font-size:40px;font-weight:800;margin-top:14px}.f{font-size:24px;color:#9fb0c8;margin-top:10px;width:600px}
.r{position:absolute;right:48px;top:130px}.g{width:560px;font-size:23px;font-weight:700;color:#cbd5e1;text-align:right;margin-top:8px}
.b{position:absolute;left:64px;bottom:46px;font-size:46px;font-weight:900}.b span{color:#ffd400}</style>
<div class="l"><div class="k">AI가 고른 종목</div><div class="n">+${best.pnl}%</div>
<div class="s">${best.name} · ${md(best.from)} 추천 → ${md(best.to)} 매도</div><div class="f">실제 추천 기록 · 과거 성과는 미래 수익을 보장하지 않습니다</div></div>
<div class="r">${svg}<div class="g">${best.ticker} 실제 종가 · 노랑 추천일 · 빨강 매도일</div></div>
<div class="b">매일 무료 · <span>flowvium.net</span></div>`;
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.setContent(html); await p.waitForTimeout(300);
await p.screenshot({ path: OUT, type: 'jpeg', quality: 90 });
await b.close();
console.log(`✅ ${OUT} · ${best.ticker} +${best.pnl}% (${best.from}→${best.to}) · ${(statSync(OUT).size / 1024).toFixed(0)}KB`);
const vid = arg('upload');
if (vid) {
  const { setThumbnail } = await import('../lib/youtube.mjs');
  const r = await setThumbnail(vid, OUT);
  console.log(r.ok ? `✅ 썸네일 교체 ${vid}` : `❌ 썸네일 교체 실패: ${r.reason}`);
  if (!r.ok) process.exit(1);
}
