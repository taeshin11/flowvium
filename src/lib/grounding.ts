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

/** Universe 정책 — 허용 리스트가 아닌 정책 기반 (S&P500 전체 + 주요 ETF + 암호화폐) */
// 예시 리스트 (AI 참고용 — 이 외에도 S&P500 전체, 주요 국가 ETF, 암호화폐 허용)
const APPROVED_US_EXAMPLES = [
  'NVDA','AAPL','MSFT','GOOGL','META','AMZN','TSLA','AMD','AVGO','JPM','GS','V','MA',
  'LLY','JNJ','XOM','WMT','COST','HD','KO','PG','MCD','LMT','RTX','BA','UNH',
  'PLTR','COIN','SNOW','CRM','ADBE','ORCL','INTU','UBER','SHOP','NFLX','DIS',
  'ALB','FCX','NEM','CF','MOS',  // Materials/Commodities stocks
  'SMCI','DELL','HPE','ANET',    // AI infra
  'MARA', 'RIOT', 'SOFI', 'HOOD', 'UPST',    // Fintech/Crypto miners (Russell 2000)
];
const APPROVED_ETF_EXAMPLES = [
  // US broad/sector
  'SPY','QQQ','IWM','VTI','XLK','XLE','XLF','XLV','XLI','XLY','XLB','XLU','XLC','XLP','XLRE',
  // Smart Beta
  'MTUM','QUAL','USMV','VLUE','IVE','IVW',
  // Country ETFs
  'EWY','EWJ','EWZ','EWA','EWG','EWU','EWT','EWH','INDA','FXI','EEM','VWO','VGK','EWW',
  // Bonds/Rates
  'TLT','IEF','SHY','HYG','LQD',
  // Commodities/Hedges
  'GLD','SLV','USO','DBA','GDX','UUP',
  // Crypto & Crypto ETFs
  'IBIT','FBTC','GBTC','ETHA','BITB','BITO',
  'ARKB', 'HODL',    // Bitcoin spot ETFs (Ark, VanEck)
];
const APPROVED_CRYPTO = ['BTC-USD','ETH-USD','SOL-USD','BNB-USD','XRP-USD','AVAX-USD','LINK-USD'];
const APPROVED_KR = [
  '005930.KS','000660.KS','373220.KS','005380.KS','035420.KS',
  '035720.KS','051910.KS','005490.KS','000270.KS','207940.KS',
];

export const APPROVED_UNIVERSE = [...APPROVED_US_EXAMPLES, ...APPROVED_ETF_EXAMPLES, ...APPROVED_CRYPTO, ...APPROVED_KR];

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
    `Ticker universe POLICY (not a strict allowlist):`,
    `- ALLOWED: Any S&P 500 component, major ETF, or top-100 crypto by market cap`,
    `- ALLOWED: Country ETFs (EWY/EWJ/EWZ/VGK etc.), bond ETFs, commodity ETFs`,
    `- ALLOWED: Korean stocks (KRW): ${APPROVED_KR.join(', ')}`,
    `- ALLOWED: Crypto via Yahoo Finance: BTC-USD, ETH-USD, SOL-USD etc. and ETFs: IBIT, FBTC, BITO`,
    `- ALLOWED: Small caps listed on NYSE/NASDAQ (Russell 2000 components, S&P 600): e.g. MARA, RIOT, SMCI, SOFI, UPST, HOOD`,
    `- ALLOWED: Small cap ETFs: IWM (Russell 2000), IJR (S&P 600), SCHA (small-cap blend)`,
    `- BLOCKED: OTC/pink sheets (suffix .OB, .PK) — not on major exchanges, unreliable pricing`,
    `- BLOCKED: Pure inverse/leveraged ETFs as primary hold (SQQQ/TQQQ/SOXS etc.)`,
    `- RULE: All tickers must have Yahoo Finance price data. If unsure, use IWM/QQQ/SPY as small/mid/large proxy.`,
  ];
  if (livePriceSummary) {
    lines.push('', `[Live Prices — use for entryZone/target/stopLoss]`, livePriceSummary);
  }
  lines.push('', `[END FACTS]`);
  return lines.join('\n');
}
