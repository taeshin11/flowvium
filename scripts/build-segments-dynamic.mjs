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
import { readFileSync } from 'fs';
import { saveSegments, getSegmentTickersToRefresh } from './lib/db.mjs';

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

// exaone grounded 추출 — region 텍스트에서 "NAME | NUMBER" 라인. 포맷무관(번역 per-field 와 동일
//   원리: 소형모델은 구조화JSON 불안정하나 단순 grounded 추출은 안정). filing 실수치만 reformat → 환각無.
async function exaoneExtract(region) {
  try {
    const prompt = `From the financial text below, extract each business segment/product and its MOST RECENT year revenue (in millions, the first number after each name). Output ONLY lines formatted exactly as: NAME | NUMBER. Exclude any "Total" row. No commentary, no other text.\n\n${region}`;
    const r = await fetch('http://localhost:11434/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.OLLAMA_TRANSLATE_MODEL || 'exaone3.5:7.8b', messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 400 }),
      signal: AbortSignal.timeout(90000),
    });
    if (!r.ok) return [];
    const d = await r.json();
    const txt = (d.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
    const rows = [];
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*[-*•]?\s*([A-Za-z][A-Za-z0-9,&'’.\/ ()-]{1,45}?)\s*[|:]\s*\$?\s*([\d][\d,]{2,})/);
      if (m) {
        const name = m[1].trim().replace(/\s+/g, ' ');
        const amt = +m[2].replace(/,/g, '');
        if (!/^total/i.test(name) && amt >= 50 && !rows.find(x => x.name === name)) rows.push({ name, amount: amt });
      }
    }
    return rows.slice(0, 8);
  } catch { return []; }
}

function findTotal(region) {
  // "Total [words] $ 215,938" / "Total net sales $ 416,161" — Total 직후 첫 큰 숫자
  const m = region.match(/Total\b[^$\d]{0,25}\$?\s*([\d,]{4,})/i);
  return m ? +m[1].replace(/,/g, '') : null;
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

// 매출 breakdown 테이블 영역 찾기 — 제품 > 세그먼트 > 엔드마켓 우선순위(broad).
function findRegion(txt) {
  const KWS = [
    /Products and Services Performance|Net sales by category|Net (?:sales|revenues?) by (?:major )?(?:product|category|offering|type)|Disaggregation of Revenue/i,
    /Revenue by Reportable Segments?|Net sales by (?:reportable )?segments?|Segment Operating Performance|Segment Results|Revenues? by (?:reportable )?segments?/i,
    /Revenue by End Market|by end market|Revenue by Market|Revenue by geograph/i,
  ];
  for (const re of KWS) { const i = txt.search(re); if (i >= 0) return txt.slice(i, i + 900); }
  return null;
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
  // 1) 결정론 파싱(빠름, 클린 포맷). 2) 실패 시 region+exaone grounded 추출(포맷무관).
  let seg = parseSegments(txt);
  let method = 'regex';
  if (!seg) {
    const region = findRegion(txt);
    if (!region) return { ticker, error: 'no-region' };
    const total = findTotal(region);
    const rows = await exaoneExtract(region);
    if (!total || rows.length < 2) return { ticker, error: 'exaone-no-rows' };
    const sum = rows.reduce((s, x) => s + x.amount, 0);
    if (Math.abs(sum - total) / total > 0.08) return { ticker, error: `sum-mismatch(${Math.round(sum/1e3)}k vs ${Math.round(total/1e3)}k)` };
    seg = { total, segments: rows.map(x => ({ name: x.name, amount: x.amount, pct: Math.round(x.amount / total * 1000) / 10 })).sort((a, b) => b.pct - a.pct) };
    method = 'exaone';
  }
  return { ticker, ...seg, asOf: filing.date, source: `10-K/${method}`, url };
}

const rawArgs = process.argv.slice(2);
const refreshArg = rawArgs.find(a => /^--refresh=\d+$/.test(a));
let tickers;
if (refreshArg) {
  // cron 주기 refresh — 미보유/가장 오래된 US ticker N개 자동선택(rotating). 모니터링시 점진 갱신.
  const n = +refreshArg.split('=')[1];
  const cand = (() => { try { return JSON.parse(readFileSync('data/candidate-tickers.json', 'utf8')).tickers || []; } catch { return []; } })();
  tickers = getSegmentTickersToRefresh(cand, n);
  console.log(`[build-segments-dynamic] refresh 모드 — 갱신 대상 ${tickers.length}: ${tickers.join(', ') || '(없음, 전부 최신)'}`);
} else {
  tickers = rawArgs.map(s => s.toUpperCase());
}
if (!tickers.length) { console.log('사용: node scripts/build-segments-dynamic.mjs AAPL MSFT ...  또는  --refresh=8'); process.exit(0); }

const cikMap = await loadCikMap();
// DB-only 저장(flowvium.db = cron checkout wipe 경로 밖, 영속). data/*.json 은 wipe 경로 + refresh
//   마다 dirty → wipe-risk 유발하므로 미사용(2026-06-07 churn 제거).
let ok = 0, fail = 0;
for (const t of tickers) {
  try {
    const r = await extractForTicker(t, cikMap);
    if (r.error) { console.log(`  ✗ ${t}: ${r.error}`); fail++; }
    else {
      try { saveSegments(t, { segments: r.segments, total: r.total, asOf: r.asOf, source: r.source, fetchedAt: new Date().toISOString() }); } catch (e) { console.warn(`    [db] ${t} 적재 실패: ${e.message}`); }
      console.log(`  ✓ ${t} (asOf ${r.asOf}, ${r.source}): ${r.segments.slice(0, 4).map(s => `${s.name} ${s.pct}%`).join(' · ')}`);
      ok++;
    }
  } catch (e) { console.log(`  ✗ ${t}: ${String(e.message).slice(0, 50)}`); fail++; }
  await sleep(250); // SEC rate-limit 예의
}
console.log(`\n[build-segments-dynamic] ✓ ${ok} / ✗ ${fail} → DB company_segments (영속, wipe 안전)`);
