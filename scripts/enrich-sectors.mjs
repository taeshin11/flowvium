#!/usr/bin/env node
/**
 * scripts/enrich-sectors.mjs — sector=Unknown 종목을 Yahoo assetProfile(권위 소스)로 보강.
 * 2026-06-05: candidate-tickers meta.sector Unknown 105(BA/RTX/ORCL/TSLA 등) → Yahoo crumb 인증으로
 *   실제 sector fetch → 프로젝트 taxonomy 매핑 → meta 갱신. 추측 금지, 권위 소스만.
 * 사용: node scripts/enrich-sectors.mjs   (이후 npm run build:universe)
 */
import { readFileSync, writeFileSync } from 'fs';

// Yahoo sector → 프로젝트 taxonomy (SECTOR_ETF/sectorAllocation 기준)
const MAP = {
  'Technology': 'technology', 'Financial Services': 'financials', 'Healthcare': 'healthcare',
  'Industrials': 'industrials', 'Consumer Cyclical': 'consumer-discretionary',
  'Consumer Defensive': 'consumer-staples', 'Energy': 'energy', 'Real Estate': 'real-estate',
  'Basic Materials': 'materials', 'Utilities': 'utilities', 'Communication Services': 'communication-services',
};

async function getCrumb() {
  const r = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
  const cookie = (r.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
  const cr = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': 'Mozilla/5.0', Cookie: cookie }, signal: AbortSignal.timeout(8000) });
  return { crumb: await cr.text(), cookie };
}

async function fetchSector(ticker, crumb, cookie) {
  try {
    const r = await fetch(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=assetProfile&crumb=${encodeURIComponent(crumb)}`,
      { headers: { 'User-Agent': 'Mozilla/5.0', Cookie: cookie }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const p = (await r.json())?.quoteSummary?.result?.[0]?.assetProfile;
    const ySec = p?.sector;
    // semiconductors 세분화 (industry 기반)
    if (/semiconductor/i.test(p?.industry || '')) return 'semiconductors';
    return ySec ? (MAP[ySec] ?? null) : null;
  } catch { return null; }
}

const cand = JSON.parse(readFileSync('data/candidate-tickers.json', 'utf8'));
cand.meta = cand.meta || {};
const us = cand.tickers.filter(t => !/\.(KS|KQ)$/.test(t));
const unknown = us.filter(t => !cand.meta[t]?.sector || cand.meta[t].sector === 'Unknown');
console.log(`sector=Unknown US: ${unknown.length} → Yahoo 권위 보강`);

const { crumb, cookie } = await getCrumb();
if (!crumb) { console.error('crumb 실패'); process.exit(1); }

let filled = 0, failed = [];
const CONC = 4;
for (let i = 0; i < unknown.length; i += CONC) {
  const batch = unknown.slice(i, i + CONC);
  const res = await Promise.all(batch.map(async t => ({ t, sec: await fetchSector(t, crumb, cookie) })));
  for (const { t, sec } of res) {
    if (sec) { cand.meta[t] = { ...(cand.meta[t] || {}), sector: sec }; filled++; }
    else failed.push(t);
  }
  if (i % 20 === 0) console.log(`  ... ${i + batch.length}/${unknown.length} (채움 ${filled})`);
}

writeFileSync('data/candidate-tickers.json', JSON.stringify(cand, null, 2) + '\n');
console.log(`\n✅ sector 보강 ${filled}/${unknown.length} | 실패 ${failed.length}: ${failed.slice(0, 15).join(',')}`);
console.log('샘플:', ['BA', 'ORCL', 'TSLA', 'BX', 'GEHC'].map(t => `${t}=${cand.meta[t]?.sector}`).join(' '));
