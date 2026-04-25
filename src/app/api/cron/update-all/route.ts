import { logger } from '@/lib/logger';
/**
 * /api/cron/update-all
 *
 * 하루 3회 실행 (vercel.json 기준 KST):
 *   07:50 KST / 15:50 KST / 21:20 KST
 *
 * 캐시 워밍 순서:
 *   0. non-US heatmap (KR/JP/CN/EU — fire & forget, concurrent with stage 1)
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
export const dynamic = 'force-dynamic';

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
      cache: 'no-store',
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

const TOP_TICKERS = ['NVDA', 'AAPL', 'MSFT', 'TSMC', 'AMZN', 'GOOGL', 'META', 'LMT', 'MU', 'ASML'];

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET ?? '';
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const base = getBaseUrl();
  const startTime = Date.now();

  // Non-US heatmaps: fire & forget concurrently with stage 1 — Korean/Japanese/Chinese/EU users get pre-warmed cache.
  Promise.allSettled(['KR', 'JP', 'CN', 'EU'].map(country =>
    warm(base, `/api/market-heatmap?country=${country}`, `heatmap-${country}`, 20000)
  )).then(results => {
    for (const r of results) {
      if (r.status === 'fulfilled' && !r.value.ok)
        logger.warn('cron.update-all', 'warm_failed', { label: r.value.label, status: r.value.status, durationMs: r.value.ms });
    }
  }).catch(() => {});

  // ── 1단계: 모든 독립 소스 + heatmap/OSINT 완전 병렬 ─────────────────────
  // heatmap·OSINT는 stage 1 데이터에 무의존 → 분리 필요 없음.
  // latest-updates 만 제외 (macro/fear-greed/capital-flows Redis 워밍 완료 후 실행).
  // 타임아웃 설계: stage 1(30s) + stage 2(25s) < maxDuration(60s).
  // EDGAR 3종(insider/ownership/nport): 30s — 그 이상이면 EDGAR 장애이므로 조기 포기.
  // market-caps/heatmap: Yahoo Finance — 25s/20s 충분.
  const [macroR, yieldR, fedR, capitalR, commCurveR, fearGreedR, creditR, shortR, capsR, insiderR, ownerR, optR, koreaR, nportR, blockR, volR, cotR, heatmapR, osintSocR, osintSancR, osintCorpR, osintCryptoR, moversR, sectorR] = await Promise.all([
    warm(base, '/api/macro-indicators', 'macro-indicators'),
    warm(base, '/api/yield-curve', 'yield-curve', 30000),
    warm(base, '/api/fedwatch', 'fedwatch'),
    warm(base, '/api/capital-flows', 'capital-flows'),
    warm(base, '/api/commodity-curve', 'commodity-curve', 20000),
    warm(base, '/api/volatility', 'volatility'),
    warm(base, '/api/fear-greed?force=1', 'fear-greed'),
    warm(base, '/api/credit-balance', 'credit-balance'),
    warm(base, '/api/short-interest', 'short-interest', 10000),
    warm(base, '/api/market-caps', 'market-caps', 25000),
    warm(base, '/api/insider-trades', 'insider-trades', 30000),
    warm(base, '/api/ownership-alerts', 'ownership-alerts', 30000),
    warm(base, '/api/options-flow', 'options-flow', 15000),
    warm(base, '/api/korea-flow', 'korea-flow', 20000),
    warm(base, '/api/nport-holdings', 'nport-holdings', 30000),
    warm(base, '/api/block-trades', 'block-trades', 25000),
    warm(base, '/api/cot-positions', 'cot-positions', 20000),
    warm(base, '/api/market-heatmap?country=US', 'market-heatmap', 20000),
    warm(base, '/api/osint/social',    'osint-social',    20000),
    warm(base, '/api/osint/sanctions', 'osint-sanctions', 20000),
    warm(base, '/api/osint/corporate', 'osint-corporate', 20000),
    warm(base, '/api/osint/crypto',    'osint-crypto',    20000),
    warm(base, '/api/market-movers',   'market-movers',   15000),
    warm(base, '/api/sector-pe',       'sector-pe',       25000),
  ]);

  // ── 2단계: capital-flows 의존 분석 + latest-updates 병렬 ─────────────
  // flow-analysis: capital-flows Redis 완료 후 실행.
  // latest-updates: macro/fear-greed/capital-flows 모두 완료 후 실행 — 둘은 서로 무의존.
  const [flowR, latestR] = await Promise.all([
    warm(base, '/api/flow-analysis?tf=4w', 'flow-analysis'),
    warm(base, '/api/latest-updates',  'latest-updates',  15000),
  ]);

  // ── 3단계: daily-brief — fire & forget (dedicated cron이 5분 후 재생성) ──
  // await 하면 stage 1(30s) + stage 2(25s) + stage 3(20s) = 75s → maxDuration(60s) 초과.
  // daily-brief는 자체 cron으로 관리되므로 update-all에서 결과를 기다릴 필요 없음.
  fetch(`${base}/api/daily-brief?tf=4w`, { signal: AbortSignal.timeout(20000), cache: 'no-store' })
    .then(r => { if (!r.ok) logger.warn('cron.update-all', 'daily_brief_warm_failed', { status: r.status }); })
    .catch(e => logger.warn('cron.update-all', 'daily_brief_warm_error', { error: e instanceof Error ? e.message : String(e) }));

  // ── 4단계: investment-strategy + 수급동향 주요 티커 pre-warm (fire & forget) ───
  fetch(`${base}/api/investment-strategy`, { signal: AbortSignal.timeout(50000), cache: 'no-store' })
    .then(r => { if (!r.ok) logger.warn('cron.update-all', 'investment_strategy_warm_failed', { status: r.status }); })
    .catch(e => logger.warn('cron.update-all', 'investment_strategy_warm_error', { error: e instanceof Error ? e.message : String(e) }));

  // ── 수급동향 주요 티커 pre-warm (fire & forget, 병렬) ──────────────
  Promise.allSettled(TOP_TICKERS.map(ticker =>
    fetch(`${base}/api/stock-supply?ticker=${ticker}`, {
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    })
  )).catch(() => {});

  // ── 5단계: news-cascade (느림 — fire & forget) ─────────────────────────
  fetch(`${base}/api/news-cascade`, { signal: AbortSignal.timeout(60000), cache: 'no-store' })
    .then(r => { if (!r.ok) logger.warn('cron.update-all', 'news_cascade_failed', { status: r.status }); })
    .catch(e => logger.warn('cron.update-all', 'news_cascade_error', { error: e instanceof Error ? e.message : String(e) }));

  const results = [
    macroR, yieldR, fedR, capitalR, commCurveR, fearGreedR, creditR, shortR, capsR,
    insiderR, ownerR, optR, koreaR, nportR, blockR, volR, cotR,
    heatmapR, osintSocR, osintSancR, osintCorpR, osintCryptoR, moversR, sectorR, latestR,
    flowR,
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
