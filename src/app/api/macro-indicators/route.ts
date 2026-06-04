import { logger, loggedRedisSet } from '@/lib/logger';
import { logMetrics } from '@/lib/metrics-db';
/**
 * /api/macro-indicators
 *
 * Key macro indicators + cascade impact analysis
 *
 * Data sources:
 *   - FRED (free CSV endpoint) for CPI, PCE, PPI, NFP, GDP, Retail Sales, Unemployment, Yield Curve,
 *     IG/HY Credit OAS (BAMLC0A0CM / BAMLH0A0HYM2)
 *   - Static fallback for ISM, FOMC (no free FRED source)
 *
 * Cache: daily key (refreshes at midnight KST via cron)
 */
import { NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import type { Redis } from '@upstash/redis';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600' };

// Module-level memory cache — without Redis, each request fires 17 parallel FRED calls.
// Memory TTL: 4h (FRED data updates at most once daily; conserves FRED rate limits).
// Redis TTL: 25h (covers one full day; the next cron run always refreshes before expiry).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let MACRO_MEMORY_CACHE: { data: any; expiresAt: number } | null = null;
const MACRO_MEMORY_TTL_MS = 4 * 60 * 60 * 1000;

function kstDate(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}
function cacheKey(): string {
  return `flowvium:macro-indicators:v13:${kstDate()}`;
}

// Next business day after a given ISO date string (or today if none given)
function nextBizDay(afterIso?: string): string {
  const d = afterIso ? new Date(afterIso) : new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface CascadeStep {
  asset: string;
  direction: 'up' | 'down' | 'mixed';
  reason: string;
  magnitude: 'strong' | 'moderate' | 'weak';
}

export interface MacroIndicator {
  id: string;
  name: string;
  nameKo: string;
  category: 'inflation' | 'employment' | 'growth' | 'monetary' | 'trade' | 'credit';
  actual: number | null;
  forecast: number | null;
  previous: number | null;
  unit: string;
  releaseDate: string;
  nextRelease?: string;
  surprise: 'beat' | 'miss' | 'inline' | 'pending';
  rateImpact: 'hawkish' | 'dovish' | 'neutral';
  rateImpactKo: string;
  cascade: CascadeStep[];
  summary: string;
  liveData?: boolean;
  dataNote?: string;
}

// ── FRED helpers ──────────────────────────────────────────────────────────────
async function fetchFREDCsv(series: string, monthsBack: number = 15): Promise<Array<{ date: string; value: number }>> {
  const startDate = new Date(Date.now() - monthsBack * 30.5 * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  // 2026-06-04: fredgraph.csv 가 한국 자가호스트에서 25s+ 타임아웃 → FRED JSON API(api.stlouisfed.org,
  //   빠름) 우선. 유효 32자 키 필요(이전 \n 오염으로 무효였음). 키 없거나 실패 시 CSV 폴백.
  const apiKey = process.env.FRED_API_KEY?.trim();
  if (apiKey && /^[a-z0-9]{32}$/.test(apiKey)) {
    try {
      const apiUrl = `https://api.stlouisfed.org/fred/series/observations?series_id=${series}&api_key=${apiKey}&file_type=json&observation_start=${startDate}&sort_order=asc`;
      const res = await fetch(apiUrl, { signal: AbortSignal.timeout(8000), cache: 'no-store' });
      if (res.ok) {
        const j = await res.json() as { observations?: Array<{ date: string; value: string }> };
        const obs = (j.observations ?? [])
          .map(o => ({ date: o.date, value: parseFloat(o.value) }))
          .filter((x): x is { date: string; value: number } => !!x.date && !isNaN(x.value));
        if (obs.length) return obs;
      }
    } catch { /* fall through to CSV */ }
  }
  try {
    const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series}&observation_start=${startDate}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    });
    if (!res.ok) {
      logger.warn('macro-indicators', 'fred_csv_http_error', { series, status: res.status });
      return [];
    }
    const text = await res.text();
    return text.trim().split('\n').slice(1)
      .map(line => {
        const [date, val] = line.split(',');
        const value = parseFloat(val);
        return (!date || isNaN(value)) ? null : { date: date.trim(), value };
      })
      .filter((x): x is { date: string; value: number } => x !== null);
  } catch (err) {
    logger.error('macro-indicators', 'fred_csv_error', { series, error: err });
    return [];
  }
}

// Latest value — returns last row plus optional previous row value
async function fetchLatest(series: string, monthsBack: number = 3): Promise<{ value: number; date: string; previous?: number } | null> {
  const rows = await fetchFREDCsv(series, monthsBack);
  if (!rows.length) return null;
  const last = rows[rows.length - 1];
  const prev = rows.length >= 2 ? rows[rows.length - 2] : null;
  return { ...last, previous: prev?.value };
}

// YoY % change (index-based series like CPI, PCE, PPI)
async function fetchYoY(series: string): Promise<{ value: number; previous: number; date: string } | null> {
  const rows = await fetchFREDCsv(series, 15);
  if (rows.length < 13) return null;
  const last = rows[rows.length - 1];
  const prev1 = rows[rows.length - 2];
  // Find ~12 months ago
  const targetYear = parseInt(last.date.slice(0, 4)) - 1;
  const targetMonth = last.date.slice(5, 7);
  const yearAgoIdx = rows.findIndex(r => r.date.startsWith(`${targetYear}-${targetMonth}`));
  const yearAgo = yearAgoIdx >= 0 ? rows[yearAgoIdx] : rows[rows.length - 13];
  if (!yearAgo || yearAgo.value === 0) return null;
  const yoy = parseFloat(((last.value - yearAgo.value) / yearAgo.value * 100).toFixed(2));
  // Previous month's YoY
  const prevYearAgo = yearAgoIdx > 0 ? rows[yearAgoIdx - 1] : rows[rows.length - 14];
  const prevYoY = prevYearAgo && prevYearAgo.value !== 0
    ? parseFloat(((prev1.value - prevYearAgo.value) / prevYearAgo.value * 100).toFixed(2))
    : yoy;
  return { value: yoy, previous: prevYoY, date: last.date };
}

// MoM absolute change (for NFP: thousands of jobs)
async function fetchMoMChange(series: string): Promise<{ value: number; previous: number; date: string } | null> {
  const rows = await fetchFREDCsv(series, 4);
  if (rows.length < 3) return null;
  const last = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  const prevprev = rows[rows.length - 3];
  return {
    value: parseFloat((last.value - prev.value).toFixed(1)),
    previous: parseFloat((prev.value - prevprev.value).toFixed(1)),
    date: last.date,
  };
}

// MoM % change (for Retail Sales)
async function fetchMoMPct(series: string): Promise<{ value: number; previous: number; date: string } | null> {
  const rows = await fetchFREDCsv(series, 4);
  if (rows.length < 3) return null;
  const last = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  const prevprev = rows[rows.length - 3];
  if (prev.value === 0 || prevprev.value === 0) return null;
  return {
    value: parseFloat(((last.value - prev.value) / prev.value * 100).toFixed(1)),
    previous: parseFloat(((prev.value - prevprev.value) / prevprev.value * 100).toFixed(1)),
    date: last.date,
  };
}

// ── Yield Curve — US Treasury Direct API ──────────────────────────────────────
// 훨씬 빠르고 정확한 소스 (FRED CSV는 전체 히스토리 반환으로 느림)
export interface YieldPoint { label: string; value: number | null; }

// Treasury CSV 컬럼 인덱스 → 우리 레이블 매핑
const TREASURY_COL_MAP: Record<string, string> = {
  '1 Mo': '1M', '3 Mo': '3M', '6 Mo': '6M', '1 Yr': '1Y',
  '2 Yr': '2Y', '5 Yr': '5Y', '10 Yr': '10Y', '20 Yr': '20Y', '30 Yr': '30Y',
};
const DISPLAY_ORDER = ['1M', '3M', '6M', '1Y', '2Y', '5Y', '10Y', '20Y', '30Y'];

// FRED series IDs for each maturity
const FRED_YIELD_SERIES: Record<string, string> = {
  '1M':  'DGS1MO',
  '3M':  'DGS3MO',
  '6M':  'DGS6MO',
  '1Y':  'DGS1',
  '2Y':  'DGS2',
  '5Y':  'DGS5',
  '10Y': 'DGS10',
  '20Y': 'DGS20',
  '30Y': 'DGS30',
};

async function fetchFredLatest(seriesId: string, apiKey: string): Promise<number | null> {
  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=10`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Flowvium' },
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = await res.json();
    const obs = (json.observations ?? []) as Array<{ value: string }>;
    // Take the most recent non-null ('.' means no data)
    for (const o of obs) {
      if (o.value && o.value !== '.') {
        const v = parseFloat(o.value);
        if (!isNaN(v)) return v;
      }
    }
    return null;
  } catch (err) {
    logger.warn('macro-indicators', 'fred_api_error', { seriesId, error: err });
    return null;
  }
}

async function fetchYieldCurve(baseUrl?: string): Promise<{ points: YieldPoint[]; inverted: boolean; spread10y2y: number | null }> {
  const empty = { points: DISPLAY_ORDER.map(l => ({ label: l, value: null })), inverted: false, spread10y2y: null };

  // Primary: reuse /api/yield-curve (1h Redis cache) — eliminates 9 parallel FRED requests
  // that intermittently return null due to rate limiting.
  if (baseUrl) {
    try {
      const res = await fetch(`${baseUrl}/api/yield-curve`, {
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json() as { today?: Array<{ label: string; value: number | null }>; spread2s10sCurrent?: number | null; inverted?: boolean };
        const today = data.today ?? [];
        if (today.length > 0) {
          const labelMap = Object.fromEntries(today.map(p => [p.label, p.value]));
          const points = DISPLAY_ORDER.map(l => ({ label: l, value: (labelMap[l] ?? null) as number | null }));
          const spread10y2y = data.spread2s10sCurrent ?? null;
          logger.info('macro-indicators', 'yield_curve_via_api', { points: points.filter(p => p.value != null).length });
          return { points, inverted: data.inverted ?? (spread10y2y !== null && spread10y2y < 0), spread10y2y };
        }
      }
    } catch (e) {
      logger.warn('macro-indicators', 'yield_curve_api_fallback', { error: e });
    }
  }

  // Fallback: direct FRED fetch (9 parallel requests — may intermittently rate-limit)
  try {
    const labels = DISPLAY_ORDER;
    const apiKey = process.env.FRED_API_KEY?.trim();

    let labelMap: Record<string, number | null>;

    if (apiKey) {
      const results = await Promise.all(labels.map(l => fetchFredLatest(FRED_YIELD_SERIES[l], apiKey)));
      labelMap = Object.fromEntries(labels.map((l, i) => [l, results[i]]));
    } else {
      const results = await Promise.all(labels.map(l => fetchLatest(FRED_YIELD_SERIES[l])));
      labelMap = Object.fromEntries(labels.map((l, i) => [l, results[i]?.value ?? null]));
      logger.info('macro-indicators', 'yield_curve_csv_fallback', { message: 'FRED_API_KEY not set, using free CSV endpoint' });
    }

    const points: YieldPoint[] = DISPLAY_ORDER.map(l => ({ label: l, value: labelMap[l] ?? null }));
    const y2 = labelMap['2Y'] ?? null;
    const y10 = labelMap['10Y'] ?? null;
    let spread10y2y = y2 !== null && y10 !== null ? parseFloat((y10 - y2).toFixed(2)) : null;

    if (spread10y2y === null) {
      const t10y2y = await fetchLatest('T10Y2Y');
      if (t10y2y !== null) {
        spread10y2y = parseFloat(t10y2y.value.toFixed(2));
        logger.info('macro-indicators', 'yield_curve_t10y2y_fallback', { spread: spread10y2y });
      }
    }

    return { points, inverted: spread10y2y !== null && spread10y2y < 0, spread10y2y };
  } catch (err) {
    logger.error('macro-indicators', 'yield_curve_error', { error: err });
    return empty;
  }
}

// ── Surprise classification ───────────────────────────────────────────────────
function classify(actual: number | null, forecast: number, higherIsBetter: boolean): 'beat' | 'miss' | 'inline' | 'pending' {
  if (actual === null) return 'pending';
  const diff = Math.abs(actual - forecast);
  const threshold = Math.abs(forecast) * 0.02; // 2% tolerance
  if (diff <= threshold || diff < 0.05) return 'inline';
  return (actual > forecast) === higherIsBetter ? 'beat' : 'miss';
}

function rateImpact(id: string, surprise: string): { impact: 'hawkish' | 'dovish' | 'neutral'; ko: string } {
  if (surprise === 'inline' || surprise === 'pending') return { impact: 'neutral', ko: 'neutral' };
  // 'beat' = actual performed better than forecast (lower-is-better indicators: lower actual = beat)
  // Inflation misses (CPI/PPI/PCE higher than expected) = hawkish; activity beats = hawkish
  const hawkishOnBeat = ['nfp', 'retail', 'iclaims', 'umcsent', 'gdp', 'ism', 'unrate'];
  const hawkishOnMiss = ['cpi', 'pce', 'ppi'];
  if (hawkishOnBeat.includes(id)) {
    return surprise === 'beat'
      ? { impact: 'hawkish', ko: 'hawkish (tightening pressure)' }
      : { impact: 'dovish', ko: 'dovish (rate cut expectations↑)' };
  }
  if (hawkishOnMiss.includes(id)) {
    return surprise === 'miss'
      ? { impact: 'hawkish', ko: 'hawkish (inflation above target → prolonged tightening)' }
      : { impact: 'dovish', ko: 'dovish (inflation cooling → rate cut expectations↑)' };
  }
  return { impact: 'neutral', ko: 'neutral' };
}

// ── Cascade logic ─────────────────────────────────────────────────────────────
function buildCascade(id: string, surprise: 'beat' | 'miss' | 'inline' | 'pending'): CascadeStep[] {
  if (surprise === 'pending' || surprise === 'inline') return [];
  const cascades: Record<string, { beat: CascadeStep[]; miss: CascadeStep[] }> = {
    // beat = actual < forecast (lower inflation = dovish); miss = actual > forecast (higher inflation = hawkish)
    cpi: {
      beat: [
        { asset: 'US Treasury Yields', direction: 'down', reason: 'CPI below est. → rate cut expectations↑ → bond rally', magnitude: 'strong' },
        { asset: 'USD (DXY)', direction: 'down', reason: 'dovish Fed pivot expectations → USD weakness', magnitude: 'moderate' },
        { asset: 'US Equities (S&P500)', direction: 'up', reason: 'lower discount rate → valuation improvement', magnitude: 'strong' },
        { asset: 'Gold (GLD)', direction: 'up', reason: 'real rates↓ → gold attractiveness↑', magnitude: 'strong' },
        { asset: 'EM Stocks/FX', direction: 'up', reason: 'USD weakness → EM capital inflows', magnitude: 'moderate' },
      ],
      miss: [
        { asset: 'US Treasury Yields', direction: 'up', reason: 'CPI above est. → prolonged tightening → bond sell-off', magnitude: 'strong' },
        { asset: 'USD (DXY)', direction: 'up', reason: 'higher-for-longer rates → USD strength', magnitude: 'strong' },
        { asset: 'US Equities (S&P500)', direction: 'down', reason: 'higher discount rate → valuation pressure', magnitude: 'moderate' },
        { asset: 'Gold (GLD)', direction: 'down', reason: 'real rates↑ → gold opportunity cost rises', magnitude: 'moderate' },
        { asset: 'EM Stocks/FX', direction: 'down', reason: 'USD strength → capital outflows from EM', magnitude: 'strong' },
      ],
    },
    // beat = actual < forecast (lower PCE = dovish); miss = actual > forecast (higher PCE = hawkish)
    pce: {
      beat: [
        { asset: 'US Treasury Yields', direction: 'down', reason: 'Fed preferred gauge below est. → cut timeline pulled forward', magnitude: 'strong' },
        { asset: 'US Equities (S&P500)', direction: 'up', reason: 'rate cut expectations → multiple expansion', magnitude: 'strong' },
        { asset: 'Gold (GLD)', direction: 'up', reason: 'real rates falling → gold attractiveness↑', magnitude: 'moderate' },
        { asset: 'EM Stocks', direction: 'up', reason: 'USD weakness outlook → EM inflows', magnitude: 'moderate' },
      ],
      miss: [
        { asset: 'US Treasury Yields', direction: 'up', reason: 'PCE above est. → Fed tightening reinforced', magnitude: 'strong' },
        { asset: 'US Equities (S&P500)', direction: 'down', reason: 'rate cut timeline pushed back → de-rating', magnitude: 'strong' },
        { asset: 'USD (DXY)', direction: 'up', reason: 'hawkish Fed stance reinforced → USD bid', magnitude: 'moderate' },
      ],
    },
    nfp: {
      beat: [
        { asset: 'US Treasury Yields', direction: 'up', reason: 'strong jobs → Fed tightening room', magnitude: 'strong' },
        { asset: 'USD (DXY)', direction: 'up', reason: 'economic strength → USD demand', magnitude: 'moderate' },
        { asset: 'US Equities (S&P500)', direction: 'mixed', reason: 'strong growth vs rising rates conflict', magnitude: 'weak' },
      ],
      miss: [
        { asset: 'US Treasury Yields', direction: 'down', reason: 'recession fear → safe-haven buying', magnitude: 'strong' },
        { asset: 'US Equities (S&P500)', direction: 'down', reason: 'recession risk', magnitude: 'moderate' },
        { asset: 'Gold (GLD)', direction: 'up', reason: 'uncertainty → safe-haven demand', magnitude: 'moderate' },
      ],
    },
    gdp: {
      beat: [
        { asset: 'US Treasury Yields', direction: 'up', reason: 'strong growth → tightening room', magnitude: 'moderate' },
        { asset: 'US Equities (S&P500)', direction: 'up', reason: 'corporate earnings expectations strengthened', magnitude: 'moderate' },
        { asset: 'USD (DXY)', direction: 'up', reason: 'economic strength → capital inflows', magnitude: 'moderate' },
      ],
      miss: [
        { asset: 'US Treasury Yields', direction: 'down', reason: 'recession fear → rate cut expectations', magnitude: 'moderate' },
        { asset: 'US Equities (S&P500)', direction: 'down', reason: 'corporate earnings downgrade risk', magnitude: 'moderate' },
        { asset: 'Gold (GLD)', direction: 'up', reason: 'economic uncertainty → safe-haven demand', magnitude: 'moderate' },
      ],
    },
    // beat = actual < forecast (lower PPI = dovish leading signal); miss = actual > forecast (higher PPI = hawkish)
    ppi: {
      beat: [
        { asset: 'US Treasury Yields', direction: 'down', reason: 'PPI below est. → CPI disinflation expected → cut expectations↑', magnitude: 'moderate' },
        { asset: 'US Equities (S&P500)', direction: 'up', reason: 'cost relief → margin improvement + easing outlook', magnitude: 'moderate' },
        { asset: 'Gold (GLD)', direction: 'up', reason: 'real rate cut expectations → gold attractiveness↑', magnitude: 'weak' },
      ],
      miss: [
        { asset: 'US Treasury Yields', direction: 'up', reason: 'PPI above est. → leads CPI upside → tightening signal', magnitude: 'moderate' },
        { asset: 'US Equities (S&P500)', direction: 'down', reason: 'input cost pressure + prolonged tightening concerns', magnitude: 'moderate' },
        { asset: 'USD (DXY)', direction: 'up', reason: 'inflation pipeline building → rates-held USD bid', magnitude: 'weak' },
      ],
    },
    retail: {
      beat: [
        { asset: 'US Equities (S&P500)', direction: 'up', reason: 'strong consumer → retail/consumer discretionary benefit', magnitude: 'moderate' },
        { asset: 'US Treasury Yields', direction: 'up', reason: 'consumer strength → inflation concerns', magnitude: 'weak' },
      ],
      miss: [
        { asset: 'US Equities (S&P500)', direction: 'down', reason: 'consumer slowdown → growth concern', magnitude: 'moderate' },
        { asset: 'US Treasury Yields', direction: 'down', reason: 'economic slowdown → rate cut expectations', magnitude: 'moderate' },
        { asset: 'Gold (GLD)', direction: 'up', reason: 'safe-haven demand', magnitude: 'weak' },
      ],
    },
    ism: {
      beat: [
        { asset: 'US Equities (S&P500)', direction: 'up', reason: 'manufacturing expansion → economic strength', magnitude: 'moderate' },
        { asset: 'Commodities', direction: 'up', reason: 'industrial demand expanding', magnitude: 'moderate' },
      ],
      miss: [
        { asset: 'US Equities (S&P500)', direction: 'down', reason: 'manufacturing contraction signal', magnitude: 'moderate' },
        { asset: 'Gold (GLD)', direction: 'up', reason: 'economic concern → safe-haven demand', magnitude: 'weak' },
        { asset: 'US Treasury Yields', direction: 'down', reason: 'weakening economy → easing expectations', magnitude: 'moderate' },
      ],
    },
    fomc: {
      beat: [
        { asset: 'US Treasury Yields', direction: 'up', reason: 'more hawkish than expected → immediate rate repricing', magnitude: 'strong' },
        { asset: 'USD (DXY)', direction: 'up', reason: 'interest rate differential widening', magnitude: 'strong' },
        { asset: 'US Equities (S&P500)', direction: 'down', reason: 'liquidity reduction concerns', magnitude: 'strong' },
        { asset: 'Gold (GLD)', direction: 'down', reason: 'real rates surging', magnitude: 'moderate' },
      ],
      miss: [
        { asset: 'US Treasury Yields', direction: 'down', reason: 'dovish language → bond rally', magnitude: 'strong' },
        { asset: 'US Equities (S&P500)', direction: 'up', reason: 'liquidity expectations + multiple expansion', magnitude: 'strong' },
        { asset: 'Gold (GLD)', direction: 'up', reason: 'real rates falling', magnitude: 'strong' },
        { asset: 'EM Stocks', direction: 'up', reason: 'USD weakness + capital inflows', magnitude: 'moderate' },
      ],
    },
    unrate: {
      beat: [ // lower unemployment = beat for employment, hawkish
        { asset: 'US Treasury Yields', direction: 'up', reason: 'strong jobs → wage inflation concern', magnitude: 'moderate' },
        { asset: 'USD (DXY)', direction: 'up', reason: 'economic vitality → USD demand', magnitude: 'weak' },
      ],
      miss: [
        { asset: 'US Treasury Yields', direction: 'down', reason: 'weakening jobs → rate cut expectations', magnitude: 'moderate' },
        { asset: 'Gold (GLD)', direction: 'up', reason: 'economic concern → safe-haven demand', magnitude: 'weak' },
      ],
    },
    umcsent: {
      beat: [ // higher sentiment than expected = consumer spending resilient
        { asset: 'US Equities (S&P500)', direction: 'up', reason: 'strong consumer sentiment → retail/services benefit', magnitude: 'moderate' },
        { asset: 'US Treasury Yields', direction: 'up', reason: 'consumer strength → inflation concern sustained', magnitude: 'weak' },
        { asset: 'USD (DXY)', direction: 'up', reason: 'economic strength → USD demand', magnitude: 'weak' },
      ],
      miss: [ // lower sentiment = consumers pulling back = dovish
        { asset: 'US Equities (S&P500)', direction: 'down', reason: 'consumer spending decline forecast → retail/services hurt', magnitude: 'moderate' },
        { asset: 'US Treasury Yields', direction: 'down', reason: 'economic slowdown fear → rate cut expectations', magnitude: 'moderate' },
        { asset: 'Gold (GLD)', direction: 'up', reason: 'economic uncertainty → safe-haven demand', magnitude: 'moderate' },
        { asset: 'Consumer Discretionary', direction: 'down', reason: 'wallet-closing signal', magnitude: 'strong' },
      ],
    },
    iclaims: {
      beat: [ // lower claims than expected = labor market resilient = hawkish
        { asset: 'US Treasury Yields', direction: 'up', reason: 'fewer layoffs → labor resilience → Fed tightening room', magnitude: 'moderate' },
        { asset: 'USD (DXY)', direction: 'up', reason: 'economic strength signal', magnitude: 'weak' },
        { asset: 'US Equities (S&P500)', direction: 'mixed', reason: 'strong economy vs rising rates offset', magnitude: 'weak' },
      ],
      miss: [ // higher claims than expected = layoffs rising = dovish
        { asset: 'US Treasury Yields', direction: 'down', reason: 'layoffs rising → economic slowdown → cut expectations↑', magnitude: 'moderate' },
        { asset: 'US Equities (S&P500)', direction: 'down', reason: 'deteriorating jobs → consumer spending concern', magnitude: 'moderate' },
        { asset: 'Gold (GLD)', direction: 'up', reason: 'economic uncertainty → safe-haven demand', magnitude: 'weak' },
      ],
    },
    ig_spread: {
      beat: [ // spread narrows (tighter) = credit calmer = risk-on
        { asset: 'US Equities (S&P500)', direction: 'up', reason: 'credit risk easing → corporate financing cost ↓', magnitude: 'moderate' },
        { asset: 'IG Corporate Bonds', direction: 'up', reason: 'spread tightening → IG bond price rise', magnitude: 'moderate' },
        { asset: 'USD (DXY)', direction: 'down', reason: 'risk-on return → safe-haven USD selling', magnitude: 'weak' },
      ],
      miss: [ // spread widens = credit stress = risk-off
        { asset: 'US Equities (S&P500)', direction: 'down', reason: 'credit stress leading indicator → corporate refinancing risk', magnitude: 'strong' },
        { asset: 'US Treasuries (TLT)', direction: 'up', reason: 'safe-haven demand → yields fall', magnitude: 'moderate' },
        { asset: 'Gold (GLD)', direction: 'up', reason: 'credit stress → safe-haven hedge', magnitude: 'moderate' },
      ],
    },
    hy_spread: {
      beat: [ // HY spread narrows = junk rally = max risk-on
        { asset: 'US Equities (S&P500)', direction: 'up', reason: 'HY rally = extreme risk-on signal', magnitude: 'strong' },
        { asset: 'HY Corporate Bonds (HYG)', direction: 'up', reason: 'spread tightening → high yield bond price rise', magnitude: 'strong' },
        { asset: 'Commodities', direction: 'up', reason: 'economic optimism spreading', magnitude: 'weak' },
      ],
      miss: [ // HY spread widens = credit crisis signal = extreme risk-off
        { asset: 'US Equities (S&P500)', direction: 'down', reason: 'HY spread approaching 500bp = recession warning', magnitude: 'strong' },
        { asset: 'US Treasuries (TLT)', direction: 'up', reason: 'extreme safe-haven flight', magnitude: 'strong' },
        { asset: 'Gold (GLD)', direction: 'up', reason: 'credit panic → gold demand surging', magnitude: 'strong' },
        { asset: 'USD (DXY)', direction: 'up', reason: 'risk-off USD strength', magnitude: 'moderate' },
      ],
    },
  };
  const def = cascades[id];
  if (!def) return [];
  return surprise === 'beat' ? def.beat : def.miss;
}

// Annual update: refresh this list when the Federal Reserve publishes the next year's FOMC calendar.
const FOMC_DATES_UPCOMING = [
  '2026-01-29', '2026-03-19', '2026-04-29',
  '2026-06-17', '2026-07-29', '2026-09-16',
  '2026-10-28', '2026-12-09',
  '2027-01-29', '2027-03-18', '2027-04-30',
  '2027-06-17', '2027-07-29', '2027-09-16',
  '2027-10-28', '2027-12-09',
];
function nextFomcDate(): string {
  const today = new Date().toISOString().slice(0, 10);
  return FOMC_DATES_UPCOMING.find(d => d > today) ?? FOMC_DATES_UPCOMING[FOMC_DATES_UPCOMING.length - 1];
}

// ── BEA/BLS release schedule — auto-advance nextRelease after each date passes ─
// Prevents stale "next release" dates without manual updates after each report.
// STATIC_DATA_AS_OF: 이 날짜 이후 FRED 데이터가 없으면 static fallback 사용됨 (수동 업데이트 필요)
// FRED live 데이터가 있으면 이 값은 무시됨.
const STATIC_DATA_AS_OF = '2026-04-26';

// Annual update: add the next year's BLS/BEA/Census release dates before year-end.
const RELEASE_SCHEDULE: Record<string, string[]> = {
  // CPI: BLS releases ~2nd week of following month
  cpi: [
    '2026-05-13', // April CPI
    '2026-06-11', // May CPI
    '2026-07-15', // June CPI
    '2026-08-12', // July CPI
    '2026-09-11', // August CPI
    '2026-10-14', // September CPI
    '2026-11-12', // October CPI
    '2026-12-10', // November CPI
    '2027-01-13', '2027-02-10', '2027-03-10', '2027-04-14',
    '2027-05-12', '2027-06-10', '2027-07-14', '2027-08-11',
    '2027-09-10', '2027-10-13', '2027-11-10', '2027-12-10',
  ],
  // PPI: BLS releases ~1 day after CPI
  ppi: [
    '2026-05-14', // April PPI
    '2026-06-12', // May PPI
    '2026-07-16', // June PPI
    '2026-08-13', // July PPI
    '2026-09-12', // August PPI
    '2026-10-15', // September PPI
    '2026-11-13', // October PPI
    '2026-12-11', // November PPI
    '2027-01-14', '2027-02-11', '2027-03-11', '2027-04-15',
    '2027-05-13', '2027-06-11', '2027-07-15', '2027-08-12',
    '2027-09-13', '2027-10-14', '2027-11-12', '2027-12-13',
  ],
  // Retail Sales: Census Bureau ~mid-month
  retail: [
    '2026-05-15', // April Retail
    '2026-06-16', // May Retail
    '2026-07-17', // June Retail
    '2026-08-14', // July Retail
    '2026-09-16', // August Retail
    '2026-10-16', // September Retail
    '2026-11-17', // October Retail
    '2026-12-16', // November Retail
    '2027-01-15', '2027-02-16', '2027-03-16', '2027-04-15',
    '2027-05-14', '2027-06-16', '2027-07-16', '2027-08-16',
    '2027-09-16', '2027-10-15', '2027-11-16', '2027-12-16',
  ],
  // Unemployment Rate: same day as NFP (first Friday of month)
  unrate: [
    '2026-05-01', '2026-06-05', '2026-07-03', '2026-08-07',
    '2026-09-04', '2026-10-02', '2026-11-06', '2026-12-04',
    '2027-01-08', '2027-02-05', '2027-03-05', '2027-04-02',
    '2027-05-07', '2027-06-04', '2027-07-02', '2027-08-06',
    '2027-09-03', '2027-10-01', '2027-11-05', '2027-12-03',
  ],
  // UMich Sentiment: preliminary ~2nd Friday of month
  umcsent: [
    '2026-05-08', '2026-06-12', '2026-07-10', '2026-08-14',
    '2026-09-11', '2026-10-09', '2026-11-13', '2026-12-11',
    '2027-01-15', '2027-02-12', '2027-03-12', '2027-04-09',
    '2027-05-14', '2027-06-11', '2027-07-09', '2027-08-13',
    '2027-09-10', '2027-10-08', '2027-11-12', '2027-12-10',
  ],
  pce: [
    '2026-04-30', // March Core PCE
    '2026-05-30', // April Core PCE
    '2026-06-26', // May Core PCE
    '2026-07-31', // June Core PCE
    '2026-08-28', // July Core PCE
    '2026-09-30', // August Core PCE
    '2026-10-30', // September Core PCE
    '2026-11-25', // October Core PCE
    '2026-12-23', // November Core PCE
    '2027-01-29', '2027-02-26', '2027-03-26', '2027-04-30',
    '2027-05-28', '2027-06-25', '2027-07-30', '2027-08-27',
    '2027-09-30', '2027-10-29', '2027-11-24', '2027-12-23',
  ],
  gdp: [
    '2026-04-30', // Q1 Advance
    '2026-05-29', // Q1 Second
    '2026-06-25', // Q1 Third
    '2026-07-30', // Q2 Advance
    '2026-10-29', // Q3 Advance
    '2027-01-29', // Q4 Advance
    '2027-02-26', '2027-03-25',
    '2027-04-29', '2027-05-27', '2027-06-24',
    '2027-07-29', '2027-08-26', '2027-09-30',
    '2027-10-28', '2027-11-24', '2027-12-22',
  ],
  // NFP / Unemployment Rate: first Friday of each month (BLS Employment Situation)
  nfp: [
    '2026-05-01', // April 2026
    '2026-06-05', // May 2026
    '2026-07-03', // June 2026
    '2026-08-07', // July 2026
    '2026-09-04', // August 2026
    '2026-10-02', // September 2026
    '2026-11-06', // October 2026
    '2026-12-04', // November 2026
    '2027-01-08', '2027-02-05', '2027-03-05', '2027-04-02',
    '2027-05-07', '2027-06-04', '2027-07-02', '2027-08-06',
    '2027-09-03', '2027-10-01', '2027-11-05', '2027-12-03',
  ],
  // Initial Jobless Claims: every Thursday
  iclaims: [
    '2026-04-30', // week ending Apr 25
    '2026-05-07', '2026-05-14', '2026-05-21', '2026-05-28',
    '2026-06-04', '2026-06-11', '2026-06-18', '2026-06-25',
    '2026-07-02', '2026-07-09', '2026-07-16', '2026-07-23', '2026-07-30',
    '2026-08-06', '2026-08-13', '2026-08-20', '2026-08-27',
    '2027-01-07', '2027-01-14', '2027-01-21', '2027-01-28',
    '2027-02-04', '2027-02-11', '2027-02-18', '2027-02-25',
    '2027-03-04', '2027-03-11', '2027-03-18', '2027-03-25',
    '2027-04-01', '2027-04-08', '2027-04-15', '2027-04-22', '2027-04-29',
  ],
};
function nextScheduledRelease(series: string, fallback: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const dates = RELEASE_SCHEDULE[series];
  if (!dates) return fallback;
  return dates.find(d => d > today) ?? fallback;
}

// ── Static fallback data ──────────────────────────────────────────────────────
// Used when FRED is unavailable; all values as of 2026-04-26
const STATIC: Record<string, Omit<MacroIndicator, 'cascade' | 'liveData'>> = {
  cpi: {
    id: 'cpi', name: 'CPI (Consumer Price Index)', nameKo: '소비자 물가지수',
    category: 'inflation', actual: 3.3, forecast: 2.5, previous: 2.4, unit: '%YoY',
    releaseDate: '2026-04-10', nextRelease: '2026-05-13', surprise: 'miss',
    rateImpact: 'hawkish', rateImpactKo: 'hawkish (inflation accelerating → prolonged tightening)',
    summary: 'Mar CPI 3.3%YoY — above est. 2.5%. Tariff shock re-accelerating inflation.',
  },
  pce: {
    id: 'pce', name: 'PCE Price Index (Core)', nameKo: '근원 개인소비지출 물가',
    category: 'inflation', actual: 3.0, forecast: 2.6, previous: 3.1, unit: '%YoY',
    releaseDate: '2026-03-28', nextRelease: '2026-04-30', surprise: 'miss',
    rateImpact: 'hawkish', rateImpactKo: 'hawkish (core inflation above forecast → prolonged tightening)',
    summary: 'Core PCE 3.0%YoY (est. 2.6%). Above Fed 2% target; tariff-driven re-acceleration.',
  },
  nfp: {
    id: 'nfp', name: 'Non-Farm Payrolls', nameKo: '비농업 고용지수',
    category: 'employment', actual: 228, forecast: 140, previous: 117, unit: 'K',
    releaseDate: '2026-04-04', nextRelease: '2026-05-02', surprise: 'beat',
    rateImpact: 'hawkish', rateImpactKo: 'hawkish (labor strength → tightening room)',
    summary: 'Mar NFP 228K beat est. 140K. Strong labor market delays Jun rate cut.',
  },
  fomc: {
    id: 'fomc', name: 'FOMC Rate Decision', nameKo: 'FOMC 금리 결정',
    category: 'monetary', actual: 3.75, forecast: 3.625, previous: 3.875, unit: '%',
    releaseDate: '2026-03-19', nextRelease: '2026-04-29', surprise: 'inline',
    rateImpact: 'neutral', rateImpactKo: 'neutral (data-dependent hold)',
    summary: 'Mar FOMC hold. Current rate 3.5-3.75% (mid 3.625%). Next meeting 2026-04-29.',
  },
  gdp: {
    id: 'gdp', name: 'GDP Growth Rate (Q1 Advance)', nameKo: 'GDP 성장률 (Q1)',
    category: 'growth', actual: null, forecast: 2.1, previous: 0.5, unit: '%QoQ SAAR',
    releaseDate: '2026-04-30', nextRelease: '2026-04-30', surprise: 'pending',
    rateImpact: 'neutral', rateImpactKo: 'neutral (pending)',
    summary: 'Q1 2026 GDP Advance — releasing 2026-04-30. Wall Street consensus 2.1% QoQ SAAR; Atlanta Fed GDPNow 1.2% (tariff drag). Wide dispersion reflects uncertainty.',
  },
  ism: {
    id: 'ism', name: 'ISM Manufacturing PMI', nameKo: 'ISM 제조업 PMI',
    category: 'growth', actual: 49.0, forecast: 49.5, previous: 50.3, unit: 'index',
    releaseDate: '2026-04-01', nextRelease: '2026-05-01', surprise: 'miss',
    rateImpact: 'dovish', rateImpactKo: 'dovish (manufacturing contraction → rate cut expectations)',
    summary: 'Mar ISM Mfg 49.0, below 50 threshold. Tariff uncertainty weighing.',
  },
  retail: {
    id: 'retail', name: 'Retail Sales', nameKo: '소매 판매',
    category: 'growth', actual: 1.7, forecast: -1.3, previous: 0.7, unit: '%MoM',
    releaseDate: '2026-04-16', nextRelease: '2026-05-15', surprise: 'beat',
    rateImpact: 'neutral', rateImpactKo: 'neutral (better than expected)',
    summary: 'Mar Retail Sales +1.7% (FRED RSAFS revised) vs advance est. -1.3%.',
  },
  ppi: {
    id: 'ppi', name: 'PPI (Producer Price Index)', nameKo: '생산자 물가지수 (최종수요)',
    category: 'inflation', actual: 4.1, forecast: 3.3, previous: 1.6, unit: '%YoY',
    releaseDate: '2026-04-11', nextRelease: '2026-05-14', surprise: 'miss',
    rateImpact: 'hawkish', rateImpactKo: 'hawkish (cost pressure widening)',
    summary: 'Mar PPI (final demand) 4.1%YoY — above est. 3.3%. Tariff cost pass-through accelerating.',
  },
  unrate: {
    id: 'unrate', name: 'Unemployment Rate', nameKo: '실업률',
    category: 'employment', actual: 4.3, forecast: 4.1, previous: 4.1, unit: '%',
    releaseDate: '2026-04-04', nextRelease: '2026-05-02', surprise: 'miss',
    rateImpact: 'dovish', rateImpactKo: 'dovish (labor market cooling)',
    summary: 'Unemployment 4.3% — labor market cooling, above est. 4.1%.',
  },
  iclaims: {
    id: 'iclaims', name: 'Initial Jobless Claims (Weekly)', nameKo: '신규 실업수당 청구 (주간)',
    category: 'employment', actual: 222, forecast: 224, previous: 224, unit: 'K/wk',
    releaseDate: '2026-04-24', nextRelease: '2026-05-01', surprise: 'beat',
    rateImpact: 'hawkish', rateImpactKo: 'hawkish (labor resilience)',
    summary: 'Initial claims 222K — below est. 224K. No layoff surge signal.',
  },
  umcsent: {
    id: 'umcsent', name: 'U of Michigan Consumer Sentiment', nameKo: '미시간대 소비자심리지수',
    category: 'growth', actual: 52.2, forecast: 54.0, previous: 57.9, unit: 'index',
    releaseDate: '2026-04-11', nextRelease: '2026-05-09', surprise: 'miss',
    rateImpact: 'dovish', rateImpactKo: 'dovish (consumer sentiment deteriorating)',
    summary: 'Apr consumer sentiment 52.2 — below 60. Tariff uncertainty + inflation fears surging. Lowest since 1978.',
  },
  ig_spread: {
    id: 'ig_spread', name: 'IG Credit OAS (ICE BofA)', nameKo: 'IG 신용 스프레드 (OAS)',
    category: 'credit', actual: 0.79, forecast: 0.75, previous: 0.89, unit: '%',
    releaseDate: '2026-04-25', nextRelease: '2026-04-28', surprise: 'miss',
    rateImpact: 'neutral', rateImpactKo: 'neutral (credit risk slightly elevated)',
    summary: 'IG OAS 0.79% — slightly above historical lows. Above 1.5% = credit stress alert.',
  },
  hy_spread: {
    id: 'hy_spread', name: 'HY Credit OAS (ICE BofA)', nameKo: 'HY 신용 스프레드 (OAS)',
    category: 'credit', actual: 2.84, forecast: 2.80, previous: 3.23, unit: '%',
    releaseDate: '2026-04-25', nextRelease: '2026-04-28', surprise: 'miss',
    rateImpact: 'neutral', rateImpactKo: 'neutral (HY risk slightly elevated)',
    summary: 'HY OAS 2.84% — above 5% = recession alert. Currently neutral.',
  },
};

// ── FRED static forecasts (consensus at time of last update) ──────────────────
// FRED gives actual values; we keep forecasts as static consensus
// nextRelease는 모두 RELEASE_SCHEDULE에서 자동 계산 — 하드코딩 날짜 제거
// forecast는 시장 컨센서스 (업데이트 필요 시 여기만 수정, 날짜는 자동)
// Quarterly update: refresh consensus forecasts after each major macro forecast cycle.
const FORECASTS: Record<string, { forecast: number }> = {
  cpi:       { forecast: 2.5  },
  pce:       { forecast: 2.8  },
  nfp:       { forecast: 140  },
  gdp:       { forecast: 2.1  },
  ppi:       { forecast: 3.3  },
  retail:    { forecast: -1.3 },
  unrate:    { forecast: 4.1  },
  iclaims:   { forecast: 224  },
  umcsent:   { forecast: 54.0 },
  ig_spread: { forecast: 0.75 },
  hy_spread: { forecast: 2.80 },
};

// ── Main GET ──────────────────────────────────────────────────────────────────
export async function GET(request: Request) {
  const redis = createRedis();
  const key = cacheKey();
  const reqHost = new URL(request.url).host;
  const reqProto = new URL(request.url).protocol;
  const baseUrl = reqHost.startsWith('localhost') ? 'http://localhost:3000' : `${reqProto}//${reqHost}`;

  // Cron warm calls (x-cron-warm: 1) bypass both memory cache AND Redis — ensures fresh FRED data
  // on release days (e.g. GDP Q1 advance at 12:30 UTC April 30 picked up by 13:00 UTC cron warm).
  const cronSecret = process.env.CRON_SECRET ?? '';
  const cronAuthed = !cronSecret || request.headers.get('authorization') === `Bearer ${cronSecret}`;
  const isCronWarm = cronAuthed && request.headers.get('x-cron-warm') === '1';

  // Module-level memory cache hit (no-Redis path)
  if (!isCronWarm && !redis && MACRO_MEMORY_CACHE && Date.now() < MACRO_MEMORY_CACHE.expiresAt) {
    logger.info('macro-indicators', 'memory_cache_hit');
    return NextResponse.json(MACRO_MEMORY_CACHE.data, { headers: CDN_HEADERS });
  }

  if (redis && !isCronWarm) {
    try {
      const cached = await redis.get<object>(key);
      if (cached) {
        const cachedYc = (cached as Record<string, unknown>)?.yieldCurve as { spread10y2y?: number | null } | undefined;
        if (cachedYc?.spread10y2y != null) {
          return NextResponse.json(cached, { headers: CDN_HEADERS });
        }
        // spread is null in cache — bypass and refetch to pick up T10Y2Y fallback
        logger.warn('macro-indicators', 'cache_null_spread_bypass', { key });
      }
    } catch (e) { logger.warn('macro-indicators', 'cache_read_error', { error: e }); }
  }

  // Fetch FRED data in parallel
  const [
    fredCPI, fredCoreCPI, fredPCE, fredCorePCE,
    fredNFP, fredGDP, fredPPI, fredRetail, fredUnrate,
    fredISM, fredFOMCUpper, fredFOMCLower,
    yieldCurve, fredIClaims, fredUMCSENT,
    fredIGSpread, fredHYSpread,
  ] = await Promise.allSettled([
    fetchYoY('CPIAUCSL'),
    fetchYoY('CPILFESL'),
    fetchYoY('PCEPI'),
    fetchYoY('PCEPILFE'),
    fetchMoMChange('PAYEMS'),
    fetchLatest('A191RL1Q225SBEA', 6),  // 6-month window: FRED Q1 date=2026-01-01 falls before default 3-month start
    fetchYoY('WPSFD49207'),  // PPI Final Demand (BLS headline) — replaced PPIACO (All Commodities, wrong series)
    fetchMoMPct('RSAFS'),
    fetchLatest('UNRATE'),
    fetchLatest('NAPM'),             // ISM Manufacturing PMI (NAPM series often unreachable; falls back to static)
    fetchLatest('DFEDTARU'),         // Fed funds upper bound
    fetchLatest('DFEDTARL'),         // Fed funds lower bound
    fetchYieldCurve(baseUrl),
    fetchLatest('ICSA'),             // Initial Jobless Claims (weekly, in persons)
    fetchLatest('UMCSENT'),          // U of Michigan Consumer Sentiment (monthly)
    fetchLatest('BAMLC0A0CM'),       // ICE BofA IG Corporate OAS (daily, %)
    fetchLatest('BAMLH0A0HYM2'),     // ICE BofA HY Corporate OAS (daily, %)
  ]);

  // Build indicators from FRED data, fall back to static
  function get<T>(r: PromiseSettledResult<T | null>): T | null {
    return r.status === 'fulfilled' ? r.value : null;
  }

  const indicators: MacroIndicator[] = [];

  // CPI
  const cpiData = get(fredCPI);
  {
    const base = STATIC.cpi;
    const actual = cpiData?.value ?? base.actual;
    const previous = cpiData?.previous ?? base.previous;
    const fc = FORECASTS.cpi.forecast;
    const surprise = classify(actual, fc, false); // lower = beat (dovish)
    const ri = rateImpact('cpi', surprise);
    indicators.push({
      ...base,
      actual, previous, forecast: fc,
      releaseDate: cpiData?.date ?? base.releaseDate,
      nextRelease: nextScheduledRelease("cpi", ""),
      surprise, rateImpact: ri.impact, rateImpactKo: ri.ko,
      summary: actual !== null
        ? `CPI ${actual.toFixed(1)}%YoY (est. ${fc}%, prev ${previous?.toFixed(1) ?? '?'}%). ${actual < fc ? 'Below est. — rate cut expectations strengthened.' : actual > fc ? 'Above est. — tightening pressure.' : 'In line.'}`
        : base.summary,
      cascade: buildCascade('cpi', surprise),
      liveData: !!cpiData,
    });
  }

  // PCE (Core)
  const pceData = get(fredCorePCE) ?? get(fredPCE);
  {
    const base = STATIC.pce;
    const actual = pceData?.value ?? base.actual;
    const previous = pceData?.previous ?? base.previous;
    const fc = FORECASTS.pce.forecast;
    const surprise = classify(actual, fc, false);
    const ri = rateImpact('pce', surprise);
    indicators.push({
      ...base,
      actual, previous, forecast: fc,
      releaseDate: pceData?.date ?? base.releaseDate,
      nextRelease: nextScheduledRelease('pce', nextScheduledRelease("pce", "")),
      surprise, rateImpact: ri.impact, rateImpactKo: ri.ko,
      summary: actual !== null
        ? `Core PCE ${actual.toFixed(1)}%YoY (est. ${fc}%). ${actual > 2.5 ? 'Still above Fed 2% target.' : 'Approaching Fed 2% target.'}`
        : base.summary,
      cascade: buildCascade('pce', surprise),
      liveData: !!pceData,
    });
  }

  // NFP — FRED PAYEMS shows absolute levels; MoM change can lag BLS headline when
  // BLS revises a prior month on the same release day (FRED incorporates revisions
  // with a ~1-week lag). Detect by comparing FRED MoM vs static BLS headline.
  const nfpData = get(fredNFP);
  {
    const base = STATIC.nfp;
    const fredActual = nfpData ? Math.round(nfpData.value) : null;
    const staticActual = base.actual;
    // If FRED deviates from BLS static by > 15% AND static is recent (≤60 days), use static + note
    const fredLag = fredActual !== null && staticActual !== null
      && Math.abs(fredActual - staticActual) > Math.abs(staticActual) * 0.15
      && (Date.now() - new Date(base.releaseDate).getTime()) < 60 * 24 * 60 * 60 * 1000;
    const actual = fredLag ? staticActual : (fredActual ?? staticActual);
    const previous = (!nfpData || fredLag) ? base.previous : Math.round(nfpData.previous);
    const fc = FORECASTS.nfp.forecast;
    const surprise = classify(actual, fc, true);
    const ri = rateImpact('nfp', surprise);
    indicators.push({
      ...base,
      actual, previous, forecast: fc,
      releaseDate: nfpData?.date ?? base.releaseDate,
      nextRelease: nextScheduledRelease('nfp', nextScheduledRelease("nfp", "")),
      surprise, rateImpact: ri.impact, rateImpactKo: ri.ko,
      summary: actual !== null
        ? `NFP ${actual.toLocaleString()}K (est. ${fc}K). ${actual > fc ? 'Strong jobs — rate cut timing delayed.' : 'Jobs slowing — rate cut expectations strengthened.'}`
        : base.summary,
      cascade: buildCascade('nfp', surprise),
      liveData: !!nfpData && !fredLag,
      dataNote: fredLag ? `FRED PAYEMS ${fredActual}K (전월 수정 반영 지연) — BLS 공식 발표 ${staticActual}K 사용 중` : undefined,
    });
  }

  // FOMC current rate (FRED DFEDTARU/DFEDTARL)
  const fomcUpper = get(fredFOMCUpper);
  const fomcLower = get(fredFOMCLower);
  {
    const base = STATIC.fomc;
    const actualUpper = fomcUpper?.value ?? (base.actual ?? 4.5);
    const actualLower = fomcLower?.value ?? ((base.actual ?? 4.5) - 0.25);
    const midRate = parseFloat(((actualUpper + actualLower) / 2).toFixed(3));
    const surprise = classify(midRate, base.forecast ?? 4.5, false);
    indicators.push({
      ...base,
      actual: midRate,
      previous: base.previous,
      forecast: base.forecast,
      releaseDate: fomcUpper?.date ?? base.releaseDate,
      surprise, rateImpact: base.rateImpact, rateImpactKo: base.rateImpactKo,
      nextRelease: nextFomcDate(),
      summary: fomcUpper
        ? `Current rate ${actualLower}~${actualUpper}% (mid ${midRate}%). Next FOMC: ${nextFomcDate()}.`
        : base.summary,
      cascade: buildCascade('fomc', surprise),
      liveData: !!fomcUpper,
    });
  }

  // GDP
  const gdpData = get(fredGDP);
  // FRED quarterly observation date = quarter-start (e.g. 2025-10-01 = Q4 2025).
  // Reject pre-current-year quarters to avoid labeling Q4 2025 as "Q1 Advance".
  // Never use gdpData.date as releaseDate — it's the quarter start, not the BEA press-release date.
  const gdpYearCutoff = `${new Date().getFullYear()}-01-01`;
  const gdpLive = gdpData?.date && gdpData.date >= gdpYearCutoff ? gdpData : null;
  {
    const base = STATIC.gdp;
    const actual = gdpLive ? parseFloat(gdpLive.value.toFixed(1)) : base.actual;
    const fc = FORECASTS.gdp.forecast;
    const surprise = classify(actual, fc, true);
    const ri = rateImpact('gdp', surprise);
    indicators.push({
      ...base,
      actual, previous: gdpLive?.previous != null ? parseFloat(gdpLive.previous.toFixed(1)) : base.previous, forecast: fc,
      releaseDate: base.releaseDate,
      nextRelease: nextScheduledRelease('gdp', nextScheduledRelease("gdp", "")),
      surprise, rateImpact: ri.impact, rateImpactKo: ri.ko,
      summary: actual !== null
        ? `GDP ${actual}% QoQ SAAR (est. ${fc}%). ${actual > 2 ? 'Growth solid.' : actual > 0 ? 'Growth slowing.' : 'Negative growth warning.'}`
        : base.summary,
      cascade: buildCascade('gdp', surprise),
      liveData: !!gdpLive,
    });
  }

  // ISM Manufacturing PMI (FRED NAPM series)
  const ismData = get(fredISM);
  {
    const base = STATIC.ism;
    const actual = ismData ? parseFloat(ismData.value.toFixed(1)) : base.actual;
    const fc = 49.5; // consensus
    const surprise = classify(actual, fc, true); // higher PMI = better
    const ri = rateImpact('ism', surprise);
    indicators.push({
      ...base,
      actual, previous: base.previous, forecast: fc,
      releaseDate: ismData?.date ?? base.releaseDate,
      surprise, rateImpact: ri.impact, rateImpactKo: ri.ko,
      summary: actual !== null
        ? `ISM PMI ${actual} (est. ${fc}). ${actual >= 50 ? 'Manufacturing expanding.' : 'Manufacturing contracting — economic slowdown risk.'}`
        : base.summary,
      cascade: buildCascade('ism', surprise),
      liveData: !!ismData,
    });
  }

  // Retail Sales
  const retailData = get(fredRetail);
  {
    const base = STATIC.retail;
    const actual = retailData ? parseFloat(retailData.value.toFixed(1)) : base.actual;
    const previous = retailData ? parseFloat(retailData.previous.toFixed(1)) : base.previous;
    const fc = FORECASTS.retail.forecast;
    const surprise = classify(actual, fc, true);
    const ri = rateImpact('retail', surprise);
    indicators.push({
      ...base,
      actual, previous, forecast: fc,
      releaseDate: retailData?.date ?? base.releaseDate,
      nextRelease: nextScheduledRelease("retail", ""),
      surprise, rateImpact: ri.impact, rateImpactKo: ri.ko,
      summary: actual !== null
        ? `Retail Sales ${actual > 0 ? '+' : ''}${actual}%MoM (est. ${fc > 0 ? '+' : ''}${fc}%). ${actual > 0 ? 'Consumer recovery signal.' : 'Consumer spending contracting.'}`
        : base.summary,
      cascade: buildCascade('retail', surprise),
      liveData: !!retailData,
    });
  }

  // PPI
  const ppiData = get(fredPPI);
  {
    const base = STATIC.ppi;
    const actual = ppiData?.value ?? base.actual;
    const previous = ppiData?.previous ?? base.previous;
    const fc = FORECASTS.ppi.forecast;
    const surprise = classify(actual, fc, false);
    const ri = rateImpact('ppi', surprise);
    indicators.push({
      ...base,
      actual, previous, forecast: fc,
      releaseDate: ppiData?.date ?? base.releaseDate,
      nextRelease: nextScheduledRelease("ppi", ""),
      surprise, rateImpact: ri.impact, rateImpactKo: ri.ko,
      summary: actual !== null
        ? `PPI (final demand) ${actual.toFixed(1)}%YoY (est. ${fc}%). ${actual < fc ? 'Leading signal of CPI stabilization.' : 'Leading signal of CPI upside pressure.'}`
        : base.summary,
      cascade: buildCascade('ppi', surprise),
      liveData: !!ppiData,
    });
  }

  // Unemployment Rate
  const unrateData = get(fredUnrate);
  {
    const base = STATIC.unrate;
    const actual = unrateData?.value ?? base.actual;
    const fc = FORECASTS.unrate.forecast;
    // For unrate: lower is better for economy but higher = dovish for Fed
    const surprise = classify(actual, fc, false); // lower than forecast = beat (hawkish)
    const ri = rateImpact('unrate', surprise);
    indicators.push({
      ...base,
      actual, previous: base.previous, forecast: fc,
      releaseDate: unrateData?.date ?? base.releaseDate,
      nextRelease: nextScheduledRelease('nfp', nextScheduledRelease("unrate", "")),
      surprise, rateImpact: ri.impact, rateImpactKo: ri.ko,
      summary: actual !== null
        ? `Unemployment ${actual}% (est. ${fc}%, prev ${base.previous}%). ${actual > fc ? 'Labor market cooling — rate cut pressure.' : 'Labor market holding firm.'}`
        : base.summary,
      cascade: buildCascade('unrate', surprise),
      liveData: !!unrateData,
    });
  }

  // Initial Jobless Claims — ICSA reports in raw persons; convert to thousands
  // FRED ICSA uses week-ending dates; static.releaseDate is the BLS Thursday release (5 days after week-end).
  // If FRED week-ending date < (releaseDate - 5 days), FRED hasn't updated to the latest BLS release.
  const iclaimsRaw = get(fredIClaims);
  {
    const base = STATIC.iclaims;
    const iclaimsWeekEnd = new Date(new Date(base.releaseDate).getTime() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const iclaimsStale = iclaimsRaw?.date != null && iclaimsRaw.date < iclaimsWeekEnd;
    const actualK: number | null = (!iclaimsRaw || iclaimsStale) ? null : Math.round(iclaimsRaw.value / 1000);
    const fc = FORECASTS.iclaims.forecast;
    const displayActual = actualK ?? base.actual;
    const surprise = classify(displayActual, fc, false); // lower claims = beat
    const ri = rateImpact('iclaims', surprise);
    indicators.push({
      ...base,
      actual: displayActual, previous: base.previous, forecast: fc,
      releaseDate: iclaimsRaw && !iclaimsStale ? iclaimsRaw.date : base.releaseDate,
      nextRelease: nextScheduledRelease('iclaims', nextScheduledRelease("iclaims", "")),
      surprise, rateImpact: ri.impact, rateImpactKo: ri.ko,
      summary: actualK != null
        ? `Initial claims ${actualK}K/wk (est. ${fc}K). ${actualK < fc ? 'No layoff surge — labor market resilient.' : 'Claims rising — watch for layoff pressure.'}`
        : base.summary,
      cascade: buildCascade('iclaims', surprise),
      liveData: actualK != null,
      dataNote: iclaimsStale ? `FRED ${iclaimsRaw?.date} 기준 (주간 갱신 지연) — BLS ${base.releaseDate} 공식 발표 사용 중` : undefined,
    });
  }

  // U of Michigan Consumer Sentiment
  // FRED UMCSENT carries month-start dates; preliminary releases reach FRED days after BLS publication.
  // If FRED month < static's release month, static has the more current reading.
  const umcsentData = get(fredUMCSENT);
  {
    const base = STATIC.umcsent;
    const fredMonthStale = umcsentData?.date != null && umcsentData.date.slice(0, 7) < base.releaseDate.slice(0, 7);
    const liveVal: number | null = (!umcsentData || fredMonthStale) ? null : parseFloat(umcsentData.value.toFixed(1));
    const actual = liveVal ?? (base.actual as number);
    const fc = FORECASTS.umcsent.forecast;
    const surprise = classify(actual, fc, true); // higher sentiment = beat
    const ri = rateImpact('umcsent', surprise);
    indicators.push({
      ...base,
      actual, previous: base.previous, forecast: fc,
      releaseDate: umcsentData && !fredMonthStale ? umcsentData.date : base.releaseDate,
      nextRelease: nextScheduledRelease("umcsent", ""),
      surprise, rateImpact: ri.impact, rateImpactKo: ri.ko,
      summary: liveVal != null
        ? `Consumer sentiment ${liveVal.toFixed(1)} (est. ${fc}). ${liveVal < 60 ? 'Below 60 — consumer spending slowdown risk.' : liveVal < fc ? 'Below est. — household spending concern.' : 'Above est. — consumer recovery signal.'}`
        : base.summary,
      cascade: buildCascade('umcsent', surprise),
      liveData: liveVal != null,
      dataNote: fredMonthStale ? `FRED ${umcsentData?.date?.slice(0, 7)} 기준 (예비치 갱신 지연) — ${base.releaseDate} 공식 예비치 사용 중` : undefined,
    });
  }

  // IG Credit OAS (ICE BofA US Corporate, daily, %)
  const igData = get(fredIGSpread);
  {
    const base = STATIC.ig_spread;
    const actual: number = igData != null ? parseFloat(igData.value.toFixed(2)) : (base.actual as number);
    const fc = FORECASTS.ig_spread.forecast;
    const surprise = classify(actual, fc, false); // lower OAS = better (credit looser)
    const ri = rateImpact('ig_spread', surprise);
    indicators.push({
      ...base,
      actual, previous: base.previous,
      forecast: fc,
      releaseDate: igData?.date ?? base.releaseDate,
      nextRelease: nextBizDay(igData?.date ?? base.releaseDate),
      surprise, rateImpact: ri.impact, rateImpactKo: ri.ko,
      summary: igData != null
        ? `IG OAS ${actual.toFixed(2)}% (${igData.date}). ${actual > 1.5 ? 'Above 1.5% — credit stress alert.' : actual > 1.0 ? 'Entering caution zone.' : 'Normal range.'}`
        : base.summary,
      cascade: buildCascade('ig_spread', surprise),
      liveData: igData != null,
    });
  }

  // HY Credit OAS (ICE BofA US High Yield, daily, %)
  const hyData = get(fredHYSpread);
  {
    const base = STATIC.hy_spread;
    const actual: number = hyData != null ? parseFloat(hyData.value.toFixed(2)) : (base.actual as number);
    const fc = FORECASTS.hy_spread.forecast;
    const surprise = classify(actual, fc, false); // lower OAS = better
    const ri = rateImpact('hy_spread', surprise);
    indicators.push({
      ...base,
      actual, previous: base.previous,
      forecast: fc,
      releaseDate: hyData?.date ?? base.releaseDate,
      nextRelease: nextBizDay(hyData?.date ?? base.releaseDate),
      surprise, rateImpact: ri.impact, rateImpactKo: ri.ko,
      summary: hyData != null
        ? `HY OAS ${actual.toFixed(2)}% (${hyData.date}). ${actual > 5.0 ? 'Above 5% — recession signal.' : actual > 4.0 ? 'Entering stress zone.' : 'Normal range.'}`
        : base.summary,
      cascade: buildCascade('hy_spread', surprise),
      liveData: hyData != null,
    });
  }

  const yc = get(yieldCurve as PromiseSettledResult<{ points: YieldPoint[]; inverted: boolean; spread10y2y: number | null } | null>) ?? { points: [], inverted: false, spread10y2y: null };
  const now = new Date().toISOString();
  const liveCount = indicators.filter(ind => ind.liveData).length;
  const totalCount = indicators.length;
  const ycLive = yc.points.some(pt => pt.value != null);
  // 3-tier source: all-live → 'fred', some-live → 'mixed', none-live → 'static'.
  // verify-metrics 가 'mixed'/'static' 을 별도 감지해 stale 노출 방지.
  const responseSource: 'fred' | 'mixed' | 'static' =
    liveCount === totalCount && ycLive ? 'fred'
    : liveCount === 0 && !ycLive ? 'static'
    : 'mixed';
  const response = {
    indicators,
    yieldCurve: yc,
    updatedAt: now,
    source: responseSource,
    liveCount,
    staticCount: totalCount - liveCount,
    ...(responseSource !== 'fred' ? { staticAsOf: STATIC_DATA_AS_OF } : {}),
  };

  if (redis) {
    try {
      await loggedRedisSet(redis, 'api.macro-indicators', key, response, { ex: 25 * 60 * 60 });
      logger.info('macro-indicators', 'cache_saved', { indicators: indicators.length });
    } catch (e) { logger.warn('macro-indicators', 'cache_write_error', { error: e }); }

    // ── metrics-db: 발표된 실제값 영구 기록 ───────────────────────────────
    const dbItems = indicators
      .filter(ind => ind.actual != null)
      .map(ind => ({
        key: `macro.actual.${ind.id}`,
        label: `${ind.name} (실제값)`,
        group: 'macro-actual' as const,
        status: 'ok' as const,
        value: `${ind.actual}${ind.unit ?? ''}`,
        source: 'FRED',
      }));
    if (dbItems.length > 0) {
      await logMetrics(redis, dbItems, now).catch(() => {});
      logger.info('macro-indicators', 'mdb_written', { count: dbItems.length });
    }
  }

  // Module-level memory cache write (no-Redis path)
  if (!redis) {
    MACRO_MEMORY_CACHE = { data: response, expiresAt: Date.now() + MACRO_MEMORY_TTL_MS };
    logger.info('macro-indicators', 'memory_cache_written', { indicators: indicators.length });
  }

  return NextResponse.json(response, { headers: CDN_HEADERS });
}
