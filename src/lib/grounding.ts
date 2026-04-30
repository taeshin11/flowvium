/**
 * grounding.ts — AI 할루시네이션 방지를 위한 사실 기반 컨텍스트 주입
 *
 * Phase 1: 수동 시드 (연준 의장, approved universe, 허용 지표 카탈로그)
 * Phase 2: Redis cron 자동 업데이트 (FRED API, Yahoo prices)
 */

/** 연준/중앙은행 리더십 사실 — 시제 오류 차단 */
const FED_LEADERSHIP_FACTS = `
- Jerome Powell served as Federal Reserve Chair from 2018-02-05 to 2026-02-05. He is FORMER chair.
- Do NOT describe Jerome Powell as current Fed chair after 2026-02.
- Current Fed Chair successor status: refer only to data in context; if unknown, say "current Fed chair" without a name.
- ECB President: Christine Lagarde (2019-11 to present, confirmed as of 2025-08).
- BOJ Governor: Kazuo Ueda (2023-04 to present, confirmed as of 2025-08).
`.trim();

/** 허용 지표 카탈로그 — 미수집 지표 날조 방지 */
const INDICATOR_CATALOG = `
Available data sources (ONLY use these, do not invent others):
- GDP: FRED series GDP (quarterly)
- CPI: FRED series CPIAUCSL (monthly)
- Unemployment: FRED series UNRATE (monthly)
- Fed Funds Rate: FRED series DFF / FEDFUNDS
- VIX: CBOE Volatility Index (from context)
- CNN Fear & Greed: score 0-100 (from context)
- Yahoo Finance: stock prices, 52w high/low, P/E ratio
- SEC EDGAR: Form 4 insider transactions, 13F institutional holdings
- Capital flows: 1W/4W/13W returns by asset/country (from context)
- COT: CFTC Commitment of Traders (from context if available)
Forbidden: Do not cite RSI/MACD/Bollinger values unless explicitly provided in context.
Forbidden: Do not invent analyst targets, earnings estimates, or credit ratings.
`.trim();

/** Approved ticker universe — universe 이탈 방지 */
const APPROVED_US = [
  // Mega-cap Tech
  'NVDA','AAPL','MSFT','GOOGL','GOOG','META','AMZN','TSLA',
  // Semiconductors
  'AMD','INTC','MU','AVGO','QCOM','TXN','AMAT','KLAC','LRCX','MRVL','ON','ARM','ASML',
  // AI/Cloud
  'PLTR','SNOW','CRM','NOW','ADBE','ORCL','INTU','UBER','COIN','SHOP',
  // Financials
  'JPM','GS','MS','BAC','WFC','C','SCHW','V','MA','PYPL','AXP','SPGI','MCO','BLK',
  // Healthcare
  'LLY','JNJ','PFE','MRK','ABBV','AMGN','GILD','REGN','BIIB','UNH','CVS',
  // Energy
  'XOM','CVX','COP','SLB',
  // Consumer/Industrial
  'WMT','COST','HD','TGT','KO','PEP','PG','MCD','SBUX','NKE',
  'LMT','RTX','NOC','BA','GE','CAT','DE','HON','UPS','FDX','MMM',
  // Telecom/Media
  'T','VZ','CMCSA','DIS','NFLX',
];
const APPROVED_ETF = [
  // US broad/sector
  'SPY','QQQ','IWM','DIA','VTI',
  'XLK','XLE','XLF','XLV','XLI','XLY','XLB','XLU','XLRE','XLC','XLK','XLP',
  // Country ETFs
  'EWY','EWJ','EWZ','EWA','EWG','EWU','EWT','EWH','INDA','FXI','EEM','VWO',
  // Commodities/Hedges
  'GLD','SLV','USO','DBA','GDX','UUP','TLT','IEF','HYG','LQD','MTUM','QUAL',
];
const APPROVED_KR = [
  '005930.KS','000660.KS','373220.KS','005380.KS','035420.KS',
  '035720.KS','051910.KS','005490.KS','000270.KS','207940.KS',
];

export const APPROVED_UNIVERSE = [...APPROVED_US, ...APPROVED_ETF, ...APPROVED_KR];

/** [FACTS] 섹션 문자열 생성 — 프롬프트 앞부분에 주입 */
export function buildGroundingFacts(livePriceSummary?: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [
    `[FACTS — MANDATORY: use only facts below; do not invent data outside this section]`,
    `System date: ${today}`,
    '',
    FED_LEADERSHIP_FACTS,
    '',
    INDICATOR_CATALOG,
    '',
    `Approved ticker universe (${APPROVED_UNIVERSE.length} tickers):`,
    `${[...APPROVED_US, ...APPROVED_ETF].join(', ')}`,
    `Korean stocks (KRW): ${APPROVED_KR.join(', ')}`,
    `RULE: Portfolio tickers MUST be from this universe only.`,
  ];
  if (livePriceSummary) {
    lines.push('', `[Live Prices — use for entryZone/target/stopLoss]`, livePriceSummary);
  }
  lines.push('', `[END FACTS]`);
  return lines.join('\n');
}
