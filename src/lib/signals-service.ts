import type { InstitutionalSignal } from '@/data/institutional-signals';
import { logger } from '@/lib/logger';
import { computeNewsGapScore, type NewsArticle } from '@/lib/alpha-vantage';
import {
  getNewsGapCache,
  setNewsGapCache,
  mergeNewsGapCache,
  type TickerNewsCache,
} from '@/lib/signals-cache';
import { Redis } from '@upstash/redis';

const REDIS_KEY_SIGNALS = 'flowvium:13f-signals:v1';

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

/** Redis에 저장된 EDGAR 13F 파싱 결과를 읽어옴. 없으면 null. */
async function get13FSignals(): Promise<InstitutionalSignal[] | null> {
  try {
    const redis = createRedis();
    if (!redis) return null;
    const data = await redis.get(REDIS_KEY_SIGNALS);
    if (!Array.isArray(data) || data.length === 0) return null;
    return data as InstitutionalSignal[];
  } catch (err) {
    logger.error('signals.service', 'get_13f_failed', { error: err });
    return null;
  }
}

/**
 * All US-listed tickers we track.
 * Ordered mid/small caps FIRST — news gap is most meaningful for less-covered stocks.
 * Large caps (always in the news) are at the end.
 *
 * 23 tickers × 1 AV call each = 23 calls/day → safely within 25/day free tier limit.
 */
const US_TICKERS_BY_PRIORITY = [
  // Tier 1: Mid/small caps + high news-gap names — signal strongest here
  'MU',   'AMAT', 'LRCX', 'KLAC', 'ALB',
  'KTOS', 'MRVL', 'RTX',  'NOC',  'LHX',
  'REGN', 'MRNA', 'COIN', 'FCX',  'SMCI',
  'DELL', 'ORCL', 'TSM',  'ASML',
  // Tier 2: Large caps — still useful for cascade context
  'NVDA', 'MSFT', 'GOOGL',
  'TSLA', 'LLY',  'LMT',
]; // 25 tickers = Alpha Vantage free tier daily limit

export interface SignalsResult {
  signals: InstitutionalSignal[];
  lastUpdated: string;
  updatedTickers: number;
  source: 'live' | 'cached' | 'static';
}

// 2026-06-13: Alpha Vantage(25콜/일 쿼터) → Yahoo 티커별 RSS 교체 (사용자 "사각지대 미루지 말고
//   개선해" — AV 쿼터를 25종목이 단독 소진해 매일 5/25 만 갱신되던 구조 한계, Finnhub company-news
//   는 유료화 401 실측). RSS 는 무인증·무쿼터, 단 전 종목 20개 캡이라 카운트 대신 *기사 밀도*
//   (pubDate 스팬 기반 일당 기사수 × 30 = 30일 환산 카운트)로 변별 — 실측: NVDA 40/일 vs CW 1.1/일.
async function fetchNewsRateRss(ticker: string): Promise<{ count: number; articles: NewsArticle[] } | null> {
  try {
    const r = await fetch(
      `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(ticker)}&region=US&lang=en-US`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000), cache: 'no-store' },
    );
    if (!r.ok) return null;
    const xml = await r.text();
    const items = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/g));
    if (!items.length) return { count: 0, articles: [] };
    const dates = items
      .map(m => Date.parse(m[1].match(/<pubDate>([^<]+)<\/pubDate>/)?.[1] ?? ''))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const spanDays = dates.length >= 2 ? Math.max((dates[dates.length - 1] - dates[0]) / 86400000, 0.5) : 30;
    const ratePerDay = items.length / spanDays;
    const count30d = Math.round(ratePerDay * 30);
    const articles: NewsArticle[] = items.slice(0, 5).map(m => ({
      title: m[1].match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1]?.trim() ?? '',
      date: m[1].match(/<pubDate>([^<]+)<\/pubDate>/)?.[1]?.slice(0, 16) ?? '',
      source: 'Yahoo Finance',
      url: m[1].match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() ?? '',
    }));
    return { count: count30d, articles };
  } catch { return null; }
}

/** Fetch fresh news-rate gap scores for all US tickers (Yahoo RSS — no quota). */
async function refreshNewsGaps(): Promise<Record<string, TickerNewsCache>> {
  const now = new Date().toISOString();
  const result: Record<string, TickerNewsCache> = {};
  const BATCH = 5;
  const DELAY_MS = 1_000; // RSS 는 쿼터 없음 — 예의상 소짧은 간격만

  for (let i = 0; i < US_TICKERS_BY_PRIORITY.length; i += BATCH) {
    const batch = US_TICKERS_BY_PRIORITY.slice(i, i + BATCH);
    const results = await Promise.allSettled(batch.map((ticker) => fetchNewsRateRss(ticker)));
    for (let j = 0; j < batch.length; j++) {
      const ticker = batch[j];
      const r = results[j];
      if (r.status === 'rejected') {
        logger.error('signals.service', 'news_fetch_failed', { ticker, error: r.reason });
      }
      if (r.status === 'fulfilled' && r.value !== null) {
        result[ticker] = {
          score: computeNewsGapScore(r.value.count),
          articles: r.value.count,
          recentArticles: r.value.articles,
          updatedAt: now,
        };
      }
    }
    if (i + BATCH < US_TICKERS_BY_PRIORITY.length) {
      await new Promise((res) => setTimeout(res, DELAY_MS));
    }
  }
  return result;
}

/**
 * Apply a news gap cache map onto the static signal array.
 * Only newsGapScore + mediaArticles are overwritten — ownership data stays from 13F.
 */
function applyNewsGaps(
  base: InstitutionalSignal[],
  cache: Record<string, TickerNewsCache>
): InstitutionalSignal[] {
  return base.map((s) => {
    const entry = cache[s.ticker];
    if (!entry) return s;
    return { ...s, newsGapScore: entry.score, mediaArticles: entry.articles };
  });
}

/**
 * EDGAR 13F는 한 기관 내 자회사/계좌별로 행이 분리돼 있어
 * 같은 (institution, ticker)가 accumulating/reducing 으로 번갈아 표시됨.
 * (institution, ticker) 기준으로 sharesChanged 합산 후 net 방향으로 통합.
 */
function aggregateByInstitutionTicker(signals: InstitutionalSignal[]): InstitutionalSignal[] {
  const map = new Map<string, InstitutionalSignal & { _netShares: number }>();

  for (const s of signals) {
    const key = `${s.institution}::${s.ticker}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...s, _netShares: s.sharesChanged });
    } else {
      const netShares = existing._netShares + s.sharesChanged;
      const totalShares = Math.max(existing.totalShares, s.totalShares);
      // Keep the most recent filing date
      const filingDate = existing.filingDate > s.filingDate ? existing.filingDate : s.filingDate;
      // Parse "$X.XB"/"$X.XM" to sum estimated values
      const parseVal = (v: string) => {
        const m = v.match(/([\d.]+)([BM])?/);
        if (!m) return 0;
        const n = parseFloat(m[1]);
        return m[2] === 'B' ? n * 1000 : n; // normalize to $M
      };
      const totalM = parseVal(existing.estimatedValue) + parseVal(s.estimatedValue);
      const estimatedValue = totalM >= 1000 ? `$${(totalM / 1000).toFixed(1)}B` : `$${Math.round(totalM)}M`;
      map.set(key, { ...existing, _netShares: netShares, totalShares, filingDate, estimatedValue });
    }
  }

  return Array.from(map.values()).map(({ _netShares, ...s }) => ({
    ...s,
    sharesChanged: _netShares,
    action: _netShares > 0 ? 'accumulating' : _netShares < 0 ? 'reducing' : s.action,
  }));
}

/**
 * Main entry point called by the signals server component.
 *
 * Strategy:
 * 1. Redis 13F 데이터 확인 (EDGAR 크론이 저장한 실제 파싱 데이터)
 * 2. 없으면 정적 데이터 사용
 * 3. Alpha Vantage 뉴스갭 스코어 오버레이
 * 4. Persist refreshed data to Redis (26h TTL)
 */
// 재진입 방지: refreshNewsGaps 이 이미 돌고 있으면 또 kick off 하지 않는다.
// 서버리스 인스턴스 수명 내에서만 유효 (cold start 후 초기화).
let backgroundRefreshInFlight = false;

// 2026-06-04: getSignals 가 매 요청 762KB(13f-ownership) Upstash GET(~11s)을 읽어 22s 소요 →
//   /screener·/intelligence 가 빈 화면으로 보임. pm2 장수 프로세스 메모리 캐시로 첫 로드 외 즉시 응답.
let _signalsMemCache: { data: SignalsResult; expiresAt: number } | null = null;
const SIGNALS_MEM_TTL = 15 * 60 * 1000; // 15분 — 13F 는 분기, news-gap 은 일 단위라 충분

export async function getSignals(forceRefresh = false): Promise<SignalsResult> {
  if (!forceRefresh && _signalsMemCache && Date.now() < _signalsMemCache.expiresAt) {
    return _signalsMemCache.data;
  }
  const _cache = (r: SignalsResult): SignalsResult => {
    _signalsMemCache = { data: r, expiresAt: Date.now() + SIGNALS_MEM_TTL };
    return r;
  };
  const lastUpdated = new Date().toISOString();

  // === 1. EDGAR 13F Redis 데이터 우선 사용 ===
  const liveSignals = await get13FSignals();
  // 하드코딩 institutionalSignals 폴백 제거 — stale 데이터가 실데이터처럼 보이는 문제 방지.
  // 크론이 한 번도 안 돌았거나 Redis 비어있으면 빈 배열 반환 (투명한 실패).
  // 2026-06-13: 구분기 filing 필터 (사용자 /signals 감사 "16개월 전 accumulating 이 현재 신호처럼
  //   읽힘") — 13F 는 분기 공시라 2분기(190d) 이전 행은 현재 수급 신호로 무의미 → 제외.
  //   실측: 2024-08~ filing 139행이 2026-05 행과 혼재 표시되던 것.
  const FILING_MAX_AGE_MS = 190 * 86400000;
  const freshSignals = (liveSignals ?? []).filter(s => {
    const t = Date.parse(s.filingDate ?? '');
    return Number.isFinite(t) && Date.now() - t <= FILING_MAX_AGE_MS;
  });
  // EDGAR 13F는 자회사/계좌별 행 분리 → (institution, ticker) 기준으로 집계
  const baseSignals = aggregateByInstitutionTicker(freshSignals);
  // 2026-06-13: 뉴스갭 소스가 Yahoo RSS(무키) 전환 — AV 키 게이트 제거.

  // === Try Redis cache ===
  const cached = await getNewsGapCache();

  if (cached && !forceRefresh) {
    return _cache({
      signals: applyNewsGaps(baseSignals, cached),
      lastUpdated,
      updatedTickers: Object.keys(cached).length,
      source: 'cached',
    });
  }

  // === 캐시 없음: stale-while-revalidate ===
  // refreshNewsGaps 는 AV 무료 티어 5req/min 제약 때문에 ceil(N/5)*12s 걸림
  // (100 tickers = 4분). SSR 페이지가 이걸 블록하면 사용자 타임아웃.
  // 해결: base signals 즉시 반환 + 백그라운드에서 refresh kick off.
  // 다음 요청에서 Redis 캐시 히트로 live 데이터 제공. 첫 요청만 static.
  if (!backgroundRefreshInFlight) {
    backgroundRefreshInFlight = true;
    // fire-and-forget — Promise 버려도 serverless runtime 이 완료까지 유지 (best-effort)
    (async () => {
      try {
        const fresh = await refreshNewsGaps();
        const merged = mergeNewsGapCache(cached, fresh);
        await setNewsGapCache(merged);
        logger.info('signals.service', 'background_refresh_ok', { updatedTickers: Object.keys(fresh).length });
      } catch (err) {
        logger.error('signals.service', 'background_refresh_failed', { error: err });
      } finally {
        backgroundRefreshInFlight = false;
      }
    })();
    logger.info('signals.service', 'background_refresh_started');
  }

  // 사용자는 즉시 base signals 받는다 (news gap score 는 다음 요청부터)
  return _cache({
    signals: baseSignals,
    lastUpdated,
    updatedTickers: 0,
    source: liveSignals ? 'live' : 'static',
  });
}
