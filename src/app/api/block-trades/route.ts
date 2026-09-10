/**
 * /api/block-trades
 *
 * 2026-06-13: Polygon 유료 의존 제거 (사용자 "후원 안 받고 무료 정보로 우회 못 하나").
 * Yahoo v8 5분봉의 *거래량 버스트*로 대량 거래를 근사: 봉 거래량이 당일 20봉 평균의 4배+
 * AND 명목금액 $3M+ 이면 "대량 거래 의심 구간". 실제 체결(prints)이 아닌 분봉 집계 proxy
 * 임을 source 라벨에 명시 — 추측/가짜 아님 (실측 분봉에서 결정론 계산).
 * 방향: 봉 종가>시가 = 매수 우위 추정 (exchange 필드에 'burst-up/down' 표기).
 * Redis cache 30 min.
 */
import { NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import type { BlockTrade } from '@/lib/polygon';
import { logger, loggedRedisSet } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CACHE_KEY = 'flowvium:block-trades:v2'; // v2: yahoo 5m burst proxy
const CACHE_TTL = 30 * 60;
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=1200, stale-while-revalidate=120' };

const TRACKED_TICKERS = [
  'NVDA', 'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AMD', 'TSM',
  'SMCI', 'COIN', 'MU', 'AVGO', 'ASML', 'KLAC', 'LRCX', 'AMAT',
  'LMT', 'RTX', 'NOC', 'LLY', 'LHX', 'MRNA', 'REGN', 'FCX', 'ALB', 'KTOS',
];
const BURST_MULT = 4;        // 20봉 평균 대비 배수
const MIN_NOTIONAL = 3e6;    // $3M+

/**
 * 2026-09-10: 종전에는 실패해도 [] 를 돌려줬다. 그래서 "터짐이 없는 날"과 "야후가 안 열린 날"이
 *   응답에서 구별되지 않았고, 모니터가 빈 응답을 "정적/정지 의심"으로 찍어 6사이클(1.7h) 경보 후
 *   "개입 필요"까지 승격됐다 — 그런데 볼 것이 없으니 아무도 개입하지 못했다.
 *   실패는 null, 성공했지만 터짐이 없으면 [] 다. 이 구분이 있어야 0건이 정상인지 말할 수 있다.
 */
async function detectBursts(ticker: string): Promise<BlockTrade[] | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=5m&range=1d`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000), cache: 'no-store' });
    if (!res.ok) return null;
    const r = (await res.json())?.chart?.result?.[0];
    const ts: number[] = r?.timestamp ?? [];
    const q = r?.indicators?.quote?.[0] ?? {};
    const out: BlockTrade[] = [];
    const vols: number[] = q.volume ?? [];
    for (let i = 0; i < ts.length; i++) {
      const v = vols[i];
      const close = q.close?.[i];
      const open = q.open?.[i];
      if (!v || !close) continue;
      // 직전 20봉(자기 제외) 평균 — 초반 봉은 표본 4개 이상일 때만
      const start = Math.max(0, i - 20);
      const prior = vols.slice(start, i).filter((x: number) => x > 0);
      if (prior.length < 4) continue;
      const avg = prior.reduce((s: number, x: number) => s + x, 0) / prior.length;
      const notional = v * close;
      if (v >= avg * BURST_MULT && notional >= MIN_NOTIONAL) {
        out.push({
          id: `${ticker}-${ts[i]}`,
          timestamp: new Date(ts[i] * 1000).toISOString(),
          ticker,
          size: v,
          price: Math.round(close * 100) / 100,
          valueUsd: Math.round(notional),
          exchange: open != null && close >= open ? 'burst-up' : 'burst-down',
          conditions: [],
        });
      }
    }
    return out;
  } catch { return null; }
}

export async function GET(req: Request) {
  const reqStart = Date.now();
  const redis = createRedis();
  const force = new URL(req.url).searchParams.get('refresh') === '1';
  if (redis && !force) {
    try {
      // 옛 캐시는 배열, 새 캐시는 {items, asOf, scanned} — 배포 직후 둘이 섞이므로 둘 다 읽는다.
      const raw = await redis.get<BlockTrade[] | { items: BlockTrade[]; asOf?: string; scanned?: number }>(CACHE_KEY);
      const cached = Array.isArray(raw) ? { items: raw } : raw;
      if (cached?.items) {
        logger.info('api.block-trades', 'cache_hit', { total: cached.items.length });
        return NextResponse.json({
          items: cached.items, configured: true, cached: true, total: cached.items.length,
          scanned: cached.scanned ?? null, asOf: cached.asOf ?? null, source: 'yahoo-5m-burst-proxy',
        }, { headers: CDN_HEADERS });
      }
    } catch (err) { logger.warn('api.block-trades', 'cache_read_error', { error: err }); }
  }

  // 27 ticker × 1 fetch — 5개씩 병렬 배치
  const all: BlockTrade[] = [];
  let scanned = 0;                        // 실제로 응답을 받은 종목 수 — 0건이 정상인지의 근거다
  for (let i = 0; i < TRACKED_TICKERS.length; i += 5) {
    const batch = TRACKED_TICKERS.slice(i, i + 5);
    const results = await Promise.allSettled(batch.map(detectBursts));
    for (const r of results) {
      if (r.status !== 'fulfilled' || r.value === null) continue;
      scanned += 1;
      all.push(...r.value);
    }
  }
  all.sort((a, b) => b.valueUsd - a.valueUsd);
  const trades = all.slice(0, 60);
  const asOf = new Date().toISOString();
  // scanned/asOf 를 캐시에 함께 담는다 — 캐시 히트에서도 "살아있는 스캔이었다"를 말할 수 있어야 한다.
  if (redis) await loggedRedisSet(redis, 'api.block-trades', CACHE_KEY, { items: trades, asOf, scanned }, { ex: CACHE_TTL });
  logger.info('api.block-trades', 'burst_served', { total: trades.length, scanned, durationMs: Date.now() - reqStart });
  // 27종목 전부 실패했으면 0건은 "조용한 날"이 아니라 고장이다. 숨기지 않고 503 으로 말한다.
  if (scanned === 0) {
    logger.error('api.block-trades', 'all_sources_failed', { tried: TRACKED_TICKERS.length });
    return NextResponse.json(
      { items: [], configured: true, cached: false, total: 0, scanned: 0, asOf, source: 'yahoo-5m-burst-proxy', error: '전 종목 조회 실패 — 0건이 아니라 고장이다' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  return NextResponse.json({ items: trades, configured: true, cached: false, total: trades.length, scanned, asOf, source: 'yahoo-5m-burst-proxy (분봉 거래량 이상치 — 실제 체결 아님)' }, { headers: CDN_HEADERS });
}
