import { logger, loggedRedisSet} from '@/lib/logger';
export const maxDuration = 60; // 200 tickers × batched Yahoo v8 fetch needs up to ~20s
/**
 * /api/market-heatmap?country=US|KR|JP|CN|EU|IN|TW
 *
 * TradingView-style treemap data per country. Uses iShares ETF holdings CSV
 * (public, no auth) for constituents + market cap weights, then Stooq for
 * live price changes (US only — non-US stocks use iShares intraday price).
 *
 * Redis cache: 15 minutes per country.
 * Redis-less fallback: module-level memory cache (10min TTL) — keeps warm
 * instance responses <50ms instead of 3+s upstream re-fetch every call.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import type { Redis } from '@upstash/redis';
import { fetchCNBCQuotes, fetchYFNonUSQuotes } from '@/lib/yahoo-finance';
import { fetchStooqQuotes, fetchStooqNonUS } from '@/lib/stooq';
import { fetchNaverKRQuotes, fetchTWSEQuotes } from '@/lib/naver-finance';
import { fetchNSEIndiaQuotes } from '@/lib/nse-india';
import { fetchIShareHoldings, ISHARES_ETFS } from '@/lib/ishares-holdings';
import { SECTOR_COLORS } from '@/data/heatmap-stocks';
import { createMemoryCache } from '@/lib/memory-cache';

export const dynamic = 'force-dynamic';

const CACHE_TTL = 15 * 60;
const MEMORY_CACHE = createMemoryCache<HeatmapData>('market-heatmap', 10 * 60_000);
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=60' };

const INDICES_BY_COUNTRY: Record<string, Array<{ symbol: string; label: string }>> = {
  US: [
    { symbol: 'SPY', label: 'S&P 500' },
    { symbol: 'QQQ', label: 'NASDAQ 100' },
    { symbol: 'IWM', label: 'Russell 2000' },
    { symbol: 'DIA', label: 'Dow Jones' },
  ],
  KR: [{ symbol: 'EWY', label: 'Korea (EWY)' }],
  JP: [{ symbol: 'EWJ', label: 'Japan (EWJ)' }],
  CN: [{ symbol: 'MCHI', label: 'China (MCHI)' }, { symbol: 'FXI', label: 'FXI' }],
  EU: [{ symbol: 'EZU', label: 'Eurozone (EZU)' }, { symbol: 'VGK', label: 'VGK' }],
  IN: [{ symbol: 'INDA', label: 'India (INDA)' }, { symbol: 'SMIN', label: 'SMIN' }],
  TW: [{ symbol: 'EWT', label: 'Taiwan (EWT)' }],
};

export interface HeatmapStock {
  ticker: string;
  name: string;
  sector: string;
  marketCap: number;
  changePct: number | null;
  close: number | null;
}

export interface HeatmapSector {
  sector: string;
  color: string;
  stocks: HeatmapStock[];
  totalMarketCap: number;
  avgChangePct: number | null;
}

export interface HeatmapIndex {
  symbol: string;
  label: string;
  changePct: number | null;
  close: number | null;
}

export interface HeatmapData {
  country: string;
  countryLabel: string;
  sectors: HeatmapSector[];
  indices: HeatmapIndex[];
  totalStocks: number;
  updatedAt: string;
  dataDate: string | null;
  source: string;
  unavailable?: boolean;
  unavailableReason?: string;
}

const SUPPORTED = ['US', 'KR', 'JP', 'CN', 'EU', 'IN', 'TW'];

const YF_SUFFIX: Record<string, string> = { KR: '.KS', JP: '.T', IN: '.NS', TW: '.TW' };
const YF_EU: Record<string, string> = {
  'Germany': '.DE', 'France': '.PA', 'United Kingdom': '.L',
  'Netherlands': '.AS', 'Switzerland': '.SW', 'Spain': '.MC',
  'Italy': '.MI', 'Sweden': '.ST', 'Denmark': '.CO',
  'Norway': '.OL', 'Finland': '.HE', 'Belgium': '.BR',
};

function toYFSuffix(ticker: string, country: string, location?: string): string {
  if (country === 'EU') {
    const suf = location ? (YF_EU[location] ?? '') : '';
    if (!suf) return ticker;
    // Strip trailing dot (e.g. "RR." → "RR") and replace spaces with hyphens
    // (e.g. "INVE B" → "INVE-B") before appending Yahoo suffix.
    const clean = ticker.replace(/\.$/, '').replace(/\s+/g, '-');
    return `${clean}${suf}`;
  }
  // CN tickers map to Hong Kong-listed shares (.HK) — not mainland A-shares.
  // UI should render heatmap.cn_exchange_note to clarify this to users.
  if (country === 'CN') return /^\d+$/.test(ticker) ? `${ticker}.HK` : ticker;
  const suf = YF_SUFFIX[country];
  return suf ? `${ticker}${suf}` : ticker;
}


export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const rawCountry = (url.searchParams.get('country') ?? 'US').toUpperCase();
  const country = SUPPORTED.includes(rawCountry) ? rawCountry : 'US';
  const force = url.searchParams.get('refresh') === '1';
  const cfg = ISHARES_ETFS[country];
  const hour = new Date().toISOString().slice(0, 13);
  const cacheKey = `flowvium:heatmap:v18:${country}:${hour}`; // v18: KR Stooq.ks + IN Stooq.ns (Naver/NSE UA-spoofing removed)
  const redis = createRedis();

  if (!force) {
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) return NextResponse.json({ ...(cached as object), cached: true }, { headers: CDN_HEADERS });
      } catch { /* non-fatal */ }
    } else {
      const mem = MEMORY_CACHE.get(country);
      if (mem) return NextResponse.json({ ...mem, cached: true, cacheLayer: 'memory' }, { headers: CDN_HEADERS });
    }
  }

  // 1. Fetch ETF constituents (includes market cap weights)
  const holdings = await fetchIShareHoldings(country);

  // Filter out tiny holdings — top stocks by market value, cap at 200
  const topHoldings = holdings
    .sort((a, b) => b.marketValue - a.marketValue)
    .slice(0, country === 'US' ? 200 : 80);

  // 2. Fetch quotes — hybrid approach:
  //    US stocks: Stooq batch (35/req, ~6 requests total, reliable from Vercel)
  //    Indices (SPY/QQQ/EWY etc.): Yahoo v8 (4 requests, correct prev-close day-change)
  //    Non-US stocks: iShares EOD price (no live source available)
  const indexConfigs = INDICES_BY_COUNTRY[country] ?? [];

  // Stooq for US equity constituents
  // iShares CSV uses "BRKB" but Stooq expects "BRK-B"; add other aliases here as needed
  const STOOQ_US_ALIAS: Record<string, string> = { 'BRKB': 'BRK-B' };
  const stooqMap = new Map<string, { changePct: number | null; close: number | null }>();
  if (country === 'US') {
    // holdingTicker → stooqTicker (apply alias then dot→dash)
    const aliasToHolding = new Map<string, string>(
      topHoldings.map(h => {
        const aliased = STOOQ_US_ALIAS[h.ticker] ?? h.ticker;
        return [aliased.replace(/\./g, '-'), h.ticker];
      })
    );
    const stooqTickers = topHoldings.map(h => {
      const aliased = STOOQ_US_ALIAS[h.ticker] ?? h.ticker;
      return aliased.replace(/\./g, '-');
    });
    const stooqQuotes = await fetchStooqQuotes(stooqTickers);
    for (const q of stooqQuotes) {
      // Map back to original holding ticker so lookup by h.ticker works
      const holdingTicker = aliasToHolding.get(q.symbol) ?? q.symbol;
      stooqMap.set(holdingTicker, { changePct: q.changePct, close: q.close });
    }
  }

  // Non-US: Stooq first (covers JP + EU-partial), then country-specific source, then Yahoo fallback
  // KR/TW/IN return N/D from Stooq — skip that round-trip.
  // CN numeric tickers map to .hk suffix (Stooq HK exchange) — do NOT skip.
  // KR: Naver Finance (accessible from Vercel, no auth, batch-capable) instead of Yahoo v8 (blocked)
  const STOOQ_SKIP = new Set(['KR', 'TW', 'IN']);
  const nonUSQuoteMap = new Map<string, { changePct: number | null; close: number | null }>();
  if (country !== 'US') {
    if (!STOOQ_SKIP.has(country)) {
      // Pass 1: Stooq (covers JP fully, EU partially)
      const stooqQuotes = await fetchStooqNonUS(topHoldings, country);
      for (const q of stooqQuotes) {
        if (q.changePct != null || q.close != null) {
          nonUSQuoteMap.set(q.symbol, { changePct: q.changePct, close: q.close });
        }
      }
      logger.info('market-heatmap', 'stooq_pass', { country, matched: nonUSQuoteMap.size });
    }

    // Pass 1.5: Country-specific source for Stooq-N/D + Yahoo-blocked countries
    // KR: Naver Finance (batch polling API, no auth, free)
    // TW: TWSE + TPEX open API (full-day report, no auth, free)
    if (country === 'KR') {
      const krMissing = topHoldings.filter(h => !nonUSQuoteMap.has(h.ticker.toUpperCase())).map(h => h.ticker);
      if (krMissing.length > 0) {
        const naverQuotes = await fetchNaverKRQuotes(krMissing);
        for (const q of naverQuotes) {
          if (q.changePct != null || q.close != null) {
            nonUSQuoteMap.set(q.symbol.toUpperCase(), { changePct: q.changePct, close: q.close });
          }
        }
        logger.info('market-heatmap', 'naver_kr_pass', { requested: krMissing.length, matched: naverQuotes.filter(q => q.changePct != null).length });
      }
    } else if (country === 'TW') {
      const twMissing = topHoldings.filter(h => !nonUSQuoteMap.has(h.ticker.toUpperCase())).map(h => h.ticker);
      if (twMissing.length > 0) {
        const twseQuotes = await fetchTWSEQuotes(twMissing);
        for (const q of twseQuotes) {
          if (q.changePct != null || q.close != null) {
            nonUSQuoteMap.set(q.symbol.toUpperCase(), { changePct: q.changePct, close: q.close });
          }
        }
        logger.info('market-heatmap', 'twse_tw_pass', { requested: twMissing.length, matched: twseQuotes.filter(q => q.changePct != null).length });
      }
    } else if (country === 'IN') {
      // NSE India NIFTY 500 public API — no auth, matches iShares INDA ticker symbols exactly.
      // Vercel accessibility unconfirmed (NSE may block cloud IPs).
      const inMissing = topHoldings.filter(h => !nonUSQuoteMap.has(h.ticker.toUpperCase())).map(h => h.ticker);
      if (inMissing.length > 0) {
        const nseQuotes = await fetchNSEIndiaQuotes(inMissing);
        for (const q of nseQuotes) {
          if (q.changePct != null || q.close != null) {
            nonUSQuoteMap.set(q.symbol.toUpperCase(), { changePct: q.changePct, close: q.close });
          }
        }
        logger.info('market-heatmap', 'nse_in_pass', { requested: inMissing.length, matched: nseQuotes.filter(q => q.changePct != null).length });
      }
    }

    // Pass 2: Yahoo fallback for tickers still missing.
    // KR skipped — Naver handles it and Yahoo is blocked from Vercel.
    // IN, CN, EU, JP: attempt Yahoo (IN especially needs this as NSE may be IP-blocked).
    const missingHoldings = country === 'KR'
      ? []
      : topHoldings.filter(h => !nonUSQuoteMap.has(h.ticker.toUpperCase()));
    if (missingHoldings.length > 0) {
      const yfSymMap = new Map(
        missingHoldings.map(h => [toYFSuffix(h.ticker, country, h.location), h.ticker.toUpperCase()])
      );
      const yfQuotes = await fetchYFNonUSQuotes(yfSymMap);
      for (const q of yfQuotes) {
        if (q.changePct != null || q.close != null) {
          nonUSQuoteMap.set(q.symbol, { changePct: q.changePct, close: q.close });
        }
      }
      logger.info('market-heatmap', 'yahoo_fallback_pass', { country, requested: missingHoldings.length, matched: yfQuotes.length });
    }
    logger.info('market-heatmap', 'nonUS_total', { country, total: topHoldings.length, resolved: nonUSQuoteMap.size });
  }

  // CNBC for index ETFs — reliable from Vercel IPs (Yahoo v8 blocked by AWS range)
  const indexCNBCQuotes = await fetchCNBCQuotes(indexConfigs.map(i => i.symbol));
  const indexYahooMap = new Map(indexCNBCQuotes.map(q => [q.symbol, q]));

  // 3. Build HeatmapStock list
  const stocks: HeatmapStock[] = topHoldings.map(h => {
    const live = country === 'US' ? stooqMap.get(h.ticker) : nonUSQuoteMap.get(h.ticker);
    return {
      ticker: h.ticker,
      name: h.name,
      sector: h.sector,
      marketCap: h.marketValue / 1e9,
      changePct: live?.changePct ?? null,
      close: live?.close ?? (h.price || null),
    };
  });

  // 4. Group by sector
  const bySector: Record<string, HeatmapStock[]> = {};
  for (const s of stocks) {
    if (!bySector[s.sector]) bySector[s.sector] = [];
    bySector[s.sector].push(s);
  }

  const sectors: HeatmapSector[] = Object.entries(bySector).map(([name, ss]) => {
    let totalMC = 0, weightedSum = 0, weightedDenom = 0;
    for (const x of ss) {
      totalMC += x.marketCap;
      if (x.changePct != null) { weightedSum += x.changePct * x.marketCap; weightedDenom += x.marketCap; }
    }
    const weighted = weightedDenom > 0 ? weightedSum / weightedDenom : null;
    return {
      sector: name,
      color: SECTOR_COLORS[name] ?? '#64748b',
      stocks: ss.sort((a, b) => b.marketCap - a.marketCap),
      totalMarketCap: totalMC,
      avgChangePct: weighted != null ? parseFloat(weighted.toFixed(2)) : null,
    };
  }).sort((a, b) => b.totalMarketCap - a.totalMarketCap);

  // 5. Build indices from Yahoo v8 (accurate day-change)
  const indices: HeatmapIndex[] = indexConfigs.map(i => {
    const q = indexYahooMap.get(i.symbol);
    return { symbol: i.symbol, label: i.label, changePct: q?.changePct ?? null, close: q?.close ?? null };
  });

  const dataDate = new Date().toISOString().slice(0, 10);
  // 2026-06-04: iShares 비US 구성 CSV 차단 → KR 은 universe 폴백으로 복구, 그 외(JP/CN/EU/TW/IN)는
  //   아직 대체 구성 소스 없어 빈 결과 → silent blank 대신 unavailable 명시(정직 + [K] 가 known 처리).
  const unavailable = sectors.length === 0 && country !== 'US';
  const data: HeatmapData = {
    country,
    countryLabel: cfg?.countryLabel ?? country,
    sectors,
    indices,
    totalStocks: stocks.length,
    updatedAt: new Date().toISOString(),
    dataDate,
    ...(unavailable ? { unavailable: true, unavailableReason: `${country} 구성종목 소스(iShares) 차단 — 대체 소스 작업 중` } : {}),
    source: country === 'US'
      ? 'iShares IVV (구성) + Stooq (종목 시세) + Yahoo v8 (지수)'
      : country === 'KR'
        ? `KR universe (구성) + Naver Finance (시세)`
        : country === 'TW'
          ? `iShares ${cfg?.etfTicker} (구성) + TWSE+TPEX (시세)`
          : country === 'IN'
            ? `iShares ${cfg?.etfTicker} (구성) + NSE India (시세)`
            : country === 'CN'
              ? `iShares ${cfg?.etfTicker} (구성) + Stooq HK (시세)`
              : `iShares ${cfg?.etfTicker} (구성) + Stooq+Yahoo (시세)`,
  };

  // 2026-07-10: silent-empty(구성소스 실패, unavailable 아님)를 Redis 에 15분 고정하던 결함 수정 —
  //   빈 결과는 명시적 unavailable 일 때만 캐시(업스트림 재시도 허용). 메모리 캐시와 동일 원칙.
  const cacheable = stocks.length > 0 || unavailable === true;
  if (redis && cacheable) {
    const t0 = Date.now();
    try {
      logger.info('market-heatmap', 'save_start', { key: cacheKey, ttl: CACHE_TTL });
      await loggedRedisSet(redis, 'api.market-heatmap', cacheKey, data, { ex: CACHE_TTL });
      logger.info('market-heatmap', 'save_ok', { key: cacheKey, durationMs: Date.now() - t0 });
    } catch (err) {
      logger.error('market-heatmap', 'save_failed', { key: cacheKey, error: err });
    }
  } else if (!redis && stocks.length > 0) {
    // Only cache non-empty to avoid pinning a failed upstream fetch
    MEMORY_CACHE.set(country, data);
  }

  return NextResponse.json({ ...data, cached: false }, { headers: CDN_HEADERS });
}
