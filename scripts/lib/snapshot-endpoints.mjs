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
  const tickerEndpoints = [];
  if (Array.isArray(opts.portfolioTickers)) {
    for (const t of opts.portfolioTickers) {
      if (!t) continue;
      if (t.endsWith('.KS') || t.endsWith('.KQ')) {
        const code = t.replace(/\.(KS|KQ)$/, '');
        tickerEndpoints.push(`/api/company-kr/${code}`);
      } else {
        tickerEndpoints.push(`/api/company-financials/${t}`);
      }
    }
  }
  const allEndpoints = [...endpoints, ...tickerEndpoints];

  const results = [];
  for (let i = 0; i < allEndpoints.length; i += concurrency) {
    const batch = allEndpoints.slice(i, i + concurrency);
    const settled = await Promise.all(batch.map(async ep => {
      const r = await fetchOne(baseUrl, ep);
      saveSnapshot({
        reportId,
        endpoint: ep,
        status: r.status,
        response: r.body,
        durationMs: r.durationMs,
      });
      return { endpoint: ep, ok: r.ok, status: r.status, durationMs: r.durationMs };
    }));
    results.push(...settled);
  }
  return results;
}
