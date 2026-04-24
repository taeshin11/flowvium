import { logger, loggedRedisSet} from '@/lib/logger';
/**
 * /api/macro-indicators
 *
 * Key macro indicators + cascade impact analysis
 *
 * Data sources:
 *   - FRED (free CSV endpoint) for CPI, PCE, PPI, NFP, GDP, Retail Sales, Unemployment, Yield Curve
 *   - Static fallback for ISM, FOMC (no free FRED source)
 *
 * Cache: daily key (refreshes at midnight KST via cron)
 */
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600' };

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

function kstDate(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}
function cacheKey(): string {
  return `flowvium:macro-indicators:v4:${kstDate()}`;
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
  category: 'inflation' | 'employment' | 'growth' | 'monetary' | 'trade';
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
}

// ── FRED helpers ──────────────────────────────────────────────────────────────
async function fetchFREDCsv(series: string, monthsBack: number = 15): Promise<Array<{ date: string; value: number }>> {
  try {
    const startDate = new Date(Date.now() - monthsBack * 30.5 * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
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

// Latest value
async function fetchLatest(series: string): Promise<{ value: number; date: string } | null> {
  const rows = await fetchFREDCsv(series, 3);
  const last = rows[rows.length - 1];
  return last ?? null;
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

async function fetchYieldCurve(): Promise<{ points: YieldPoint[]; inverted: boolean; spread10y2y: number | null }> {
  const empty = { points: DISPLAY_ORDER.map(l => ({ label: l, value: null })), inverted: false, spread10y2y: null };

  try {
    const labels = DISPLAY_ORDER;
    const apiKey = process.env.FRED_API_KEY?.trim();

    let labelMap: Record<string, number | null>;

    if (apiKey) {
      // Prefer FRED JSON API (faster, sorted desc)
      const results = await Promise.all(labels.map(l => fetchFredLatest(FRED_YIELD_SERIES[l], apiKey)));
      labelMap = Object.fromEntries(labels.map((l, i) => [l, results[i]]));
    } else {
      // Free fallback: FRED CSV (no API key required, slightly slower)
      const results = await Promise.all(labels.map(l => fetchLatest(FRED_YIELD_SERIES[l])));
      labelMap = Object.fromEntries(labels.map((l, i) => [l, results[i]?.value ?? null]));
      logger.info('macro-indicators', 'yield_curve_csv_fallback', { message: 'FRED_API_KEY not set, using free CSV endpoint' });
    }

    const points: YieldPoint[] = DISPLAY_ORDER.map(l => ({
      label: l,
      value: labelMap[l] ?? null,
    }));

    const y2 = labelMap['2Y'] ?? null;
    const y10 = labelMap['10Y'] ?? null;
    const spread10y2y = y2 !== null && y10 !== null ? parseFloat((y10 - y2).toFixed(2)) : null;

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
  if (surprise === 'inline' || surprise === 'pending') return { impact: 'neutral', ko: '중립' };
  const hawkishOnBeat = ['cpi', 'pce', 'nfp', 'ppi', 'retail'];
  const hawkishOnMiss = ['gdp', 'ism', 'unrate'];
  if (hawkishOnBeat.includes(id)) {
    return surprise === 'beat'
      ? { impact: 'hawkish', ko: '매파적 (긴축 압력)' }
      : { impact: 'dovish', ko: '비둘기파 (인하 기대↑)' };
  }
  if (hawkishOnMiss.includes(id)) {
    return surprise === 'miss'
      ? { impact: 'hawkish', ko: '매파적' }
      : { impact: 'dovish', ko: '비둘기파' };
  }
  return { impact: 'neutral', ko: '중립' };
}

// ── Cascade logic ─────────────────────────────────────────────────────────────
function buildCascade(id: string, surprise: 'beat' | 'miss' | 'inline' | 'pending'): CascadeStep[] {
  if (surprise === 'pending' || surprise === 'inline') return [];
  const cascades: Record<string, { beat: CascadeStep[]; miss: CascadeStep[] }> = {
    cpi: {
      beat: [
        { asset: '미 국채 금리', direction: 'up', reason: 'Fed 긴축 기대↑ → 채권 매도', magnitude: 'strong' },
        { asset: '달러 (DXY)', direction: 'up', reason: '금리 상승 → 달러 강세', magnitude: 'strong' },
        { asset: '미국 주식 (S&P500)', direction: 'down', reason: '할인율 상승 → 밸류에이션 압박', magnitude: 'moderate' },
        { asset: '금 (GLD)', direction: 'down', reason: '실질금리 상승 → 금 비용 증가', magnitude: 'moderate' },
        { asset: 'EM 주식/통화', direction: 'down', reason: '달러 강세 → 자본 이탈', magnitude: 'strong' },
      ],
      miss: [
        { asset: '미 국채 금리', direction: 'down', reason: 'Fed 완화 기대↑ → 채권 매수', magnitude: 'strong' },
        { asset: '달러 (DXY)', direction: 'down', reason: '금리 하락 기대 → 달러 약세', magnitude: 'moderate' },
        { asset: '미국 주식 (S&P500)', direction: 'up', reason: '할인율 하락 → 밸류에이션 개선', magnitude: 'strong' },
        { asset: '금 (GLD)', direction: 'up', reason: '실질금리 하락 → 금 매력↑', magnitude: 'strong' },
        { asset: 'EM 주식/통화', direction: 'up', reason: '달러 약세 → 자본 유입', magnitude: 'moderate' },
      ],
    },
    pce: {
      beat: [
        { asset: '미 국채 금리', direction: 'up', reason: 'Fed 선호 지표 상회 → 긴축 강화', magnitude: 'strong' },
        { asset: '미국 주식 (S&P500)', direction: 'down', reason: '금리 인하 시기 후퇴', magnitude: 'strong' },
        { asset: '달러 (DXY)', direction: 'up', reason: '매파적 Fed 입장 강화', magnitude: 'moderate' },
      ],
      miss: [
        { asset: '미 국채 금리', direction: 'down', reason: 'Fed 목표 근접 → 인하 기대↑', magnitude: 'strong' },
        { asset: '미국 주식 (S&P500)', direction: 'up', reason: '금리 인하 시기 앞당김', magnitude: 'strong' },
        { asset: '금 (GLD)', direction: 'up', reason: '실질금리 하락', magnitude: 'moderate' },
        { asset: 'EM 주식', direction: 'up', reason: '달러 약세 전망', magnitude: 'moderate' },
      ],
    },
    nfp: {
      beat: [
        { asset: '미 국채 금리', direction: 'up', reason: '고용 강세 → Fed 긴축 여력', magnitude: 'strong' },
        { asset: '달러 (DXY)', direction: 'up', reason: '경제 강세 → 달러 수요', magnitude: 'moderate' },
        { asset: '미국 주식 (S&P500)', direction: 'mixed', reason: '성장 호조 vs 금리 상승 충돌', magnitude: 'weak' },
      ],
      miss: [
        { asset: '미 국채 금리', direction: 'down', reason: '경기 우려 → 안전자산 매수', magnitude: 'strong' },
        { asset: '미국 주식 (S&P500)', direction: 'down', reason: '경기 침체 우려', magnitude: 'moderate' },
        { asset: '금 (GLD)', direction: 'up', reason: '경기 불확실성 → 안전자산', magnitude: 'moderate' },
      ],
    },
    gdp: {
      beat: [
        { asset: '미 국채 금리', direction: 'up', reason: '성장 호조 → 긴축 여지', magnitude: 'moderate' },
        { asset: '미국 주식 (S&P500)', direction: 'up', reason: '기업 실적 기대 강화', magnitude: 'moderate' },
        { asset: '달러 (DXY)', direction: 'up', reason: '경제 강세 → 자본 유입', magnitude: 'moderate' },
      ],
      miss: [
        { asset: '미 국채 금리', direction: 'down', reason: '침체 우려 → 인하 기대', magnitude: 'moderate' },
        { asset: '미국 주식 (S&P500)', direction: 'down', reason: '기업 실적 하향 우려', magnitude: 'moderate' },
        { asset: '금 (GLD)', direction: 'up', reason: '경기 불안 → 안전자산', magnitude: 'moderate' },
      ],
    },
    ppi: {
      beat: [
        { asset: '미 국채 금리', direction: 'up', reason: 'PPI 상승 → CPI 선행 → 긴축 예고', magnitude: 'moderate' },
        { asset: '미국 주식 (S&P500)', direction: 'down', reason: '기업 원가 부담 + 긴축 우려', magnitude: 'moderate' },
        { asset: '달러 (DXY)', direction: 'up', reason: '물가 압력 → 금리 유지', magnitude: 'weak' },
      ],
      miss: [
        { asset: '미 국채 금리', direction: 'down', reason: 'PPI 하락 → CPI 안정 기대', magnitude: 'moderate' },
        { asset: '미국 주식 (S&P500)', direction: 'up', reason: '원가 부담 완화 → 마진 개선', magnitude: 'moderate' },
        { asset: '금 (GLD)', direction: 'up', reason: '인하 기대 → 실질금리 하락', magnitude: 'weak' },
      ],
    },
    retail: {
      beat: [
        { asset: '미국 주식 (S&P500)', direction: 'up', reason: '소비 강세 → 리테일·소비재 수혜', magnitude: 'moderate' },
        { asset: '미 국채 금리', direction: 'up', reason: '소비 호조 → 인플레 우려', magnitude: 'weak' },
      ],
      miss: [
        { asset: '미국 주식 (S&P500)', direction: 'down', reason: '소비 둔화 → 성장 우려', magnitude: 'moderate' },
        { asset: '미 국채 금리', direction: 'down', reason: '경기 둔화 → 인하 기대', magnitude: 'moderate' },
        { asset: '금 (GLD)', direction: 'up', reason: '안전자산 수요', magnitude: 'weak' },
      ],
    },
    ism: {
      beat: [
        { asset: '미국 주식 (S&P500)', direction: 'up', reason: '제조업 확장 → 경기 강세', magnitude: 'moderate' },
        { asset: '원자재', direction: 'up', reason: '산업 수요 확대', magnitude: 'moderate' },
      ],
      miss: [
        { asset: '미국 주식 (S&P500)', direction: 'down', reason: '제조업 수축 신호', magnitude: 'moderate' },
        { asset: '금 (GLD)', direction: 'up', reason: '경기 우려 → 안전자산', magnitude: 'weak' },
        { asset: '미 국채 금리', direction: 'down', reason: '경기 약화 → 완화 기대', magnitude: 'moderate' },
      ],
    },
    fomc: {
      beat: [
        { asset: '미 국채 금리', direction: 'up', reason: '예상보다 매파 → 즉각 금리 반영', magnitude: 'strong' },
        { asset: '달러 (DXY)', direction: 'up', reason: '금리 차이 확대', magnitude: 'strong' },
        { asset: '미국 주식 (S&P500)', direction: 'down', reason: '유동성 축소 우려', magnitude: 'strong' },
        { asset: '금 (GLD)', direction: 'down', reason: '실질금리 급등', magnitude: 'moderate' },
      ],
      miss: [
        { asset: '미 국채 금리', direction: 'down', reason: '완화적 발언 → 채권 랠리', magnitude: 'strong' },
        { asset: '미국 주식 (S&P500)', direction: 'up', reason: '유동성 기대 + 멀티플 확장', magnitude: 'strong' },
        { asset: '금 (GLD)', direction: 'up', reason: '실질금리 하락', magnitude: 'strong' },
        { asset: 'EM 주식', direction: 'up', reason: '달러 약세 + 자본 유입', magnitude: 'moderate' },
      ],
    },
    unrate: {
      beat: [ // lower unemployment = beat for employment, hawkish
        { asset: '미 국채 금리', direction: 'up', reason: '고용 강세 → 임금 인플레 우려', magnitude: 'moderate' },
        { asset: '달러 (DXY)', direction: 'up', reason: '경제 활력 → 달러 수요', magnitude: 'weak' },
      ],
      miss: [
        { asset: '미 국채 금리', direction: 'down', reason: '고용 약화 → 인하 기대', magnitude: 'moderate' },
        { asset: '금 (GLD)', direction: 'up', reason: '경기 우려 → 안전자산', magnitude: 'weak' },
      ],
    },
  };
  const def = cascades[id];
  if (!def) return [];
  return surprise === 'beat' ? def.beat : def.miss;
}

// ── Static fallback data ──────────────────────────────────────────────────────
// Used when FRED is unavailable; all values as of 2026-04-16
const STATIC: Record<string, Omit<MacroIndicator, 'cascade' | 'liveData'>> = {
  cpi: {
    id: 'cpi', name: 'CPI (Consumer Price Index)', nameKo: '소비자 물가지수',
    category: 'inflation', actual: 2.4, forecast: 2.5, previous: 2.8, unit: '%YoY',
    releaseDate: '2026-04-10', nextRelease: '2026-05-13', surprise: 'miss',
    rateImpact: 'dovish', rateImpactKo: '비둘기파 (인하 기대↑)',
    summary: '3월 CPI 2.4%로 예상(2.5%)보다 낮게 발표. 에너지·중고차 하락 주도.',
  },
  pce: {
    id: 'pce', name: 'PCE Price Index (Core)', nameKo: '근원 개인소비지출 물가',
    category: 'inflation', actual: 2.6, forecast: 2.6, previous: 2.7, unit: '%YoY',
    releaseDate: '2026-03-28', nextRelease: '2026-04-30', surprise: 'inline',
    rateImpact: 'neutral', rateImpactKo: '중립',
    summary: 'Fed 선호 인플레 지표 예상치 부합. 2.6%로 목표 2%에 아직 거리 있음.',
  },
  nfp: {
    id: 'nfp', name: 'Non-Farm Payrolls', nameKo: '비농업 고용지수',
    category: 'employment', actual: 228, forecast: 140, previous: 117, unit: '천명',
    releaseDate: '2026-04-04', nextRelease: '2026-05-02', surprise: 'beat',
    rateImpact: 'hawkish', rateImpactKo: '매파적 (긴축 여력 유지)',
    summary: '3월 NFP 228K로 예상(140K) 대폭 상회. 노동시장 강세로 6월 인하 전망 약화.',
  },
  fomc: {
    id: 'fomc', name: 'FOMC Rate Decision', nameKo: 'FOMC 금리 결정',
    category: 'monetary', actual: 4.5, forecast: 4.5, previous: 4.5, unit: '%',
    releaseDate: '2026-03-19', nextRelease: '2026-05-07', surprise: 'inline',
    rateImpact: 'neutral', rateImpactKo: '동결 (불확실성 유지)',
    summary: '3월 FOMC 동결 결정. 점도표 연내 2회 인하 유지. Powell "데이터 의존" 강조.',
  },
  gdp: {
    id: 'gdp', name: 'GDP Growth Rate (Q4)', nameKo: 'GDP 성장률',
    category: 'growth', actual: 2.4, forecast: 2.3, previous: 3.1, unit: '%QoQ SAAR',
    releaseDate: '2026-03-27', nextRelease: '2026-04-30', surprise: 'beat',
    rateImpact: 'hawkish', rateImpactKo: '경기 강세 → 긴축 여력',
    summary: 'Q4 GDP 확정치 2.4%, 속보치 상회. 소비 지출·민간투자 견조.',
  },
  ism: {
    id: 'ism', name: 'ISM Manufacturing PMI', nameKo: 'ISM 제조업 PMI',
    category: 'growth', actual: 49.0, forecast: 49.5, previous: 50.3, unit: '지수',
    releaseDate: '2026-04-01', nextRelease: '2026-05-01', surprise: 'miss',
    rateImpact: 'dovish', rateImpactKo: '경기 둔화 → 인하 기대',
    summary: '4월 ISM 제조 49.0으로 50 기준선 하회. 관세 불확실성 영향.',
  },
  retail: {
    id: 'retail', name: 'Retail Sales', nameKo: '소매 판매',
    category: 'growth', actual: -1.1, forecast: -1.3, previous: 0.7, unit: '%MoM',
    releaseDate: '2026-04-16', nextRelease: '2026-05-15', surprise: 'beat',
    rateImpact: 'neutral', rateImpactKo: '예상보다 양호',
    summary: '3월 소매판매 -1.1%로 예상(-1.3%) 소폭 상회. 소비 둔화 흐름.',
  },
  ppi: {
    id: 'ppi', name: 'PPI (Producer Price Index)', nameKo: '생산자 물가지수',
    category: 'inflation', actual: 2.7, forecast: 3.3, previous: 3.2, unit: '%YoY',
    releaseDate: '2026-04-11', nextRelease: '2026-05-14', surprise: 'miss',
    rateImpact: 'dovish', rateImpactKo: '비둘기파 (물가 압력 완화)',
    summary: '3월 PPI 2.7%로 예상(3.3%) 크게 하회. 에너지·서비스 원가 하락.',
  },
  unrate: {
    id: 'unrate', name: 'Unemployment Rate', nameKo: '실업률',
    category: 'employment', actual: 4.2, forecast: 4.1, previous: 4.1, unit: '%',
    releaseDate: '2026-04-04', nextRelease: '2026-05-02', surprise: 'miss',
    rateImpact: 'dovish', rateImpactKo: '비둘기파',
    summary: '실업률 4.2% — 고용시장 소폭 냉각 신호.',
  },
};

// ── FRED static forecasts (consensus at time of last update) ──────────────────
// FRED gives actual values; we keep forecasts as static consensus
const FORECASTS: Record<string, { forecast: number; nextRelease: string }> = {
  cpi:    { forecast: 2.5,   nextRelease: '2026-05-13' },
  pce:    { forecast: 2.6,   nextRelease: '2026-04-30' },
  nfp:    { forecast: 140,   nextRelease: '2026-05-02' },
  gdp:    { forecast: 2.3,   nextRelease: '2026-04-30' },
  ppi:    { forecast: 3.3,   nextRelease: '2026-05-14' },
  retail: { forecast: -1.3,  nextRelease: '2026-05-15' },
  unrate: { forecast: 4.1,   nextRelease: '2026-05-02' },
};

// ── Main GET ──────────────────────────────────────────────────────────────────
export async function GET() {
  const redis = createRedis();
  const key = cacheKey();

  if (redis) {
    try {
      const cached = await redis.get<object>(key);
      if (cached) return NextResponse.json(cached, { headers: CDN_HEADERS });
    } catch (e) { logger.warn('macro-indicators', 'cache_read_error', { error: e }); }
  }

  // Fetch FRED data in parallel
  const [
    fredCPI, fredCoreCPI, fredPCE, fredCorePCE,
    fredNFP, fredGDP, fredPPI, fredRetail, fredUnrate,
    fredISM, fredFOMCUpper, fredFOMCLower,
    yieldCurve,
  ] = await Promise.allSettled([
    fetchYoY('CPIAUCSL'),
    fetchYoY('CPILFESL'),
    fetchYoY('PCEPI'),
    fetchYoY('PCEPILFE'),
    fetchMoMChange('PAYEMS'),
    fetchLatest('A191RL1Q225SBEA'),  // real GDP QoQ SAAR %
    fetchYoY('PPIACO'),
    fetchMoMPct('RSAFS'),
    fetchLatest('UNRATE'),
    fetchLatest('NAPM'),             // ISM Manufacturing PMI
    fetchLatest('DFEDTARU'),         // Fed funds upper bound
    fetchLatest('DFEDTARL'),         // Fed funds lower bound
    fetchYieldCurve(),
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
      nextRelease: FORECASTS.cpi.nextRelease,
      surprise, rateImpact: ri.impact, rateImpactKo: ri.ko,
      summary: actual !== null
        ? `CPI ${actual.toFixed(1)}%YoY (예상 ${fc}%, 이전 ${previous?.toFixed(1) ?? '?'}%). ${actual < fc ? '예상 하회 — 인하 기대 강화.' : actual > fc ? '예상 상회 — 긴축 압력.' : '예상 부합.'}`
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
      nextRelease: FORECASTS.pce.nextRelease,
      surprise, rateImpact: ri.impact, rateImpactKo: ri.ko,
      summary: actual !== null
        ? `근원 PCE ${actual.toFixed(1)}%YoY (예상 ${fc}%). Fed 목표 2%${actual > 2.5 ? '에 아직 거리 있음' : '에 근접 중'}.`
        : base.summary,
      cascade: buildCascade('pce', surprise),
      liveData: !!pceData,
    });
  }

  // NFP
  const nfpData = get(fredNFP);
  {
    const base = STATIC.nfp;
    const actual = nfpData ? Math.round(nfpData.value) : base.actual;
    const previous = nfpData ? Math.round(nfpData.previous) : base.previous;
    const fc = FORECASTS.nfp.forecast;
    const surprise = classify(actual, fc, true);
    const ri = rateImpact('nfp', surprise);
    indicators.push({
      ...base,
      actual, previous, forecast: fc,
      releaseDate: nfpData?.date ?? base.releaseDate,
      nextRelease: FORECASTS.nfp.nextRelease,
      surprise, rateImpact: ri.impact, rateImpactKo: ri.ko,
      summary: actual !== null
        ? `NFP ${actual.toLocaleString()}K (예상 ${fc}K). ${actual > fc ? '고용 강세 — 인하 시기 후퇴 가능성.' : '고용 둔화 — 인하 기대 강화.'}`
        : base.summary,
      cascade: buildCascade('nfp', surprise),
      liveData: !!nfpData,
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
      actual: actualUpper,
      previous: base.previous,
      forecast: base.forecast,
      releaseDate: fomcUpper?.date ?? base.releaseDate,
      surprise, rateImpact: base.rateImpact, rateImpactKo: base.rateImpactKo,
      summary: fomcUpper
        ? `현재 기준금리 ${actualLower}~${actualUpper}% (목표 중간값 ${midRate}%). 다음 FOMC: ${base.nextRelease}.`
        : base.summary,
      cascade: buildCascade('fomc', surprise),
      liveData: !!fomcUpper,
    });
  }

  // GDP
  const gdpData = get(fredGDP);
  {
    const base = STATIC.gdp;
    const actual = gdpData ? parseFloat(gdpData.value.toFixed(1)) : base.actual;
    const fc = FORECASTS.gdp.forecast;
    const surprise = classify(actual, fc, true);
    const ri = rateImpact('gdp', surprise);
    indicators.push({
      ...base,
      actual, previous: base.previous, forecast: fc,
      releaseDate: gdpData?.date ?? base.releaseDate,
      nextRelease: FORECASTS.gdp.nextRelease,
      surprise, rateImpact: ri.impact, rateImpactKo: ri.ko,
      summary: actual !== null
        ? `GDP ${actual}% QoQ SAAR (예상 ${fc}%). ${actual > 2 ? '성장세 견조.' : actual > 0 ? '성장 둔화 중.' : '마이너스 성장 경고.'}`
        : base.summary,
      cascade: buildCascade('gdp', surprise),
      liveData: !!gdpData,
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
        ? `ISM PMI ${actual} (예상 ${fc}). ${actual >= 50 ? '제조업 확장 국면.' : '제조업 수축 — 경기 둔화 우려.'}`
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
      nextRelease: FORECASTS.retail.nextRelease,
      surprise, rateImpact: ri.impact, rateImpactKo: ri.ko,
      summary: actual !== null
        ? `소매판매 ${actual > 0 ? '+' : ''}${actual}%MoM (예상 ${fc > 0 ? '+' : ''}${fc}%). ${actual > 0 ? '소비 회복 신호.' : '소비 위축 흐름.'}`
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
      nextRelease: FORECASTS.ppi.nextRelease,
      surprise, rateImpact: ri.impact, rateImpactKo: ri.ko,
      summary: actual !== null
        ? `PPI ${actual.toFixed(1)}%YoY (예상 ${fc}%). ${actual < fc ? 'CPI 안정 선행 신호.' : 'CPI 상승 압력 예고.'}`
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
      nextRelease: FORECASTS.unrate.nextRelease,
      surprise, rateImpact: ri.impact, rateImpactKo: ri.ko,
      summary: actual !== null
        ? `실업률 ${actual}% (예상 ${fc}%, 이전 ${base.previous}%). ${actual > fc ? '고용시장 냉각 — 인하 압력.' : '고용 견조 유지.'}`
        : base.summary,
      cascade: buildCascade('unrate', surprise),
      liveData: !!unrateData,
    });
  }

  const yc = get(yieldCurve as PromiseSettledResult<{ points: YieldPoint[]; inverted: boolean; spread10y2y: number | null } | null>) ?? { points: [], inverted: false, spread10y2y: null };
  const response = { indicators, yieldCurve: yc, updatedAt: new Date().toISOString() };

  if (redis) {
    try {
      await loggedRedisSet(redis, 'api.macro-indicators', key, response, { ex: 25 * 60 * 60 });
      logger.info('macro-indicators', 'cache_saved', { indicators: indicators.length });
    } catch (e) { logger.warn('macro-indicators', 'cache_write_error', { error: e }); }
  }

  return NextResponse.json(response, { headers: CDN_HEADERS });
}
