import { logger, loggedRedisSet} from '@/lib/logger';
/**
 * /api/fedwatch
 *
 * FOMC 회의별 금리 인하/동결/인상 확률 (CME FedWatch 스타일, 단순형) — 계산은 src/lib/fedwatch-calc.ts.
 * 2026-10-16: 현재 금리를 4월 값(3.50~3.75%)으로 박아 둔 STATIC_DATA 를 걷어냈다. 9/17 인상 뒤에도 그 위에서
 *   계산해 'Oct 29 인상 84%·현재 3.625%' 를 냈다(사이트 눈검증에서 발견). 이제:
 *   - 현재 목표범위·실효금리 = FRED DFEDTARL/DFEDTARU/DFF(그때그때)
 *   - 회의 뒤 금리 = 회의 다음 달 ZQ 선물(Yahoo) 내재금리
 *   - 지난 회의는 내보내지 않는다. 기준을 못 받으면 확률을 지어내지 않고 meetings 를 비운다(source 에 이유).
 * FOMC 일정(결정일)은 연준 공식 달력 — 구조 데이터라 코드에 둔다. 2027 일정은 확인 전이라 넣지 않았다.
 * Cache: 4h Redis
 */
import { NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import { computeMeetings, postMeetingContract, type FomcMeetingCalc } from '@/lib/fedwatch-calc';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function cacheKey(): string {
  const utcDate = new Date().toISOString().slice(0, 10);
  return `flowvium:fedwatch:v3:${utcDate}`;
}

export type FomcMeeting = FomcMeetingCalc;

export interface FedWatchData {
  currentTargetLow: number | null;
  currentTargetHigh: number | null;
  currentRateMid: number | null;
  effectiveRate: number | null;
  meetings: FomcMeeting[];
  yearEndImpliedRate: number | null;
  totalImpliedCuts: number | null;  // bps (인하만, 인상이면 0 — changeBps 를 같이 본다)
  totalChangeBps: number | null;
  updatedAt: string;
  source: string;
}

// 연준 공식 2026 FOMC 결정일(2일 회의의 둘째 날). 9/17 인상은 FRED DFEDTARU 변경일(2026-09-17)과 일치.
const FOMC_DATES = ['2026-01-28', '2026-03-18', '2026-04-29', '2026-06-18', '2026-07-30', '2026-09-17', '2026-10-29', '2026-12-10'];

async function fredLatest(id: string): Promise<{ date: string; value: number } | null> {
  try {
    const cosd = new Date(Date.now() - 45 * 86400_000).toISOString().slice(0, 10);
    const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${cosd}`, { signal: AbortSignal.timeout(10000), cache: 'no-store' });
    if (!res.ok) return null;
    const rows = (await res.text()).trim().split('\n').slice(1).map((l) => l.split(',')).filter(([, v]) => v && v !== '.');
    const last = rows.at(-1);
    return last ? { date: last[0], value: Number(last[1]) } : null;
  } catch { return null; }
}

async function zqPrice(contract: string): Promise<number | null> {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${contract}.CBT?interval=1d&range=5d`, {
      signal: AbortSignal.timeout(8000), cache: 'no-store', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Flowvium/1.0)', Accept: 'application/json' } });
    if (!res.ok) return null;
    const d = await res.json();
    const p = d?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof p === 'number' && p > 90 && p < 100 ? p : null;
  } catch { return null; }
}

async function build(): Promise<FedWatchData & { liveData: boolean }> {
  const today = new Date().toISOString().slice(0, 10);
  const [lo, hi, dff] = await Promise.all([fredLatest('DFEDTARL'), fredLatest('DFEDTARU'), fredLatest('DFF')]);
  const empty = (why: string) => ({ currentTargetLow: lo?.value ?? null, currentTargetHigh: hi?.value ?? null,
    currentRateMid: lo && hi ? (lo.value + hi.value) / 2 : null, effectiveRate: dff?.value ?? null, meetings: [],
    yearEndImpliedRate: null, totalImpliedCuts: null, totalChangeBps: null, updatedAt: new Date().toISOString(), source: why, liveData: false });
  if (!lo || !hi || !dff) return empty('FRED 기준금리 수신 실패 — 확률 계산 안 함');
  const contracts = Array.from(new Set(FOMC_DATES.filter((d) => d >= today).map(postMeetingContract)));
  const prices: Record<string, number> = {};
  await Promise.all(contracts.map(async (c) => { const p = await zqPrice(c); if (p != null) prices[c] = p; }));
  const meetings = computeMeetings({ dates: FOMC_DATES, prices, effr: dff.value, targetLow: lo.value, targetHigh: hi.value, today });
  if (!meetings.length) return empty('ZQ 선물 가격 수신 실패 — 확률 계산 안 함');
  const last = meetings[meetings.length - 1];
  return {
    currentTargetLow: lo.value, currentTargetHigh: hi.value, currentRateMid: (lo.value + hi.value) / 2, effectiveRate: dff.value,
    meetings, yearEndImpliedRate: last.impliedRate, totalImpliedCuts: last.cumulativeCuts, totalChangeBps: last.changeBps,
    updatedAt: new Date().toISOString(),
    source: `FRED 목표범위(${lo.date})·실효금리 DFF(${dff.date}) + Yahoo ZQ 선물 실시간 — 회의 다음 달 계약으로 계산`,
    liveData: true,
  };
}

const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=14400, stale-while-revalidate=600' };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let FEDWATCH_MEMORY_CACHE: { data: any; expiresAt: number } | null = null;
const FEDWATCH_MEMORY_TTL_MS = 4 * 60 * 60 * 1000;

// 차기 회의 = 아직 안 열린 회의(회의 당일 0시 UTC 부터 다음으로). meetings 는 이미 미래만이지만 캐시가 하루를 넘길 수 있다.
function withNextMeeting<T extends { meetings?: FomcMeeting[] }>(data: T): T & { nextMeeting: FomcMeeting | null } {
  const now = Date.now();
  const ms = (data.meetings ?? []).filter((m) => new Date(m.date).getTime() > now);
  return { ...data, meetings: ms, nextMeeting: ms[0] ?? null };
}

export async function GET() {
  const redis = createRedis();
  if (!redis && FEDWATCH_MEMORY_CACHE && Date.now() < FEDWATCH_MEMORY_CACHE.expiresAt) {
    return NextResponse.json({ ...withNextMeeting(FEDWATCH_MEMORY_CACHE.data), cached: true }, { headers: CDN_HEADERS });
  }
  if (redis) {
    try {
      const cached = await redis.get(cacheKey());
      if (cached) return NextResponse.json({ ...withNextMeeting(cached as { meetings?: FomcMeeting[] }), cached: true }, { headers: CDN_HEADERS });
    } catch { /* non-fatal */ }
  }
  const result = await build();
  if (result.liveData) {
    if (redis) {
      const key = cacheKey();
      try { await loggedRedisSet(redis, 'api.fedwatch', key, result, { ex: 4 * 60 * 60 }); }
      catch (err) { logger.error('fedwatch', 'save_failed', { key, error: err }); }
    } else FEDWATCH_MEMORY_CACHE = { data: result, expiresAt: Date.now() + FEDWATCH_MEMORY_TTL_MS };
  }
  return NextResponse.json({ ...withNextMeeting(result), cached: false }, { headers: CDN_HEADERS });
}
