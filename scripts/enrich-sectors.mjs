#!/usr/bin/env node
/**
 * scripts/enrich-sectors.mjs — sector 미상(Unknown/KR/∅) 종목을 권위 소스로 보강 (US + KR 전체).
 *
 * 2026-06-05: US sector=Unknown 105(BA/RTX/ORCL/TSLA 등) Yahoo crumb 보강 (US 전용 초판).
 * 2026-06-14: **US+KR 전체로 확장** (사용자 "enrich-sectors 는 US 만 / KR HPSP='차량' 환각").
 *   - KR 235종이 meta.sector="KR" generic → LLM 이 종목 사업 모르고 "차량/에너지/국방" 환각.
 *   - 1차 seed: data/company-profiles.json (이미 수집된 Yahoo assetProfile 701건, KR 348 포함) — 무네트워크.
 *   - 2차: profiles 미수록 잔여만 Yahoo crumb 로 직접 fetch.
 *   - 기존 실제 sector 는 보존(덮어쓰기 금지) — 'KR'/'Unknown'/'∅' 만 채움.
 *   - US 는 프로젝트 taxonomy(소문자) · KR 은 Yahoo raw(대문자, 기존 KR 표기와 통일) + 반도체 세분.
 * 사용: node scripts/enrich-sectors.mjs           (전체 보강)
 *       node scripts/enrich-sectors.mjs --no-net  (profiles seed 만, 네트워크 생략)
 * 이후: npm run build:universe (파생 동기화)
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';

const NO_NET = process.argv.includes('--no-net');

// Yahoo sector → 프로젝트 taxonomy (US 용, SECTOR_ETF/sectorAllocation 기준 소문자)
const US_MAP = {
  'Technology': 'technology', 'Financial Services': 'financials', 'Healthcare': 'healthcare',
  'Industrials': 'industrials', 'Consumer Cyclical': 'consumer-discretionary',
  'Consumer Defensive': 'consumer-staples', 'Energy': 'energy', 'Real Estate': 'real-estate',
  'Basic Materials': 'materials', 'Utilities': 'utilities', 'Communication Services': 'communication-services',
};

const isKr = (t) => /\.(KS|KQ)$/.test(t);
const bad = (s) => !s || s === 'Unknown' || s === 'KR' || s === 'kr' || s === '';

// KR ETF 판별 (Naver/Yahoo assetProfile 미제공이 정상 — buy 후보에서 제외되므로 sector 미상 허용)
const KR_ETF = /^(TIGER|KODEX|KBSTAR|ARIRANG|ACE|SOL|KINDEX|HANARO|PLUS|RISE|KOSEF|TIMEFOLIO|KCGI|마이티|히어로즈|마이다스|파워|FOCUS|포커스|WON|TREX|BNK|에셋플러스)/i;
const isKrEtf = (name) => KR_ETF.test(name || '') || /레버리지|인버스|\bETF\b|채권|국채|S&P|나스닥|코스닥150|코스피200|2X|선물/.test(name || '');

// Naver WICS 업종명(한글) → 프로젝트 sector 라벨 (KR 대문자 표기). substring 매칭, 미스 시 한글명 그대로.
function krIndustryToSector(koName) {
  const n = koName || '';
  if (/반도체/.test(n)) return 'Semiconductors';
  if (/제약|생물공학|바이오|건강관리|생명과학|의료/.test(n)) return 'Healthcare';
  if (/은행|증권|보험|금융|카드|캐피탈|지주/.test(n)) return 'Financials';
  if (/자동차/.test(n)) return 'Automotive';
  if (/2차전지|전지|배터리/.test(n)) return 'Battery';
  if (/소프트웨어|인터넷|IT서비스|게임|디스플레이|전자장비|전자제품|컴퓨터|통신장비|하드웨어/.test(n)) return 'Technology';
  if (/화학|화장품/.test(n)) return 'Materials';
  if (/금속|광물|철강|비철/.test(n)) return 'Materials';
  if (/기계|건설|조선|중공업|항공|운송|상사|전기장비|건축/.test(n)) return 'Industrials';
  if (/식품|음료|담배|가정용품|생활용품/.test(n)) return 'Consumer Staples';
  if (/의류|섬유|호텔|레저|유통|소매|미디어|교육|화장품|백화점|면세/.test(n)) return 'Consumer Cyclical';
  if (/석유|가스|에너지/.test(n)) return 'Energy';
  if (/유틸리티|전력|전기.?가스/.test(n)) return 'Utilities';
  if (/부동산|리츠/.test(n)) return 'Real Estate';
  if (/통신서비스|미디어와엔터|방송/.test(n)) return 'Communication Services';
  return n || null; // 매핑 미스 → 한글 업종명 그대로 (generic 'KR' 보다 grounding 우수)
}

const naverIndustryCache = new Map(); // industryCode → 한글 업종명
async function naverSector(stockCode) {
  try {
    const r = await fetch(`https://m.stock.naver.com/api/stock/${stockCode}/integration`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const code = (await r.json())?.industryCode;
    if (!code) return null;
    if (!naverIndustryCache.has(code)) {
      const ir = await fetch(`https://m.stock.naver.com/api/stocks/industry/${code}?page=1&pageSize=1`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
      naverIndustryCache.set(code, ir.ok ? ((await ir.json())?.groupInfo?.name ?? null) : null);
    }
    const ko = naverIndustryCache.get(code);
    return ko ? krIndustryToSector(ko) : null;
  } catch { return null; }
}

/** raw Yahoo sector(+industry) → 종목 시장에 맞는 sector 라벨. 반도체는 industry 로 세분. */
function normalizeSector(ySector, yIndustry, krTicker) {
  if (!ySector) return null;
  const ind = yIndustry || '';
  if (/semiconductor/i.test(ind)) return krTicker ? 'Semiconductors' : 'semiconductors';
  if (krTicker) return ySector;            // KR: Yahoo raw 대문자 (기존 KR meta 표기와 통일)
  return US_MAP[ySector] ?? null;          // US: 프로젝트 taxonomy 소문자
}

async function getCrumb() {
  const r = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
  const cookie = (r.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
  const cr = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': 'Mozilla/5.0', Cookie: cookie }, signal: AbortSignal.timeout(8000) });
  return { crumb: await cr.text(), cookie };
}

async function fetchProfile(ticker, crumb, cookie) {
  try {
    const r = await fetch(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=assetProfile&crumb=${encodeURIComponent(crumb)}`,
      { headers: { 'User-Agent': 'Mozilla/5.0', Cookie: cookie }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const p = (await r.json())?.quoteSummary?.result?.[0]?.assetProfile;
    if (!p) return null;
    return { sector: p.sector ?? null, industry: p.industry ?? null, summary: p.longBusinessSummary ?? null };
  } catch { return null; }
}

const cand = JSON.parse(readFileSync('data/candidate-tickers.json', 'utf8'));
cand.meta = cand.meta || {};
const profiles = existsSync('data/company-profiles.json') ? JSON.parse(readFileSync('data/company-profiles.json', 'utf8')) : {};

const missing = cand.tickers.filter(t => bad(cand.meta[t]?.sector));
console.log(`sector 미상: ${missing.length}종 (US ${missing.filter(t => !isKr(t)).length} / KR ${missing.filter(isKr).length})`);

// ── 1차: company-profiles.json seed (무네트워크) ───────────────────────────
let seeded = 0;
const stillMissing = [];
for (const t of missing) {
  const pf = profiles[t];
  const sec = pf ? normalizeSector(pf.sector, pf.industry, isKr(t)) : null;
  if (sec) { cand.meta[t] = { ...(cand.meta[t] || {}), sector: sec }; seeded++; }
  else stillMissing.push(t);
}
console.log(`  [seed] company-profiles 로 보강 ${seeded}종 | 잔여 ${stillMissing.length}`);

// ── 2차: 잔여만 Yahoo 직접 fetch ───────────────────────────────────────────
let fetched = 0;
const failed = [];
if (!NO_NET && stillMissing.length) {
  const { crumb, cookie } = await getCrumb();
  if (!crumb) { console.error('crumb 실패 — seed 결과만 저장'); }
  else {
    const CONC = 4;
    for (let i = 0; i < stillMissing.length; i += CONC) {
      const batch = stillMissing.slice(i, i + CONC);
      const res = await Promise.all(batch.map(async t => ({ t, pf: await fetchProfile(t, crumb, cookie) })));
      for (const { t, pf } of res) {
        const sec = pf ? normalizeSector(pf.sector, pf.industry, isKr(t)) : null;
        if (sec) {
          cand.meta[t] = { ...(cand.meta[t] || {}), sector: sec };
          if (pf.summary) { profiles[t] = { ...(profiles[t] || {}), name: cand.meta[t]?.name, sector: pf.sector, industry: pf.industry, summary: pf.summary, asOf: new Date().toISOString().slice(0, 10) }; }
          fetched++;
        } else failed.push(t);
      }
      if (i % 40 === 0) console.log(`  [net] ${i + batch.length}/${stillMissing.length} (보강 ${fetched})`);
    }
    // 새로 fetch 한 summary 는 profiles 에도 적재 (다음 실행 seed + 생성기 grounding 재사용)
    if (fetched) writeFileSync('data/company-profiles.json', JSON.stringify(profiles, null, 2) + '\n');
  }
} else if (NO_NET) {
  console.log('  [net] --no-net → 네트워크 생략');
  failed.push(...stillMissing);
}

// ── 3차: Yahoo 미커버 KR 종목(404)은 Naver WICS 업종(권위 KR 소스)으로 보강. ETF 는 제외. ──
let naverN = 0;
const krResidual = cand.tickers.filter(t => isKr(t) && bad(cand.meta[t]?.sector) && !isKrEtf(cand.meta[t]?.name));
if (!NO_NET && krResidual.length) {
  console.log(`  [naver] Yahoo 미커버 KR ${krResidual.length}종 → Naver WICS 업종 보강`);
  const CONC = 3;
  for (let i = 0; i < krResidual.length; i += CONC) {
    const batch = krResidual.slice(i, i + CONC);
    const res = await Promise.all(batch.map(async t => ({ t, sec: await naverSector(t.replace(/\.(KS|KQ)$/, '')) })));
    for (const { t, sec } of res) { if (sec) { cand.meta[t] = { ...(cand.meta[t] || {}), sector: sec }; naverN++; } }
    await new Promise(s => setTimeout(s, 250));
  }
  console.log(`  [naver] 보강 ${naverN}/${krResidual.length} (업종 ${naverIndustryCache.size}종 캐시)`);
}

writeFileSync('data/candidate-tickers.json', JSON.stringify(cand, null, 2) + '\n');

const remain = cand.tickers.filter(t => bad(cand.meta[t]?.sector));
console.log(`\n✅ sector 보강 완료: seed ${seeded} + Yahoo ${fetched} + Naver ${naverN} = ${seeded + fetched + naverN}종 | 미상 잔여 ${remain.length}`);
const remainNonEtf = remain.filter(t => !isKrEtf(cand.meta[t]?.name));
console.log(`  잔여 ${remain.length} 중 비ETF ${remainNonEtf.length}: ${remainNonEtf.slice(0, 20).join(',')}${remainNonEtf.length > 20 ? ' ...' : ''}`);
if (remainNonEtf.length === 0) console.log('  (잔여는 전부 ETF — assetProfile 미제공 정상, buy 후보 제외 대상)');
console.log('샘플 US:', ['BA', 'RTX', 'ORCL', 'TSLA', 'LMT'].map(t => `${t}=${cand.meta[t]?.sector ?? '∅'}`).join(' '));
console.log('샘플 KR:', ['403870.KQ', '033780.KS', '005930.KS'].map(t => `${t}=${cand.meta[t]?.sector ?? '∅'}`).join(' '));
