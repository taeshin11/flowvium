import { logger } from './logger';

/**
 * iShares ETF holdings fetcher.
 * Parses the public CSV exports for S&P 500 (IVV) and regional ETFs.
 *
 * URL pattern:
 *   https://www.ishares.com/us/products/{productId}/{slug}/1467271812596.ajax
 *     ?fileType=csv&fileName={TICKER}_holdings&dataType=fund
 *
 * CSV has metadata header rows then a column header starting with "Ticker,Name,..."
 */

export interface IShareHolding {
  ticker: string;
  name: string;
  sector: string;
  marketValue: number;  // USD
  weight: number;       // % of ETF
  price: number;
  location: string;
  currency: string;
}

export interface IShareETFConfig {
  etfTicker: string;   // e.g. 'IVV'
  url: string;
  country: string;     // 'US' | 'KR' | 'JP' | 'CN' | 'EU' | 'IN' | 'TW'
  countryLabel: string;
}

export const ISHARES_ETFS: Record<string, IShareETFConfig> = {
  US: {
    etfTicker: 'IVV',
    country: 'US',
    countryLabel: 'S&P 500',
    url: 'https://www.ishares.com/us/products/239726/ishares-core-sp-500-etf/1467271812596.ajax?fileType=csv&fileName=IVV_holdings&dataType=fund',
  },
  KR: {
    etfTicker: 'EWY',
    country: 'KR',
    countryLabel: 'Korea',
    url: 'https://www.ishares.com/us/products/239681/ishares-msci-south-korea-etf/1467271812596.ajax?fileType=csv&fileName=EWY_holdings&dataType=fund',
  },
  JP: {
    etfTicker: 'EWJ',
    country: 'JP',
    countryLabel: 'Japan',
    url: 'https://www.ishares.com/us/products/239665/ishares-msci-japan-etf/1467271812596.ajax?fileType=csv&fileName=EWJ_holdings&dataType=fund',
  },
  CN: {
    etfTicker: 'MCHI',
    country: 'CN',
    countryLabel: 'China',
    url: 'https://www.ishares.com/us/products/239619/ishares-msci-china-etf/1467271812596.ajax?fileType=csv&fileName=MCHI_holdings&dataType=fund',
  },
  EU: {
    etfTicker: 'IEUR',
    country: 'EU',
    countryLabel: 'Europe',
    url: 'https://www.ishares.com/us/products/239736/ishares-europe-etf/1467271812596.ajax?fileType=csv&fileName=IEUR_holdings&dataType=fund',
  },
  IN: {
    etfTicker: 'INDA',
    country: 'IN',
    countryLabel: 'India',
    url: 'https://www.ishares.com/us/products/239659/ishares-msci-india-etf/1467271812596.ajax?fileType=csv&fileName=INDA_holdings&dataType=fund',
  },
  TW: {
    etfTicker: 'EWT',
    country: 'TW',
    countryLabel: 'Taiwan',
    url: 'https://www.ishares.com/us/products/239686/ishares-msci-taiwan-etf/1467271812596.ajax?fileType=csv&fileName=EWT_holdings&dataType=fund',
  },
};

/** Parse a line respecting simple CSV quoting. */
function parseCSVLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQ = !inQ;
    else if (c === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

const SECTOR_KO: Record<string, string> = {
  'Information Technology': '정보기술',
  'Communication':          '커뮤니케이션',
  'Communication Services': '커뮤니케이션',
  'Consumer Discretionary': '경기소비재',
  'Consumer Staples':       '필수소비재',
  'Financials':             '금융',
  'Health Care':            '헬스케어',
  'Healthcare':             '헬스케어',
  'Industrials':            '산업재',
  'Energy':                 '에너지',
  'Materials':              '소재',
  'Real Estate':            '부동산',
  'Utilities':              '유틸리티',
};

export async function fetchIShareHoldings(country: string): Promise<IShareHolding[]> {
  const cfg = ISHARES_ETFS[country.toUpperCase()];
  if (!cfg) {
    logger.warn('ishares', 'unknown_country', { country });
    return [];
  }
  const start = Date.now();
  try {
    const res = await fetch(cfg.url, {
      signal: AbortSignal.timeout(20000),
      headers: { 'User-Agent': 'Mozilla/5.0' },
      cache: 'no-store',
    });
    if (!res.ok) {
      logger.warn('ishares', 'http_error', { country, etf: cfg.etfTicker, status: res.status, durationMs: Date.now() - start });
      return [];
    }
    const text = await res.text();
    const lines = text.split('\n').filter(Boolean);

    // Find the header line
    const headerIdx = lines.findIndex(l => l.trim().startsWith('Ticker,'));
    if (headerIdx < 0) return [];

    const headers = parseCSVLine(lines[headerIdx]);
    const tickerI = headers.indexOf('Ticker');
    const nameI = headers.indexOf('Name');
    const sectorI = headers.indexOf('Sector');
    const mvI = headers.indexOf('Market Value');
    const wtI = headers.indexOf('Weight (%)');
    const priceI = headers.indexOf('Price');
    const locI = headers.indexOf('Location');
    const curI = headers.indexOf('Market Currency');

    const holdings: IShareHolding[] = [];
    logger.debug('ishares', 'parse_start', { country, etf: cfg.etfTicker, headerIdx });
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      if (cols.length < headers.length - 2) continue;
      const ticker = cols[tickerI]?.replace(/"/g, '').trim();
      if (!ticker || ticker === '-') continue;
      const assetClass = headers.indexOf('Asset Class') >= 0
        ? cols[headers.indexOf('Asset Class')]?.replace(/"/g, '').trim()
        : 'Equity';
      if (assetClass !== 'Equity') continue;

      const parseNum = (s: string | undefined) =>
        parseFloat((s ?? '').replace(/"/g, '').replace(/,/g, ''));

      const sectorEn = cols[sectorI]?.replace(/"/g, '').trim() ?? '';
      holdings.push({
        ticker,
        name: cols[nameI]?.replace(/"/g, '').trim() ?? ticker,
        sector: SECTOR_KO[sectorEn] ?? sectorEn ?? '기타',
        marketValue: parseNum(cols[mvI]) || 0,
        weight: parseNum(cols[wtI]) || 0,
        price: parseNum(cols[priceI]) || 0,
        location: cols[locI]?.replace(/"/g, '').trim() ?? '',
        currency: cols[curI]?.replace(/"/g, '').trim() ?? 'USD',
      });
    }
    logger.info('ishares', 'fetched', { country, etf: cfg.etfTicker, holdings: holdings.length, durationMs: Date.now() - start });
    return holdings;
  } catch (err) {
    logger.error('ishares', 'fetch_failed', { country, etf: cfg.etfTicker, error: err, durationMs: Date.now() - start });
    return [];
  }
}
