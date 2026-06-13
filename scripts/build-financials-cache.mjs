#!/usr/bin/env node
/**
 * scripts/build-financials-cache.mjs — 전 종목 펀더멘털 사전수집 (2026-06-13, 사용자 "미리미리
 *   수집해두면 되잖아. 다 자세히"). 깔때기(top-50 deep fetch) 제약 제거 — stage-1 에서 전 종목
 *   재무 평가 가능하게 캐시.
 *
 * US: SEC companyfacts/CIK{cik}.json — 1콜로 전 태그 → revenue/netIncome/equity/operatingIncome
 *   추출, revYoY·opMargin·ROE 계산. (companyconcept 4콜 대신 1콜 — SEC 부하 1/4.)
 * KR: /api/company-kr/{code} (DART, prefetch 와 동일 소스) latestAnnual.
 *
 * 출력: data/financials.json { TICKER: { revUsd, revYoYPct, opMarginPct, roePct, fy } }
 * 사용: node scripts/build-financials-cache.mjs   (일 cron — 분기보고라 일 1회 충분)
 */
import { readFileSync, writeFileSync } from 'fs';

const UA = { 'User-Agent': 'Flowvium research contact@flowvium.net' };
const SITE = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\s+/g, '') || 'http://localhost:3000';
const OUT = 'data/financials.json';

const cand = JSON.parse(readFileSync('data/candidate-tickers.json', 'utf8'));
const all = cand.tickers ?? [];
const usT = all.filter(t => !/\.(KS|KQ)$/.test(t) && !/^\d/.test(t) && !cand.meta?.[t]?.cap?.includes('etf'));
const krT = all.filter(t => /\.(KS|KQ)$/.test(t));

const map = await (await fetch('https://www.sec.gov/files/company_tickers.json', { headers: UA, signal: AbortSignal.timeout(15000) })).json();
const t2c = {};
for (const k in map) t2c[map[k].ticker.toUpperCase()] = String(map[k].cik_str).padStart(10, '0');

const out = {};
// 최신 연간 fact 값 (10-K) + 직전연도 — USD 단위
function annual(facts, tag) {
  const u = facts?.['us-gaap']?.[tag]?.units?.USD;
  if (!Array.isArray(u)) return null;
  const fy = u.filter(x => x.form === '10-K' && x.fp === 'FY' && x.frame).sort((a, b) => (a.end < b.end ? 1 : -1));
  return fy.length ? fy : null;
}
let usFound = 0;
for (let i = 0; i < usT.length; i++) {
  const t = usT[i];
  const cik = t2c[t.toUpperCase()];
  if (!cik) continue;
  try {
    const r = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, { headers: UA, signal: AbortSignal.timeout(10000) });
    if (!r.ok) { await new Promise(s => setTimeout(s, 90)); continue; }
    const facts = (await r.json()).facts;
    const revArr = annual(facts, 'RevenueFromContractWithCustomerExcludingAssessedTax') ?? annual(facts, 'Revenues') ?? annual(facts, 'SalesRevenueNet');
    const niArr = annual(facts, 'NetIncomeLoss');
    const eqArr = annual(facts, 'StockholdersEquity');
    const opArr = annual(facts, 'OperatingIncomeLoss');
    if (!revArr) { await new Promise(s => setTimeout(s, 90)); continue; }
    const rev = revArr[0].val;
    const revPrev = revArr.find(x => { const dd = (new Date(revArr[0].end) - new Date(x.end)) / 86400000; return dd >= 330 && dd <= 400; })?.val;
    const ni = niArr?.[0]?.val ?? null;
    const eq = eqArr?.[0]?.val ?? null;
    const op = opArr?.[0]?.val ?? null;
    out[t] = {
      revUsd: rev,
      revYoYPct: revPrev > 0 ? +(((rev / revPrev) - 1) * 100).toFixed(1) : null,
      opMarginPct: op != null && rev > 0 ? +((op / rev) * 100).toFixed(1) : null,
      roePct: ni != null && eq > 0 ? +((ni / eq) * 100).toFixed(1) : null,
      fy: revArr[0].end?.slice(0, 4) ?? null,
    };
    usFound++;
  } catch { /* skip */ }
  await new Promise(s => setTimeout(s, 90));
  if ((i + 1) % 100 === 0) console.log(`  ... US ${i + 1}/${usT.length} (${usFound} 보유)`);
}

// KR: company-kr (DART) — 서버 Redis 캐시 prefetch 와 공유. SITE 경유.
let krFound = 0;
for (let i = 0; i < krT.length; i++) {
  const t = krT[i];
  try {
    const d = await (await fetch(`${SITE}/api/company-kr/${t.replace(/\.(KS|KQ)$/, '')}`, { signal: AbortSignal.timeout(12000) })).json();
    const la = d?.latestAnnual;
    if (la && la.revenueUSD > 0) {
      out[t] = {
        revUsd: la.revenueUSD,
        revYoYPct: d.revenueYoYPct ?? la.revenueYoYPct ?? null,
        opMarginPct: la.operatingMarginPct ?? null,
        roePct: la.roePct ?? null,
        fy: String(la.fiscalYear ?? '').slice(0, 4) || null,
      };
      krFound++;
    }
  } catch { /* skip */ }
  await new Promise(s => setTimeout(s, 60));
  if ((i + 1) % 100 === 0) console.log(`  ... KR ${i + 1}/${krT.length} (${krFound} 보유)`);
}

writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
console.log(`✅ financials: US ${usFound}/${usT.length} + KR ${krFound}/${krT.length} → ${OUT} (총 ${Object.keys(out).length})`);
