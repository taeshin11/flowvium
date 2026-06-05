/**
 * Stooq batch quote client — free CSV endpoint, no auth required.
 * Used as primary price source since Yahoo Finance v7 now returns 401 from Vercel.
 */
import { logger } from './logger';

export interface StooqQuote {
  symbol: string;   // normalized: original ticker (uppercase, no suffix)
  date: string | null;
  time: string | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  /** Intraday % change: (close - open) / open * 100 */
  changePct: number | null;
}

/** Internal: fetch pre-formatted Stooq symbols. symbolMap: stooqSymbol → originalTicker */
async function fetchStooqRaw(symbolMap: Map<string, string>): Promise<StooqQuote[]> {
  const stooqSymbols = Array.from(symbolMap.keys());
  if (!stooqSymbols.length) return [];

  const BATCH = 35;
  const out: StooqQuote[] = [];

  for (let i = 0; i < stooqSymbols.length; i += BATCH) {
    const batch = stooqSymbols.slice(i, i + BATCH);
    const batchStart = Date.now();
    try {
      const url = `https://stooq.com/q/l/?s=${batch.join('+')}&f=sd2t2ohlcv&h&e=csv`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(12000),
        cache: 'no-store',
      });
      if (!res.ok) {
        logger.warn('stooq', 'http_error', { batchStart: i, batchEnd: i + BATCH, status: res.status, durationMs: Date.now() - batchStart });
        continue;
      }
      const text = await res.text();
      const lines = text.trim().split('\n');
      if (lines.length < 2) continue;

      for (let j = 1; j < lines.length; j++) {
        const cols = lines[j].split(',');
        if (cols.length < 8) continue;
        const stooqSym = cols[0].toLowerCase();
        const originalTicker = symbolMap.get(stooqSym) ?? cols[0].toUpperCase();
        const date = cols[1] && cols[1] !== 'N/D' ? cols[1] : null;
        const time = cols[2] && cols[2] !== 'N/D' ? cols[2] : null;
        const open = parseFloat(cols[3]);
        const high = parseFloat(cols[4]);
        const low = parseFloat(cols[5]);
        const close = parseFloat(cols[6]);
        const volume = parseFloat(cols[7]);
        const changePct = (open > 0 && !isNaN(close)) ? ((close - open) / open) * 100 : null;

        out.push({
          symbol: originalTicker,
          date,
          time,
          open: isNaN(open) ? null : open,
          high: isNaN(high) ? null : high,
          low: isNaN(low) ? null : low,
          close: isNaN(close) ? null : close,
          volume: isNaN(volume) ? null : volume,
          changePct: changePct != null ? parseFloat(changePct.toFixed(2)) : null,
        });
      }
    } catch (err) {
      logger.error('stooq', 'batch_failed', { batchStart: i, batchEnd: i + BATCH, error: err, durationMs: Date.now() - batchStart });
    }
  }

  logger.info('stooq', 'fetched', { requested: stooqSymbols.length, returned: out.length });
  return out;
}

// 2026-06-06: Stooq 가 JS/PoW 봇챌린지로 영구 차단됨(CSV 대신 HTML 반환 → fetchStooqRaw 빈배열).
//   narratives/market-heatmap/market-caps 등 모든 소비처 silent degrade. → Yahoo v7 quote(crumb 인증)
//   폴백을 공유 lib 에 추가해 한 곳에서 전부 복구. v7 401 은 crumb 로 우회.
let _yCrumb: { crumb: string; cookie: string } | null = null;
async function getYahooCrumb(): Promise<{ crumb: string; cookie: string }> {
  if (_yCrumb) return _yCrumb;
  const UA = { 'User-Agent': 'Mozilla/5.0' };
  const r = await fetch('https://fc.yahoo.com', { headers: UA, signal: AbortSignal.timeout(8000) });
  const cookie = (r.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
  const cr = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { ...UA, Cookie: cookie }, signal: AbortSignal.timeout(8000) });
  _yCrumb = { crumb: await cr.text(), cookie };
  return _yCrumb;
}
/** Yahoo v7 quote 배치(crumb) → StooqQuote 형태로 변환. Stooq 봇차단 폴백. */
async function fetchYahooQuotesAsStooq(tickers: string[]): Promise<StooqQuote[]> {
  const out: StooqQuote[] = [];
  if (!tickers.length) return out;
  let cr: { crumb: string; cookie: string };
  try { cr = await getYahooCrumb(); } catch { return out; }
  if (!cr.crumb || cr.crumb.length > 30) return out;
  const UA = { 'User-Agent': 'Mozilla/5.0', Cookie: cr.cookie };
  for (let i = 0; i < tickers.length; i += 50) {
    const chunk = tickers.slice(i, i + 50);
    const symMap = new Map(chunk.map(t => [t.replace(/\./g, '-').toUpperCase(), t.toUpperCase()]));
    try {
      const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${Array.from(symMap.keys()).map(encodeURIComponent).join(',')}&crumb=${encodeURIComponent(cr.crumb)}`;
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12000) });
      if (!res.ok) continue;
      const j = await res.json() as { quoteResponse?: { result?: Array<Record<string, number | string>> } };
      for (const q of j?.quoteResponse?.result ?? []) {
        const close = q.regularMarketPrice as number | undefined;
        if (close == null || !isFinite(close)) continue;
        const open = (q.regularMarketOpen as number) ?? null;
        const chg = q.regularMarketChangePercent as number | undefined;
        out.push({
          symbol: symMap.get(String(q.symbol)) ?? String(q.symbol),
          date: null, time: null,
          open, high: (q.regularMarketDayHigh as number) ?? null, low: (q.regularMarketDayLow as number) ?? null,
          close, volume: (q.regularMarketVolume as number) ?? null,
          changePct: chg != null ? parseFloat(chg.toFixed(2)) : (open && open > 0 ? parseFloat((((close - open) / open) * 100).toFixed(2)) : null),
        });
      }
    } catch { /* skip chunk */ }
  }
  if (out.length) logger.info('stooq', 'yahoo_fallback', { requested: tickers.length, returned: out.length });
  return out;
}

/** Fetch US stock quotes; tickers are plain symbols (AAPL, BRK-B, etc.) */
export async function fetchStooqQuotes(tickers: string[]): Promise<StooqQuote[]> {
  if (!tickers.length) return [];
  const symbolMap = new Map(tickers.map(t => [`${t.toLowerCase()}.us`, t.toUpperCase()]));
  const res = await fetchStooqRaw(symbolMap);
  // Stooq 봇차단/부분실패 → Yahoo v7 crumb 폴백으로 누락분 보강
  if (res.length < tickers.length * 0.5) {
    const have = new Set(res.map(r => r.symbol));
    const yh = await fetchYahooQuotesAsStooq(tickers);
    for (const q of yh) if (!have.has(q.symbol)) res.push(q);
  }
  return res;
}

const STOOQ_SUFFIX: Record<string, string> = {
  KR: '.kr', JP: '.jp', IN: '.in', TW: '.tw',
};
const STOOQ_EU: Record<string, string> = {
  'Germany': '.de', 'France': '.fr', 'United Kingdom': '.uk',
  'Netherlands': '.nl', 'Switzerland': '.ch', 'Spain': '.es',
  'Italy': '.it', 'Sweden': '.se', 'Denmark': '.dk',
  'Norway': '.no', 'Finland': '.fi', 'Belgium': '.be',
  'Austria': '.at', 'Portugal': '.pt', 'Ireland': '.ie',
};

function toStooqSymbol(ticker: string, country: string, location?: string): string {
  const t = ticker.toLowerCase();
  if (country === 'EU') {
    const suf = location ? (STOOQ_EU[location] ?? '') : '';
    const clean = t.replace(/\.$/, '').replace(/\s+/g, '-');
    return suf ? `${clean}${suf}` : clean;
  }
  if (country === 'CN') return /^\d+$/.test(ticker) ? `${t}.hk` : `${t}.us`;
  const suf = STOOQ_SUFFIX[country];
  return suf ? `${t}${suf}` : t;
}

/** Fetch non-US stock quotes using Stooq's international exchange suffixes. */
export async function fetchStooqNonUS(
  holdings: Array<{ ticker: string; location: string }>,
  country: string
): Promise<StooqQuote[]> {
  if (!holdings.length) return [];
  const symbolMap = new Map(
    holdings.map(h => [toStooqSymbol(h.ticker, country, h.location), h.ticker.toUpperCase()])
  );
  return fetchStooqRaw(symbolMap);
}
