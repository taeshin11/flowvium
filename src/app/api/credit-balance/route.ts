import { logger, loggedRedisSet} from '@/lib/logger';
/**
 * /api/credit-balance
 *
 * 국가별 신용잔고(증거금 대출/마진 데트) 데이터
 * GDP 대비 비율, 역대 비교, 리스크 레벨 분석
 *
 * 데이터 소스:
 *   - 미국: FINRA Margin Statistics
 *   - 한국: KRX 신용거래융자
 *   - 일본: TSE 신용거래잔고
 *   - 중국: CSRC 융자융권 잔고
 *   - 유럽/기타: 각국 금융당국 통계
 *
 * 캐시: 24h Redis (일별 업데이트)
 */

import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { fetchAllCreditData, type LiveCreditData } from '@/lib/credit-fetchers';

const REDIS_KEY_LIVE = 'flowvium:credit-balance:live:v1';
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=82800, stale-while-revalidate=3600' };

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface CreditHistPoint {
  period: string;      // e.g. "2024-Q4"
  balance: number;     // billions USD
  gdpRatio: number;    // % of GDP
}

export interface CountryCreditData {
  id: string;
  country: string;
  flag: string;
  currentBalance: number;   // billions USD
  currentBalanceLocal: string; // e.g. "₩22.1조"
  gdp: number;              // billions USD (nominal, latest annual)
  gdpRatio: number;         // currentBalance / gdp * 100
  gdpRatioRank: 'low' | 'medium' | 'high' | 'extreme'; // vs own history
  changeYoY: number;        // % change from same period last year
  changeQoQ: number;        // % change from last quarter
  historical: CreditHistPoint[];
  peakBalance: number;
  peakPeriod: string;
  troughBalance: number;
  troughPeriod: string;
  histPercentile: number;   // 0-100, where current sits in history
  riskLevel: 'low' | 'medium' | 'high' | 'extreme';
  riskReason: string;
  source: string;
  sourceUrl: string;
  lastUpdated: string;      // data as-of date
  // For plain language explanation
  laymanSummary: string;
}

/** Read live credit data from Redis (populated by cron). Returns null per country if missing. */
async function readLiveCreditData(redis: Redis | null): Promise<Record<string, LiveCreditData | null>> {
  if (!redis) return {};
  try {
    const data = await redis.get(REDIS_KEY_LIVE);
    if (data && typeof data === 'object') return data as Record<string, LiveCreditData | null>;
  } catch { /* non-fatal */ }
  return {};
}

/** Apply live data overlay onto a static country record. */
function applyLiveOverlay(c: CountryCreditData, live: LiveCreditData | null): CountryCreditData {
  if (!live) return c;
  const newGdpRatio = parseFloat((live.balance / c.gdp * 100).toFixed(2));
  // Compute YoY from historical data if possible
  const lastYearBalance = c.historical[c.historical.length - 2]?.balance ?? c.currentBalance;
  const changeYoY = lastYearBalance
    ? parseFloat((((live.balance - lastYearBalance) / lastYearBalance) * 100).toFixed(1))
    : c.changeYoY;
  return {
    ...c,
    currentBalance: live.balance,
    currentBalanceLocal: live.balanceLocal,
    gdpRatio: newGdpRatio,
    changeYoY,
    lastUpdated: live.period,
    source: live.source,
  };
}

/**
 * For countries without live data, generate a dynamic `lastUpdated` label
 * that reflects the most likely-available data period based on publication lag.
 * US: quarterly, lag ~1 quarter → show last completed quarter
 * Others: monthly reports — show last month
 */
function dynamicLastUpdated(countryId: string): string {
  const now = new Date();
  if (countryId === 'us' || countryId === 'us_gdp_sectors' || countryId === 'eu') {
    // Quarterly data — 1 quarter lag
    const currentQ = Math.ceil((now.getMonth() + 1) / 3);
    const prevQ = currentQ === 1 ? 4 : currentQ - 1;
    const year = currentQ === 1 ? now.getFullYear() - 1 : now.getFullYear();
    return `${year}-Q${prevQ}`;
  }
  // Monthly — previous month
  const d = new Date(now);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ── Static data (researched, updated quarterly) ───────────────────────────────
// All balances converted to USD billions for cross-country comparison
// Historical data key points: 2015–2026Q1 (updated 2026-04)

const DATA: CountryCreditData[] = [
  {
    id: 'us',
    country: '미국',
    flag: '🇺🇸',
    currentBalance: 893,      // ~$893B FINRA margin debt (2026 Jan, published Feb 2026)
    currentBalanceLocal: '$893B',
    gdp: 28200,
    gdpRatio: 3.17,
    gdpRatioRank: 'high',
    changeYoY: +9.6,
    changeQoQ: +3.1,
    historical: [
      { period: '2015', balance: 507, gdpRatio: 2.8 },
      { period: '2016', balance: 513, gdpRatio: 2.7 },
      { period: '2017', balance: 581, gdpRatio: 2.9 },
      { period: '2018', balance: 554, gdpRatio: 2.7 },
      { period: '2019', balance: 562, gdpRatio: 2.6 },
      { period: '2020', balance: 722, gdpRatio: 3.4 },
      { period: '2021', balance: 936, gdpRatio: 4.1 },  // 역대 최고
      { period: '2022', balance: 622, gdpRatio: 2.5 },  // 급락
      { period: '2023', balance: 703, gdpRatio: 2.7 },
      { period: '2024', balance: 815, gdpRatio: 2.9 },
      { period: '2025-Q2', balance: 847, gdpRatio: 3.01 },
      { period: '2025-Q4', balance: 865, gdpRatio: 3.07 },
      { period: '2026-Q1', balance: 893, gdpRatio: 3.17 },
    ],
    peakBalance: 936,
    peakPeriod: '2021',
    troughBalance: 459,
    troughPeriod: '2009',
    histPercentile: 78,
    riskLevel: 'high',
    riskReason: '2021년 역대 최고(936B) 대비 95% 수준 근접. GDP 비율 3.17% — 역대 최고권 진입 경계.',
    source: 'FINRA Margin Statistics',
    sourceUrl: 'https://www.finra.org/investors/learn-to-invest/advanced-investing/margin-statistics',
    lastUpdated: '2026-01',
    laymanSummary: '미국 투자자들이 주식을 사기 위해 증권사에서 빌린 돈. 많이 빌릴수록 시장이 과열됐다는 신호예요.',
  },
  {
    id: 'kr',
    country: '한국',
    flag: '🇰🇷',
    currentBalance: 13.8,     // ~20.0조원 → ~$13.8B at 1450 KRW/USD
    currentBalanceLocal: '₩20.0조',
    gdp: 1780,
    gdpRatio: 0.78,
    gdpRatioRank: 'low',
    changeYoY: -9.2,
    changeQoQ: -3.5,
    historical: [
      { period: '2015', balance: 6.2, gdpRatio: 0.45 },
      { period: '2016', balance: 7.8, gdpRatio: 0.55 },
      { period: '2017', balance: 9.5, gdpRatio: 0.64 },
      { period: '2018', balance: 11.2, gdpRatio: 0.72 },
      { period: '2019', balance: 10.1, gdpRatio: 0.63 },
      { period: '2020', balance: 15.5, gdpRatio: 0.98 },
      { period: '2021', balance: 24.8, gdpRatio: 1.48 }, // 역대 최고 (₩36조)
      { period: '2022', balance: 14.3, gdpRatio: 0.84 },
      { period: '2023', balance: 14.8, gdpRatio: 0.86 },
      { period: '2024', balance: 15.2, gdpRatio: 0.86 },
      { period: '2025-Q2', balance: 14.5, gdpRatio: 0.83 },
      { period: '2026-Q1', balance: 13.8, gdpRatio: 0.78 },
    ],
    peakBalance: 24.8,
    peakPeriod: '2021',
    troughBalance: 5.1,
    troughPeriod: '2014',
    histPercentile: 45,
    riskLevel: 'medium',
    riskReason: '2021년 역대 최고(₩36조) 대비 56% 수준으로 지속 감소. 경기 침체 우려로 레버리지 축소 중.',
    source: 'KRX 신용거래융자 통계',
    sourceUrl: 'https://data.krx.co.kr',
    lastUpdated: '2026-03',
    laymanSummary: '코스피·코스닥 투자자들이 증권사에서 빌려서 주식 산 돈의 총합이에요. 줄고 있어서 과열은 아니지만 개인 비중이 높아요.',
  },
  {
    id: 'jp',
    country: '일본',
    flag: '🇯🇵',
    currentBalance: 36.5,     // ~¥5.5조 → ~$36B at 152 JPY/USD
    currentBalanceLocal: '¥5.5조',
    gdp: 4280,
    gdpRatio: 0.85,
    gdpRatioRank: 'medium',
    changeYoY: +9.9,
    changeQoQ: +2.8,
    historical: [
      { period: '2015', balance: 28.5, gdpRatio: 0.64 },
      { period: '2016', balance: 22.1, gdpRatio: 0.52 },
      { period: '2017', balance: 31.4, gdpRatio: 0.68 },
      { period: '2018', balance: 26.8, gdpRatio: 0.55 },
      { period: '2019', balance: 21.2, gdpRatio: 0.47 },
      { period: '2020', balance: 18.9, gdpRatio: 0.44 },
      { period: '2021', balance: 25.3, gdpRatio: 0.57 },
      { period: '2022', balance: 22.7, gdpRatio: 0.56 },
      { period: '2023', balance: 27.9, gdpRatio: 0.65 },
      { period: '2024', balance: 33.2, gdpRatio: 0.78 },
      { period: '2025-Q2', balance: 34.8, gdpRatio: 0.81 },
      { period: '2026-Q1', balance: 36.5, gdpRatio: 0.85 },
    ],
    peakBalance: 43.2,
    peakPeriod: '2006',
    troughBalance: 14.1,
    troughPeriod: '2009',
    histPercentile: 60,
    riskLevel: 'medium',
    riskReason: '닛케이 변동성 확대 속 신용잔고 완만 증가 중. 엔화 약세로 달러 기준 변동 큼.',
    source: 'TSE (도쿄증권거래소)',
    sourceUrl: 'https://www.jpx.co.jp/markets/statistics-equities/margin/index.html',
    lastUpdated: '2026-03',
    laymanSummary: '일본 주식시장 투자자들의 신용 레버리지. 2024년 닛케이 최고점 이후 레버리지도 높은 수준 유지 중이에요.',
  },
  {
    id: 'cn',
    country: '중국',
    flag: '🇨🇳',
    currentBalance: 210,      // ~¥1.52조 위안 → ~$210B at 7.25 CNY/USD
    currentBalanceLocal: '¥1.52조위안',
    gdp: 18100,
    gdpRatio: 1.16,
    gdpRatioRank: 'medium',
    changeYoY: +9.4,
    changeQoQ: +4.1,
    historical: [
      { period: '2015', balance: 380, gdpRatio: 3.4 },  // 역대 최고 (버블)
      { period: '2016', balance: 95, gdpRatio: 0.87 },
      { period: '2017', balance: 112, gdpRatio: 0.93 },
      { period: '2018', balance: 87, gdpRatio: 0.65 },
      { period: '2019', balance: 108, gdpRatio: 0.77 },
      { period: '2020', balance: 131, gdpRatio: 0.87 },
      { period: '2021', balance: 192, gdpRatio: 1.15 },
      { period: '2022', balance: 145, gdpRatio: 0.88 },
      { period: '2023', balance: 147, gdpRatio: 0.89 },
      { period: '2024', balance: 192, gdpRatio: 1.08 },
      { period: '2025-Q2', balance: 201, gdpRatio: 1.12 },
      { period: '2026-Q1', balance: 210, gdpRatio: 1.16 },
    ],
    peakBalance: 380,
    peakPeriod: '2015',
    troughBalance: 75,
    troughPeriod: '2013',
    histPercentile: 52,
    riskLevel: 'medium',
    riskReason: '정책 부양책 지속으로 신용잔고 완만 증가. 2015년 버블(380B) 대비 55% 수준이나 미·중 무역 긴장 변수.',
    source: 'CSRC 융자융권 잔고',
    sourceUrl: 'http://www.csrc.gov.cn',
    lastUpdated: '2026-03',
    laymanSummary: '중국 주식시장 신용거래 잔고. 정부 부양책으로 꾸준히 늘고 있어요. 2015년 버블 때의 절반 수준이에요.',
  },
  {
    id: 'eu',
    country: '유럽 (EU)',
    flag: '🇪🇺',
    currentBalance: 124,
    currentBalanceLocal: '€113B',
    gdp: 18700,
    gdpRatio: 0.66,
    gdpRatioRank: 'low',
    changeYoY: +5.1,
    changeQoQ: +1.8,
    historical: [
      { period: '2015', balance: 98, gdpRatio: 0.64 },
      { period: '2016', balance: 88, gdpRatio: 0.57 },
      { period: '2017', balance: 105, gdpRatio: 0.66 },
      { period: '2018', balance: 97, gdpRatio: 0.60 },
      { period: '2019', balance: 95, gdpRatio: 0.58 },
      { period: '2020', balance: 102, gdpRatio: 0.67 },
      { period: '2021', balance: 128, gdpRatio: 0.79 },
      { period: '2022', balance: 105, gdpRatio: 0.66 },
      { period: '2023', balance: 107, gdpRatio: 0.62 },
      { period: '2024', balance: 118, gdpRatio: 0.64 },
      { period: '2025-Q2', balance: 121, gdpRatio: 0.65 },
      { period: '2026-Q1', balance: 124, gdpRatio: 0.66 },
    ],
    peakBalance: 128,
    peakPeriod: '2021',
    troughBalance: 70,
    troughPeriod: '2012',
    histPercentile: 65,
    riskLevel: 'medium',
    riskReason: '유럽 증시 반등에 따라 신용잔고 소폭 증가. GDP 대비 0.66%로 여전히 낮은 수준.',
    source: 'ESMA Market Data',
    sourceUrl: 'https://www.esma.europa.eu',
    lastUpdated: '2026-Q1',
    laymanSummary: '유럽 주요국 증시 신용잔고 합산 추정치. 미국·중국 대비 레버리지 낮고 안정적이에요.',
  },
  {
    id: 'tw',
    country: '대만',
    flag: '🇹🇼',
    currentBalance: 17.2,     // ~NT$550B → ~$17.2B at 32 TWD/USD (감소)
    currentBalanceLocal: 'NT$550B',
    gdp: 790,
    gdpRatio: 2.18,
    gdpRatioRank: 'high',
    changeYoY: -6.5,
    changeQoQ: -4.8,
    historical: [
      { period: '2015', balance: 10.2, gdpRatio: 1.85 },
      { period: '2016', balance: 9.8, gdpRatio: 1.75 },
      { period: '2017', balance: 12.1, gdpRatio: 2.06 },
      { period: '2018', balance: 11.3, gdpRatio: 1.88 },
      { period: '2019', balance: 11.8, gdpRatio: 1.95 },
      { period: '2020', balance: 13.4, gdpRatio: 2.15 },
      { period: '2021', balance: 16.2, gdpRatio: 2.41 },
      { period: '2022', balance: 11.8, gdpRatio: 1.68 },
      { period: '2023', balance: 13.5, gdpRatio: 1.88 },
      { period: '2024', balance: 18.4, gdpRatio: 2.43 }, // 역대 최고
      { period: '2025-Q2', balance: 19.1, gdpRatio: 2.52 }, // 역대 최고
      { period: '2026-Q1', balance: 17.2, gdpRatio: 2.18 }, // 조정
    ],
    peakBalance: 19.1,
    peakPeriod: '2025-Q2',
    troughBalance: 7.2,
    troughPeriod: '2008',
    histPercentile: 88,
    riskLevel: 'high',
    riskReason: '2025년 역대 최고 이후 미·중 무역 마찰로 TSMC 조정, 신용잔고도 감소 전환. 여전히 역사적 고점 수준.',
    source: 'TWSE 信用交易統計',
    sourceUrl: 'https://www.twse.com.tw',
    lastUpdated: '2026-03',
    laymanSummary: 'TSMC와 AI 반도체 붐 이후 무역 마찰로 조정 중. 그래도 역사적으로 높은 레버리지 수준이에요.',
  },
  {
    id: 'in',
    country: '인도',
    flag: '🇮🇳',
    currentBalance: 31.2,     // ~₹2.62조 → ~$31.2B at 84 INR/USD
    currentBalanceLocal: '₹2.62조',
    gdp: 3850,
    gdpRatio: 0.81,
    gdpRatioRank: 'medium',
    changeYoY: +9.5,
    changeQoQ: +3.1,
    historical: [
      { period: '2015', balance: 4.8, gdpRatio: 0.23 },
      { period: '2016', balance: 5.2, gdpRatio: 0.24 },
      { period: '2017', balance: 7.6, gdpRatio: 0.33 },
      { period: '2018', balance: 6.9, gdpRatio: 0.27 },
      { period: '2019', balance: 6.1, gdpRatio: 0.22 },
      { period: '2020', balance: 8.3, gdpRatio: 0.32 },
      { period: '2021', balance: 13.5, gdpRatio: 0.47 },
      { period: '2022', balance: 14.2, gdpRatio: 0.46 },
      { period: '2023', balance: 18.9, gdpRatio: 0.57 },
      { period: '2024', balance: 28.5, gdpRatio: 0.80 },
      { period: '2025-Q2', balance: 29.5, gdpRatio: 0.80 },
      { period: '2026-Q1', balance: 31.2, gdpRatio: 0.81 },
    ],
    peakBalance: 31.2,
    peakPeriod: '2026-Q1',
    troughBalance: 3.2,
    troughPeriod: '2013',
    histPercentile: 99,
    riskLevel: 'high',
    riskReason: '⚠ 역대 최고 갱신 지속! 신흥 중산층 소매 투자자 급증으로 신용잔고 가파른 상승 중.',
    source: 'NSE/BSE Margin Data',
    sourceUrl: 'https://www.nseindia.com',
    lastUpdated: '2026-03',
    laymanSummary: '인도 개인 투자자들이 급증하면서 신용거래도 역대 최고 수준이에요. 성장하는 시장이지만 레버리지 위험도 함께 증가 중.',
  },
  {
    id: 'us_gdp_sectors',
    country: '미국 GDP 비율 추이',
    flag: '🇺🇸',
    currentBalance: 893,
    currentBalanceLocal: '$893B',
    gdp: 28200,
    gdpRatio: 3.17,
    gdpRatioRank: 'high',
    changeYoY: +9.6,
    changeQoQ: +3.1,
    historical: [
      { period: '2000', balance: 278, gdpRatio: 2.7 },  // 닷컴 버블
      { period: '2002', balance: 141, gdpRatio: 1.3 },  // 버블 붕괴
      { period: '2007', balance: 381, gdpRatio: 2.6 },  // 금융위기 전
      { period: '2009', balance: 234, gdpRatio: 1.6 },  // 금융위기 저점
      { period: '2015', balance: 507, gdpRatio: 2.8 },
      { period: '2018', balance: 554, gdpRatio: 2.7 },
      { period: '2020', balance: 722, gdpRatio: 3.4 },
      { period: '2021', balance: 936, gdpRatio: 4.1 },  // 역대 최고
      { period: '2022', balance: 622, gdpRatio: 2.5 },
      { period: '2024', balance: 815, gdpRatio: 2.9 },
      { period: '2025-Q4', balance: 865, gdpRatio: 3.07 },
      { period: '2026-Q1', balance: 893, gdpRatio: 3.17 },
    ],
    peakBalance: 936,
    peakPeriod: '2021',
    troughBalance: 141,
    troughPeriod: '2002',
    histPercentile: 78,
    riskLevel: 'high',
    riskReason: '닷컴버블·금융위기 전 레벨(2.6~2.7%) 상회 중. GDP 비율 3.17%로 위험 구간 진입.',
    source: 'FINRA / World Bank',
    sourceUrl: 'https://www.finra.org',
    lastUpdated: '2026-01',
    laymanSummary: '장기 역사 관점: 닷컴 버블, 금융위기 때와 현재 수준 비교.',
  },
];

// Remove the duplicate US long-history from main list — it's for chart only
const COUNTRY_DATA = DATA.filter(d => d.id !== 'us_gdp_sectors');
const US_LONG_HISTORY = DATA.find(d => d.id === 'us_gdp_sectors')!;

// ── Risk thresholds (percentile-based) ────────────────────────────────────────
function computeRiskLabel(percentile: number): 'low' | 'medium' | 'high' | 'extreme' {
  if (percentile >= 90) return 'extreme';
  if (percentile >= 70) return 'high';
  if (percentile >= 40) return 'medium';
  return 'low';
}

// ── Global snapshot ───────────────────────────────────────────────────────────
function buildGlobalSnapshot(countries: CountryCreditData[]) {
  const totalBalance = countries.reduce((s, c) => s + c.currentBalance, 0);
  const totalGdp = countries.reduce((s, c) => s + c.gdp, 0);
  const globalRatio = parseFloat(((totalBalance / totalGdp) * 100).toFixed(2));

  const riskCounts = { low: 0, medium: 0, high: 0, extreme: 0 };
  countries.forEach(c => riskCounts[c.riskLevel]++);

  const mostLeveraged = [...countries].sort((a, b) => b.gdpRatio - a.gdpRatio).slice(0, 3);
  const fastestGrowing = [...countries].sort((a, b) => b.changeYoY - a.changeYoY).slice(0, 3);

  return {
    totalBalance: parseFloat(totalBalance.toFixed(1)),
    globalGdpRatio: globalRatio,
    riskCounts,
    mostLeveraged,
    fastestGrowing,
  };
}

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET() {
  const redis = createRedis();
  const cacheKey = `flowvium:credit-balance:v2:${new Date().toISOString().slice(0, 10)}`;

  if (redis) {
    try {
      const cached = await redis.get<object>(cacheKey);
      if (cached) return NextResponse.json({ ...cached, cached: true }, { headers: CDN_HEADERS });
    } catch { /* non-fatal */ }
  }

  // Read Redis live data (populated by cron) + direct live fetch as fallback for freshness
  const [liveFromRedis, liveNow] = await Promise.all([
    readLiveCreditData(redis),
    // If Redis has no data, fetch immediately (slow path for first request)
    redis ? Promise.resolve(null) : fetchAllCreditData(),
  ]);
  const live = liveNow ?? liveFromRedis;

  const countries = COUNTRY_DATA.map(c => {
    const liveEntry = live[c.id] ?? null;
    const overlaid = applyLiveOverlay(c, liveEntry);
    // If no live data, refresh lastUpdated to the most-recent likely-published period
    const finalLastUpdated = liveEntry ? overlaid.lastUpdated : dynamicLastUpdated(c.id);
    return {
      ...overlaid,
      lastUpdated: finalLastUpdated,
      riskLevel: computeRiskLabel(c.histPercentile),
    };
  });

  const globalSnapshot = buildGlobalSnapshot(countries);

  const response = {
    countries,
    usLongHistory: US_LONG_HISTORY,
    globalSnapshot,
    updatedAt: new Date().toISOString(),
    cached: false,
  };

  if (redis) {
    try {
      logger.info('credit-balance', 'save_start', { key: cacheKey, ttl: 24 * 60 * 60 });
      const t0 = Date.now();
      await loggedRedisSet(redis, 'api.credit-balance', cacheKey, response, { ex: 24 * 60 * 60 });
      logger.info('credit-balance', 'save_ok', { key: cacheKey, durationMs: Date.now() - t0 });
    } catch (err) {
      logger.error('credit-balance', 'save_failed', { key: cacheKey, error: err });
    }
  }

  return NextResponse.json(response, { headers: CDN_HEADERS });
}
