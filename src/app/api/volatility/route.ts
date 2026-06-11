import { logger, loggedRedisSet } from '@/lib/logger';
import { YAHOO_HEADERS } from '@/lib/yahoo-finance';
/**
 * /api/volatility
 *
 * VIX term structure + historical data.
 * Sources (all Yahoo Finance chart API — free, confirmed reachable from Vercel):
 *   ^VXST = 9-day VIX
 *   ^VIX  = 30-day VIX (standard)
 *   ^VXMT = 6-month VIX
 *   ^VVIX = Vol of VIX (100+ = elevated uncertainty)
 *
 * Also returns 90-day VIX history for sparkline.
 * Cache: Redis 30min | memory 15min
 */
import { NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import type { Redis } from '@upstash/redis';
import { createMemoryCache } from '@/lib/memory-cache';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const CACHE_TTL = 30 * 60;
const STALE_KEY = 'flowvium:volatility:stale';
const MEM_CACHE = createMemoryCache<VolatilityData>('volatility', 15 * 60_000);
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=60' };

export interface VolPoint { date: string; value: number }

export interface VolatilityData {
  // Current values
  vxst: number | null;   // 9-day
  vix: number | null;    // 30-day
  vxmt: number | null;   // 6-month
  vvix: number | null;   // Vol of VIX
  // Regime
  regime: 'contango' | 'backwardation' | 'humped' | 'unknown';
  regimeLabel: string;
  // 90-day VIX history
  history: VolPoint[];
  dataDate: string | null;
  updatedAt: string;
  cached: boolean;
  source: 'yahoo' | 'cboe-fallback' | 'mixed' | 'stale' | 'empty';
}

const YF_HEADERS = YAHOO_HEADERS;

async function fetchCurrentPrice(symbol: string): Promise<number | null> {
  // 2026-06-12: query1 → query2 재시도. 보고서 배치(1,329종 시세)가 query1 을 rate-limit 시키면
  //   CBOE CSV 폴백이 발동하는데, CBOE 일별 CSV 는 전일치까지만 — 전일 VIX 가 'current' 로 silent
  //   제공돼 earlyWarning 이 stale 입력을 받던 사건 (6/12 morning VIX 22.2[6/10] vs 실측 19.4[6/11]).
  for (const host of ['query1', 'query2']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
      // chart v8 은 무인증 — 공유 YAHOO_HEADERS(쿠키/크럼)가 만료 시 오히려 거부됨 → 플레인 UA
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const json = await res.json();
      const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (typeof price === 'number') return price;
    } catch { /* 다음 host */ }
  }
  return null;
}

// CBOE CDN is not subject to Yahoo Finance IP rate-limits on Vercel cloud IPs.
// CSV format varies: VIX/VIX9D/VIX6M → DATE,OPEN,HIGH,LOW,CLOSE (closeCol=4)
//                   VVIX             → DATE,CLOSE (closeCol=1)
async function fetchCBOEIndex(csvName: string, closeCol = 4): Promise<number | null> {
  try {
    const res = await fetch(`https://cdn.cboe.com/api/global/us_indices/daily_prices/${csvName}_History.csv`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/csv,text/plain,*/*',
      },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const text = await res.text();
    const lines = text.trim().split('\n').filter(l => l.trim() && !l.startsWith('DATE') && !l.startsWith('date'));
    const last = lines[lines.length - 1];
    if (!last) return null;
    const parts = last.split(',');
    const close = parseFloat(parts[closeCol]);
    return isNaN(close) ? null : parseFloat(close.toFixed(2));
  } catch { return null; }
}

async function fetchVixFromCBOE(): Promise<{ current: number | null; history: VolPoint[] }> {
  try {
    const res = await fetch('https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/csv,text/plain,*/*',
        'Referer': 'https://www.cboe.com/tradable_products/vix/',
      },
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    });
    if (!res.ok) return { current: null, history: [] };
    const text = await res.text();
    const lines = text.trim().split('\n').slice(1); // skip DATE,OPEN,HIGH,LOW,CLOSE header
    const recent = lines.slice(-90);
    const history: VolPoint[] = [];
    for (const line of recent) {
      const parts = line.split(',');
      if (parts.length < 5) continue;
      const dateStr = parts[0].trim();
      const close = parseFloat(parts[4]);
      if (isNaN(close) || !dateStr) continue;
      const [mm, dd, yyyy] = dateStr.split('/');
      if (!mm || !dd || !yyyy) continue;
      history.push({
        date: `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`,
        value: parseFloat(close.toFixed(2)),
      });
    }
    const current = history.length > 0 ? history[history.length - 1].value : null;
    return { current, history };
  } catch { return { current: null, history: [] }; }
}

async function fetchHistory(symbol: string, range = '3mo'): Promise<VolPoint[]> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    const ts: number[] = result?.timestamp ?? [];
    const closes: (number | null)[] = result?.indicators?.quote?.[0]?.close ?? [];
    const out: VolPoint[] = [];
    for (let i = 0; i < ts.length; i++) {
      const c = closes[i];
      if (typeof c !== 'number' || isNaN(c)) continue;
      out.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), value: parseFloat(c.toFixed(2)) });
    }
    return out;
  } catch { return []; }
}

function detectRegime(vxst: number | null, vix: number | null, vxmt: number | null): { regime: VolatilityData['regime']; estimated: boolean } {
  if (vxst == null || vxmt == null) {
    // VXST/VXMT unavailable — heuristic from VIX level only.
    // Historical VIX term structure: below 25 is almost always contango; above 35 almost always backwardation.
    if (vix == null) return { regime: 'unknown', estimated: false };
    if (vix < 25) return { regime: 'contango', estimated: true };
    if (vix >= 35) return { regime: 'backwardation', estimated: true };
    return { regime: 'unknown', estimated: true }; // 25–35: genuinely ambiguous without term structure
  }
  if (vix == null) return { regime: 'unknown', estimated: false };
  if (vxst < vix && vix < vxmt) return { regime: 'contango', estimated: false };
  if (vxst > vix && vix > vxmt) return { regime: 'backwardation', estimated: false };
  return { regime: 'humped', estimated: false };
}

const REGIME_LABEL: Record<VolatilityData['regime'], string> = {
  contango: 'Contango (normal — long-term uncertainty > short-term)',
  backwardation: 'Backwardation (stress — immediate shock)',
  humped: 'Humped (mixed — mid-term risk concentration)',
  unknown: 'No data',
};
const REGIME_LABEL_EST: Record<VolatilityData['regime'], string> = {
  contango: 'Contango est. (VIX heuristic — VXST/VXMT unavailable)',
  backwardation: 'Backwardation est. (VIX heuristic — VXST/VXMT unavailable)',
  humped: 'Humped (mixed)',
  unknown: 'No data (VIX 25–35, structure ambiguous)',
};

export async function GET() {
  const cacheKey = 'flowvium:volatility:v1';
  const redis = createRedis();

  const mem = MEM_CACHE.get('global');
  if (mem) return NextResponse.json({ ...mem, cached: true, cacheLayer: 'memory' }, { headers: CDN_HEADERS });

  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return NextResponse.json({ ...(cached as object), cached: true }, { headers: CDN_HEADERS });
    } catch { /* non-fatal */ }
  }

  const start = Date.now();
  const [vxst, vix, vxmt, vvix, history] = await Promise.all([
    fetchCurrentPrice('^VIX9D'),   // 2026-06-12: ^VXST 는 2021 폐지 심볼 — Yahoo 가 죽은 quote(10.84) 반환.
    fetchCurrentPrice('^VIX'),     //   그간 Yahoo 실패→CBOE 폴백이 우연히 정상값을 줘서 가려졌던 잠복 버그.
    fetchCurrentPrice('^VIX6M'),   // ^VXMT 도 동일 (현행 ^VIX6M)
    fetchCurrentPrice('^VVIX'),
    fetchHistory('^VIX', '3mo'),
  ]);
  logger.info('volatility', 'fetched', { durationMs: Date.now() - start });

  // CBOE CDN fallback — activates when Vercel IP is Yahoo rate-limited
  let vixFinal = vix;
  let histFinal = history;
  let cboeUsed = false;
  if (vixFinal == null || histFinal.length < 10) {
    const cboe = await fetchVixFromCBOE();
    // 2026-06-12 fix: history 만 실패해도 신선한 Yahoo VIX 를 CBOE 전일값으로 무조건 덮어쓰던 버그
    //   (CBOE 일별 CSV 는 전일치까지 — earlyWarning 이 하루 stale VIX 22.2 를 받은 사건의 직접 원인)
    if (cboe.current != null && vixFinal == null) { vixFinal = cboe.current; cboeUsed = true; }
    if (cboe.history.length >= 10 && histFinal.length < 10) { histFinal = cboe.history; cboeUsed = true; }
    if (cboeUsed) logger.info('volatility', 'cboe_fallback', { vix: cboe.current, histLen: cboe.history.length });
  }

  // CBOE fallback for VXST (VIX9D), VXMT (VIX6M), VVIX — Yahoo Finance blocked on Vercel
  let vxstFinal = vxst;
  let vxmtFinal = vxmt;
  let vvixFinal = vvix;
  if (vxstFinal == null) {
    vxstFinal = await fetchCBOEIndex('VIX9D');
    if (vxstFinal != null) { logger.info('volatility', 'cboe_fallback', { metric: 'vxst', value: vxstFinal }); cboeUsed = true; }
  }
  if (vxmtFinal == null) {
    vxmtFinal = await fetchCBOEIndex('VIX6M');
    if (vxmtFinal != null) { logger.info('volatility', 'cboe_fallback', { metric: 'vxmt', value: vxmtFinal }); cboeUsed = true; }
  }
  if (vvixFinal == null) {
    vvixFinal = await fetchCBOEIndex('VVIX', 1); // VVIX CSV is DATE,CLOSE (2 cols)
    if (vvixFinal != null) { logger.info('volatility', 'cboe_fallback', { metric: 'vvix', value: vvixFinal }); cboeUsed = true; }
  }

  const { regime, estimated: regimeEstimated } = detectRegime(vxstFinal, vixFinal, vxmtFinal);
  const latestDate = histFinal.length ? histFinal[histFinal.length - 1].date : null;

  const yahooUsed = vix != null || history.length >= 10 || vxst != null || vxmt != null || vvix != null;
  const sourceLabel: VolatilityData['source'] =
    vixFinal == null ? 'empty'
    : cboeUsed && yahooUsed ? 'mixed'
    : cboeUsed ? 'cboe-fallback'
    : 'yahoo';

  const data: VolatilityData = {
    vxst: vxstFinal, vix: vixFinal, vxmt: vxmtFinal, vvix: vvixFinal,
    regime,
    regimeLabel: regimeEstimated ? REGIME_LABEL_EST[regime] : REGIME_LABEL[regime],
    history: histFinal.slice(-90),
    dataDate: latestDate,
    updatedAt: new Date().toISOString(),
    cached: false,
    source: sourceLabel,
  };

  const hasData = data.vix != null;
  if (redis) {
    try {
      await loggedRedisSet(redis, 'api.volatility', cacheKey, data, { ex: CACHE_TTL });
      if (hasData) await loggedRedisSet(redis, 'api.volatility', STALE_KEY, data, {});
    } catch { /* non-fatal */ }
  } else {
    MEM_CACHE.set('global', data);
  }

  // Serve stale if all fetches returned null (Yahoo blocked)
  if (!hasData && redis) {
    try {
      const stale = await redis.get(STALE_KEY);
      if (stale) {
        logger.info('api.volatility', 'stale_fallback', { note: 'Yahoo returned null, serving stale' });
        MEM_CACHE.set('global', stale as VolatilityData);
        return NextResponse.json({ ...(stale as object), cached: true, stale: true, source: 'stale' }, { headers: CDN_HEADERS });
      }
    } catch { /* non-fatal */ }
  }

  return NextResponse.json(data, { headers: CDN_HEADERS });
}
