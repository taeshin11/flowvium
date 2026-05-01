// @static-data-warning: 이 파일의 byCountry/byAsset 데이터는 정적 fallback입니다.
// live API (fear-greed/route.ts) 가 이 데이터를 override하므로 코드 변경 불필요.
// 직접 수정 시 route.ts의 override 로직을 함께 확인하세요.
/**
 * Fear & Greed data — by country and by asset class.
 * Updated: daily via scripts/scrapers/fear-greed-calc.ts (TODO)
 * Currently: static baseline (2026-04-26)
 */

export interface FearGreedEntry {
  id: string;
  label: string;
  flag?: string;
  score: number; // 0–100
  trend: 'up' | 'down' | 'neutral'; // 7-day direction
  driver: string; // key reason
  prevScore?: number; // 7 days ago
}

export type FearGreedLevel = 'extreme-fear' | 'fear' | 'neutral' | 'greed' | 'extreme-greed';

export function getLevel(score: number): FearGreedLevel {
  if (score <= 24) return 'extreme-fear';
  if (score <= 44) return 'fear';
  if (score <= 55) return 'neutral';
  if (score <= 74) return 'greed';
  return 'extreme-greed';
}

export const levelLabels: Record<FearGreedLevel, { en: string; ko: string; color: string; bg: string; border: string }> = {
  'extreme-fear': { en: 'Extreme Fear', ko: '극단적 공포', color: 'text-red-600',    bg: 'bg-red-50',    border: 'border-red-200' },
  'fear':         { en: 'Fear',         ko: '공포',       color: 'text-orange-500', bg: 'bg-orange-50', border: 'border-orange-200' },
  'neutral':      { en: 'Neutral',      ko: '중립',       color: 'text-yellow-600', bg: 'bg-yellow-50', border: 'border-yellow-200' },
  'greed':        { en: 'Greed',        ko: '탐욕',       color: 'text-green-500',  bg: 'bg-green-50',  border: 'border-green-200' },
  'extreme-greed':{ en: 'Extreme Greed',ko: '극단적 탐욕',color: 'text-emerald-600',bg: 'bg-emerald-50',border: 'border-emerald-200' },
};

// ── By Country ────────────────────────────────────────────────────────────────
export const fearGreedByCountry: FearGreedEntry[] = [
  {
    id: 'us',
    label: 'United States',
    flag: '🇺🇸',
    score: 66,
    prevScore: 32,
    trend: 'up',
    driver: 'Trade war de-escalation + Mag7 earnings beats. VIX at 18. Risk-on return.',
  },
  {
    id: 'korea',
    label: '한국 (Korea)',
    flag: '🇰🇷',
    score: 48,
    prevScore: 21,
    trend: 'up',
    driver: 'KOSPI recovery from lows. Samsung HBM cycle bottoming. Won stabilizing.',
  },
  {
    id: 'japan',
    label: '日本 (Japan)',
    flag: '🇯🇵',
    score: 52,
    prevScore: 37,
    trend: 'up',
    driver: 'Nikkei recovery. BOJ steady at 0.5%. Weak yen supporting exporters.',
  },
  {
    id: 'china',
    label: '中国 (China)',
    flag: '🇨🇳',
    score: 56,
    prevScore: 54,
    trend: 'up',
    driver: 'Stimulus package expectations. AI subsidy + domestic consumption push.',
  },
  {
    id: 'eu',
    label: 'Europe (EU)',
    flag: '🇪🇺',
    score: 44,
    prevScore: 29,
    trend: 'up',
    driver: 'Trade deal progress reducing tariff risk. Euro defense spending boost.',
  },
  {
    id: 'uk',
    label: 'United Kingdom',
    flag: '🇬🇧',
    score: 50,
    prevScore: 40,
    trend: 'up',
    driver: 'BOE rate cut expectations firming. FTSE 100 near highs driven by miners/oil.',
  },
  {
    id: 'india',
    label: 'भारत (India)',
    flag: '🇮🇳',
    score: 68,
    prevScore: 63,
    trend: 'up',
    driver: 'Nifty near ATH. Domestic consumption + FII inflows accelerating.',
  },
  {
    id: 'brazil',
    label: 'Brasil',
    flag: '🇧🇷',
    score: 42,
    prevScore: 45,
    trend: 'neutral',
    driver: 'Commodity exports steady. Fiscal concerns capping upside. Real under pressure.',
  },
  {
    id: 'taiwan',
    label: '台灣 (Taiwan)',
    flag: '🇹🇼',
    score: 58,
    prevScore: 44,
    trend: 'up',
    driver: 'TSMC strong guidance + AI chip demand surge. Geopolitical premium easing.',
  },
  {
    id: 'australia',
    label: 'Australia',
    flag: '🇦🇺',
    score: 52,
    prevScore: 48,
    trend: 'up',
    driver: 'ASX near highs. RBA cut expectations. Iron ore demand steady from China.',
  },
];

// ── By Asset Class ────────────────────────────────────────────────────────────
export const fearGreedByAsset: FearGreedEntry[] = [
  {
    id: 'us-equities',
    label: 'US Stocks (S&P 500)',
    flag: '📈',
    score: 66,
    prevScore: 31,
    trend: 'up',
    driver: 'Mag7 earnings beats + AI capex revival. Tariff de-escalation rally. SPY +0.3% 4W.',
  },
  {
    id: 'crypto',
    label: 'Crypto (BTC/ETH)',
    flag: '₿',
    score: 72,
    prevScore: 47,
    trend: 'up',
    driver: 'BTC +43% 4W surge. Spot ETF institutional inflows. Risk-on momentum.',
  },
  {
    id: 'gold',
    label: 'Gold (XAU)',
    flag: '🥇',
    score: 55,
    prevScore: 76,
    trend: 'down',
    driver: 'Safe haven unwinding. GLD -5.5% 4W profit-taking. Risk appetite return.',
  },
  {
    id: 'bonds',
    label: 'US Treasuries',
    flag: '🏛️',
    score: 60,
    prevScore: 58,
    trend: 'up',
    driver: 'TLT +1.7% 4W. Rate cut expectations building into FOMC Apr 30.',
  },
  {
    id: 'real-estate',
    label: 'Real Estate (REITs)',
    flag: '🏢',
    score: 35,
    prevScore: 25,
    trend: 'up',
    driver: 'XLRE -0.5% 4W. Rate cut hopes offsetting vacancy concerns.',
  },
  {
    id: 'oil',
    label: 'Oil (WTI/Brent)',
    flag: '🛢️',
    score: 36,
    prevScore: 38,
    trend: 'down',
    driver: 'USO +2.1% 4W but demand slowdown fears persist. OPEC+ output key risk.',
  },
  {
    id: 'semiconductors',
    label: 'Semiconductors',
    flag: '🔬',
    score: 70,
    prevScore: 35,
    trend: 'up',
    driver: 'NVDA data center demand. TSMC strong guidance. AI inference cycle accelerating.',
  },
  {
    id: 'defense',
    label: 'Defense & Aerospace',
    flag: '🛡️',
    score: 68,
    prevScore: 72,
    trend: 'neutral',
    driver: 'NATO 5% GDP target. Geopolitical premium holding. LMT/RTX/NOC steady.',
  },
  {
    id: 'ai-cloud',
    label: 'AI / Cloud',
    flag: '🤖',
    score: 72,
    prevScore: 42,
    trend: 'up',
    driver: 'QQQ +1.9% 4W. MSFT/GOOG/META Azure/Cloud beats. Capex concerns resolved.',
  },
  {
    id: 'commodities',
    label: 'Commodities (DJP)',
    flag: '⛏️',
    score: 38,
    prevScore: 44,
    trend: 'down',
    driver: 'XLB -3.9% 4W. China demand mixed. Materials facing margin pressure.',
  },
];

// ── Money Flow Signals ────────────────────────────────────────────────────────
export interface MoneyFlowSector {
  sector: string;
  sectorKo: string;
  direction: 'inflow' | 'outflow';
  magnitude: number; // 1–5
  topMovers: Array<{ ticker: string; action: string }>;
  reason: string;
  sinceDate: string;        // ISO date when this flow started
  signal: 'accelerating' | 'holding' | 'fading'; // current momentum
}

export const moneyFlowSectors: MoneyFlowSector[] = [
  {
    sector: 'Technology (AI Cycle)',
    sectorKo: 'AI 테크',
    direction: 'inflow',
    magnitude: 5,
    topMovers: [{ ticker: 'NVDA', action: '↑' }, { ticker: 'MSFT', action: '↑' }, { ticker: 'META', action: '↑' }],
    reason: 'AI capex revival — MSFT/GOOG/META Q1 beats. XLK +5% 4W. NVDA data center demand accelerating.',
    sinceDate: '2026-04-15',
    signal: 'accelerating',
  },
  {
    sector: 'Bitcoin / Crypto',
    sectorKo: '비트코인 / 암호화폐',
    direction: 'inflow',
    magnitude: 5,
    topMovers: [{ ticker: 'BITO', action: '↑' }, { ticker: 'MSTR', action: '↑' }, { ticker: 'COIN', action: '↑' }],
    reason: 'Spot ETF institutional inflows accelerating. BTC +43% 4W. Risk-on rotation into digital assets.',
    sinceDate: '2026-04-07',
    signal: 'accelerating',
  },
  {
    sector: 'Industrials (Reshoring)',
    sectorKo: '산업재 (리쇼어링)',
    direction: 'inflow',
    magnitude: 3,
    topMovers: [{ ticker: 'GE', action: '↑' }, { ticker: 'CAT', action: '↑' }, { ticker: 'HON', action: '↑' }],
    reason: 'US manufacturing reshoring + infrastructure spend. XLI +2.4% 4W. Tariff-driven domestic capex.',
    sinceDate: '2026-03-10',
    signal: 'holding',
  },
  {
    sector: 'Consumer Discretionary',
    sectorKo: '경기소비재',
    direction: 'inflow',
    magnitude: 2,
    topMovers: [{ ticker: 'AMZN', action: '↑' }, { ticker: 'TSLA', action: '↑' }],
    reason: 'Trade war de-escalation hopes + retail sales +1.7% beat. XLY +1.4% 4W reversal.',
    sinceDate: '2026-04-14',
    signal: 'holding',
  },
  {
    sector: 'Healthcare / Pharma',
    sectorKo: '헬스케어 / 제약',
    direction: 'outflow',
    magnitude: 5,
    topMovers: [{ ticker: 'UNH', action: '↓' }, { ticker: 'CVS', action: '↓' }, { ticker: 'MRNA', action: '↓' }],
    reason: 'Drug pricing reform risk + Medicaid cut pressure. XLV -7.1% 4W. RFK Jr. regulatory overhang.',
    sinceDate: '2026-04-07',
    signal: 'accelerating',
  },
  {
    sector: 'Gold / Precious Metals',
    sectorKo: '금 / 귀금속',
    direction: 'outflow',
    magnitude: 4,
    topMovers: [{ ticker: 'GLD', action: '↓' }, { ticker: 'NEM', action: '↓' }, { ticker: 'GOLD', action: '↓' }],
    reason: 'Safe haven unwinding as risk appetite returns (F&G 66). GLD -5.5% 4W profit-taking.',
    sinceDate: '2026-04-20',
    signal: 'accelerating',
  },
  {
    sector: 'Consumer Staples',
    sectorKo: '필수소비재',
    direction: 'outflow',
    magnitude: 3,
    topMovers: [{ ticker: 'PG', action: '↓' }, { ticker: 'KO', action: '↓' }, { ticker: 'WMT', action: '↓' }],
    reason: 'Defensive rotation reversal. XLP -3.8% 4W. Risk-on flows leaving safe havens.',
    sinceDate: '2026-04-14',
    signal: 'holding',
  },
  {
    sector: 'Energy (Crude Oil)',
    sectorKo: '에너지 (원유)',
    direction: 'outflow',
    magnitude: 3,
    topMovers: [{ ticker: 'XOM', action: '↓' }, { ticker: 'CVX', action: '↓' }, { ticker: 'SLB', action: '↓' }],
    reason: 'Demand slowdown fears + OPEC+ production uncertainty. XLE -3.5% 4W.',
    sinceDate: '2026-03-20',
    signal: 'holding',
  },
];
