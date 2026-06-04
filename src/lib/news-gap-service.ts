import { newsGapData, type NewsGapEntry, type OwnershipRecord } from '@/data/news-gap';
import { getNewsGapCache } from '@/lib/signals-cache';
import { UNIVERSE_SEARCH } from '@/data/universe-search';
import { Redis } from '@upstash/redis';
import { logger } from '@/lib/logger';

const REDIS_KEY_OWNERSHIP = 'flowvium:13f-ownership:v1';

// ticker → {name, sector} (UNIVERSE_SEARCH 권위 맵) + 정적 newsGapData 의 richer 메타.
const UNIV = new Map(UNIVERSE_SEARCH.map(c => [c.ticker, c]));
const STATIC_BY_TICKER = new Map(newsGapData.map(e => [e.ticker, e]));

/** 라이브 13F 보유 데이터에서 기관활동 점수(0-100) 계산 — 정적/하드코딩 50 대체. */
function computeIbActivity(own: OwnershipRecord[]): { score: number; level: 'high' | 'medium' | 'low' } {
  // breadth(기관 수)는 종목마다 ~top15 로 비슷해 변별력 없음(100 포화) → 기관당 *순매수 강도*가 진짜 신호.
  //   net = (신규*1.5 + 증가 − 감소) / 기관수, 50 기준 ±45 로 스케일. 누적 매수 종목 ↑, 분산 종목 ↓.
  const n = own.length || 1;
  const newN = own.filter(o => o.action === 'new').length;
  const incN = own.filter(o => o.action === 'increased').length;
  const redN = own.filter(o => o.action === 'reduced').length;
  const net = (newN * 1.5 + incN - redN) / n;
  const score = Math.max(5, Math.min(100, Math.round(50 + net * 45)));
  const level = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';
  return { score, level };
}

function mediaScoreFrom(articles: number | undefined): number {
  if (articles == null) return 20; // 미디어 데이터 없음 = 낮은 커버리지(=갭의 일부)
  return Math.min(100, Math.round(Math.sqrt(articles) * 5));
}

export interface NewsGapResult {
  entries: NewsGapEntry[];
  lastUpdated: string;
  source: 'live' | 'cached' | 'static';
  updatedTickers: number;
}

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

/** Redis에서 EDGAR 파싱된 ownership 데이터 조회 */
async function getLiveOwnership(): Promise<Record<string, OwnershipRecord[]> | null> {
  try {
    const redis = createRedis();
    if (!redis) return null;
    const data = await redis.get(REDIS_KEY_OWNERSHIP);
    if (!data || typeof data !== 'object') return null;
    return data as Record<string, OwnershipRecord[]>;
  } catch (err) {
    logger.error('news-gap.service', 'get_ownership_failed', { error: err });
    return null;
  }
}

/**
 * Reads the shared news-gap Redis cache (written by the signals cron / signals-service).
 * Overlays:
 *   1. EDGAR 13F ownership 데이터 (실시간 파싱)
 *   2. Alpha Vantage mediaScore, gapScore, 실제 기사 헤드라인
 *
 * Zero additional Alpha Vantage calls — shares the same 25-ticker daily fetch budget.
 */
// 2026-06-04: getNewsGapData 도 762KB(13f-ownership) Upstash GET(~11s)을 읽어 느림 → /api/news-gap
//   (Company/Compare/Signals 페이지가 fetch) 가 빈 화면 지연. signals 와 동일하게 pm2 메모리 캐시.
let _newsGapMemCache: { data: NewsGapResult; expiresAt: number } | null = null;
const NEWSGAP_MEM_TTL = 15 * 60 * 1000;

export async function getNewsGapData(): Promise<NewsGapResult> {
  if (_newsGapMemCache && Date.now() < _newsGapMemCache.expiresAt) return _newsGapMemCache.data;
  const _cache = (r: NewsGapResult): NewsGapResult => {
    _newsGapMemCache = { data: r, expiresAt: Date.now() + NEWSGAP_MEM_TTL };
    return r;
  };
  const lastUpdated = new Date().toISOString();

  const [cached, liveOwnership] = await Promise.all([
    getNewsGapCache(),
    getLiveOwnership(),
  ]);

  const source = liveOwnership ? 'live' : cached ? 'cached' : 'static';

  if (!cached && !liveOwnership) {
    // static fallback 은 캐시하지 않음(다음 요청에서 live 재시도) — 빈 결과만 즉시 반환.
    return {
      entries: [...newsGapData].sort((a, b) => b.gapScore - a.gapScore),
      lastUpdated,
      source: 'static',
      updatedTickers: 0,
    };
  }

  let entries: NewsGapEntry[];

  if (liveOwnership && Object.keys(liveOwnership).length > 0) {
    // 동적 모드: 종목 셋을 라이브 13F 보유 ticker 에서 결정 + 점수 계산(정적 리스트 의존 제거).
    //   이전엔 정적 newsGapData(Q1 2026) 가 종목 셋을 고정 + 동적 ticker 는 score 50 하드코딩이라
    //   "변하는 게 없다"는 사용자 지적. 이제 매 분기 13F + 매일 미디어로 셋·점수 모두 갱신.
    entries = Object.entries(liveOwnership).map(([ticker, ownership]) => {
      const live = cached?.[ticker];
      const stat = STATIC_BY_TICKER.get(ticker);
      const univ = UNIV.get(ticker);
      const { score: ibActivityScore, level: ibActivityLevel } = computeIbActivity(ownership);
      const mediaScore = mediaScoreFrom(live?.articles);
      // gapScore = 높은 기관활동 + 낮은 미디어 (news-gap thesis). 라이브 score 있으면 우선.
      const gapScore = live?.score ?? Math.round(ibActivityScore * (1 - mediaScore / 100));
      return {
        ticker,
        companyName: univ?.name ?? stat?.companyName ?? ticker,
        sector: univ?.sector ?? stat?.sector ?? 'other',
        ibActivityLevel,
        ibActivityScore,
        mediaScore,
        gapScore,
        topInstitutions: ownership.map(o => o.institution).slice(0, 3),
        recentArticles: live?.recentArticles?.length ? live.recentArticles : (stat?.recentArticles ?? []),
        ibActions: stat?.ibActions ?? [],
        ownershipData: ownership,
      };
    });
  } else {
    // cached(미디어)만 있고 13F 없음 → 정적 셋에 미디어 점수만 overlay.
    entries = newsGapData.map((entry) => {
      const live = cached?.[entry.ticker];
      return {
        ...entry,
        gapScore: live?.score ?? entry.gapScore,
        mediaScore: live ? mediaScoreFrom(live.articles) : entry.mediaScore,
        recentArticles: live?.recentArticles?.length ? live.recentArticles : entry.recentArticles,
      };
    });
  }

  // Sort: strongest signal first
  entries.sort((a, b) => b.gapScore - a.gapScore);

  const updatedTickers = new Set([
    ...(Object.keys(cached ?? {})),
    ...(Object.keys(liveOwnership ?? {})),
  ].filter(t => entries.some(e => e.ticker === t))).size;

  return _cache({
    entries,
    lastUpdated,
    source,
    updatedTickers,
  });
}
