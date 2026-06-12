#!/usr/bin/env node
/**
 * scripts/build-company-profiles.mjs — 폴백(미큐레이션) US 종목 사실 프로필 일괄 수집.
 *
 * 배경(2026-06-12 사용자 "AAPL은 자세한데 WDAY는 부실 — 전수조사"): 전수조사 결과 US 873 중
 *   329종(38%)이 companies-batch 미수록 → minimal 폴백 페이지, 그중 316종은 사업 설명조차 없음.
 *   Yahoo quoteSummary assetProfile(권위 소스, enrich-sectors.mjs 와 동일 crumb 패턴)에서
 *   longBusinessSummary/sector/industry/직원수/웹사이트를 수집 — 추측/LLM생성 금지, 사실만.
 *
 * 출력: data/company-profiles.json  { TICKER: { name, sector, industry, employees, website, summary, asOf } }
 * 소비: /api/company-business/[ticker] (profile 필드) → CompanyPage 폴백 렌더.
 * 사용: node scripts/build-company-profiles.mjs          (전체 갱신 — 기존 항목도 재수집)
 *       node scripts/build-company-profiles.mjs --missing (미보유분만)
 *       node scripts/build-company-profiles.mjs --tickers=WDAY,APH (특정 종목 — 보고서 신규 종목 hook)
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';

const OUT = 'data/company-profiles.json';
const onlyMissing = process.argv.includes('--missing');

// 대상: candidate US 중 companies-batch 미수록 (폴백 페이지 사용 종목)
const cand = JSON.parse(readFileSync('data/candidate-tickers.json', 'utf8'));
const candArr = Array.isArray(cand) ? cand : (cand.tickers ?? []);
const batch = new Set();
for (let i = 1; i <= 10; i++) {
  try {
    const s = readFileSync(`src/data/companies-batch${i}.ts`, 'utf8');
    for (const m of s.matchAll(/ticker:\s*['"]([A-Z0-9.\-]+)['"]/g)) batch.add(m[1]);
  } catch { /* */ }
}
try {
  const s = readFileSync('src/data/companies.ts', 'utf8');
  for (const m of s.matchAll(/ticker:\s*['"]([A-Z0-9.\-]+)['"]/g)) batch.add(m[1]);
} catch { /* */ }
const targets = candArr.filter(t => !/\.(KS|KQ)$/.test(t) && !batch.has(t));

const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
// 2026-06-12: --tickers= 모드 — 보고서 파이프라인이 portfolio 신규 종목을 즉석 보강 (사용자
//   "보고서에 새 종목 잡힐 때마다 풀페이지"). 후보 풀 제약 없이 명시 종목 수집.
const tickersArg = process.argv.find(a => a.startsWith('--tickers='));
// 2026-06-12: --tickers 모드는 KR(.KS/.KQ) 도 허용 — Yahoo assetProfile 이 KR 도 지원하는데
//   "KR 은 DART 가 커버" 가정으로 제외했더니 KT&G 페이지 사업설명 전무 (사용자 "AAPL 에 비해 부실").
const todo = tickersArg
  ? tickersArg.split('=')[1].split(',').map(t => t.trim().toUpperCase()).filter(Boolean)
  : onlyMissing ? targets.filter(t => !prev[t]) : targets;
console.log(`[profiles] 대상 ${tickersArg ? todo.length + ' (--tickers)' : targets.length + ' (US 폴백)'} / 수집 ${todo.length}${onlyMissing ? ' (--missing)' : ''}`);
if (!todo.length) { console.log('[profiles] 수집 대상 없음'); process.exit(0); }

async function getCrumb() {
  const r = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
  const cookie = (r.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
  const cr = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': 'Mozilla/5.0', Cookie: cookie }, signal: AbortSignal.timeout(8000) });
  return { crumb: await cr.text(), cookie };
}

async function fetchProfile(ticker, crumb, cookie) {
  // Yahoo 는 BRK-B 형식 (dot → dash 이미 candidate 형식이 dash)
  const r = await fetch(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=assetProfile,quoteType&crumb=${encodeURIComponent(crumb)}`,
    { headers: { 'User-Agent': 'Mozilla/5.0', Cookie: cookie }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) return { _status: r.status };
  const j = await r.json();
  const res = j?.quoteSummary?.result?.[0];
  const p = res?.assetProfile;
  if (!p) return null;
  return {
    name: res?.quoteType?.longName ?? null,
    sector: p.sector ?? null,
    industry: p.industry ?? null,
    employees: p.fullTimeEmployees ?? null,
    website: p.website ?? null,
    summary: p.longBusinessSummary ?? null,
    asOf: new Date().toISOString().slice(0, 10),
  };
}

const { crumb, cookie } = await getCrumb();
if (!crumb || crumb.includes('<')) { console.error('[profiles] crumb 획득 실패 — Yahoo 차단?'); process.exit(1); }

let ok = 0, fail = 0, rate = 0;
for (const [i, t] of todo.entries()) {
  try {
    const p = await fetchProfile(t, crumb, cookie);
    if (p && !p._status && (p.summary || p.industry)) { prev[t] = p; ok++; }
    else if (p?._status === 429) { rate++; await new Promise(r => setTimeout(r, 5000)); }
    else fail++;
  } catch { fail++; }
  await new Promise(r => setTimeout(r, 250)); // rate-limit 예방
  if ((i + 1) % 50 === 0) {
    writeFileSync(OUT, JSON.stringify(prev, null, 0) + '\n'); // 중간 저장 (중단 내성)
    console.log(`  ${i + 1}/${todo.length} (ok ${ok} / fail ${fail} / 429 ${rate})`);
  }
}
writeFileSync(OUT, JSON.stringify(prev, null, 0) + '\n');
console.log(`[profiles] 완료: ok ${ok} / fail ${fail} / 429 ${rate} → ${OUT} (총 ${Object.keys(prev).length}종)`);
console.log(`  예: WDAY=${JSON.stringify(prev.WDAY ?? null)?.slice(0, 140)}`);
