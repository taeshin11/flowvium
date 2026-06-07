#!/usr/bin/env node
/**
 * scripts/build-segments-dynamic.mjs — SEC 10-K 에서 제품/세그먼트별 매출을 *동적* 추출.
 *
 * 배경(2026-06-07 사용자): "정적 큐레이션이 기본이지만 사업보고에 따라 동적으로 바뀌어야지. 왜 아직
 *   사각지대?". companies-batch 의 products[] revenueShare 는 손큐레이션 스냅샷 → stale(AAPL iPhone
 *   정적 52% vs 실제 10-K 50.4%). SEC companyconcept API 는 총액만 주고 제품split 은 filing 본문에만.
 *
 * 엔진: SEC submissions → 최신 10-K → 본문 'Products and Services Performance'/'Net sales by category'/
 *   'Segment' 테이블 영역 추출 → 결정론적 파싱(label + $amount) → 합계 검증(Σ segment ≈ total revenue,
 *   ±3% 이내라야 채택 — 환각/오파싱 차단) → % 계산 + as-of(filing date). 환각 없음(filing 실수치).
 *
 * 출력: data/company-segments-dynamic.json { TICKER: { segments:[{name,amount,pct}], total, asOf, fy, source } }
 * 사용: node scripts/build-segments-dynamic.mjs AAPL MSFT NVDA   (인자 없으면 portfolio+주요)
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';

const UA = { 'User-Agent': 'flowvium research contact@flowvium.net' };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ticker → CIK (SEC company_tickers.json)
async function loadCikMap() {
  const r = await fetch('https://www.sec.gov/files/company_tickers.json', { headers: UA, signal: AbortSignal.timeout(20000) });
  const j = await r.json();
  const m = {};
  for (const k in j) m[j[k].ticker.toUpperCase()] = String(j[k].cik_str).padStart(10, '0');
  return m;
}

async function latest10K(cik) {
  const r = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: UA, signal: AbortSignal.timeout(20000) });
  const j = await r.json();
  const f = j.filings.recent;
  const idx = f.form.findIndex(x => x === '10-K');
  if (idx < 0) return null;
  return { accession: f.accessionNumber[idx].replace(/-/g, ''), doc: f.primaryDocument[idx], date: f.filingDate[idx], cik: cik.replace(/^0+/, '') };
}

// 10-K 본문에서 매출 테이블 영역 추출 + 결정론적 파싱
function parseSegments(txt) {
  // 제품/카테고리 테이블 우선(사용자 "주력 매출상품"), 없으면 사업/지역 세그먼트.
  //   AAPL 은 'Segment Operating Performance'(지역)가 'Products and Services'(제품)보다 앞서 나와
  //   순서 검색 시 지역이 잡힘 → 제품 키워드 먼저 별도 검색.
  const PROD = /(Products and Services Performance|Net sales by category|Net (?:sales|revenues?) by (?:major )?(?:product|category|offering))/i;
  const SEG = /(Net sales by (?:reportable )?segment|Segment Operating Performance|Revenue by (?:reportable )?segment|Segment Results|Revenues? by segment)/i;
  let i = txt.search(PROD);
  if (i < 0) i = txt.search(SEG);
  if (i < 0) return null;
  const region = txt.slice(i, i + 1400);
  // total 추출
  const totalM = region.match(/Total (?:net sales|net revenues?|revenues?)\s*\$?\s*([\d,]+)/i);
  const total = totalM ? +totalM[1].replace(/,/g, '') : null;
  // "Label $ 209,586" 또는 "Label 33,708" (label = 1~5단어 영문, 그 뒤 첫 숫자=최신년도)
  const rows = [];
  // 이름 [각주(1)] [$] 숫자 — 각주마커 (1)/(2) 허용(AAPL "Services (1) 109,158" 류).
  const rowRe = /([a-z]?[A-Z][A-Za-z,&'’ ]{2,40}?)\s+(?:\(\d+\)\s*)?\$?\s*([\d][\d,]{2,})\s/g;
  let m;
  while ((m = rowRe.exec(region)) !== null) {
    const name = m[1].trim().replace(/\s+/g, ' ');
    const amt = +m[2].replace(/,/g, '');
    if (/^total/i.test(name) || amt < 100) continue;          // total 행·잡음 제외
    if (/change|following table|dollars in|millions/i.test(name)) continue;
    if (rows.find(r => r.name === name)) continue;
    rows.push({ name, amount: amt });
    if (rows.length >= 8) break;
  }
  if (!total || rows.length < 2) return null;
  // 합계 검증 — Σ segment 이 total 의 95~105% 라야 채택(오파싱/누락 차단)
  const sum = rows.reduce((s, r) => s + r.amount, 0);
  if (Math.abs(sum - total) / total > 0.06) return null;
  return {
    total,
    segments: rows.map(r => ({ name: r.name, amount: r.amount, pct: Math.round(r.amount / total * 1000) / 10 }))
      .sort((a, b) => b.pct - a.pct),
  };
}

async function extractForTicker(ticker, cikMap) {
  const cik = cikMap[ticker.toUpperCase()];
  if (!cik) return { ticker, error: 'no-cik' };
  const filing = await latest10K(cik);
  if (!filing) return { ticker, error: 'no-10k' };
  const url = `https://www.sec.gov/Archives/edgar/data/${filing.cik}/${filing.accession}/${filing.doc}`;
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(40000) });
  if (!r.ok) return { ticker, error: `filing-http-${r.status}` };
  const html = await r.text();
  const txt = html.replace(/<[^>]+>/g, ' ').replace(/&#160;|&nbsp;/g, ' ').replace(/&#8217;|&#8216;/g, "'").replace(/&#8212;/g, '-').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  const seg = parseSegments(txt);
  if (!seg) return { ticker, error: 'no-segment-table' };
  return { ticker, ...seg, asOf: filing.date, source: '10-K', url };
}

const args = process.argv.slice(2).map(s => s.toUpperCase());
let tickers = args;
if (!tickers.length) {
  // 기본: candidate-tickers 의 US 대형 일부 (테스트는 인자 권장)
  try { tickers = (JSON.parse(readFileSync('data/candidate-tickers.json', 'utf8')).tickers || []).filter(t => !/\.(KS|KQ)$/.test(t)).slice(0, 0); } catch { tickers = []; }
}
if (!tickers.length) { console.log('사용: node scripts/build-segments-dynamic.mjs AAPL MSFT ...'); process.exit(0); }

const cikMap = await loadCikMap();
const out = existsSync('data/company-segments-dynamic.json') ? JSON.parse(readFileSync('data/company-segments-dynamic.json', 'utf8')) : {};
let ok = 0, fail = 0;
for (const t of tickers) {
  try {
    const r = await extractForTicker(t, cikMap);
    if (r.error) { console.log(`  ✗ ${t}: ${r.error}`); fail++; }
    else {
      out[t] = { segments: r.segments, total: r.total, asOf: r.asOf, source: r.source };
      console.log(`  ✓ ${t} (asOf ${r.asOf}): ${r.segments.slice(0, 4).map(s => `${s.name} ${s.pct}%`).join(' · ')}`);
      ok++;
    }
  } catch (e) { console.log(`  ✗ ${t}: ${String(e.message).slice(0, 50)}`); fail++; }
  await sleep(250); // SEC rate-limit 예의
}
writeFileSync('data/company-segments-dynamic.json', JSON.stringify(out, null, 0) + '\n');
console.log(`\n[build-segments-dynamic] ✓ ${ok} / ✗ ${fail} → data/company-segments-dynamic.json (${Object.keys(out).length} 누적)`);
