// @static-data-warning: 종목 티커 리스트는 정적 스냅샷입니다 (early 2026 기준).
// 티커 자체는 정적이어도 무방하나, marketCap 수치는 stale할 수 있습니다.
// 색상(수익률)은 런타임에 live 가격으로 채워집니다.
/**
 * Top S&P 500 stocks for heatmap rendering.
 * marketCap in $B (as of early 2026 — snapshot used for box sizing only).
 * Box size is proportional to marketCap; colors are filled at runtime from live prices.
 */

export interface HeatmapStockMeta {
  ticker: string;
  name: string;
  sector: string;   // Korean-friendly bucket label
  marketCap: number; // billions USD — used for treemap weighting only
}

export const HEATMAP_STOCKS: HeatmapStockMeta[] = [
  // ── Technology · 반도체 ─────────────────────────────────────
  { ticker: 'NVDA',  name: 'NVIDIA',           sector: '반도체',        marketCap: 3200 },
  { ticker: 'TSM',   name: 'TSMC',             sector: '반도체',        marketCap: 1050 },
  { ticker: 'AVGO',  name: 'Broadcom',         sector: '반도체',        marketCap: 820 },
  { ticker: 'AMD',   name: 'AMD',              sector: '반도체',        marketCap: 280 },
  { ticker: 'ASML',  name: 'ASML',             sector: '반도체',        marketCap: 330 },
  { ticker: 'QCOM',  name: 'Qualcomm',         sector: '반도체',        marketCap: 200 },
  { ticker: 'AMAT',  name: 'Applied Materials',sector: '반도체',        marketCap: 175 },
  { ticker: 'LRCX',  name: 'Lam Research',     sector: '반도체',        marketCap: 125 },
  { ticker: 'KLAC',  name: 'KLA Corp',         sector: '반도체',        marketCap: 105 },
  { ticker: 'MU',    name: 'Micron',           sector: '반도체',        marketCap: 140 },
  { ticker: 'ARM',   name: 'Arm Holdings',     sector: '반도체',        marketCap: 165 },
  { ticker: 'MRVL',  name: 'Marvell',          sector: '반도체',        marketCap: 90  },
  { ticker: 'SMCI',  name: 'Super Micro',      sector: '반도체',        marketCap: 55  },
  { ticker: 'INTC',  name: 'Intel',            sector: '반도체',        marketCap: 110 },
  { ticker: 'TXN',   name: 'Texas Instruments',sector: '반도체',        marketCap: 175 },

  // ── Technology · 소프트웨어·AI·클라우드 ──────────────────────
  { ticker: 'MSFT',  name: 'Microsoft',        sector: '소프트웨어',    marketCap: 3500 },
  { ticker: 'AAPL',  name: 'Apple',            sector: '소프트웨어',    marketCap: 3300 },
  { ticker: 'GOOGL', name: 'Alphabet',         sector: '소프트웨어',    marketCap: 2200 },
  { ticker: 'META',  name: 'Meta',             sector: '소프트웨어',    marketCap: 1500 },
  { ticker: 'ORCL',  name: 'Oracle',           sector: '소프트웨어',    marketCap: 430 },
  { ticker: 'CRM',   name: 'Salesforce',       sector: '소프트웨어',    marketCap: 310 },
  { ticker: 'ADBE',  name: 'Adobe',            sector: '소프트웨어',    marketCap: 225 },
  { ticker: 'NOW',   name: 'ServiceNow',       sector: '소프트웨어',    marketCap: 190 },
  { ticker: 'INTU',  name: 'Intuit',           sector: '소프트웨어',    marketCap: 180 },
  { ticker: 'PANW',  name: 'Palo Alto',        sector: '소프트웨어',    marketCap: 135 },
  { ticker: 'PLTR',  name: 'Palantir',         sector: '소프트웨어',    marketCap: 130 },
  { ticker: 'SNOW',  name: 'Snowflake',        sector: '소프트웨어',    marketCap: 70 },
  { ticker: 'CRWD',  name: 'CrowdStrike',      sector: '소프트웨어',    marketCap: 100 },
  { ticker: 'DDOG',  name: 'Datadog',          sector: '소프트웨어',    marketCap: 45 },

  // ── Commerce·Internet ───────────────────────────────────────
  { ticker: 'AMZN',  name: 'Amazon',           sector: '전자상거래',    marketCap: 2300 },
  { ticker: 'NFLX',  name: 'Netflix',          sector: '스트리밍',      marketCap: 350 },
  { ticker: 'DIS',   name: 'Disney',           sector: '스트리밍',      marketCap: 185 },
  { ticker: 'TSLA',  name: 'Tesla',            sector: 'EV·배터리',     marketCap: 950 },

  // ── Financials ──────────────────────────────────────────────
  { ticker: 'JPM',   name: 'JPMorgan',         sector: '금융',          marketCap: 690 },
  { ticker: 'V',     name: 'Visa',             sector: '금융',          marketCap: 580 },
  { ticker: 'MA',    name: 'Mastercard',       sector: '금융',          marketCap: 480 },
  { ticker: 'BAC',   name: 'Bank of America',  sector: '금융',          marketCap: 350 },
  { ticker: 'WFC',   name: 'Wells Fargo',      sector: '금융',          marketCap: 245 },
  { ticker: 'GS',    name: 'Goldman Sachs',    sector: '금융',          marketCap: 175 },
  { ticker: 'MS',    name: 'Morgan Stanley',   sector: '금융',          marketCap: 180 },
  { ticker: 'BLK',   name: 'BlackRock',        sector: '금융',          marketCap: 145 },
  { ticker: 'SCHW',  name: 'Charles Schwab',   sector: '금융',          marketCap: 140 },
  { ticker: 'C',     name: 'Citigroup',        sector: '금융',          marketCap: 130 },
  { ticker: 'AXP',   name: 'American Express', sector: '금융',          marketCap: 210 },
  { ticker: 'BRK-B', name: 'Berkshire B',      sector: '금융',          marketCap: 950 },

  // ── Healthcare ──────────────────────────────────────────────
  { ticker: 'LLY',   name: 'Eli Lilly',        sector: '제약·바이오',   marketCap: 770 },
  { ticker: 'UNH',   name: 'UnitedHealth',     sector: '헬스케어',      marketCap: 540 },
  { ticker: 'JNJ',   name: 'Johnson&Johnson',  sector: '제약·바이오',   marketCap: 400 },
  { ticker: 'PFE',   name: 'Pfizer',           sector: '제약·바이오',   marketCap: 170 },
  { ticker: 'ABBV',  name: 'AbbVie',           sector: '제약·바이오',   marketCap: 310 },
  { ticker: 'MRK',   name: 'Merck',            sector: '제약·바이오',   marketCap: 300 },
  { ticker: 'TMO',   name: 'Thermo Fisher',    sector: '헬스케어',      marketCap: 210 },
  { ticker: 'ABT',   name: 'Abbott',           sector: '헬스케어',      marketCap: 200 },
  { ticker: 'REGN',  name: 'Regeneron',        sector: '제약·바이오',   marketCap: 115 },
  { ticker: 'MRNA',  name: 'Moderna',          sector: '제약·바이오',   marketCap: 35 },

  // ── Consumer ────────────────────────────────────────────────
  { ticker: 'WMT',   name: 'Walmart',          sector: '소비재',        marketCap: 600 },
  { ticker: 'COST',  name: 'Costco',           sector: '소비재',        marketCap: 420 },
  { ticker: 'PG',    name: 'P&G',              sector: '소비재',        marketCap: 380 },
  { ticker: 'KO',    name: 'Coca-Cola',        sector: '소비재',        marketCap: 290 },
  { ticker: 'PEP',   name: 'PepsiCo',          sector: '소비재',        marketCap: 230 },
  { ticker: 'MCD',   name: 'McDonalds',        sector: '소비재',        marketCap: 210 },
  { ticker: 'NKE',   name: 'Nike',             sector: '소비재',        marketCap: 135 },
  { ticker: 'SBUX',  name: 'Starbucks',        sector: '소비재',        marketCap: 115 },
  { ticker: 'HD',    name: 'Home Depot',       sector: '소비재',        marketCap: 355 },

  // ── Energy ──────────────────────────────────────────────────
  { ticker: 'XOM',   name: 'ExxonMobil',       sector: '에너지',        marketCap: 475 },
  { ticker: 'CVX',   name: 'Chevron',          sector: '에너지',        marketCap: 275 },
  { ticker: 'COP',   name: 'ConocoPhillips',   sector: '에너지',        marketCap: 130 },
  { ticker: 'SLB',   name: 'Schlumberger',     sector: '에너지',        marketCap: 65 },

  // ── Industrials / Defense ───────────────────────────────────
  { ticker: 'LMT',   name: 'Lockheed Martin',  sector: '방산',          marketCap: 120 },
  { ticker: 'RTX',   name: 'RTX Corp',         sector: '방산',          marketCap: 160 },
  { ticker: 'NOC',   name: 'Northrop',         sector: '방산',          marketCap: 75 },
  { ticker: 'LHX',   name: 'L3Harris',         sector: '방산',          marketCap: 45 },
  { ticker: 'BA',    name: 'Boeing',           sector: '산업재',        marketCap: 135 },
  { ticker: 'CAT',   name: 'Caterpillar',      sector: '산업재',        marketCap: 195 },
  { ticker: 'GE',    name: 'General Electric', sector: '산업재',        marketCap: 210 },
  { ticker: 'HON',   name: 'Honeywell',        sector: '산업재',        marketCap: 140 },
  { ticker: 'UPS',   name: 'UPS',              sector: '산업재',        marketCap: 120 },

  // ── Communication ───────────────────────────────────────────
  { ticker: 'T',     name: 'AT&T',             sector: '통신',          marketCap: 155 },
  { ticker: 'VZ',    name: 'Verizon',          sector: '통신',          marketCap: 175 },
  { ticker: 'TMUS',  name: 'T-Mobile',         sector: '통신',          marketCap: 240 },

  // ── Crypto-related ──────────────────────────────────────────
  { ticker: 'COIN',  name: 'Coinbase',         sector: '암호화폐',      marketCap: 75 },

  // ── Utilities / Real Estate ─────────────────────────────────
  { ticker: 'NEE',   name: 'NextEra',          sector: '유틸리티',      marketCap: 170 },
  { ticker: 'DUK',   name: 'Duke Energy',      sector: '유틸리티',      marketCap: 90 },
  { ticker: 'SO',    name: 'Southern Co',      sector: '유틸리티',      marketCap: 100 },

  // ── Materials ───────────────────────────────────────────────
  { ticker: 'LIN',   name: 'Linde',            sector: '소재',          marketCap: 225 },
  { ticker: 'FCX',   name: 'Freeport',         sector: '소재',          marketCap: 70 },
  { ticker: 'ALB',   name: 'Albemarle',        sector: '소재',          marketCap: 12 },
];

/** Sector color palette — matches box base hue before % change tint is applied */
export const SECTOR_COLORS: Record<string, string> = {
  '반도체':         '#6366f1',
  '소프트웨어':     '#3b82f6',
  '전자상거래':     '#8b5cf6',
  '스트리밍':       '#ec4899',
  'EV·배터리':      '#22c55e',
  '금융':           '#0891b2',
  '제약·바이오':    '#a855f7',
  '헬스케어':       '#14b8a6',
  '소비재':         '#f59e0b',
  '에너지':         '#ef4444',
  '방산':           '#dc2626',
  '산업재':         '#64748b',
  '통신':           '#06b6d4',
  '암호화폐':       '#fbbf24',
  '유틸리티':       '#10b981',
  '소재':           '#84cc16',
};
