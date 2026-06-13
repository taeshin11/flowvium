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
// 2026-06-13: end-date 정렬 추출 (NVDA opMargin 484%·FY2022 stale 버그 fix). XBRL 다중태그/restatement/
//   분기·TTM 혼재 위험 → ① 연간(start~end ≈ 350-380일)만 ② 같은 회계연도 end 로 전 지표 정렬
//   ③ sanity 범위. 이게 "값 진위" 검증(형태 아닌 내용).
function annualByEnd(facts, tags) {
  // 2026-06-13 fix: 태그 *전부* 병합 (break 금지). NVDA 처럼 최근FY=Revenues / 과거FY=
  //   RevenueFromContract... 로 태그가 갈리면, 첫 태그서 break 하면 stale FY(2022) 만 잡힘.
  //   end별 first-tag 우선(우선순위 순서 = 권위), 병합 후 최신 end 선택 → 최신 FY 보장.
  const byEnd = new Map();
  for (const tag of tags) {
    const u = facts?.['us-gaap']?.[tag]?.units?.USD;
    if (!Array.isArray(u)) continue;
    for (const x of u) {
      if (x.form !== '10-K' || !x.start || !x.end || x.val == null) continue;
      const days = (new Date(x.end) - new Date(x.start)) / 86400000;
      if (days < 350 || days > 380) continue;  // 연간만 (분기/TTM 제외)
      if (!byEnd.has(x.end)) byEnd.set(x.end, x.val);  // end별 우선순위 높은(먼저 순회) 태그값 유지
    }
    // break 없음 — 모든 후보 태그 병합 (태그 split 종목의 최신 FY 누락 방지)
  }
  return byEnd;  // Map<endDate, val>
}
// 시점(instant) 값 — equity 등 (start 없음)
function instantByEnd(facts, tags) {
  const byEnd = new Map();
  for (const tag of tags) {
    const u = facts?.['us-gaap']?.[tag]?.units?.USD;
    if (!Array.isArray(u)) continue;
    for (const x of u) {
      if (x.form !== '10-K' || x.start || !x.end || x.val == null) continue;  // instant=start 없음
      if (!byEnd.has(x.end)) byEnd.set(x.end, x.val);
    }
    // break 없음 — 태그 병합
  }
  return byEnd;
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
    // 2026-06-13: 태그 확장 — 은행(RevenuesNetOfInterestExpense)·유틸(RegulatedAndUnregulated…)
    //   포함. NVDA류 외 DUK/WFC/MS/NEE 가 stale FY 였던 근본 = 최신매출이 미확인 태그에 있음.
    const revM = annualByEnd(facts, [
      'RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet',
      'RevenuesNetOfInterestExpense', 'RegulatedAndUnregulatedOperatingRevenue',
      'TotalRevenuesAndOtherIncome', 'RevenueFromContractWithCustomerIncludingAssessedTax',
    ]);
    if (!revM.size) { await new Promise(s => setTimeout(s, 90)); continue; }
    const ends = [...revM.keys()].sort((a, b) => (a < b ? 1 : -1));  // 최신 end 먼저
    const latestEnd = ends[0];
    // staleness guard: 최신 FY 가 2년+ 오래면 = 우리가 그 종목 최신매출 태그를 못 잡은 것 → 방출 금지
    //   (stale 를 "현재"인 양 내보내는 게 진짜 해악. null = 펀더멘털 신호 없음으로 안전 처리).
    const NOW_Y = new Date().getFullYear();
    if (latestEnd && (NOW_Y - (+latestEnd.slice(0, 4))) > 2) { await new Promise(s => setTimeout(s, 90)); continue; }
    const rev = revM.get(latestEnd);
    // 직전 회계연도 end (~1년 전)
    const prevEnd = ends.find(e => { const dd = (new Date(latestEnd) - new Date(e)) / 86400000; return dd >= 330 && dd <= 400; });
    const revPrev = prevEnd ? revM.get(prevEnd) : null;
    // op/ni 는 *같은 end* 로 정렬 (기간 불일치 484% 버그 차단)
    const opM = annualByEnd(facts, ['OperatingIncomeLoss']);
    const niM = annualByEnd(facts, ['NetIncomeLoss']);
    const eqM = instantByEnd(facts, ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest']);
    const op = opM.get(latestEnd) ?? null;
    const ni = niM.get(latestEnd) ?? null;
    const eq = eqM.get(latestEnd) ?? null;
    let opMarginPct = op != null && rev > 0 ? +((op / rev) * 100).toFixed(1) : null;
    let roePct = ni != null && eq > 0 ? +((ni / eq) * 100).toFixed(1) : null;
    // sanity: opMargin -100~100, ROE -300~300 (이탈 = 기간/태그 불일치 → 버림)
    if (opMarginPct != null && (opMarginPct < -100 || opMarginPct > 100)) opMarginPct = null;
    if (roePct != null && (roePct < -300 || roePct > 300)) roePct = null;
    out[t] = {
      revUsd: rev,
      revYoYPct: revPrev > 0 ? +(((rev / revPrev) - 1) * 100).toFixed(1) : null,
      opMarginPct, roePct,
      fy: latestEnd?.slice(0, 4) ?? null,
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
      // 2026-06-13: US 와 동일 sanity clamp (KR 경로 누락이 -219651% 등 garbage 통과시킴).
      //   영세 KOSDAQ 적자기업은 opMargin -500% 등 = 노이즈 → null. ROE -300~300 외 버림.
      let opMarginPct = la.operatingMarginPct ?? null;
      let roePct = la.roePct ?? null;
      if (opMarginPct != null && (opMarginPct < -100 || opMarginPct > 100)) opMarginPct = null;
      if (roePct != null && (roePct < -300 || roePct > 300)) roePct = null;
      out[t] = {
        revUsd: la.revenueUSD,
        revYoYPct: d.revenueYoYPct ?? la.revenueYoYPct ?? null,
        opMarginPct, roePct,
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
