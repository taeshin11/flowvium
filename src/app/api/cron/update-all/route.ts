import { logger } from '@/lib/logger';
/**
 * /api/cron/update-all
 *
 * 하루 3회 실행 (vercel.json 기준 KST):
 *   07:50 KST / 15:50 KST / 21:20 KST
 *
 * 캐시 워밍 순서:
 *   1. macro-indicators (FRED) + yield-curve (FRED TIPS/BEI) + volatility (VIX)
 *   2. fedwatch (CME)
 *   3. capital-flows (Yahoo Finance — 44+ tickers)
 *   4. fear-greed (CNN + Yahoo — force=1로 강제 갱신)
 *   5. credit-balance
 *   6. flow-analysis (AI, capital-flows 이후)
 *   7. daily-brief x3 timeframes (EXAONE AI)
 *   8. news-cascade (fire & forget)
 *   9. stock-supply 주요 티커 pre-warm
 */
import { NextResponse } from 'next/server';

export const maxDuration = 60;

// VERCEL_URL은 프리뷰 URL이므로 항상 프로덕션 도메인 고정
function getBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\s+/g, '').replace(/\\n/g, '') ||
    'https://flowvium.vercel.app'
  );
}

async function warm(
  base: string,
  path: string,
  label: string,
  timeoutMs = 25000,
): Promise<{ label: string; ok: boolean; ms: number; status?: number }> {
  const start = Date.now();
  try {
    const res = await fetch(`${base}${path}`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'x-cron-warm': '1' },
    });
    if (!res.ok) {
      logger.warn('cron.update-all', 'warm_http_error', { label, status: res.status, ms: Date.now() - start });
    } else {
      logger.info('cron.update-all', 'warm_ok', { label, ms: Date.now() - start });
    }
    return { label, ok: res.ok, ms: Date.now() - start, status: res.status };
  } catch (e) {
    logger.error('cron.update-all', 'warm_timeout', { label, error: e, ms: Date.now() - start });
    return { label, ok: false, ms: Date.now() - start, status: 0 };
  }
}

// Redis 캐시 강제 삭제 (daily-brief DELETE endpoint)
async function bustDailyBriefCache(base: string, secret: string) {
  try {
    await fetch(`${base}/api/daily-brief`, {
      method: 'DELETE',
      headers: { 'x-cron-secret': secret },
      signal: AbortSignal.timeout(5000),
    });
  } catch { /* non-fatal */ }
}

const TOP_TICKERS = ['NVDA', 'AAPL', 'MSFT', 'TSMC', 'AMZN', 'GOOGL', 'META', 'LMT', 'MU', 'ASML'];

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET ?? '';
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const base = getBaseUrl();
  const startTime = Date.now();

  // ── 1단계: 독립적인 데이터 소스 병렬 갱신 ────────────────────────────────
  const [macroR, yieldR, fedR, capitalR, commCurveR, fearGreedR, creditR, shortR, capsR, insiderR, ownerR, optR, koreaR, nportR, blockR, volR] = await Promise.all([
    warm(base, '/api/macro-indicators', 'macro-indicators'),
    warm(base, '/api/yield-curve', 'yield-curve', 30000),       // 16 FRED series (TIPS + BEI)
    warm(base, '/api/fedwatch', 'fedwatch'),
    warm(base, '/api/capital-flows', 'capital-flows'),
    warm(base, '/api/commodity-curve', 'commodity-curve', 20000), // WTI/Gold futures (12 Yahoo calls)
    warm(base, '/api/volatility', 'volatility'),
    warm(base, '/api/fear-greed?force=1', 'fear-greed'),
    warm(base, '/api/credit-balance', 'credit-balance'),
    warm(base, '/api/short-interest', 'short-interest', 45000),
    warm(base, '/api/market-caps', 'market-caps', 50000),
    warm(base, '/api/insider-trades', 'insider-trades', 55000),   // EDGAR Form 4 (~40 filings)
    warm(base, '/api/ownership-alerts', 'ownership-alerts', 55000), // EDGAR 13D/13G
    warm(base, '/api/options-flow', 'options-flow', 15000),        // Unusual Whales (no-op without key)
    warm(base, '/api/korea-flow', 'korea-flow', 20000),            // KRX 외인·기관
    warm(base, '/api/nport-holdings', 'nport-holdings', 55000),     // EDGAR N-PORT mutual funds
    warm(base, '/api/block-trades', 'block-trades', 30000),         // Polygon (no-op without key)
  ]);

  // ── 1-b: 히트맵 (국가별 x 시간별 키라 US만 워밍) + OSINT ───────────────
  const [heatmapR, osintSocR, osintSancR, osintCorpR, osintCryptoR, latestR] = await Promise.all([
    warm(base, '/api/market-heatmap?country=US', 'market-heatmap', 45000),
    warm(base, '/api/osint/social',    'osint-social',    25000),
    warm(base, '/api/osint/sanctions', 'osint-sanctions', 25000),
    warm(base, '/api/osint/corporate', 'osint-corporate', 25000),
    warm(base, '/api/osint/crypto',    'osint-crypto',    25000),
    warm(base, '/api/latest-updates',  'latest-updates',  15000),  // aggregates everything, warm last in stage 1
  ]);

  // ── 2단계: capital-flows 의존 분석 ─────────────────────────────────────
  const flowR = await warm(base, '/api/flow-analysis?tf=4w', 'flow-analysis');

  // ── 3단계: AI 리포트 캐시 삭제 후 재생성 ────────────────────────────────
  if (cronSecret) await bustDailyBriefCache(base, cronSecret);
  const [brief1wR, brief4wR, brief13wR] = await Promise.all([
    warm(base, '/api/daily-brief?tf=1w&force=1', 'daily-brief-1w', 20000),
    warm(base, '/api/daily-brief?tf=4w&force=1', 'daily-brief-4w', 20000),
    warm(base, '/api/daily-brief?tf=13w&force=1', 'daily-brief-13w', 20000),
  ]);

  // ── 4단계: 수급동향 주요 티커 pre-warm (fire & forget) ─────────────────
  for (const ticker of TOP_TICKERS) {
    fetch(`${base}/api/stock-supply?ticker=${ticker}`, {
      signal: AbortSignal.timeout(15000),
    }).catch(() => {});
  }

  // ── 5단계: news-cascade (느림 — fire & forget) ─────────────────────────
  fetch(`${base}/api/news-cascade`, { signal: AbortSignal.timeout(60000) }).catch(() => {});

  const results = [
    macroR, yieldR, fedR, capitalR, commCurveR, fearGreedR, creditR, shortR, capsR,
    insiderR, ownerR, optR, koreaR, nportR, blockR, volR,
    heatmapR, osintSocR, osintSancR, osintCorpR, osintCryptoR, latestR,
    flowR, brief1wR, brief4wR, brief13wR,
  ];
  const failedCount = results.filter(r => !r.ok).length;

  // Log per-endpoint warming outcome so /admin/logs shows which cron targets
  // failed without having to tail Vercel dashboard.
  for (const r of results) {
    if (!r.ok) logger.warn('cron.update-all', 'warm_failed', { label: r.label, status: r.status, durationMs: r.ms });
  }
  logger.info('cron.update-all', 'run_complete', { failedCount, totalMs: Date.now() - startTime });

  return NextResponse.json({
    success: failedCount === 0,
    failedCount,
    totalMs: Date.now() - startTime,
    baseUrl: base,
    results,
    updatedAt: new Date().toISOString(),
    kstTime: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ') + ' KST',
  });
}
