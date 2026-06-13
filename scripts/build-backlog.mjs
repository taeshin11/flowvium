#!/usr/bin/env node
/**
 * scripts/build-backlog.mjs — 전 US 종목 수주잔고(backlog) 빌드 (2026-06-13, 사용자 "전종목 할수있는법").
 *
 * 방법: SEC XBRL RPO(RevenueRemainingPerformanceObligation, ASC606 표준태그) companyconcept API.
 *   방산·제조·건설·SaaS·자본재 등 *주문기반* 기업이 표준 보고 — 산업 무관 structured(환각 0).
 *   잔고가 없는 업종(은행·소매)은 태그 부재 → null (정상, 결손 아님).
 *   레벨 + YoY(잔고 증가율 = 향후 매출 가시성·book-to-bill proxy) 계산.
 * KR: DART 에 표준 수주잔고 태그 부재 → 신규수주는 contract_win 신호(flow)로 커버. backlog(level)은
 *   조선/건설 사업보고서 비정형이라 구조 소스 없음 — US RPO 가 유일한 전종목 structured 경로.
 *
 * 출력: data/backlog.json { TICKER: { rpoUsd, rpoYoYPct, end, tag } }
 * 사용: node scripts/build-backlog.mjs [--only-missing]
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';

const UA = { 'User-Agent': 'Flowvium research contact@flowvium.net' };
const OUT = 'data/backlog.json';
const TAGS = ['RevenueRemainingPerformanceObligation', 'ContractWithCustomerLiability'];

const cand = JSON.parse(readFileSync('data/candidate-tickers.json', 'utf8'));
const usTickers = (cand.tickers ?? []).filter(t => !/\.(KS|KQ)$/.test(t) && !/^\d/.test(t));

const map = await (await fetch('https://www.sec.gov/files/company_tickers.json', { headers: UA, signal: AbortSignal.timeout(15000) })).json();
const t2c = {};
for (const k in map) t2c[map[k].ticker.toUpperCase()] = String(map[k].cik_str).padStart(10, '0');

const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const onlyMissing = process.argv.includes('--only-missing');
const out = { ...prev };
let found = 0, attempted = 0;

for (const t of usTickers) {
  if (onlyMissing && prev[t]) continue;
  const cik = t2c[t.replace(/\.(KS|KQ)$/, '').toUpperCase()];
  if (!cik) continue;
  attempted++;
  let rec = null;
  for (const tag of TAGS) {
    try {
      const r = await fetch(`https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/${tag}.json`, { headers: UA, signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const d = await r.json();
      const usd = (d.units?.USD ?? []).filter(x => x.form && /10-K|10-Q/.test(x.form) && x.val != null);
      if (!usd.length) continue;
      usd.sort((a, b) => (a.end < b.end ? 1 : -1));
      const latest = usd[0];
      // YoY: ~1년 전 (end 350-380일 차) 동일태그 값
      const prevYear = usd.find(x => { const dd = (new Date(latest.end) - new Date(x.end)) / 86400000; return dd >= 350 && dd <= 400; });
      const rpoYoYPct = prevYear && prevYear.val > 0 ? +(((latest.val / prevYear.val) - 1) * 100).toFixed(1) : null;
      rec = { rpoUsd: latest.val, rpoYoYPct, end: latest.end, tag: tag === 'RevenueRemainingPerformanceObligation' ? 'RPO' : 'deferred' };
      break;
    } catch { /* next tag */ }
    await new Promise(res => setTimeout(res, 100));
  }
  if (rec) { out[t] = rec; found++; }
  await new Promise(res => setTimeout(res, 100));
  if (attempted % 100 === 0) console.log(`  ... ${attempted} 시도 / ${found} backlog 보유`);
}

writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
console.log(`✅ backlog: ${found}/${attempted} 시도 보유 → ${OUT} (총 ${Object.keys(out).length})`);
