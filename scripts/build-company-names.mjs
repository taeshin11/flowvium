#!/usr/bin/env node
/**
 * scripts/build-company-names.mjs — companies-batch*.ts 의 실제 회사명을 ticker→name JSON 으로 추출.
 *
 * 배경(2026-06-03 CPRT→"Cypress Semiconductor" 환각 사건): generate-report-local.mjs 가 portfolio
 * name 검증을 ~60개 하드코딩 `US_NAMES_HARNESS` 로만 했음. CPRT(Copart) 가 거기 없어 LLM 환각이
 * 그대로 통과. 권위 소스(allCompanies, companies-batch*.ts ~515 실제 프로필)를 안 썼기 때문.
 *
 * 이 스크립트가 batch 파일에서 {name, ticker} 쌍을 전부 추출해 data/company-names.json 생성 →
 * generate-report-local.mjs(name override) + verify-report.mjs(name↔ticker probe) 가 공유.
 *
 * 필드 순서 무관(name→ticker / ticker→name 양쪽) + 객체 경계 기반 파싱.
 * 사용: node scripts/build-company-names.mjs   (data/company-names.json 갱신)
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';

const out = {};
let scanned = 0;

for (let i = 1; i <= 10; i++) {
  const f = `src/data/companies-batch${i}.ts`;
  if (!existsSync(f)) continue;
  const src = readFileSync(f, 'utf8');
  // 객체 단위 분할: `{ ... }` 안에서 name 과 ticker 를 같이 잡음 (순서 무관).
  // 각 ticker 출현 위치 기준 ±600자 윈도우에서 가장 가까운 name 매칭.
  const tickerRe = /ticker:\s*["']([A-Z0-9.\-]+)["']/g;
  let m;
  while ((m = tickerRe.exec(src)) !== null) {
    const ticker = m[1];
    const pos = m.index;
    const win = src.slice(Math.max(0, pos - 600), pos + 600);
    // 같은 객체 내 name (가장 가까운 것). name 필드는 회사명, sector/industry 와 구분.
    const nameMatches = [...win.matchAll(/\bname:\s*["']([^"']+)["']/g)];
    if (nameMatches.length === 0) continue;
    // ticker 위치(윈도우 내 상대 좌표)에 가장 가까운 name 선택
    const relTicker = Math.min(pos, 600);
    let best = null, bestDist = Infinity;
    for (const nm of nameMatches) {
      const d = Math.abs(nm.index - relTicker);
      if (d < bestDist) { bestDist = d; best = nm[1]; }
    }
    if (best && !out[ticker]) { out[ticker] = best; scanned++; }
  }
}

// 2026-06-05: SEC company_tickers(권위 소스) 동적 fetch — batch 추출이 못 덮는 US 종목 전체 보강
//   (실명 커버리지 57%→95%+). 사용자 "권위 소스로 1338 전체 커버". 회사명은 거의 안 바뀌어 안정적.
const titleCase = (s) => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
  .replace(/\b(Inc|Corp|Llc|Ltd|Plc|Lp|Co|Sa|Nv|Ag)\b/g, m => m === 'Llc' ? 'LLC' : m === 'Plc' ? 'PLC' : m === 'Lp' ? 'LP' : m === 'Nv' ? 'NV' : m === 'Sa' ? 'SA' : m === 'Ag' ? 'AG' : m)
  .replace(/\/\w+$/, '');   // "GROUP INC/RI" → "Group Inc" 류 접미 코드 제거
try {
  const cand = JSON.parse(readFileSync('data/candidate-tickers.json', 'utf8'));
  const usTickers = (cand.tickers || []).filter(t => !/\.(KS|KQ)$/.test(t)).map(t => t.toUpperCase());
  const r = await fetch('https://www.sec.gov/files/company_tickers.json', {
    headers: { 'User-Agent': 'flowvium research contact@flowvium.net' }, signal: AbortSignal.timeout(20000),
  });
  if (r.ok) {
    const j = await r.json();
    const sec = {}; for (const k in j) sec[j[k].ticker] = j[k].title;
    let filled = 0;
    for (const t of usTickers) { if (!out[t] && sec[t]) { out[t] = titleCase(sec[t]); filled++; } }
    console.log(`[build-company-names] SEC 권위명 보강: ${filled} (예: AMP=${out['AMP'] ?? '?'})`);
  } else console.warn(`[build-company-names] ⚠️ SEC fetch ${r.status} — batch 명만 사용`);
} catch (e) { console.warn(`[build-company-names] ⚠️ SEC fetch 실패: ${String(e.message).slice(0, 50)} — batch 명만`); }

// 2026-06-05: 큐레이션 override — batch/SEC 둘 다 못 덮는 주요 ticker(ETF 포함) 권위명 강제.
//   TSLA 가 candidate meta.name="OEM & Other"(산업라벨)로 UI 노출되던 사건.
const CURATED = {
  // ETF (SEC company_tickers 미수록) — 주요 ETF 권위명
  SPY: 'SPDR S&P 500 ETF', VOO: 'Vanguard S&P 500 ETF', IVV: 'iShares Core S&P 500 ETF',
  VTI: 'Vanguard Total Stock Market ETF', QQQ: 'Invesco QQQ Trust', QQQM: 'Invesco NASDAQ 100 ETF',
  IWM: 'iShares Russell 2000 ETF', DIA: 'SPDR Dow Jones Industrial Average ETF', ITOT: 'iShares Core S&P Total US Stock Market ETF',
  IJR: 'iShares Core S&P Small-Cap ETF', SPLG: 'SPDR Portfolio S&P 500 ETF',
  TSLA: 'Tesla, Inc.', NWSA: 'News Corporation', NWS: 'News Corporation',
  TSM: 'TSMC',  // 2026-06-06: SEC legal name(Taiwan Semiconductor Manufacturing Co Ltd) 대신 보편 표시명. gate↔verify 단일 권위.
  GOOG: 'Alphabet Inc.', GOOGL: 'Alphabet Inc.', META: 'Meta Platforms, Inc.',
  BRK_B: 'Berkshire Hathaway Inc.',
};
for (const [t, n] of Object.entries(CURATED)) out[t] = n;   // force override (권위 큐레이션)

// 2026-06-05: ETF 이름 (Yahoo longName, enrich 로 생성된 data/etf-names.json) 병합 — SEC 미수록 ETF 보강.
try {
  if (existsSync('data/etf-names.json')) {
    const etf = JSON.parse(readFileSync('data/etf-names.json', 'utf8'));
    let e = 0; for (const [t, n] of Object.entries(etf)) { if (!out[t] && n) { out[t] = n; e++; } }
    console.log(`[build-company-names] ETF 이름 병합: ${e}`);
  }
} catch { /* non-fatal */ }

writeFileSync('data/company-names.json', JSON.stringify(out, null, 0) + '\n');
// 검증: name 이 산업라벨/Unknown 처럼 보이면 경고(향후 오염 사전 포착).
const suspect = Object.entries(out).filter(([, n]) => /\b(& Other|Unknown|N\/A)\b/i.test(n));
if (suspect.length) console.warn(`[build-company-names] ⚠️ 의심 name ${suspect.length}: ${suspect.slice(0, 5).map(([t, n]) => `${t}="${n}"`).join(', ')}`);
console.log(`[build-company-names] ${Object.keys(out).length} tickers → data/company-names.json (curated ${Object.keys(CURATED).length})`);
console.log(`  CPRT=${out.CPRT ?? '(missing)'} | NVDA=${out.NVDA ?? '?'} | AAPL=${out.AAPL ?? '?'}`);
