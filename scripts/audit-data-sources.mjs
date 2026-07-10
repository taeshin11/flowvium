#!/usr/bin/env node
/**
 * scripts/audit-data-sources.mjs — 외부 데이터 source 헬스 체크.
 *
 * Yahoo v7/v8, Stooq, FRED, SEC EDGAR, EFTS, Naver 등 우리가 의존하는
 * 모든 외부 API 가 살아있는지 확인. silent failure (401, 403, schema 변경)
 * 자동 감지.
 *
 * cron 등록 권장: 매일 새벽 1회. exit code 0 = 모두 OK, 1 = 일부 fail, 2 = critical fail.
 */
const PAD = (s, n) => String(s ?? '').padEnd(n);

const SOURCES = [
  {
    // 2026-06-06: Stooq 가 JS/PoW 봇챌린지로 영구 차단 → critical 해제(보고서가 Yahoo v7 crumb 로 전환).
    //   여전히 모니터링은 하되 실패해도 보고서 abort 안 함(Yahoo 가 primary).
    name: 'Stooq batch CSV (deprecated — bot-blocked)',
    critical: false,
    test: async () => {
      const r = await fetch('https://stooq.com/q/l/?s=nvda.us+msft.us&f=sd2t2ohlcv&h&e=csv', { signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const t = await r.text();
      if (/JavaScript|noscript|__verify/.test(t)) throw new Error('JS 봇챌린지 (영구 차단 — Yahoo v7 로 대체됨)');
      const lines = t.trim().split('\n');
      if (lines.length < 3) throw new Error('CSV empty');
      const nvdaClose = parseFloat(lines[1].split(',')[6]);
      if (!nvdaClose || nvdaClose < 100 || nvdaClose > 500) throw new Error(`NVDA price suspicious: ${nvdaClose}`);
      return `NVDA $${nvdaClose}`;
    },
  },
  {
    name: 'Yahoo v8 chart (single)',
    critical: true,
    test: async () => {
      const r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/NVDA?interval=1d&range=1d', { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const price = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (!price || price < 100 || price > 500) throw new Error(`price suspicious: ${price}`);
      return `NVDA $${price}`;
    },
  },
  {
    // 2026-06-06: Yahoo v7 quote batch(crumb 인증) — 보고서의 *주* US 가격 소스(Stooq 봇차단 대체).
    //   crumb 없이는 401 이지만 crumb 로 우회. 이게 죽으면 US 가격 못 받음 → critical.
    name: 'Yahoo v7 quote (crumb batch)',
    critical: true,
    test: async () => {
      const UA = { 'User-Agent': 'Mozilla/5.0' };
      const fc = await fetch('https://fc.yahoo.com', { headers: UA, signal: AbortSignal.timeout(8000) });
      const cookie = (fc.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
      const cr = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { ...UA, Cookie: cookie }, signal: AbortSignal.timeout(8000) });
      const crumb = await cr.text();
      if (!crumb || crumb.length > 30) throw new Error('crumb 획득 실패');
      const r = await fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=NVDA,MSFT&crumb=${encodeURIComponent(crumb)}`, { headers: { ...UA, Cookie: cookie }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const px = j?.quoteResponse?.result?.[0]?.regularMarketPrice;
      if (!px || px < 100 || px > 500) throw new Error(`NVDA price suspicious: ${px}`);
      return `NVDA $${px} (crumb OK)`;
    },
  },
  {
    name: 'Yahoo v8 KR ticker',
    critical: true,
    test: async () => {
      const r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/005930.KS?interval=1d&range=1d', { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const price = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (!price || price < 50000) throw new Error(`price suspicious: ${price}`);
      return `005930 ₩${price.toLocaleString()}`;
    },
  },
  {
    name: 'SEC EDGAR EFTS search',
    critical: false,
    test: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      const r = await fetch(`https://efts.sec.gov/LATEST/search-index?forms=8-K&dateRange=custom&startdt=${weekAgo}&enddt=${today}`, { headers: { 'User-Agent': 'FlowviumBot contact@flowvium.net' }, signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const hits = j?.hits?.hits?.length ?? 0;
      if (hits === 0) throw new Error('0 hits (suspicious)');
      return `${hits}+ hits in 7d`;
    },
  },
  {
    name: 'FRED API',
    critical: false,
    test: async () => {
      // No key needed for graph CSV
      const r = await fetch('https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10', { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const t = await r.text();
      if (!t.includes('DGS10')) throw new Error('schema changed');
      return 'DGS10 series OK';
    },
  },
  {
    name: 'CNN Fear & Greed',
    critical: false,
    test: async () => {
      // 2026-07-10: CNN 이 minimal UA 에 418 (~Q4 2025 부터) — 앱(fear-greed/route.ts)과 동일한
      //   full browser 헤더 사용. 감사 fetch 레시피는 앱 실경로와 항상 동기화(어긋나면 false alarm).
      const r = await fetch('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://edition.cnn.com/markets/fear-and-greed',
          'Origin': 'https://edition.cnn.com',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const score = j?.fear_and_greed?.score;
      if (score == null) throw new Error('schema changed');
      return `score ${Math.round(score)}`;
    },
  },
  {
    name: 'Wikipedia S&P 500',
    critical: false,
    test: async () => {
      const r = await fetch('https://en.wikipedia.org/wiki/List_of_S%26P_500_companies', { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const t = await r.text();
      // 2026-07-10: Wikipedia Parsoid 마크업 전환(href 가 class 보다 앞) — ishares-holdings.ts 와
      //   동일하게 속성 순서 무관 매칭 (구 regex 는 신마크업 0매치).
      const matches = t.match(/<a[^>]*href="https:\/\/www\.(?:nasdaq|nyse)\.com[^"]*"[^>]*>/g)?.length ?? 0;
      if (matches < 400) throw new Error(`only ${matches} matches (regex broken?)`);
      return `${matches} tickers`;
    },
  },
];

console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║  외부 데이터 source 헬스 체크 — ' + new Date().toISOString().slice(0,19) + ' ║');
console.log('╚═══════════════════════════════════════════════════════════╝\n');

let okCount = 0, failCount = 0, criticalFail = 0;
const results = await Promise.all(SOURCES.map(async s => {
  const t0 = Date.now();
  try {
    const detail = await s.test();
    return { name: s.name, critical: s.critical, ok: true, detail, ms: Date.now() - t0 };
  } catch (e) {
    return { name: s.name, critical: s.critical, ok: false, error: e.message, ms: Date.now() - t0 };
  }
}));

console.log(PAD('icon', 4) + PAD('source', 35) + PAD('ms', 7) + 'detail / error');
console.log('─'.repeat(95));
for (const r of results) {
  const icon = r.ok ? '✅' : (r.critical ? '❌' : '⚠️ ');
  console.log(`${icon}  ${PAD(r.name, 33)}${PAD(r.ms + 'ms', 7)}${r.ok ? r.detail : '❌ ' + r.error}`);
  if (r.ok) okCount++;
  else {
    failCount++;
    if (r.critical) criticalFail++;
  }
}

console.log(`\n  ✅ OK: ${okCount} | ❌ FAIL: ${failCount} (critical: ${criticalFail})`);
if (criticalFail > 0) {
  console.error('\n🚨 CRITICAL: ' + criticalFail + ' 핵심 source 실패 — 보고서 생성 중단 위험.');
  process.exit(2);
}
process.exit(failCount > 0 ? 1 : 0);
