#!/usr/bin/env node
/**
 * scripts/audit-full-coverage.mjs — 전체 1210 종목 상세 커버리지 전수 검사.
 *
 * "1200+ 종목이 다 확실히 자세하게 되는가" 검증: 샘플이 아닌 전수.
 *   각 ticker: (1) stock-price 실가, (2) 재무(US=company-financials / KR=company-kr).
 *   누락 종목을 정확히 나열 → 데이터 갭의 실제 범위 가시화.
 *
 * 외부 API(SEC/DART/Yahoo) rate-limit 고려해 동시성 6 + 캐시 의존. 자기 서버 핑이라 부하 무관.
 * 사용: node scripts/audit-full-coverage.mjs
 */
import { readFileSync } from 'fs';

const SITE = 'http://localhost:3000';
const cand = JSON.parse(readFileSync('data/candidate-tickers.json', 'utf8'));
const tickers = (Array.isArray(cand.tickers) ? cand.tickers : []).filter(Boolean);

async function getJson(path, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(`${SITE}${path}`, { signal: ctrl.signal });
    if (!r.ok) return { ok: false, status: r.status, body: null };
    return { ok: true, status: 200, body: await r.json() };
  } catch (e) { return { ok: false, status: 0, body: null, err: String(e.message || e) }; }
  finally { clearTimeout(t); }
}

async function checkTicker(t) {
  const isKR = /\.(KS|KQ)$/.test(t);
  const sp = await getJson(`/api/stock-price/${t}`);
  const hasPrice = sp.ok && sp.body?.price != null && sp.body.price > 0;
  let hasFin = false;
  if (isKR) {
    const f = await getJson(`/api/company-kr/${t.replace(/\.(KS|KQ)$/, '')}`, 20000);
    hasFin = f.ok && !f.body?.error && f.body?.latestAnnual?.revenueKRW != null;
  } else {
    const f = await getJson(`/api/company-financials/${t}`, 20000);
    hasFin = f.ok && !f.body?.error && f.body?.latestAnnual?.revenueUSD != null;
  }
  return { t, isKR, hasPrice, hasFin };
}

// 동시성 제한 실행
async function run(items, limit, fn) {
  const out = []; let i = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
  });
  await Promise.all(workers);
  return out;
}

const t0 = Date.now();
const results = await run(tickers, 6, checkTicker);
const us = results.filter(r => !r.isKR), kr = results.filter(r => r.isKR);
const noPriceUS = us.filter(r => !r.hasPrice).map(r => r.t);
const noPriceKR = kr.filter(r => !r.hasPrice).map(r => r.t);
const noFinUS = us.filter(r => !r.hasFin).map(r => r.t);
const noFinKR = kr.filter(r => !r.hasFin).map(r => r.t);

const pct = (a, b) => b ? Math.round(a / b * 1000) / 10 : 0;
console.log(`\n[full-coverage ${new Date().toISOString().slice(0, 19)}] ${tickers.length} 종목, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log(`\n실시간 시세(stock-price):`);
console.log(`  US: ${us.length - noPriceUS.length}/${us.length} (${pct(us.length - noPriceUS.length, us.length)}%)`);
console.log(`  KR: ${kr.length - noPriceKR.length}/${kr.length} (${pct(kr.length - noPriceKR.length, kr.length)}%)`);
console.log(`\n재무(US=SEC / KR=DART):`);
console.log(`  US: ${us.length - noFinUS.length}/${us.length} (${pct(us.length - noFinUS.length, us.length)}%)`);
console.log(`  KR: ${kr.length - noFinKR.length}/${kr.length} (${pct(kr.length - noFinKR.length, kr.length)}%)`);
console.log(`\n시세 누락 US (${noPriceUS.length}): ${noPriceUS.slice(0, 40).join(', ')}`);
console.log(`시세 누락 KR (${noPriceKR.length}): ${noPriceKR.slice(0, 40).join(', ')}`);
console.log(`\n재무 누락 US (${noFinUS.length}): ${noFinUS.slice(0, 50).join(', ')}`);
console.log(`재무 누락 KR (${noFinKR.length}): ${noFinKR.slice(0, 50).join(', ')}`);
