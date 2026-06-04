import { logger, loggedRedisSet } from '@/lib/logger';
/**
 * /api/market-caps
 *
 * Returns { ticker: band } 정적 enum + { ticker: liveCap } TRACKED_TICKERS (~30개).
 * Yahoo v8 chart 는 Vercel 에서도 작동 (no crumb 필요) — TRACKED 30 tickers 만
 * 병렬 fetch 로 caps map 채움. 나머지는 categorical band 만 제공.
 *
 * Optional ?ticker=AAPL param returns single-ticker data with live market cap.
 *
 * Redis cache: 24h (bands enum 정적, live caps 는 24h 안에 +-수% 변동 허용).
 * source: 'live' (30/30), 'partial' (일부), 'error' (Yahoo 전부 실패).
 * bands enum 자체는 categorical (small/mid/large/mega) 라 항상 정적 — source
 * 차원에서 분리. capsLive/capsTotal 가 라이브 커버리지 측정 지표.
 */
import { NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import type { Redis } from '@upstash/redis';
import { allCompanies } from '@/data/companies';
import { type MarketCapBand, YAHOO_HEADERS } from '@/lib/yahoo-finance';
export const dynamic = 'force-dynamic';

const CACHE_KEY = 'flowvium:market-caps:v3'; // v3: TRACKED_TICKERS live caps 추가
const CACHE_TTL = 24 * 60 * 60; // 24h — bands enum 정적, live cap 도 ±수% 변동 24h 허용
// Intelligence/Signals/Heatmap 페이지에서 가장 자주 노출되는 hot ticker
const TRACKED_TICKERS = [
  'NVDA', 'MSFT', 'AAPL', 'META', 'GOOGL', 'AMZN', 'TSLA', 'AMD',
  'MU', 'AVGO', 'ARM', 'TSM', 'ASML', 'AMAT', 'LRCX', 'KLAC',
  'JPM', 'GS', 'BAC', 'V', 'UNH', 'XOM', 'CVX',
  'LMT', 'RTX', 'NOC', 'PLTR', 'COIN', 'MRNA', 'LLY',
];
// 단일 ticker live cap 은 Yahoo 응답 그대로 반환 — CDN 은 4h 로 단축 (장중 변동 반영)
const CDN_HEADERS_MAP = { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600' };
const CDN_HEADERS_TICKER = { 'Cache-Control': 'public, s-maxage=14400, stale-while-revalidate=300' };

export const maxDuration = 60;

export interface MarketCapPayload {
  bands: Record<string, MarketCapBand>;  // ticker → band (정적 enum)
  caps: Record<string, number>;          // ticker → raw USD cap (TRACKED_TICKERS live)
  updatedAt: string;
  count: number;
  /** 'live' = TRACKED 전부 성공, 'partial' = 일부, 'error' = Yahoo 전부 실패 */
  source: 'live' | 'partial' | 'error';
  capsLive: number;       // 실제로 라이브 fetch 된 caps 개수
  capsTotal: number;      // 시도한 caps 개수 (= TRACKED_TICKERS.length)
  cached?: boolean;
}

// Yahoo v8 chart에서 meta.marketCap 삭제됨 (2026-05 확인).
// 대안: regularMarketPrice × sharesOutstanding(billions, 분기 업데이트).
const SHARES_B: Record<string, number> = {
  NVDA: 24.49, MSFT: 7.43, AAPL: 15.33, META: 2.53, GOOGL: 12.16,
  AMZN: 10.52, TSLA: 3.21, AMD: 1.62, MU: 1.10, AVGO: 4.64,
  ARM: 1.03, TSM: 5.18, ASML: 0.39, AMAT: 0.82, LRCX: 0.13,
  KLAC: 0.13, JPM: 2.86, GS: 0.33, BAC: 7.89, V: 1.62,
  UNH: 0.92, XOM: 4.22, CVX: 1.84, LMT: 0.24, RTX: 1.33,
  NOC: 0.15, PLTR: 2.36, COIN: 0.24, MRNA: 0.38, LLY: 0.95,
};

// Stooq fallback — Vercel IP 에서 Yahoo 보다 throttle 적음 (market-heatmap이 이미 안정 사용 중)
async function fetchStooqPrice(ticker: string): Promise<number | null> {
  try {
    // Stooq는 dot → dash + .us 접미사 (US 종목)
    const stooqTicker = ticker.replace(/\./g, '-').toLowerCase() + '.us';
    const res = await fetch(`https://stooq.com/q/l/?s=${stooqTicker}&f=sd2t2ohlcv&h&e=csv`, {
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const text = await res.text();
    // CSV: Symbol,Date,Time,Open,High,Low,Close,Volume
    const lines = text.trim().split('\n');
    if (lines.length < 2) return null;
    const cols = lines[1].split(',');
    const close = parseFloat(cols[6]);
    return close > 0 ? close : null;
  } catch { return null; }
}

// 2026-06-04: KR(.KS/.KQ) 시가총액 — Naver "시총"(예: "2,107조 5,834억") 파싱 → KRW.
//   (allCompanies band·SHARES_B 둘 다 US-only 라 KOSDAQ "no bands" 사각지대 해소. 동적 라이브.)
function parseKoreanCap(s: string): number | null {
  if (!s) return null;
  const clean = s.replace(/,/g, '');
  const jo = clean.match(/([\d.]+)\s*조/);
  const eok = clean.match(/([\d.]+)\s*억/);
  let krw = 0;
  if (jo) krw += parseFloat(jo[1]) * 1e12;
  if (eok) krw += parseFloat(eok[1]) * 1e8;
  return krw > 0 ? krw : null;
}
function krBand(krw: number): MarketCapBand {
  if (krw >= 50e12) return 'mega' as MarketCapBand;
  if (krw >= 10e12) return 'large' as MarketCapBand;
  if (krw >= 1e12) return 'mid' as MarketCapBand;
  return 'small' as MarketCapBand;
}
async function fetchNaverCapKR(ticker: string): Promise<number | null> {
  const code = ticker.replace(/\.(KS|KQ)$/i, '');
  try {
    const res = await fetch(`https://m.stock.naver.com/api/stock/${code}/integration`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(6000), cache: 'no-store' });
    if (!res.ok) return null;
    const j = await res.json() as { totalInfos?: Array<{ key?: string; value?: string }> };
    const cap = (j.totalInfos || []).find(x => x.key === '시총');
    return cap?.value ? parseKoreanCap(cap.value) : null;
  } catch { return null; }
}

async function fetchYahooCap(ticker: string): Promise<number | null> {
  const shares = SHARES_B[ticker];
  if (!shares) return null;

  // 1) Yahoo v8 chart 시도
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`,
      { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(6000), cache: 'no-store' }
    );
    if (res.ok) {
      const data = await res.json();
      const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice as number | undefined;
      if (price && price > 0) return Math.round(price * shares * 1e9);
    }
  } catch { /* fall through to Stooq */ }

  // 2) Stooq fallback (Vercel throttle 적음)
  const stooqPrice = await fetchStooqPrice(ticker);
  return stooqPrice ? Math.round(stooqPrice * shares * 1e9) : null;
}

// 청크 단위 순차 fetch — Vercel→Yahoo throttle 회피 (3개씩 + 800ms sleep + 실패 시 1회 retry).
async function fetchBatchInChunks(tickers: readonly string[], chunkSize = 3): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < tickers.length; i += chunkSize) {
    const chunk = tickers.slice(i, i + chunkSize);
    const results = await Promise.all(chunk.map(async t => [t, await fetchYahooCap(t)] as const));
    for (const [t, cap] of results) {
      if (cap != null && cap > 0) out.set(t, cap);
    }
    if (i + chunkSize < tickers.length) await sleep(800);
  }
  // 실패한 ticker 1회 재시도 (개별 fetch, 200ms 간격)
  const missing = tickers.filter(t => !out.has(t));
  if (missing.length > 0 && missing.length < tickers.length) {
    for (const t of missing) {
      const cap = await fetchYahooCap(t);
      if (cap != null && cap > 0) out.set(t, cap);
      await sleep(200);
    }
  }
  return out;
}

export async function GET(req: Request) {
  const redis = createRedis();
  const url = new URL(req.url);
  const force = url.searchParams.get('refresh') === '1';
  const filterTicker = url.searchParams.get('ticker')?.toUpperCase() ?? null;

  const reqStart = Date.now();
  // 2026-06-04: KR(.KS/.KQ) 단일 조회 — Naver 시총 라이브(allCompanies band 없음). KRW 기준 band.
  if (filterTicker && /\.(KS|KQ)$/i.test(filterTicker)) {
    const krwCap = await fetchNaverCapKR(filterTicker);
    if (krwCap != null) {
      return NextResponse.json({
        bands: { [filterTicker]: krBand(krwCap) }, caps: { [filterTicker]: krwCap },
        currency: 'KRW', updatedAt: new Date().toISOString(), count: 1, cached: false, source: 'naver-live',
      }, { headers: CDN_HEADERS_TICKER });
    }
    return NextResponse.json({ bands: {}, caps: {}, count: 1, source: 'kr-unavailable' }, { headers: CDN_HEADERS_TICKER });
  }
  if (redis && !force) {
    try {
      const cached = await redis.get<MarketCapPayload>(CACHE_KEY);
      if (cached) {
        logger.info('api.market-caps', 'cache_hit', { count: cached.count });
        if (filterTicker) {
          const band = cached.bands[filterTicker] ?? null;
          const liveCap = await fetchYahooCap(filterTicker);
          const caps = liveCap != null ? { [filterTicker]: liveCap } : {};
          return NextResponse.json({
            bands: band ? { [filterTicker]: band } : {}, caps,
            updatedAt: cached.updatedAt, count: 1, cached: true,
            source: liveCap != null ? 'yahoo-live' : 'static-band',
          }, { headers: CDN_HEADERS_TICKER });
        }
        return NextResponse.json({ ...cached, cached: true }, { headers: CDN_HEADERS_MAP });
      }
    } catch (err) { logger.warn('api.market-caps', 'cache_read_error', { error: err }); }
  }

  const bands: Record<string, MarketCapBand> = {};
  const seen = new Set<string>();
  for (const c of allCompanies) {
    if (!c.ticker || seen.has(c.ticker)) continue;
    seen.add(c.ticker);
    bands[c.ticker] = c.marketCap as MarketCapBand;
  }

  // TRACKED_TICKERS 청크 단위 fetch — 30 병렬 동시 시 Yahoo 가 throttle (capsLive=0/30 관찰됨).
  // 5개씩 6 chunk × 8s timeout = 최대 48s (Vercel maxDuration=60s 안).
  const capsMap = await fetchBatchInChunks(TRACKED_TICKERS, 5);
  const caps: Record<string, number> = Object.fromEntries(capsMap);
  const capsLive = capsMap.size;
  const capsTotal = TRACKED_TICKERS.length;
  const liveSource: 'live' | 'partial' | 'error' =
    capsLive === capsTotal ? 'live' : capsLive > 0 ? 'partial' : 'error';

  // 2026-05-26: capsLive=0 (Yahoo+Stooq 전부 실패) 시 prior 캐시 유지 — empty payload 저장 안 함.
  // 이전 버그: 빈 caps 가 24h TTL 캐시에 저장되어 user-visible 0/30 상태가 24h 지속.
  if (capsLive === 0 && redis) {
    try {
      const prior = await redis.get<MarketCapPayload>(CACHE_KEY);
      if (prior && prior.capsLive > 0) {
        logger.warn('api.market-caps', 'fetch_failed_preserving_prior', {
          priorCapsLive: prior.capsLive,
        });
        return NextResponse.json({
          ...prior,
          cached: true,
          source: 'partial' as const,
          updatedAt: prior.updatedAt,
        }, { headers: CDN_HEADERS_MAP });
      }
    } catch { /* non-fatal */ }
  }

  const payload: MarketCapPayload = {
    bands,
    caps,
    updatedAt: new Date().toISOString(),
    count: seen.size,
    source: liveSource,
    capsLive,
    capsTotal,
  };

  // empty payload (capsLive=0) 시 1h 짧은 TTL — 다음 호출에서 재시도 가능
  const cacheTtl = capsLive === 0 ? 60 * 60 : CACHE_TTL;
  await loggedRedisSet(redis, 'api.market-caps', CACHE_KEY, payload, { ex: cacheTtl });

  logger.info('api.market-caps', 'served', { tickers: seen.size, durationMs: Date.now() - reqStart });

  if (filterTicker) {
    const band = payload.bands[filterTicker] ?? null;
    const liveCap = await fetchYahooCap(filterTicker);
    const caps = liveCap != null ? { [filterTicker]: liveCap } : {};
    return NextResponse.json({
      bands: band ? { [filterTicker]: band } : {}, caps,
      updatedAt: payload.updatedAt, count: 1, cached: false,
      source: liveCap != null ? 'yahoo-live' : 'static-band',
    }, { headers: CDN_HEADERS_TICKER });
  }
  return NextResponse.json({ ...payload, cached: false }, { headers: CDN_HEADERS_MAP });
}
