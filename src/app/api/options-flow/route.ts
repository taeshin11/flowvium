/**
 * /api/options-flow
 *
 * 2026-06-13: Unusual Whales 유료 의존 제거 (사용자 "후원 안 받고 무료 정보로 우회 못 하나").
 * Yahoo 옵션 체인(iv-screener 가 이미 fetch·캐시하는 flowvium:iv:v1:{T})의 계약별
 * volume / openInterest 비율로 unusual activity 를 파생 — 추가 fetch 비용 0.
 *   - vol/OI ≥ 2 & volume ≥ 300 = 당일 신규 포지셔닝 의심 (고전적 무료 UOA 스크린)
 *   - call=bullish / put=bearish 근사 (sweep 방향(ask/bid)은 무료 데이터에 없음 → side='mid')
 *   - Yahoo 시세는 ~15-20분 지연 — source 라벨로 명시.
 * 종전 유료 게이트(configured:false → 잠금 UI)는 제거 — 이제 상시 데이터.
 */
import { NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import type { OptionsFlowAlert } from '@/lib/unusual-whales';
import type { IvSummary } from '@/lib/options/iv-summary';
import { SCREENER_TICKERS } from '@/lib/options/screener-tickers';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=120' };

export async function GET() {
  const t0 = Date.now();
  const redis = createRedis();
  if (!redis) {
    return NextResponse.json({ items: [], configured: true, total: 0, source: 'yahoo-chain-derived', note: 'redis unavailable' });
  }
  try {
    const keys = SCREENER_TICKERS.map((t) => `flowvium:iv:v1:${t}`);
    const summaries = await redis.mget<(IvSummary | null)[]>(...keys);
    const items: OptionsFlowAlert[] = [];
    for (const s of summaries) {
      if (!s || !Array.isArray(s.unusual)) continue;
      for (const u of s.unusual) {
        items.push({
          id: `${s.ticker}-${u.expiry}-${u.optionType}-${u.strike}`,
          timestamp: s.asOf,
          ticker: s.ticker,
          optionType: u.optionType,
          strike: u.strike,
          expiry: u.expiry,
          size: u.volume,
          premiumUsd: u.premiumUsd,
          side: 'mid',                       // 무료 데이터엔 sweep 방향 없음 — 중립 표기
          isUnusual: true,
          sentiment: u.optionType === 'call' ? 'bullish' : 'bearish',
        });
      }
    }
    items.sort((a, b) => (b.premiumUsd ?? 0) - (a.premiumUsd ?? 0));
    logger.info('api.options-flow', 'derived_ok', { total: items.length, tickers: SCREENER_TICKERS.length, durationMs: Date.now() - t0 });
    return NextResponse.json(
      { items: items.slice(0, 50), configured: true, total: items.length, source: 'yahoo-chain-derived (vol/OI>=2, ~15-20min delayed)', updatedAt: new Date().toISOString() },
      { headers: CDN_HEADERS },
    );
  } catch (err) {
    // 2026-06-13: 일시적 Redis(mget 31키) 에러를 502(=DEAD)로 내보내던 버그 — !redis 경로(200)와
    //   불일치. endpoint 자체는 정상, Redis 가 순간 hiccup 한 것 → degraded 200(빈 items + note)로
    //   통일. 모니터 auto-probe 가 transient blip 을 "죽음"으로 오탐하던 것 차단.
    logger.error('api.options-flow', 'derive_failed', { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ items: [], configured: true, total: 0, source: 'yahoo-chain-derived', degraded: true, note: 'redis transient error' }, { headers: CDN_HEADERS });
  }
}
