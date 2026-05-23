/**
 * src/lib/options/screener-tickers.ts
 *
 * /api/iv-screener 와 /api/cron/iv-prewarm 가 공유하는 watchlist.
 * S&P500 핵심 + AI 인프라 + 주요 ETF — 31개.
 */
export const SCREENER_TICKERS = [
  'NVDA', 'MSFT', 'AAPL', 'META', 'GOOGL', 'AMZN', 'TSLA', 'AMD',
  'MU', 'AVGO', 'ARM', 'TSM', 'ASML', 'AMAT', 'LRCX', 'KLAC',
  'JPM', 'GS', 'BAC', 'V', 'UNH', 'XOM', 'CVX',
  'LMT', 'RTX', 'NOC',
  'SPY', 'QQQ', 'IWM', 'GLD', 'TLT',
] as const;
