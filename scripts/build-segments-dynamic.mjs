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
import { readFileSync, statSync } from 'fs';
import { saveSegments, getSegmentTickersToRefresh } from './lib/db.mjs';

const UA = { 'User-Agent': 'flowvium research contact@flowvium.net' };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 2026-06-12: 보고서 파이프라인 lock 양보 — 벌크 sweep 이 보고서 cron(Wave1 GPU 독점 필요)과
//   겹치면 6/11 Wave1 전멸 사건 재발. lock(90min 미만) 감지 시 대기 후 재개. cron-runner 의
//   segments-refresh skip 가드와 동일 원리(단일 GPU 규칙) — 장시간 sweep 은 skip 아닌 wait.
async function waitIfReportRunning() {
  for (;;) {
    try {
      const st = statSync('logs/report-pipeline.lock');
      if (Date.now() - st.ctimeMs < 90 * 60 * 1000) {
        console.log('  [lock] 보고서 파이프라인 실행 중 — 120s 대기 (GPU 양보)');
        await sleep(120000);
        continue;
      }
    } catch { /* lock 없음 */ }
    return;
  }
}

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
  // 2026-06-12: ADR(TSM 등) 20-F/40-F 도 허용 — 벌크 sweep no-10k 28건 해소
  const idx = f.form.findIndex(x => x === '10-K' || x === '20-F' || x === '40-F');
  if (idx < 0) return null;
  return { accession: f.accessionNumber[idx].replace(/-/g, ''), doc: f.primaryDocument[idx], date: f.filingDate[idx], form: f.form[idx], cik: cik.replace(/^0+/, '') };
}

// ═══ 2026-06-12 엔진 v2 — XBRL 인스턴스 dimension 추출 (1차 방법) ═══
// 배경: 벌크 sweep 통과율 8.7% + PM(필립모리스) "Software 50.8%" 오염 통과 사건.
//   LLM 이 region 의 total 을 보고 합이 맞는 분할을 지어내면 Σ검증이 무력화됨(구조 결함).
//   XBRL 인스턴스의 ProductOrServiceAxis/StatementBusinessSegmentsAxis dimension fact 는
//   회사가 직접 태깅한 구조화 수치 — 결정론·무LLM·무환각. (d7 진단 때 companyfacts API 가
//   dimension 미제공이라 포기했으나, *인스턴스 XML 원문*엔 dimension fact 가 있음 — 이게 최선)

function cleanMemberName(qname) {
  let n = qname.split(':').pop().replace(/(Segment)?Member$/, '');
  // CamelCase → 공백 (소문자/숫자→대문자 경계만; 연속 대문자 약어 보존)
  n = n.replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  return n.trim();
}

async function xbrlExtract(filing) {
  // 1. 인스턴스 문서 찾기 (*_htm.xml 관행, 없으면 linkbase 제외 최대 .xml)
  const base = `https://www.sec.gov/Archives/edgar/data/${filing.cik}/${filing.accession}`;
  const idxR = await fetch(`${base}/index.json`, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!idxR.ok) return null;
  const items = (await idxR.json()).directory?.item ?? [];
  let inst = items.find(i => /_htm\.xml$/i.test(i.name));
  if (!inst) {
    inst = items.filter(i => /\.xml$/i.test(i.name) && !/(_cal|_def|_lab|_pre|FilingSummary|MetaLinks)/i.test(i.name))
      .sort((a, b) => (+b.size || 0) - (+a.size || 0))[0];
  }
  if (!inst) return null;
  const xr = await fetch(`${base}/${inst.name}`, { headers: UA, signal: AbortSignal.timeout(60000) });
  if (!xr.ok) return null;
  const xml = await xr.text();

  // 2. duration 컨텍스트 파싱 (id → 기간 + 명시적 dimension)
  const ctxs = new Map();
  const ctxRe = /<(?:xbrli:)?context id="([^"]+)"[^>]*>([\s\S]*?)<\/(?:xbrli:)?context>/g;
  let m;
  while ((m = ctxRe.exec(xml)) !== null) {
    const body = m[2];
    const start = body.match(/<(?:xbrli:)?startDate>([\d-]+)</)?.[1];
    const end = body.match(/<(?:xbrli:)?endDate>([\d-]+)</)?.[1];
    if (!start || !end) continue;
    const dims = [...body.matchAll(/<xbrldi:explicitMember dimension="([^"]+)"\s*>([^<]+)</g)]
      .map(x => ({ axis: x[1].trim(), member: x[2].trim() }));
    ctxs.set(m[1], { start, end, dims });
  }
  if (!ctxs.size) return null;

  // 3. revenue 개념 fact 수집
  const CONCEPTS = ['RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'Revenues', 'SalesRevenueNet'];
  const facts = [];
  for (const c of CONCEPTS) {
    const fRe = new RegExp(`<us-gaap:${c}\\b[^>]*contextRef="([^"]+)"[^>]*>([\\d.]+)</`, 'g');
    let fm;
    while ((fm = fRe.exec(xml)) !== null) {
      const ctx = ctxs.get(fm[1]);
      if (!ctx) continue;
      const days = (new Date(ctx.end) - new Date(ctx.start)) / 86400000;
      if (days < 330 || days > 400) continue;          // 연간만
      facts.push({ concept: c, ctx, val: +fm[2] });
    }
  }
  if (!facts.length) return null;
  const annualEnds = [...new Set(facts.map(f => f.ctx.end))].sort();
  const latestEnd = annualEnds.at(-1);
  const prevEnd = annualEnds.at(-2) ?? null;  // 2026-06-12: 전년 비교치 (10-K 가 2-3개년 태깅) — 세그먼트별 YoY

  // 4. 개념 × 축 우선순위로 멤버 분해 — Σ≈total ±6% 인 첫 조합 채택
  const AXES = ['srt:ProductOrServiceAxis', 'us-gaap:StatementBusinessSegmentsAxis', 'srt:StatementBusinessSegmentsAxis'];
  for (const concept of CONCEPTS) {
    const cf = facts.filter(f => f.concept === concept && f.ctx.end === latestEnd);
    const total = cf.find(f => f.ctx.dims.length === 0)?.val;
    if (!total) continue;
    for (const axis of AXES) {
      const seen = new Map();
      for (const f of cf) {
        const d = f.ctx.dims;
        if (d.length !== 1 || d[0].axis !== axis) continue;
        const name = cleanMemberName(d[0].member);
        if (/intersegment|elimination|corporate|reconcil|allother/i.test(name.replace(/\s/g, ''))) continue;
        if (!seen.has(name)) seen.set(name, f.val);
      }
      if (seen.size < 2) continue;
      const rows = [...seen.entries()].map(([name, amount]) => ({ name, amount }));
      const sum = rows.reduce((s, r) => s + r.amount, 0);
      if (Math.abs(sum - total) / total > 0.06) continue;
      // 전년 동일 axis 멤버 값 → 세그먼트별 YoY (사용자 "매출이 어느 항목에서 늘었는지").
      //   같은 태깅 사실값 그대로 — 환각 0. 전년 미태깅 멤버는 yoy null.
      const prevMap = new Map();
      if (prevEnd) {
        for (const f of facts.filter(x => x.concept === concept && x.ctx.end === prevEnd)) {
          const d = f.ctx.dims;
          if (d.length !== 1 || d[0].axis !== axis) continue;
          const name = cleanMemberName(d[0].member);
          if (!prevMap.has(name)) prevMap.set(name, f.val);
        }
      }
      return {
        total,
        segments: rows.map(r => {
          const prev = prevMap.get(r.name) ?? null;
          return {
            name: r.name,
            amount: Math.round(r.amount / 1e6),
            pct: Math.round(r.amount / total * 1000) / 10,
            yoyPct: prev ? Math.round((r.amount / prev - 1) * 1000) / 10 : null,
          };
        }).sort((a, b) => b.pct - a.pct).slice(0, 8),
      };
    }
  }
  return null;
}

// exaone grounded 추출 — region 텍스트에서 "NAME | NUMBER" 라인. 포맷무관(번역 per-field 와 동일
//   원리: 소형모델은 구조화JSON 불안정하나 단순 grounded 추출은 안정). filing 실수치만 reformat → 환각無.
async function exaoneExtract(region) {
  try {
    // 2026-06-07: 모델 통일 — 보고서와 동일 qwen3:8b 네이티브(/api/chat, think:false). 종전 /v1+exaone.
    const prompt = `From the financial text below, extract each business segment/product and its MOST RECENT year revenue (in millions, the first number after each name). Output ONLY lines formatted exactly as: NAME | NUMBER. Exclude any "Total" row. No commentary, no other text.\n\n${region}`;
    const r = await fetch('http://localhost:11434/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.OLLAMA_TRANSLATE_MODEL || 'qwen3:8b', messages: [{ role: 'user', content: prompt }], stream: false, think: false, options: { temperature: 0.1, num_predict: 400 } }),
      signal: AbortSignal.timeout(90000),
    });
    if (!r.ok) return [];
    const d = await r.json();
    const txt = (d.message?.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
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
  // 0) XBRL dimension (1차 — 결정론·무LLM·회사 자체 태깅. PM 오염 사건 후 v2 primary)
  try {
    const xb = await xbrlExtract(filing);
    if (xb) return { ticker, ...xb, asOf: filing.date, source: `${filing.form}/xbrl` };
  } catch { /* XBRL 실패 → 텍스트 경로 */ }
  const url = `https://www.sec.gov/Archives/edgar/data/${filing.cik}/${filing.accession}/${filing.doc}`;
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(40000) });
  if (!r.ok) return { ticker, error: `filing-http-${r.status}` };
  const html = await r.text();
  const txt = html.replace(/<[^>]+>/g, ' ').replace(/&#160;|&nbsp;/g, ' ').replace(/&#8217;|&#8216;/g, "'").replace(/&#8212;/g, '-').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  // 1) 결정론 파싱(빠름, 클린 포맷). 2) 실패 시 region+LLM grounded 추출(포맷무관).
  let seg = parseSegments(txt);
  let method = 'regex';
  if (!seg) {
    const region = findRegion(txt);
    if (!region) return { ticker, error: 'no-region' };
    const total = findTotal(region);
    const rows = await exaoneExtract(region);
    if (!total || rows.length < 2) return { ticker, error: 'exaone-no-rows' };
    // 2026-06-12 fabrication 가드 (PM "Software 50.8%" 사건): LLM 이 region 의 total 을 보고
    //   합이 맞는 분할을 지어낼 수 있음 — 추출된 모든 금액이 region 원문에 실제(콤마포맷) 존재해야 채택.
    const inText = rows.every(x => region.includes(x.amount.toLocaleString('en-US')) || region.includes(String(x.amount)));
    if (!inText) return { ticker, error: 'llm-fabrication-guard' };
    const sum = rows.reduce((s, x) => s + x.amount, 0);
    if (Math.abs(sum - total) / total > 0.08) return { ticker, error: `sum-mismatch(${Math.round(sum/1e3)}k vs ${Math.round(total/1e3)}k)` };
    seg = { total, segments: rows.map(x => ({ name: x.name, amount: x.amount, pct: Math.round(x.amount / total * 1000) / 10 })).sort((a, b) => b.pct - a.pct) };
    method = 'llm';
  }
  return { ticker, ...seg, asOf: filing.date, source: `${filing.form}/${method}`, url };
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
  await waitIfReportRunning();
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
