import { logger, loggedRedisSet } from '@/lib/logger';
/**
 * /api/short-interest
 *
 * Returns tracked tickers with EDGAR 13F institutional action, FINRA daily short
 * volume ratio (free, no auth), Yahoo v10 short float %, and squeeze score.
 *
 * shortVolPct = FINRA daily ShortVolume / TotalVolume × 100
 * shortFloatPct = Yahoo v10 defaultKeyStatistics.shortPercentOfFloat (crumb auth,
 *   same key as sector-pe — confirmed working from Vercel IPs as of iter186)
 *
 * Redis cache: 4 hours
 */
import { NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import type { Redis } from '@upstash/redis';
import type { InstitutionalSignal } from '@/data/institutional-signals';
import { resolve } from 'path';
import Database from 'better-sqlite3';
import { createMemoryCache } from '@/lib/memory-cache';
export const dynamic = 'force-dynamic';

export const maxDuration = 60;

const CACHE_KEY = 'flowvium:short-interest:v6'; // v6: {entries, updatedAt} 래퍼 (신선도 표기 - alive!=fresh)
const CACHE_TTL = 4 * 60 * 60; // 4 hours
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=14400, stale-while-revalidate=600' };
// Redis-less fallback — 30min TTL (short-interest changes twice daily but we
// don't want stale data locked in for 4h on warm instances).
const MEMORY_CACHE = createMemoryCache<unknown[]>('short-interest', 30 * 60_000);
const MEM_KEY = 'entries';

// Yahoo crumb — shared with sector-pe (same CRUMB_KEY)
const CRUMB_KEY = 'flowvium:yahoo:crumb:v1';
const CRUMB_TTL = 22 * 60 * 60; // match sector-pe — crumbs last ~24h
const YF_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

async function getYahooCrumb(redis: Redis | null): Promise<{ crumb: string; cookie: string } | null> {
  if (redis) {
    try {
      const cached = await redis.get<{ crumb: string; cookie: string }>(CRUMB_KEY);
      if (cached?.crumb) return cached;
    } catch { /* non-fatal */ }
  }
  try {
    const homeRes = await fetch('https://finance.yahoo.com/', {
      headers: { 'User-Agent': YF_UA, 'Accept': 'text/html' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!homeRes.ok) return null;
    // Use getSetCookie() (same as sector-pe) to correctly parse multiple Set-Cookie headers.
    // headers.get('set-cookie') returns a comma-concatenated string of full Set-Cookie values
    // (including Path=, Domain=, etc.) which is invalid as a Cookie request header.
    const rawCookies = homeRes.headers.getSetCookie?.() ?? [];
    const cookie = rawCookies
      .map(c => c.split(';')[0])
      .filter(c => c.startsWith('A1=') || c.startsWith('A3=') || c.startsWith('A1S='))
      .join('; ');
    if (!cookie) return null;
    // query2 먼저, 실패 시 query1 재시도 (두 호스트 중 하나는 항상 응답)
    let crumb = '';
    for (const host of ['query2', 'query1']) {
      const crumbRes = await fetch(`https://${host}.finance.yahoo.com/v1/test/getcrumb`, {
        headers: { 'User-Agent': YF_UA, 'Cookie': cookie },
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      });
      if (!crumbRes.ok) continue;
      const text = (await crumbRes.text()).trim();
      if (text && !text.startsWith('{')) { crumb = text; break; }
    }
    if (!crumb) return null;
    const result = { crumb, cookie };
    await loggedRedisSet(redis, 'api.short-interest', CRUMB_KEY, result, { ex: CRUMB_TTL });
    return result;
  } catch (e) {
    logger.warn('api.short-interest', 'crumb_failed', { error: String(e) });
    return null;
  }
}

/** Fetch shortPercentOfFloat + shortRatio from Yahoo v10 defaultKeyStatistics.
 *  Both fields live in the same module — no extra request cost. */
async function fetchYahooShortData(
  tickers: string[],
  crumb: string,
  cookie: string,
): Promise<{ floatMap: Map<string, number>; ratioMap: Map<string, number> }> {
  const floatMap = new Map<string, number>();
  const ratioMap = new Map<string, number>();
  const CONCURRENT = 6;

  function rawVal(field: unknown): number | null {
    if (field && typeof field === 'object' && 'raw' in (field as object)) {
      const v = (field as { raw: unknown }).raw;
      return typeof v === 'number' ? v : null;
    }
    return typeof field === 'number' ? field : null;
  }

  for (let i = 0; i < tickers.length; i += CONCURRENT) {
    const batch = tickers.slice(i, i + CONCURRENT);
    const settled = await Promise.allSettled(
      batch.map(async ticker => {
        const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=defaultKeyStatistics&crumb=${encodeURIComponent(crumb)}`;
        const res = await fetch(url, {
          headers: { 'User-Agent': YF_UA, 'Cookie': cookie },
          cache: 'no-store',
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return null;
        const json = await res.json();
        const ks = json?.quoteSummary?.result?.[0]?.defaultKeyStatistics ?? {};
        const floatRaw = rawVal(ks?.shortPercentOfFloat);
        const ratioRaw = rawVal(ks?.shortRatio);
        return {
          ticker,
          pct: floatRaw !== null ? parseFloat((floatRaw * 100).toFixed(1)) : null,
          ratio: ratioRaw !== null ? parseFloat(ratioRaw.toFixed(2)) : null,
        };
      })
    );
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) {
        const { ticker, pct, ratio } = r.value;
        if (pct !== null) floatMap.set(ticker, pct);
        if (ratio !== null) ratioMap.set(ticker, ratio);
      }
    }
    if (i + CONCURRENT < tickers.length) await new Promise(res => setTimeout(res, 150));
  }
  logger.info('api.short-interest', 'yahoo_short_data_ok', { floatFetched: floatMap.size, ratioFetched: ratioMap.size, of: tickers.length });
  return { floatMap, ratioMap };
}

/**
 * 대상 종목 — 2026-09-13 이전에는 여기 33종이 손으로 박혀 있었다.
 *
 * 그 33종만 재면서 "숏스퀴즈를 찾는다" 고 할 수 없었다. 실측으로 확인된 결과:
 *   · 매수룰 micro_squeeze_score(임계 50)는 개통 이래 0건 발화
 *   · 33종 중 임계를 넘는 건 MRNA(65)·COIN(55) 둘뿐, 둘 다 후보 30위에 든 적 없음
 *   · 풀 전체 715종을 재 보니 공매도 비중 상위는 BROS 41.5% · SWKS 36.4% · CAKE 36.2% ·
 *     WEN 35.3% · RXRX 35.0% 였다. MRNA 는 12% 로 근처도 아니었다.
 *     33종 안에서만 1등이었을 뿐이다.
 *
 * 이제 ingest-short-interest.mjs 가 풀 전체를 순환하며 공매도 잔고를 적재하고,
 * 여기서는 **실측 공매도 비중 상위 N종**을 골라 상세(FINRA 일간·기관수급)를 붙인다.
 * 손으로 고른 목록이 아니라 잰 값으로 고른다.
 *
 * 적재가 비어 있으면(최초 실행·DB 없음) 종전 목록으로 떨어진다 — 조용히 0종이 되지 않게.
 */
const FALLBACK_TICKERS = [
  'NVDA', 'AMD', 'ARM', 'TSM', 'ASML', 'MU', 'AMAT', 'LRCX', 'KLAC', 'SMCI', 'MRVL',
  'TSLA', 'ALB', 'RIVN', 'COIN', 'MSTR', 'MRNA', 'REGN', 'LLY',
  'KTOS', 'PLTR', 'RTX', 'NOC', 'LHX', 'LMT', 'FCX',
  'DELL', 'ORCL', 'MSFT', 'GOOGL', 'AAPL', 'AMZN', 'META',
];

/** 상세를 붙일 상한. 종목마다 FINRA·Yahoo 왕복이 있어 보고서의 12초 예산을 넘기면 안 된다. */
const DETAIL_LIMIT = Number(process.env.SHORT_INTEREST_DETAIL_LIMIT ?? 45);

function trackedTickers(): string[] {
  try {
    const db = new Database(resolve(process.cwd(), 'data/flowvium.db'), { readonly: true, fileMustExist: true });
    try {
      const rows = db.prepare(
        `SELECT ticker FROM short_interest
          WHERE short_pct_float IS NOT NULL
          ORDER BY short_pct_float DESC LIMIT ?`,
      ).all(DETAIL_LIMIT) as Array<{ ticker: string }>;
      if (rows.length) {
        // 종전 목록의 종목도 같이 본다 — 비중이 낮아도 사람이 계속 보던 이름들이다.
        return Array.from(new Set([...rows.map((r) => r.ticker), ...FALLBACK_TICKERS]));
      }
    } finally { db.close(); }
  } catch (e) {
    // 조용히 폴백하지 않는다 — 33종으로 돌아간 걸 모르면 "재고 있다" 고 착각한다.
    logger.warn('api.short-interest', 'tracked_from_db_failed', { error: String((e as Error)?.message).slice(0, 160) });
    return FALLBACK_TICKERS;
  }
  logger.warn('api.short-interest', 'tracked_from_db_empty', { note: 'short_interest table empty - check ingest-short-interest.mjs ran' });
  return FALLBACK_TICKERS;
}

export interface ShortEntry {
  ticker: string;
  companyName: string;
  sector: string;
  shortFloatPct: number | null;      // Yahoo v10 defaultKeyStatistics.shortPercentOfFloat (live)
  shortVolPct: number | null;        // FINRA daily: ShortVolume / TotalVolume × 100
  shortRatio: number | null;         // DaysToCover from FINRA monthly short interest file
  shortChangeMonthly: number | null;
  instAction: string | null;
  trailingPE: number | null;         // Finnhub peBasicExclExtraTTM (TTM P/E)
  squeezeScore: number;
}

/** Compute short squeeze score.
 * shortFloatPct: Yahoo v10 defaultKeyStatistics (up to 40pts — iter186 fix)
 * shortRatio (DTC): Yahoo v10 defaultKeyStatistics.shortRatio (same crumb request as shortFloatPct)
 * shortChangeMoM: always null (requires bi-monthly FINRA + float data)
 */
function calcSqueezeScore(
  shortFloatPct: number | null,
  shortVolPct: number | null,
  instAction: string | null,
): number {
  let score = 0;

  if (shortFloatPct != null) {
    if (shortFloatPct > 30) score += 40;
    else if (shortFloatPct > 20) score += 30;
    else if (shortFloatPct > 10) score += 20;
    else if (shortFloatPct > 5) score += 10;
  }

  // Normal range 40-55%; > 60% indicates unusual short-side pressure
  if (shortVolPct != null) {
    if (shortVolPct > 60) score += 25;
    else if (shortVolPct > 55) score += 15;
    else if (shortVolPct > 50) score += 8;
    else if (shortVolPct > 45) score += 3;
  }

  if (instAction === 'accumulating') score += 20;
  if (instAction === 'new_position') score += 15;

  return Math.min(100, score);
}

/** Fetch FINRA consolidated short volume for given tickers (previous trading day) */
async function fetchFinraShortVol(tickers: Set<string>): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const now = new Date();

  for (let daysBack = 1; daysBack <= 5; daysBack++) {
    const d = new Date(now);
    d.setDate(d.getDate() - daysBack);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue; // skip weekends

    const yyyymmdd = d.toISOString().slice(0, 10).replace(/-/g, '');
    const url = `https://cdn.finra.org/equity/regsho/daily/CNMSshvol${yyyymmdd}.txt`;

    try {
      const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;

      const text = await res.text();
      for (const line of text.split('\n')) {
        const parts = line.split('|');
        if (parts.length < 5) continue;
        const sym = parts[1];
        if (!tickers.has(sym)) continue;
        const shortVol = parseFloat(parts[2]);
        const totalVol = parseFloat(parts[4]);
        if (!isNaN(shortVol) && !isNaN(totalVol) && totalVol > 0) {
          map.set(sym, parseFloat(((shortVol / totalVol) * 100).toFixed(1)));
        }
      }
      if (map.size > 0) {
        logger.info('api.short-interest', 'finra_ok', { date: yyyymmdd, matched: map.size, of: tickers.size });
        break;
      }
    } catch (e) {
      logger.warn('api.short-interest', 'finra_fetch_error', { daysBack, error: e });
    }
  }
  return map;
}

interface FinraSI { changePct: number | null; daysToCover: number | null; shortQty: number | null; }
/**
 * FINRA consolidatedShortInterest — 월간(bi-monthly) 공매도 잔고 + MoM 변화율(changePercent).
 * 2026-06-04: 자가호스팅(주거 IP) 전환으로 api.finra.org 접근 가능(이전 Vercel IP 403 → shortChangeMonthly
 *   영구 null 이던 것 해결). 종목별 최근 settlementDate 범위 쿼리 → 최신 기간 changePercent 추출.
 */
async function fetchFinraShortInterest(tickers: string[]): Promise<Map<string, FinraSI>> {
  const map = new Map<string, FinraSI>();
  const now = Date.now();
  const startDate = new Date(now - 100 * 86400000).toISOString().slice(0, 10);
  const endDate = new Date(now + 5 * 86400000).toISOString().slice(0, 10);
  const queue = [...tickers];
  const worker = async () => {
    while (queue.length) {
      const t = queue.shift();
      if (!t) break;
      try {
        const body = {
          limit: 8,
          compareFilters: [{ compareType: 'EQUAL', fieldName: 'symbolCode', fieldValue: t }],
          dateRangeFilters: [{ fieldName: 'settlementDate', startDate, endDate }],
        };
        const r = await fetch('https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body),
          cache: 'no-store',
          signal: AbortSignal.timeout(8000),
        });
        if (!r.ok) continue;
        const j = await r.json();
        const arr = (Array.isArray(j) ? j : (j?.data ?? [])) as Array<Record<string, unknown>>;
        if (!arr.length) continue;
        arr.sort((a, b) => String(b.settlementDate).localeCompare(String(a.settlementDate)));
        const x = arr[0];
        map.set(t, {
          changePct: typeof x.changePercent === 'number' ? Math.round(x.changePercent * 10) / 10 : null,
          daysToCover: typeof x.daysToCoverQuantity === 'number' ? Math.round(x.daysToCoverQuantity * 100) / 100 : null,
          shortQty: typeof x.currentShortPositionQuantity === 'number' ? x.currentShortPositionQuantity : null,
        });
      } catch { /* skip ticker */ }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  logger.info('api.short-interest', 'finra_si_ok', { matched: map.size, of: tickers.length });
  return map;
}

/** Fetch trailing P/E from Finnhub metric endpoint (one request per ticker) */
async function fetchFinnhubPE(tickers: string[]): Promise<Map<string, number>> {
  const key = process.env.FINNHUB_KEY?.trim();
  if (!key) return new Map();

  const map = new Map<string, number>();
  const results = await Promise.allSettled(
    tickers.map(ticker =>
      fetch(
        `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(ticker)}&metric=all&token=${encodeURIComponent(key)}`,
        { cache: 'no-store', signal: AbortSignal.timeout(8000) }
      )
        .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
        .then((data: { metric?: Record<string, number | null> }) => ({
          ticker,
          pe: data?.metric?.peBasicExclExtraTTM ?? data?.metric?.peNormalizedAnnual ?? null,
        }))
    )
  );

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.pe != null && typeof r.value.pe === 'number' && r.value.pe > 0 && r.value.pe < 10000) {
      map.set(r.value.ticker, parseFloat(r.value.pe.toFixed(1)));
    }
  }

  logger.info('api.short-interest', 'finnhub_pe_ok', { fetched: map.size, of: tickers.length });
  return map;
}

export async function GET(req: Request) {
  const reqStart = Date.now();
  const redis = createRedis();
  const forceRefresh = new URL(req.url).searchParams.get('refresh') === '1';

  // Try cache
  if (redis && !forceRefresh) {
    try {
      const cached = await redis.get(CACHE_KEY);
      if (cached) {
        const wrap = cached as { entries?: Array<{ instAction?: string | null }>; updatedAt?: string };
        const cachedEntries = Array.isArray(cached) ? cached as Array<{ instAction?: string | null }> : (wrap.entries ?? []);
        const cachedInstSource = cachedEntries.some(e => e.instAction != null) ? 'live' : 'empty';
        logger.info('api.short-interest', 'cache_hit', { cachedEntries: cachedEntries.length });
        return NextResponse.json({ entries: cachedEntries, updatedAt: Array.isArray(cached) ? null : (wrap.updatedAt ?? null), instSource: cachedInstSource, cached: true, source: 'cached' }, { headers: CDN_HEADERS });
      }
    } catch (err) { logger.warn('api.short-interest', 'cache_read_error', { error: err }); }
  } else if (!redis && !forceRefresh) {
    const mem = MEMORY_CACHE.get(MEM_KEY);
    if (mem && Array.isArray(mem) && mem.length > 0) {
      const memEntries = mem as Array<{ instAction?: string | null }>;
      const memInstSource = memEntries.some(e => e.instAction != null) ? 'live' : 'empty';
      return NextResponse.json({ entries: mem, instSource: memInstSource, cached: true, cacheLayer: 'memory', source: 'cached' }, { headers: CDN_HEADERS });
    }
  }

  // Deduplicate tickers
  const tickers = trackedTickers();
  const tickerSet = new Set(tickers);

  // Fetch FINRA short vol, Finnhub P/E, 13f-signals, and Yahoo shortFloat in parallel.
  // Yahoo path: crumb (shared with sector-pe) → v10 quoteSummary per ticker.
  // DTC (FINRA monthly): cdn.finra.org 403 from Vercel IPs; no free alternative — iter86
  const [finraMap, peMap, redisSignals, shortDataResult, finraSiResult] = await Promise.allSettled([
    fetchFinraShortVol(tickerSet),
    fetchFinnhubPE(tickers),
    redis ? redis.get<InstitutionalSignal[]>('flowvium:13f-signals:v1') : Promise.resolve(null),
    getYahooCrumb(redis).then(c =>
      c ? fetchYahooShortData(tickers, c.crumb, c.cookie)
        : { floatMap: new Map<string, number>(), ratioMap: new Map<string, number>() }
    ),
    fetchFinraShortInterest(tickers),
  ]);
  const finraSiMap = finraSiResult.status === 'fulfilled' ? finraSiResult.value : new Map<string, FinraSI>();
  const shortVolMap = finraMap.status === 'fulfilled' ? finraMap.value : new Map<string, number>();
  const trailingPEMap = peMap.status === 'fulfilled' ? peMap.value : new Map<string, number>();
  const liveRaw = redisSignals.status === 'fulfilled' ? redisSignals.value : null;
  const shortFloatMap = shortDataResult.status === 'fulfilled' ? shortDataResult.value.floatMap : new Map<string, number>();
  const shortRatioMap = shortDataResult.status === 'fulfilled' ? shortDataResult.value.ratioMap : new Map<string, number>();
  const liveSignals: InstitutionalSignal[] = (Array.isArray(liveRaw) && liveRaw.length > 0)
    ? liveRaw as InstitutionalSignal[]
    : [];
  const instSource: 'live' | 'empty' = liveSignals.length > 0 ? 'live' : 'empty';

  // Latest action per ticker (most recent filing date) — O(n) single pass
  const instActionMap = new Map<string, string>();
  const instSectorMap = new Map<string, string>();
  const instNameMap = new Map<string, string>();
  const instFilingDateMap = new Map<string, string>();

  for (const sig of liveSignals) {
    const existingDate = instFilingDateMap.get(sig.ticker) ?? '';
    if (sig.filingDate > existingDate) {
      instActionMap.set(sig.ticker, sig.action);
      instSectorMap.set(sig.ticker, sig.sector);
      instNameMap.set(sig.ticker, sig.companyName);
      instFilingDateMap.set(sig.ticker, sig.filingDate);
    }
  }

  const entries: ShortEntry[] = tickers.map(ticker => {
    const instAction = instActionMap.get(ticker) ?? null;
    const sector = instSectorMap.get(ticker) ?? 'other';
    const companyName = instNameMap.get(ticker) ?? ticker;

    const shortVolPct = shortVolMap.get(ticker) ?? null;
    const shortFloatPct = shortFloatMap.get(ticker) ?? null;
    const finraSi = finraSiMap.get(ticker);
    // shortRatio: Yahoo daysToCover 우선, 없으면 FINRA daysToCover. shortChangeMonthly: FINRA MoM changePercent.
    const shortRatio = shortRatioMap.get(ticker) ?? finraSi?.daysToCover ?? null;
    const trailingPE = trailingPEMap.get(ticker) ?? null;
    return {
      ticker,
      companyName,
      sector,
      shortFloatPct,
      shortVolPct,
      shortRatio,
      shortChangeMonthly: finraSi?.changePct ?? null,
      instAction,
      trailingPE,
      squeezeScore: calcSqueezeScore(shortFloatPct, shortVolPct, instAction),
    };
  });

  // Sort: highest squeeze score first
  entries.sort((a, b) => b.squeezeScore - a.squeezeScore);

  await loggedRedisSet(redis, 'api.short-interest', CACHE_KEY, { entries, updatedAt: new Date().toISOString() }, { ex: CACHE_TTL });
  if (!redis && entries.length > 0) MEMORY_CACHE.set(MEM_KEY, entries);
  logger.info('api.short-interest', 'served', {
    tickers: tickers.length,
    entries: entries.length,
    instSource,
    topScore: entries[0]?.squeezeScore ?? 0,
    durationMs: Date.now() - reqStart,
  });

  const liveSource = entries.length === 0 ? 'empty' : 'live';
  return NextResponse.json({ entries, updatedAt: new Date().toISOString(), instSource, cached: false, source: liveSource }, { headers: CDN_HEADERS });
}
