/**
 * /api/cron/log-cascade-events
 *
 * Weekly cron (Sundays 01:00 UTC) — detects cascade events from the past week
 * and logs them to Redis for display on CascadeDetailPage.
 *
 * Logic:
 *   1. Fetch 10-day price history for 8 cascade leaders via Yahoo Finance
 *   2. Compute 1-week return; flag leaders with |ret1w| >= 10%
 *   3. Generate short Korean description via AI (callAI fallback chain)
 *   4. LPUSH events to Redis flowvium:cascade:events:v1, LTRIM to 50, TTL 180d
 */
import { NextRequest, NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import { logger, loggedFetch } from '@/lib/logger';
import { callAI } from '@/lib/ai-providers';
import { cascadePatterns } from '@/data/cascades';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const REDIS_KEY = 'flowvium:cascade:events:v1';
const REDIS_TTL = 180 * 24 * 3600;

// ── Target leaders to monitor ─────────────────────────────────────────────────
const LEADERS = ['NVDA', 'ASML', 'MSFT', 'TSM', 'LMT', 'ABBV', 'TSLA', 'WMT'];
const CASCADE_THRESHOLD = 10; // |ret1w| >= 10%

// Pre-build leader → {sector, followers} map from cascades.ts
function buildLeaderMeta(): Map<string, { leaderSector: string; followers: string[] }> {
  const map = new Map<string, { leaderSector: string; followers: string[] }>();
  for (const pattern of cascadePatterns) {
    if (!LEADERS.includes(pattern.leaderTicker)) continue;
    if (map.has(pattern.leaderTicker)) continue; // use first pattern
    const followers = pattern.sequence
      .filter((s) => s.role !== 'leader')
      .map((s) => s.ticker)
      .slice(0, 5);
    map.set(pattern.leaderTicker, {
      leaderSector: pattern.sectorName,
      followers,
    });
  }
  // Fallback for leaders not in cascades (ABBV, WMT)
  if (!map.has('ABBV')) map.set('ABBV', { leaderSector: 'pharma-biotech', followers: [] });
  if (!map.has('WMT')) map.set('WMT', { leaderSector: 'consumer', followers: [] });
  if (!map.has('TSM')) map.set('TSM', { leaderSector: 'semiconductors', followers: [] });
  return map;
}

// ── Yahoo Finance 10d price fetch ─────────────────────────────────────────────
async function fetchPrices10d(ticker: string): Promise<number[] | null> {
  try {
    const encodedTicker = encodeURIComponent(ticker);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodedTicker}?interval=1d&range=10d`;
    const res = await loggedFetch('log-cascade-events', `yahoo_${ticker}`, url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res || !res.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await res.json();
    const closes: (number | null)[] = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    return closes.filter((v): v is number => v != null);
  } catch (err) {
    logger.error('log-cascade-events', 'yahoo_error', { ticker, error: err });
    return null;
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const redis = createRedis();
  const leaderMeta = buildLeaderMeta();
  const today = new Date().toISOString().slice(0, 10);

  // 1. Fetch prices for all leaders in parallel
  const priceResults = await Promise.all(
    LEADERS.map(async (ticker) => {
      const prices = await fetchPrices10d(ticker);
      if (!prices || prices.length < 6) return { ticker, ret1w: null };
      const current = prices[prices.length - 1];
      const prev = prices[prices.length - 6]; // ~5 trading days back
      const ret1w = ((current - prev) / prev) * 100;
      return { ticker, ret1w, currentPrice: current };
    }),
  );

  // 2. Filter leaders with |ret1w| >= threshold
  const triggered = priceResults.filter(
    (r) => r.ret1w != null && Math.abs(r.ret1w) >= CASCADE_THRESHOLD,
  );

  if (!triggered.length) {
    logger.info('log-cascade-events', 'no_trigger', { threshold: CASCADE_THRESHOLD });
    return NextResponse.json({ triggered: false, checked: LEADERS.length });
  }

  // 3. Generate events and push to Redis
  const savedEvents: string[] = [];
  for (const { ticker, ret1w } of triggered) {
    if (ret1w == null) continue;
    const meta = leaderMeta.get(ticker) ?? { leaderSector: 'unknown', followers: [] };
    const sign = ret1w >= 0 ? '+' : '';
    const leaderMoveStr = `${sign}${ret1w.toFixed(1)}%`;

    // AI description (≤200 chars Korean)
    let description = `${ticker} 1주 ${leaderMoveStr} 이동. 연관 팔로워: ${
      meta.followers.slice(0, 3).join(', ') || '—'
    } 주목`;
    try {
      const aiResult = await callAI(
        `다음 CASCADE 이벤트를 한국어로 200자 이내로 설명하라. 투자 인사이트 포함.\n리더: ${ticker}\n주간 수익률: ${leaderMoveStr}\n섹터: ${meta.leaderSector}\n팔로워: ${meta.followers.join(', ')}\n\n설명만 반환 (앞뒤 공백 제거):`,
        { maxTokens: 120 },
      );
      if (aiResult.text.trim().length > 10) {
        description = aiResult.text.trim().slice(0, 200);
      }
    } catch (aiErr) {
      logger.warn('log-cascade-events', 'ai_fallback', { ticker, error: aiErr });
    }

    const event = {
      date: today,
      leader: ticker,
      leaderSector: meta.leaderSector,
      leaderMove: leaderMoveStr,
      followers: meta.followers,
      description,
      generatedAt: new Date().toISOString(),
    };

    if (redis) {
      try {
        await redis.lpush(REDIS_KEY, JSON.stringify(event));
        await redis.ltrim(REDIS_KEY, 0, 49);
        await redis.expire(REDIS_KEY, REDIS_TTL);
        savedEvents.push(ticker);
      } catch (redisErr) {
        logger.error('log-cascade-events', 'redis_push_error', { ticker, error: redisErr });
      }
    }

    logger.info('log-cascade-events', 'event_logged', {
      ticker,
      leaderMove: leaderMoveStr,
      sector: meta.leaderSector,
    });
  }

  return NextResponse.json({
    triggered: true,
    events: savedEvents,
    total: triggered.length,
    updatedAt: new Date().toISOString(),
  });
}
