/**
 * scripts/lib/snapshot-endpoints.mjs
 *
 * 보고서 생성 시점에 LLM 컨텍스트로 쓰이는 모든 엔드포인트를 flowvium.net 에서 fetch 해
 * SQLite endpoint_snapshots 테이블에 적재. 사후 회고 시 "이 추천이 어떤 context 에서
 * 나왔는지" 정확히 재현 가능.
 *
 * 사용:
 *   import { snapshotAllEndpoints } from './lib/snapshot-endpoints.mjs';
 *   await snapshotAllEndpoints(reportId);
 */
import { saveSnapshot } from './db.mjs';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './project-root.mjs';

// LLM context 에 들어가는 모든 엔드포인트 (CLAUDE.md 의 daily-brief 의존 목록 기준)
// 2026-05-29: sector-pe / sector-metrics / iv-screener / cascade-events 추가 (인텔리전스 탭 완전성).
export const TRACKED_ENDPOINTS = [
  '/api/fear-greed',
  '/api/capital-flows',
  '/api/macro-indicators',
  '/api/credit-balance',
  '/api/yield-curve',
  '/api/volatility',
  '/api/fedwatch',
  '/api/short-interest',
  '/api/insider-trades',
  '/api/ownership-alerts',
  '/api/nport-holdings',
  '/api/korea-flow?period=4w',
  '/api/news-cascade',
  '/api/market-heatmap?country=US',
  '/api/supply-chain-signals',
  '/api/signals',
  '/api/cot-positions',
  '/api/commodity-curve',
  '/api/market-caps',
  '/api/economic-calendar?country=US',
  // 2026-05-29 추가
  '/api/sector-pe',
  '/api/sector-metrics',
  '/api/iv-screener',
  '/api/cascade-events',
  // OSINT — 2026-06-04: DB 아카이브 누락분 추가(사용자 "db에 저장은?"). 보고서마다 endpoint_snapshots 시계열.
  '/api/osint/social',
  '/api/osint/sanctions',
  '/api/osint/crypto?address=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045&chain=eth',
  // 2026-06-05: 사용자 "모든 페이지/탭/엔드포인트가 업데이트마다 DB 저장돼야" — 무파라미터 데이터
  //   엔드포인트 전수 추가. (per-ticker[stock-price/company-*/iv 등]은 portfolioTickers 로 별도 스냅샷.)
  '/api/narratives',
  '/api/market-movers',
  '/api/news-gap',
  '/api/options-flow',
  '/api/block-trades',
  '/api/portfolio-accuracy',
  '/api/price-history',
  '/api/signal-retrospective',
  '/api/investment-strategy',
  '/api/latest-updates',
  '/api/flow-analysis',
  '/api/earnings',
  '/api/daily-brief',
  // 2026-06-12: Probe [12] 미커버 표출분 — 페이지가 쓰는데 어떤 검증도 args 넣어 검사 안 하던 4종
  '/api/stock-supply?ticker=AAPL',
  '/api/batch-prices?tickers=AAPL,MSFT,NVDA',
  '/api/company-desc/AAPL',
  '/api/company-business/AAPL',
  // 2026-06-14: KRX 시장경보(투자주의/경고/위험·소수계좌 거래집중) 라이브 — DB 시계열 적재.
  '/api/market-alerts',
  // 2026-07-04: ICI 주간 ETF net issuance 실측 — DB 시계열 적재(자산이동 실측 소스).
  '/api/fund-flows',
  // 2026-07-04 (이연 이행): TIC 월간 외국인 미국채 보유 실측 — DB 시계열 적재.
  '/api/tic-flows',
  // 2026-06-14: 작전주 매집 워치리스트(오르기 前) — DB 시계열 적재.
  '/api/accumulation-watch',
  // 2026-06-17: US 작전주 매집(거래량 기반) + KR 임원·주요주주 지분공시 피드 — DB 시계열 적재.
  '/api/accumulation-watch?market=us',
  '/api/insider-kr',
];

async function fetchOne(baseUrl, path, timeoutMs = 12000) {
  const url = `${baseUrl}${path}`;
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'flowvium-local-snapshotter/1.0' },
      cache: 'no-store',
    });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text.slice(0, 4000); }
    return { ok: res.ok, status: res.status, body, durationMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, status: null, body: { error: String(err) }, durationMs: Date.now() - t0 };
  }
}

/**
 * 모든 TRACKED_ENDPOINTS 를 병렬 fetch 후 DB 에 저장.
 * @param {string} reportId  reports.id (saveReport 반환값)
 * @param {object} opts
 *   baseUrl: 기본 https://flowvium.net (NEXT_PUBLIC_SITE_URL 환경변수 우선)
 *   endpoints: 커스텀 endpoint 목록 (기본 TRACKED_ENDPOINTS)
 *   concurrency: 동시 fetch 수 (기본 6 — Vercel rate-limit 보호)
 */
export async function snapshotAllEndpoints(reportId, opts = {}) {
  const baseUrl = (opts.baseUrl
    ?? process.env.NEXT_PUBLIC_SITE_URL
    ?? 'https://flowvium.net').replace(/\/$/, '');
  const endpoints = opts.endpoints ?? TRACKED_ENDPOINTS;
  const concurrency = opts.concurrency ?? 6;
  // 2026-05-29: portfolio ticker 별 기업 실적 endpoint 자동 생성
  // 미국 (XBRL): /api/company-financials/[ticker]
  // 한국 (DART):  /api/company-kr/[ticker]
  const tickerEndpoints = buildTickerEndpoints(opts.portfolioTickers);
  const allEndpoints = [...endpoints, ...tickerEndpoints];

  const results = [];
  for (let i = 0; i < allEndpoints.length; i += concurrency) {
    const batch = allEndpoints.slice(i, i + concurrency);
    const settled = await Promise.all(batch.map(async ep => {
      const r = await fetchOne(baseUrl, ep);
      // 2026-06-15: saveSnapshot 한 건 실패가 Promise.all 을 reject → snapshotAllEndpoints 전체가 throw
      //   → 뒤따르는 verify-loop(Karpathy 폐루프)까지 스킵되던 구조(market-alerts 객체-source 사건).
      //   per-endpoint 격리 — 한 엔드포인트 적재 실패가 폐루프를 죽이지 않게 한다.
      let saveOk = true;
      try {
        saveSnapshot({ reportId, endpoint: ep, status: r.status, response: r.body, durationMs: r.durationMs });
      } catch (e) {
        saveOk = false;
        console.warn(`[snapshot] ⚠️ ${ep} 적재 실패(격리, 비차단): ${String(e?.message ?? e).slice(0, 90)}`);
      }
      return { endpoint: ep, ok: r.ok && saveOk, status: r.status, durationMs: r.durationMs };
    }));
    results.push(...settled);
  }
  return results;
}

/**
 * candidate-tickers.json 의 meta.cap 으로 ETF 판별. 목록을 코드에 박지 않는다 —
 *   ETF 는 계속 늘어나고 박아 두면 곧 낡는다. 파일을 못 읽으면 "ETF 아님"으로 보수적 처리
 *   (기업재무를 부르는 쪽이 기존 동작이므로 판별 실패로 데이터가 줄지 않는다).
 */
let _etfSet = null;
function defaultIsEtf(ticker) {
  if (_etfSet === null) {
    _etfSet = new Set();
    try {
      const meta = JSON.parse(readFileSync(resolve(ROOT, 'data/candidate-tickers.json'), 'utf8'))?.meta ?? {};
      for (const [t, v] of Object.entries(meta)) if (v?.cap === 'etf') _etfSet.add(t.toUpperCase());
    } catch { /* 판별 불가 — 전부 비ETF 로 본다(기존 동작) */ }
  }
  return _etfSet.has(String(ticker ?? '').toUpperCase());
}

/**
 * 포트폴리오 티커 → 종목별 스냅샷 엔드포인트.
 *
 * 2026-08-26: ETF 분기를 넣었다. 종전에는 KR(.KS/.KQ)만 갈라내고 나머지를 전부
 *   /api/company-financials 로 보냈는데, ETF 는 기업재무가 없어 **매번 4XX** 였다.
 *   그 실패가 audit-coverage 에서 "라우트 죽음 의심 (100% 실패)" 으로 집계돼 push 를 막았고,
 *   진짜 라우트 장애와 구분이 안 됐다(실측 XLF 4XX:9/9).
 *
 * @param {string[]} tickers
 * @param {{isEtf?:(t:string)=>boolean}} [opts] 테스트용 주입
 */
export function buildTickerEndpoints(tickers, opts = {}) {
  const isEtf = opts.isEtf ?? defaultIsEtf;
  const out = [];
  if (!Array.isArray(tickers)) return out;
  for (const t of tickers) {
    if (!t) continue;
    if (t.endsWith('.KS') || t.endsWith('.KQ')) {
      out.push(`/api/company-kr/${t.replace(/\.(KS|KQ)$/, '')}`);
    } else if (isEtf(t)) {
      continue;   // ETF 는 기업재무가 없다 — 부르면 항상 4XX
    } else {
      out.push(`/api/company-financials/${t}`);
    }
  }
  return out;
}
