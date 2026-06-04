import { logger } from './logger';
import { UNIVERSE_SEARCH } from '@/data/universe-search';
import { fetchNaverKRQuotes } from './naver-finance';

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

// 2026-06-04: iShares 비US 구성 CSV 도 차단(HTML challenge) → KR 은 자체 universe + Naver 시총으로 구성.
//   (US 는 Wikipedia, KR 은 우리가 추적하는 KR universe — JP/CN/EU/TW/IN 은 아직 대체 소스 없음.)
const UNIV_SECTOR_KO: Record<string, string> = {
  semiconductors: '반도체', 'it-software': '정보기술', 'ai-cloud': '정보기술', technology: '정보기술',
  financials: '금융', healthcare: '헬스케어', industrials: '산업재', energy: '에너지', materials: '소재',
  'consumer-discretionary': '경기소비재', 'consumer-staples': '필수소비재', automotive: '경기소비재',
  'communication-services': '커뮤니케이션', telecom: '커뮤니케이션', utilities: '유틸리티', 'real-estate': '부동산',
};
async function fetchKRHoldingsFromUniverse(): Promise<IShareHolding[]> {
  const krUniv = UNIVERSE_SEARCH.filter(c => /\.(KS|KQ)$/.test(c.ticker));
  if (!krUniv.length) return [];
  const codes = krUniv.map(c => c.ticker.replace(/\.(KS|KQ)$/, ''));
  const quotes = await fetchNaverKRQuotes(codes);
  const qmap = new Map(quotes.map(q => [q.symbol, q]));
  const FX = 1350; // KRW→USD 근사 (국가 내 상대 sizing 용도라 정밀 불필요)
  const holdings: IShareHolding[] = [];
  for (const c of krUniv) {
    const code = c.ticker.replace(/\.(KS|KQ)$/, '');
    const q = qmap.get(code);
    if (!q || q.marketCap == null || q.close == null) continue;
    holdings.push({
      ticker: code, name: c.name, sector: UNIV_SECTOR_KO[c.sector] ?? (c.sector || '기타'),
      marketValue: Math.round(q.marketCap / FX), weight: 0, price: q.close, location: 'KR', currency: 'KRW',
    });
  }
  const total = holdings.reduce((s, h) => s + h.marketValue, 0) || 1;
  for (const h of holdings) h.weight = Math.round((h.marketValue / total) * 10000) / 100;
  logger.info('ishares', 'kr_universe_fallback', { holdings: holdings.length });
  return holdings.sort((a, b) => b.marketValue - a.marketValue);
}

/** 비US 구성 폴백 디스패치 (iShares 차단 시). KR 은 universe, 그 외는 아직 소스 없음. */
async function nonUSHoldingsFallback(country: string): Promise<IShareHolding[]> {
  if (country.toUpperCase() === 'KR') return fetchKRHoldingsFromUniverse();
  return [];
}

// 2026-05: iShares CSV URL이 JS challenge로 차단 — Wikipedia S&P 500 list 폴백.
async function fetchSP500FromWikipedia(): Promise<IShareHolding[]> {
  const start = Date.now();
  try {
    const res = await fetch('https://en.wikipedia.org/wiki/List_of_S%26P_500_companies', {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'Mozilla/5.0 FlowviumBot' },
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const html = await res.text();
    // Wikipedia constituents table parsing (2026-05 구조).
    // ticker link 은 nasdaq.com 또는 nyse.com — 둘 다 외부 link (class="external text")
    const rowRe = /<a[^>]*class="external text"[^>]*href="https:\/\/www\.(?:nasdaq|nyse)\.com[^"]*">([A-Z][A-Z0-9.\-]{0,5})<\/a>[^<]*<\/td>\s*<td><a[^>]*>([^<]+)<\/a><\/td>\s*<td>([^<]+)<\/td>/g;
    const holdings: IShareHolding[] = [];
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(html)) !== null) {
      const ticker = m[1].trim();
      const name = m[2].trim();
      const sectorEn = m[3].trim();
      holdings.push({
        ticker, name,
        sector: SECTOR_KO[sectorEn] ?? sectorEn ?? '기타',
        marketValue: 1e10 - holdings.length * 1e7, // proxy 정렬용 (실제 가중치 없음 → top 200 위주)
        weight: 0, price: 0, location: 'US', currency: 'USD',
      });
      if (holdings.length >= 500) break;
    }
    logger.info('ishares', 'wikipedia_fallback', { holdings: holdings.length, durationMs: Date.now() - start });
    return holdings;
  } catch (err) {
    logger.warn('ishares', 'wikipedia_failed', { error: String(err), durationMs: Date.now() - start });
    return [];
  }
}

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
      if (country.toUpperCase() === 'US') return fetchSP500FromWikipedia();
      return nonUSHoldingsFallback(country);
    }
    const text = await res.text();
    const lines = text.split('\n').filter(Boolean);

    // iShares가 HTML 페이지로 응답하는 경우 (JS challenge) → Wikipedia 폴백
    if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
      logger.warn('ishares', 'html_response_fallback', { country, etf: cfg.etfTicker });
      if (country.toUpperCase() === 'US') return fetchSP500FromWikipedia();
      return nonUSHoldingsFallback(country);
    }

    // Find the header line
    const headerIdx = lines.findIndex(l => l.trim().startsWith('Ticker,'));
    if (headerIdx < 0) {
      if (country.toUpperCase() === 'US') return fetchSP500FromWikipedia();
      return nonUSHoldingsFallback(country);
    }

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
    if (country.toUpperCase() === 'US') return fetchSP500FromWikipedia();
    return nonUSHoldingsFallback(country);
  }
}
