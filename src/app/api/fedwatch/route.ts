import { logger, loggedRedisSet} from '@/lib/logger';
/**
 * /api/fedwatch
 *
 * FOMC 회의별 금리 인하/동결/인상 확률 (CME FedWatch 스타일)
 * 정적 데이터 제공 — 필요 시 업데이트
 * Cache: 4h Redis
 */
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
export const dynamic = 'force-dynamic';

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

function cacheKey(): string {
  const utcDate = new Date().toISOString().slice(0, 10);
  return `flowvium:fedwatch:v2:${utcDate}`;
}

export interface FomcMeeting {
  date: string;         // "2026-05-07"
  label: string;        // "May 7"
  current: number;      // current target rate mid (e.g. 4.375)
  targetLow: number;    // e.g. 4.25
  targetHigh: number;   // e.g. 4.50
  probHike: number;     // 0~100 %
  probHold: number;
  probCut25: number;    // 1 cut (25bp)
  probCut50: number;    // 2 cuts (50bp)
  probCut75: number;    // 3+ cuts
  impliedRate: number;  // market implied rate mid
  cumulativeCuts: number; // expected cumulative cuts in bp from now
}

export interface FedWatchData {
  currentTargetLow: number;
  currentTargetHigh: number;
  currentRateMid: number;
  meetings: FomcMeeting[];
  yearEndImpliedRate: number;
  totalImpliedCuts: number;  // bps
  updatedAt: string;
  source: string;
}

// ── Static data (updated 2026-04-26) ─────────────────────────────────────────
// Based on Yahoo Finance ZQ Fed Funds Futures pricing (ZQK26-ZQZ26)
// FOMC dates corrected to match Federal Reserve official 2026 schedule:
//   Apr 28-29 → Apr 30 decision, Jun 9-10, Jul 28-29, Sep 15-16, Oct 27-28, Dec 8-9
const STATIC_DATA: FedWatchData = {
  currentTargetLow: 4.25,
  currentTargetHigh: 4.50,
  currentRateMid: 4.375,
  meetings: [
    {
      date: '2026-04-30',
      label: 'Apr 30',
      current: 4.375,
      targetLow: 4.00,
      targetHigh: 4.25,
      probHike: 0,
      probHold: 28,
      probCut25: 62,
      probCut50: 10,
      probCut75: 0,
      impliedRate: 4.195,
      cumulativeCuts: 18,
    },
    {
      date: '2026-06-10',
      label: 'Jun 10',
      current: 4.375,
      targetLow: 3.75,
      targetHigh: 4.00,
      probHike: 0,
      probHold: 40,
      probCut25: 52,
      probCut50: 8,
      probCut75: 0,
      impliedRate: 4.070,
      cumulativeCuts: 31,
    },
    {
      date: '2026-07-29',
      label: 'Jul 29',
      current: 4.375,
      targetLow: 3.75,
      targetHigh: 4.00,
      probHike: 0,
      probHold: 45,
      probCut25: 50,
      probCut50: 5,
      probCut75: 0,
      impliedRate: 4.050,
      cumulativeCuts: 32,
    },
    {
      date: '2026-09-16',
      label: 'Sep 16',
      current: 4.375,
      targetLow: 3.50,
      targetHigh: 3.75,
      probHike: 0,
      probHold: 38,
      probCut25: 55,
      probCut50: 7,
      probCut75: 0,
      impliedRate: 3.960,
      cumulativeCuts: 42,
    },
    {
      date: '2026-10-28',
      label: 'Oct 28',
      current: 4.375,
      targetLow: 3.50,
      targetHigh: 3.75,
      probHike: 0,
      probHold: 42,
      probCut25: 52,
      probCut50: 6,
      probCut75: 0,
      impliedRate: 3.935,
      cumulativeCuts: 44,
    },
    {
      date: '2026-12-09',
      label: 'Dec 9',
      current: 4.375,
      targetLow: 3.50,
      targetHigh: 3.75,
      probHike: 0,
      probHold: 45,
      probCut25: 50,
      probCut50: 5,
      probCut75: 0,
      impliedRate: 3.905,
      cumulativeCuts: 47,
    },
  ],
  yearEndImpliedRate: 3.905,
  totalImpliedCuts: 47,
  updatedAt: '2026-04-26',
  source: 'Yahoo Finance ZQ Futures 기반 시장 컨센서스',
};

// ── Yahoo Finance ZQ Futures live fetch ──────────────────────────────────────
async function fetchYFImpliedRates(): Promise<Record<string, number> | null> {
  const MONTH_MAP: Record<string, string> = {
    'F': 'JAN', 'G': 'FEB', 'H': 'MAR', 'J': 'APR', 'K': 'MAY',
    'M': 'JUN', 'N': 'JUL', 'Q': 'AUG', 'U': 'SEP', 'V': 'OCT',
    'X': 'NOV', 'Z': 'DEC',
  };
  const CONTRACTS = ['ZQJ26', 'ZQK26', 'ZQM26', 'ZQN26', 'ZQQ26', 'ZQU26', 'ZQV26', 'ZQZ26'];
  try {
    const results = await Promise.allSettled(
      CONTRACTS.map(async (contract) => {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${contract}.CBT?interval=1d&range=5d`;
        const res = await fetch(url, {
          signal: AbortSignal.timeout(8000),
          cache: 'no-store',
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; Flowvium/1.0)',
            'Accept': 'application/json',
          },
        });
        if (!res.ok) return null;
        const data = await res.json();
        const closeArr = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
        const prices: number[] = Array.isArray(closeArr)
          ? closeArr.filter((p: unknown) => typeof p === 'number')
          : [];
        const price = prices[prices.length - 1];
        if (!price || price < 90) return null;
        const monthCode = contract[2];
        const yearSuffix = contract.slice(3);
        const monthName = MONTH_MAP[monthCode];
        if (!monthName) return null;
        const impliedRate = parseFloat((100 - price).toFixed(4));
        return {
          key26: `${monthName}${yearSuffix}`,
          keyFull: `${monthName}20${yearSuffix}`,
          rate: impliedRate,
        };
      })
    );
    const rates: Record<string, number> = {};
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        rates[r.value.key26] = r.value.rate;
        rates[r.value.keyFull] = r.value.rate;
      }
    }
    return Object.keys(rates).length >= 2 ? rates : null;
  } catch {
    return null;
  }
}

// Map CME month code to a meeting, compute probability distribution from implied rate
function computeMeetingProbs(
  meeting: FomcMeeting,
  impliedRates: Record<string, number>,
  currentMid: number,
): Partial<FomcMeeting> {
  const d = new Date(meeting.date);
  const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const monthCodes = [
    `${MONTHS[d.getMonth()]}${String(d.getFullYear()).slice(2)}`,
    `${MONTHS[d.getMonth()]}${d.getFullYear()}`,
  ];
  const implied = monthCodes.reduce((acc: number | null, code) => {
    const r = impliedRates[code];
    return r !== undefined ? r : acc;
  }, null);

  if (implied === null) return {};

  const diff = currentMid - implied; // positive = market prices in cuts
  // Expected cumulative cuts in units of 25bp
  const expectedCuts = diff / 0.25;

  let probHike = 0, probHold = 0, probCut25 = 0, probCut50 = 0, probCut75 = 0;

  if (expectedCuts <= -0.5) {
    // Hike scenario dominant
    probHike = Math.min(95, Math.round(-expectedCuts * 80));
    probHold = 100 - probHike;
  } else if (expectedCuts < 0.5) {
    // Hold most likely, small cut/hike tail
    const tailCut = Math.max(0, Math.round(expectedCuts * 60));
    const tailHike = expectedCuts < 0 ? Math.min(8, Math.round(-expectedCuts * 40)) : 0;
    probHold = 100 - tailCut - tailHike;
    probCut25 = tailCut;
    probHike = tailHike;
  } else if (expectedCuts < 1.5) {
    // 1 cut most likely
    const p1 = Math.round(Math.max(30, Math.min(85, (1 - Math.abs(expectedCuts - 1)) * 120)));
    const p0 = Math.round(Math.max(0, (1.5 - expectedCuts) * 60));
    const p2 = Math.max(0, 100 - p1 - p0);
    probHold = p0;
    probCut25 = p1;
    probCut50 = p2;
  } else if (expectedCuts < 2.5) {
    // 2 cuts most likely
    const p2 = Math.round(Math.max(30, Math.min(80, (1 - Math.abs(expectedCuts - 2)) * 120)));
    const p1 = Math.round(Math.max(0, (2.5 - expectedCuts) * 50));
    const p3 = Math.max(0, 100 - p2 - p1);
    probCut25 = p1;
    probCut50 = p2;
    probCut75 = p3;
  } else {
    // 3+ cuts
    probCut75 = Math.min(75, Math.round(expectedCuts * 20));
    probCut50 = Math.round((100 - probCut75) * 0.55);
    probCut25 = Math.max(0, 100 - probCut75 - probCut50);
  }

  return {
    impliedRate: parseFloat(implied.toFixed(3)),
    probHike: parseFloat(probHike.toFixed(1)),
    probHold: parseFloat(probHold.toFixed(1)),
    probCut25: parseFloat(probCut25.toFixed(1)),
    probCut50: parseFloat(probCut50.toFixed(1)),
    probCut75: parseFloat(probCut75.toFixed(1)),
    cumulativeCuts: parseFloat(Math.max(0, diff * 100).toFixed(0)),
  };
}

const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=14400, stale-while-revalidate=600' };

// 4h module-level cache — without Redis each request fires 7 Yahoo ZQ futures calls
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let FEDWATCH_MEMORY_CACHE: { data: any; expiresAt: number } | null = null;
const FEDWATCH_MEMORY_TTL_MS = 4 * 60 * 60 * 1000;

export async function GET() {
  const redis = createRedis();

  if (!redis && FEDWATCH_MEMORY_CACHE && Date.now() < FEDWATCH_MEMORY_CACHE.expiresAt) {
    return NextResponse.json({ ...FEDWATCH_MEMORY_CACHE.data, cached: true }, { headers: CDN_HEADERS });
  }

  if (redis) {
    try {
      const cached = await redis.get(cacheKey());
      if (cached) return NextResponse.json({ ...(cached as object), cached: true }, { headers: CDN_HEADERS });
    } catch { /* non-fatal */ }
  }

  // Try live Yahoo Finance ZQ Futures data
  const cmeRates = await fetchYFImpliedRates();
  let meetings = STATIC_DATA.meetings;
  let source = STATIC_DATA.source;
  let liveData = false;

  if (cmeRates && Object.keys(cmeRates).length >= 3) {
    liveData = true;
    source = 'Yahoo Finance ZQ Futures 실시간';
    meetings = STATIC_DATA.meetings.map(m => {
      const live = computeMeetingProbs(m, cmeRates, STATIC_DATA.currentRateMid);
      return { ...m, ...live };
    });
  }

  const result: FedWatchData & { cached: boolean; liveData: boolean } = {
    ...STATIC_DATA,
    meetings,
    source,
    yearEndImpliedRate: meetings[meetings.length - 1]?.impliedRate ?? STATIC_DATA.yearEndImpliedRate,
    totalImpliedCuts: meetings[meetings.length - 1]?.cumulativeCuts ?? STATIC_DATA.totalImpliedCuts,
    updatedAt: liveData ? new Date().toISOString().slice(0, 10) : STATIC_DATA.updatedAt,
    cached: false,
    liveData,
  };

  if (redis) {
    const key = cacheKey();
    try {
      logger.info('fedwatch', 'save_start', { key, ttl: 4 * 60 * 60 });
      const t0 = Date.now();
      await loggedRedisSet(redis, 'api.fedwatch', key, result, { ex: 4 * 60 * 60 });
      logger.info('fedwatch', 'save_ok', { key, durationMs: Date.now() - t0 });
    } catch (err) {
      logger.error('fedwatch', 'save_failed', { key, error: err });
    }
  } else if (liveData) {
    FEDWATCH_MEMORY_CACHE = { data: result, expiresAt: Date.now() + FEDWATCH_MEMORY_TTL_MS };
  }

  return NextResponse.json(result, { headers: CDN_HEADERS });
}
