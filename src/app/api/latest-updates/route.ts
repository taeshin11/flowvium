import { logger, loggedRedisSet } from '@/lib/logger';
/**
 * /api/latest-updates
 *
 * 모든 소스에서 최신 업데이트를 통합하여 시간순 피드로 반환.
 *
 * 이중 경로 (self-healing):
 *   1. Redis에서 cached snapshot 읽기 (빠름)
 *   2. 실패 시 내부 /api/* 엔드포인트 live fetch (느리지만 확실)
 *
 * 이렇게 하면 Vercel 환경변수 Redis 설정 누락 시에도 LiveFeed가 살아있음.
 *
 * 소스:
 *   - Fear & Greed (/api/fear-greed)
 *   - Capital Flows 상위 변동 (/api/capital-flows)
 *   - Macro Indicators (/api/macro-indicators)
 *   - FedWatch (/api/fedwatch)
 *   - News Cascade (/api/news-cascade 또는 Redis)
 *   - Institutional Signals (정적 + Redis 13F)
 *   - News Gap 기사
 *
 * Redis cache: 15분
 */
import { NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import { buildMacroLabels } from '@/lib/macro-label';
import type { Redis } from '@upstash/redis';
import type { InstitutionalSignal } from '@/data/institutional-signals';
import { newsGapData } from '@/data/news-gap';
import { getUpcomingEvents, daysUntil } from '@/data/econ-calendar';
import { listKey as newsListKey, translatedKey as newsTranslatedKey } from '@/lib/news-cache-keys';
import { localizeLabel, relativeDayLabel } from '@/lib/update-labels';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CACHE_TTL = 15 * 60;
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=60' };

export interface UpdateItem {
  id: string;
  type: 'signal' | 'news' | 'flow' | 'market' | 'fear' | 'macro' | 'fed' | 'credit' | 'newsgap';
  headline: string;
  sub: string;
  time: string;       // 사람이 읽는 라벨 "2026/4/21 14:36:00" 등
  sortTime: string;   // ISO 타임스탬프 (내부 정렬용)
  source: string;
  badge: string;
  badgeColor: string;
  link?: string;
  direction?: 'up' | 'down' | 'neutral';
}

async function getBaseSignals(redis: Redis | null): Promise<InstitutionalSignal[]> {
  if (!redis) return [];
  try {
    const data = await redis.get('flowvium:13f-signals:v1');
    if (Array.isArray(data) && data.length > 0) return data as InstitutionalSignal[];
  } catch { /* non-fatal */ }
  return [];
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  const yyyy = d.getFullYear();
  const mm = d.getMonth() + 1;
  const dd = d.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd} ${hh}:${min}`;
}

function withinDays(iso: string, n: number): boolean {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  const days = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
  return days >= 0 && days <= n;
}

async function safeJson<T = unknown>(url: string, timeoutMs = 8000): Promise<T | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'flowvium-aggregator/1.0' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch { return null; }
}

// ── 1. Fear & Greed ──────────────────────────────────────────────────────────
interface FGEntry { id: string; label: string; score: number; prevScore?: number; level?: string; source?: string; }

async function getFearGreedItems(redis: Redis | null, base: string, locale = 'en'): Promise<UpdateItem[]> {
  // Redis shortcut: US 단일 키만 직접 읽기 (v6 현재 버전)
  if (redis) {
    try {
      const us = await redis.get<FGEntry>('flowvium:fg:v6:SPY');
      if (us?.score != null) {
        return [fgItemFromEntry(us, '🇺🇸', locale)];
      }
    } catch { /* non-fatal */ }
  }
  // Fallback: full API fetch — US + 상위 변동 국가 3개 반환
  const data = await safeJson<{ byCountry: FGEntry[]; byAsset: FGEntry[]; updatedAt: string }>(`${base}/api/fear-greed`);
  if (!data?.byCountry?.length) return [];
  const items: UpdateItem[] = [];
  const us = data.byCountry.find(e => e.id === 'us');
  if (us) items.push(fgItemFromEntry(us, '🇺🇸', locale));
  // 공포탐욕 변화폭 큰 국가 2개 추가 (미국 제외, 5pt 이상 변화)
  const topDelta = data.byCountry
    .filter(e => e.id !== 'us' && e.prevScore != null && Math.abs((e.score ?? 0) - (e.prevScore ?? 0)) >= 5)
    .sort((a, b) => Math.abs((b.score ?? 0) - (b.prevScore ?? 0)) - Math.abs((a.score ?? 0) - (a.prevScore ?? 0)))
    .slice(0, 2);
  for (const e of topDelta) items.push(fgItemFromEntry(e, '', locale));
  return items;
}

function fgItemFromEntry(e: FGEntry, flag: string, locale = 'en'): UpdateItem {
  const score = e.score;
  const prev = e.prevScore;
  const change = prev != null ? score - prev : 0;
  const changeStr = change > 0 ? ` (+${Math.round(change)})` : change < 0 ? ` (${Math.round(change)})` : '';
  const levelLabel = score >= 75 ? 'Extreme Greed' : score >= 55 ? 'Greed' : score >= 45 ? 'Neutral' : score >= 25 ? 'Fear' : 'Extreme Fear';
  const now = new Date().toISOString();
  const direction: UpdateItem['direction'] = score >= 55 ? 'up' : score <= 45 ? 'down' : 'neutral';
  const badgeColor = score >= 60 ? '#10b981' : score >= 45 ? '#f59e0b' : '#ef4444';
  return {
    id: `fg-${e.id}`,
    type: 'fear',
    headline: `${flag} ${e.label} F&G ${score}${changeStr} — ${levelLabel}`,
    sub: e.source === 'cnn' ? 'CNN Official F&G Index' : 'RSI · SMA Momentum · Volatility blend',
    source: e.source === 'cnn' ? 'CNN Fear & Greed' : 'FlowVium composite',
    time: fmtTime(now),
    sortTime: now,
    badge: localizeLabel('Sentiment', locale),
    badgeColor,
    link: '/intelligence',
    direction,
  };
}

// ── 2. Capital Flows ──────────────────────────────────────────────────────────
interface CFAsset { ticker: string; label: string; flag?: string; ret1w?: number; ret4w?: number; ret13w?: number; }

async function getCapitalFlowItems(redis: Redis | null, base: string, locale = 'en'): Promise<UpdateItem[]> {
  let assets: CFAsset[] = [];
  let updatedAt = new Date().toISOString();
  if (redis) {
    try {
      const [d1, d2] = await Promise.all([
        redis.get<{ assets: CFAsset[]; updatedAt: string }>('flowvium:capital-flows:v11:yahoo'),
        redis.get<{ assets: CFAsset[]; updatedAt: string }>('flowvium:capital-flows:v11:twelve'),
      ]);
      const d = d1?.assets?.length ? d1 : (d2?.assets?.length ? d2 : null);
      if (d?.assets?.length) { assets = d.assets; updatedAt = d.updatedAt ?? updatedAt; }
    } catch { /* non-fatal */ }
  }
  if (!assets.length) {
    const d = await safeJson<{ assets: CFAsset[]; updatedAt: string }>(`${base}/api/capital-flows`);
    if (d?.assets?.length) { assets = d.assets; updatedAt = d.updatedAt ?? updatedAt; }
  }
  if (!assets.length) return [];

  return [...assets]
    .filter(a => a.ret1w != null)
    .sort((a, b) => Math.abs(b.ret1w ?? 0) - Math.abs(a.ret1w ?? 0))
    .slice(0, 3)
    .map((a, i) => {
      const isUp = (a.ret1w ?? 0) > 0;
      const pct = (isUp ? '+' : '') + (a.ret1w ?? 0).toFixed(2) + '%';
      return {
        id: `flow-${a.ticker}-${i}`,
        type: 'flow' as const,
        headline: `${a.flag ?? ''} ${a.label} ${pct} (1W)`,
        sub: `${a.ret4w != null ? `4W ${a.ret4w > 0 ? '+' : ''}${a.ret4w.toFixed(1)}%` : localizeLabel('Capital Flow', locale)}`,
        source: localizeLabel('Capital Flows', locale),
        time: fmtTime(updatedAt),
        sortTime: updatedAt,
        badge: localizeLabel('Capital Flow', locale),
        badgeColor: isUp ? '#10b981' : '#ef4444',
        link: '/intelligence',
        direction: isUp ? 'up' as const : 'down' as const,
      };
    });
}

// ── 3. Macro Indicators ───────────────────────────────────────────────────────
interface MacroInd { id: string; name: string; nameKo: string; actual: number | null; previous: number | null; forecast: number | null; unit: string; releaseDate: string; surprise: string; rateImpact: string; rateImpactKo: string; }

async function getMacroItems(redis: Redis | null, base: string, locale: string = 'en'): Promise<UpdateItem[]> {
  let indicators: MacroInd[] = [];
  if (redis) {
    try {
      const kstDate = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
      const d = await redis.get<{ indicators: MacroInd[] }>(`flowvium:macro-indicators:v13:${kstDate}`);
      if (d?.indicators?.length) indicators = d.indicators;
    } catch { /* non-fatal */ }
  }
  if (!indicators.length) {
    const d = await safeJson<{ indicators: MacroInd[] }>(`${base}/api/macro-indicators`);
    if (d?.indicators?.length) indicators = d.indicators;
  }
  if (!indicators.length) return [];

  return indicators
    .filter(ind => ind.actual !== null && ind.releaseDate && withinDays(ind.releaseDate, 30))
    .sort((a, b) => {
      // beat/miss 우선, 그 다음 최신
      const aBig = a.surprise === 'beat' || a.surprise === 'miss' ? 1 : 0;
      const bBig = b.surprise === 'beat' || b.surprise === 'miss' ? 1 : 0;
      if (bBig !== aBig) return bBig - aBig;
      return b.releaseDate.localeCompare(a.releaseDate);
    })
    .slice(0, 4)
    .map(ind => {
      const direction: UpdateItem['direction'] = ind.surprise === 'beat' ? 'up' : ind.surprise === 'miss' ? 'down' : 'neutral';
      const badgeColor = ind.surprise === 'beat' ? '#10b981' : ind.surprise === 'miss' ? '#ef4444' : '#6366f1';
      // 2026-08-20: 종전 `${ind.name ?? ind.nameKo}` / `${ind.rateImpact ?? ind.rateImpactKo}` 는
      //   ?? 가 앞이 null 일 때만 넘어가는데 영문 필드는 항상 값이 있어, API 가 이미 주는 한국어 필드가
      //   영원히 안 쓰였다(홈에 "hawkish (prev 224K/wk)" 노출). "prev"·beat/miss 도 하드코딩이었다.
      //   rateImpact 는 닫힌 enum 이라 LLM 런타임 번역 대상이 아니다(4B 가 "호각적"으로 오역한 사례).
      const { headline: mHeadline, sub: mSub } = buildMacroLabels(ind, locale);
      return {
        id: `macro-${ind.id}`,
        type: 'macro' as const,
        headline: mHeadline,
        sub: mSub,
        source: 'FRED · US Bureau',
        time: fmtTime(ind.releaseDate),
        sortTime: ind.releaseDate,
        badge: localizeLabel('Macro', locale),
        badgeColor,
        link: '/intelligence',
        direction,
      };
    });
}

// ── 4. FedWatch ───────────────────────────────────────────────────────────────
type FomcMeeting = { date: string; label: string; probHold: number; probCut25: number; probHike25?: number };
interface FedData { currentRateMid?: number | string; meetings?: FomcMeeting[]; nextMeeting?: FomcMeeting | null; updatedAt?: string; }

async function getFedWatchItem(redis: Redis | null, base: string, locale = 'en'): Promise<UpdateItem | null> {
  let data: FedData | null = null;
  if (redis) {
    try {
      const utcDate = new Date().toISOString().slice(0, 10);
      data = await redis.get<FedData>(`flowvium:fedwatch:v2:${utcDate}`);
    } catch { /* non-fatal */ }
  }
  if (!data?.meetings?.length) {
    data = await safeJson<FedData>(`${base}/api/fedwatch`);
  }
  if (!data?.meetings?.length) return null;

  // 2026-08-20: 종전 `data.meetings[0]` 은 연초부터의 전체 일정 중 첫 원소 — 8월에 Apr 29(넉 달 전)를
  //   '다음 FOMC'로 띄웠다. fedwatch API 는 이미 nextMeeting 을 계산해 내려주고,
  //   그 파일 316행 주석이 "meetings[0] 은 Apr 29 등 과거일 수 있음"이라고 이 실수를 경고까지 하고 있었다.
  //   구버전 캐시에 nextMeeting 이 없을 수 있으므로 날짜로도 거른다 — 폴백이 다시 [0] 이면 의미가 없다.
  const todayStr = new Date().toISOString().slice(0, 10);
  const next = data.nextMeeting
    ?? data.meetings.find(m => m.date >= todayStr)
    ?? data.meetings[data.meetings.length - 1];
  if (!next) return null;
  const cutProb = Math.round(next.probCut25 ?? 0);
  const holdProb = Math.round(next.probHold ?? 0);
  const updatedAt = data.updatedAt ?? new Date().toISOString();
  const direction: UpdateItem['direction'] = cutProb > 50 ? 'up' : holdProb > 50 ? 'neutral' : 'down';
  return {
    id: 'fedwatch',
    type: 'fed',
    headline: `FOMC ${next.label} — ${localizeLabel('Hold', locale)} ${holdProb}% / ${localizeLabel('Cut', locale)} ${cutProb}%`,
    sub: `${localizeLabel('Current rate', locale)} ${data.currentRateMid ?? '-'}%`,
    source: 'CME FedWatch',
    time: fmtTime(updatedAt),
    sortTime: updatedAt,
    badge: localizeLabel('FedWatch', locale),
    badgeColor: cutProb > 50 ? '#10b981' : '#6366f1',
    link: '/intelligence',
    direction,
  };
}

// ── 5. News Cascade ──────────────────────────────────────────────────────────
type ArticleData = { id?: string; title: string; pubDate: string; source: string; sentiment: string; cascades?: Array<{ asset: string; direction: string }> };

async function getNewsCascadeItems(redis: Redis | null, base: string, locale: string = 'en'): Promise<UpdateItem[]> {
  const wantsTranslation = locale !== 'en';
  // Redis 직접 읽기: news-cascade는 전체 배열을 JSON key로 저장
  // (lrange가 아닌 get — lrange는 Redis list 자료구조에만 작동)
  if (redis) {
    try {
      const today = new Date().toISOString().slice(0, 10);
      // 1) locale 번역 캐시 우선 (한국어/일본어/중국어 등)
      if (wantsTranslation) {
        // 2026-08-20: 여기서 키를 직접 적은 탓에 news-cascade 가 v2 로 올린 걸(fd893795, 5월)
        //   못 따라가 항상 캐시 미스 → 영어 폴백 → 한국어 홈에 영문 뉴스가 나갔다.
        //   캐시 미스는 조용해서 아무 신호가 없었다. 단일 소스에서 가져온다.
        const tCached = await redis.get<ArticleData[]>(newsTranslatedKey(locale, today));
        if (Array.isArray(tCached) && tCached.length > 0) {
          return tCached
            .filter(a => a.pubDate && withinDays(a.pubDate, 3))
            .slice(0, 5)
            .map(a => newsItemFrom(a, a.id ?? a.title, locale));
        }
      }
      // 2) 영어 캐시 fallback
      const cached = await redis.get<ArticleData[]>(newsListKey(today));
      if (Array.isArray(cached) && cached.length > 0) {
        return cached
          .filter(a => a.pubDate && withinDays(a.pubDate, 3))
          .slice(0, 5)
          .map(a => newsItemFrom(a, a.id ?? a.title, locale));
      }
    } catch { /* non-fatal */ }
  }
  // 3) HTTP fallback — locale 전달해서 번역 트리거
  const url = wantsTranslation ? `${base}/api/news-cascade?locale=${encodeURIComponent(locale)}` : `${base}/api/news-cascade`;
  const d = await safeJson<{ articles?: ArticleData[] }>(url);
  const arts = d?.articles ?? [];
  return arts
    .filter(a => a.pubDate && withinDays(a.pubDate, 3))
    .slice(0, 5)
    .map(a => newsItemFrom(a, a.id ?? a.title, locale));
}

function newsItemFrom(article: { title: string; pubDate: string; source: string; sentiment: string; cascades?: Array<{ asset: string; direction: string }> }, id: string, locale = 'en'): UpdateItem {
  const cascades = article.cascades ?? [];
  const cascadeStr = cascades.slice(0, 3).map(c => `${c.asset}${c.direction === 'positive' ? '↑' : c.direction === 'negative' ? '↓' : ''}`).join(' ');
  // 클릭 시 IntelligencePage news 탭으로 이동 + 해당 기사 자동 expand 하도록 articleId 전달
  const linkHref = `/intelligence?tab=news&articleId=${encodeURIComponent(id)}`;
  return {
    id: `news-${id}`,
    type: 'news',
    headline: (article.title ?? '').slice(0, 65),
    sub: cascadeStr ? `${localizeLabel('Cascade', locale)}: ${cascadeStr}` : (article.source ?? ''),
    source: article.source || 'Reuters/CNBC',
    time: fmtTime(article.pubDate),
    sortTime: article.pubDate,
    badge: article.sentiment === 'bullish' ? localizeLabel('Bullish', locale) : article.sentiment === 'bearish' ? localizeLabel('Bearish', locale) : 'News',
    badgeColor: article.sentiment === 'bullish' ? '#10b981' : article.sentiment === 'bearish' ? '#ef4444' : '#6366f1',
    link: linkHref,
    direction: article.sentiment === 'bullish' ? 'up' : article.sentiment === 'bearish' ? 'down' : 'neutral',
  };
}

// ── 6. News Gap 정적 데이터 ───────────────────────────────────────────────────
function getNewsGapItems(locale = 'en'): UpdateItem[] {
  const items: UpdateItem[] = [];
  for (const entry of newsGapData) {
    const ownership = entry.ownershipData ?? [];
    for (const o of ownership.slice(0, 2)) {
      // prevPct is optional in static data — show 'new'/'increased'/'reduced' regardless
      const isNoteworthy = o.action !== 'maintained';
      if (!isNoteworthy) continue;
      const hasDelta = o.prevPct != null && Math.abs(o.pctOfShares - o.prevPct) >= 0.5;
      const change = hasDelta ? o.pctOfShares - (o.prevPct as number) : null;
      const isUp = o.action === 'new' || o.action === 'increased';
      const changeStr = change != null
        ? ` ${change > 0 ? '+' : ''}${change.toFixed(2)}%p`
        : ` (${o.action})`;
      const sortTime = `${o.quarter.replace(/^Q\d\s+/, '')}-01-01`;
      items.push({
        id: `ownership-${entry.ticker}-${o.institution}`,
        type: 'newsgap',
        headline: `${o.institution} — ${entry.companyName}${changeStr}`,
        sub: `${o.pctOfShares}% ${localizeLabel('held', locale)} ($${o.valueM}M) · ${o.quarter}`,
        source: 'SEC EDGAR 13F',
        time: o.quarter,
        sortTime,
        badge: localizeLabel('Holdings', locale),
        badgeColor: isUp ? '#10b981' : '#ef4444',
        link: '/news-gap',
        direction: isUp ? 'up' : 'down',
      });
    }
    for (const article of (entry.recentArticles ?? []).slice(0, 2)) {
      // Relax from 7→30 days — static articles updated quarterly, 7-day window too tight
      if (!article.date || !withinDays(article.date, 30)) continue;
      items.push({
        id: `newsgap-${entry.ticker}-${article.url ?? article.title}`,
        type: 'newsgap',
        headline: `[${entry.ticker}] ${(article.title ?? '').slice(0, 55)}`,
        sub: article.source ?? '',
        source: article.source ?? 'Alpha Vantage',
        time: fmtTime(article.date),
        sortTime: article.date,
        badge: localizeLabel('News Gap', locale),
        badgeColor: '#8b5cf6',
        link: '/news-gap',
        direction: 'neutral',
      });
    }
  }
  return items;
}

// ── 7. Market Movers (S&P 500 top gainers/losers) ────────────────────────────
interface MoverEntry { ticker: string; price: number; changePct: number; change: number; }
interface MoversCache { gainers: MoverEntry[]; losers: MoverEntry[]; updatedAt: string; }

async function getMarketMoverItems(redis: Redis | null, base: string, locale = 'en'): Promise<UpdateItem[]> {
  let data: MoversCache | null = null;
  if (redis) {
    try {
      data = await redis.get<MoversCache>('flowvium:market-movers:v1');
    } catch { /* non-fatal */ }
  }
  if (!data?.gainers?.length && !data?.losers?.length) {
    data = await safeJson<MoversCache>(`${base}/api/market-movers`, 15000);
  }
  if (!data?.gainers?.length && !data?.losers?.length) return [];
  const updatedAt = data.updatedAt ?? new Date().toISOString();
  const toItem = (m: MoverEntry, side: 'gain' | 'loss'): UpdateItem => ({
    id: `mover-${m.ticker}`,
    type: 'market' as const,
    headline: `${m.ticker} ${m.changePct > 0 ? '+' : ''}${m.changePct.toFixed(2)}% — $${m.price}`,
    sub: `${side === 'gain' ? '📈' : '📉'} ${localizeLabel(side === 'gain' ? 'Top Gainer' : 'Top Loser', locale)} · $${m.change > 0 ? '+' : ''}${m.change.toFixed(2)}`,
    source: 'Nasdaq',
    time: fmtTime(updatedAt),
    sortTime: updatedAt,
    badge: side === 'gain' ? localizeLabel('Gainer', locale) : localizeLabel('Loser', locale),
    badgeColor: side === 'gain' ? '#10b981' : '#ef4444',
    link: '/intelligence',
    direction: side === 'gain' ? 'up' as const : 'down' as const,
  });
  return [
    ...(data.gainers ?? []).slice(0, 3).map(m => toItem(m, 'gain')),
    ...(data.losers ?? []).slice(0, 3).map(m => toItem(m, 'loss')),
  ];
}

// ── 8. Institutional Signals (13F) ──────────────────────────────────────────
function getSignalItems(signals: InstitutionalSignal[], locale = 'en'): UpdateItem[] {
  return signals
    .sort((a, b) => b.filingDate.localeCompare(a.filingDate))
    .slice(0, 10)
    .map(s => {
      // 2026-08-20: enum → 표시라벨 매핑만 하고 로케일을 안 태워 한국어 화면에 영문이 나갔다.
      const actionLabel = localizeLabel(
        s.action === 'accumulating' ? 'Accumulating'
        : s.action === 'new_position' ? 'New Position'
        : s.action === 'reducing' ? 'Reducing' : 'Full Exit', locale);
      const isUp = s.action === 'accumulating' || s.action === 'new_position';
      return {
        id: `signal-${s.id}`,
        type: 'signal' as const,
        headline: `${s.institution} — ${s.companyName} ${actionLabel}`,
        sub: `${s.estimatedValue} · ${localizeLabel(s.sector, locale)}`,
        source: 'SEC EDGAR 13F',
        time: s.filingDate,
        sortTime: s.filingDate,
        badge: localizeLabel('Institutional', locale),
        badgeColor: isUp ? '#10b981' : '#ef4444',
        link: '/signals',
        direction: isUp ? 'up' as const : 'down' as const,
      };
    });
}

// ── 혼합 정렬: 시간 desc, 단 한 타입이 연속 N개 넘지 못하게 분산 ─────────────
// 피드 체감: 최신 정보가 위에 오되, 같은 카테고리만 줄줄이 나오지 않게 섞음.
function interleaveByTimeWithTypeCap(items: UpdateItem[], maxConsecutive = 2, limit = 40): UpdateItem[] {
  const sorted = [...items].sort((a, b) => b.sortTime.localeCompare(a.sortTime));
  const out: UpdateItem[] = [];
  const skipped: UpdateItem[] = [];
  let lastType: string | null = null;
  let lastTypeStreak = 0;

  for (const it of sorted) {
    if (it.type === lastType && lastTypeStreak >= maxConsecutive) {
      skipped.push(it);
      continue;
    }
    out.push(it);
    if (it.type === lastType) lastTypeStreak++;
    else { lastType = it.type; lastTypeStreak = 1; }
    if (out.length >= limit) break;
  }
  // 한도 못 채웠으면 skipped를 뒤에 붙임
  for (const it of skipped) {
    if (out.length >= limit) break;
    out.push(it);
  }
  return out;
}

// ── 9. Upcoming Economic Calendar Events ─────────────────────────────────────
function getEconCalendarItems(locale = 'en'): UpdateItem[] {
  const today = new Date();
  const upcoming = getUpcomingEvents(today, 10)
    .filter(e => e.impact === 'high' || e.impact === 'medium')
    .slice(0, 4);

  const isKo = String(locale).split('-')[0] === 'ko';
  return upcoming.map(e => {
    const days = daysUntil(e.date, today);
    const urgency = relativeDayLabel(days, locale);
    const type = e.category === 'Fed' ? 'fed' as const : 'macro' as const;
    const badgeColor = e.impact === 'high'
      ? (days <= 1 ? '#ef4444' : '#f59e0b')
      : '#6366f1';
    return {
      id: `econ-${e.date}-${e.title.slice(0, 20)}`,
      type,
      // 2026-08-20: src/data/econ-calendar.ts 는 titleKo/noteKo 를 이미 갖고 있는데
      //   라우트가 영문 필드만 써서 ko 화면에 'September Jobs Report (NFP)' 가 그대로 떴다.
      headline: `${urgency} — ${isKo ? (e.titleKo || e.title) : e.title}`,
      sub: (isKo ? (e.noteKo ?? e.note) : e.note) ?? localizeLabel(e.category, locale),
      source: localizeLabel('Economic Calendar', locale),
      // 2026-08-20: econ-calendar 의 time 은 'All day' 같은 영문 리터럴을 담는다(src/data/econ-calendar.ts).
      time: localizeLabel(e.time ?? e.date, locale),
      sortTime: e.date + 'T00:00:00.000Z',
      badge: e.impact === 'high' ? `🔴 ${localizeLabel('High Impact', locale)}` : `🟡 ${localizeLabel('Medium Impact', locale)}`,
      badgeColor,
      link: '/intelligence',
      direction: 'neutral' as const,
    };
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
function getBaseUrl(req: Request): string {
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

export async function GET(req: Request) {
  const redis = createRedis();
  const base = getBaseUrl(req);
  const url = new URL(req.url);
  const locale = (url.searchParams.get('locale') ?? 'en').trim();
  // locale 별 다른 캐시 — 번역된 뉴스 항목이 섞이지 않도록
  const cacheKey = locale !== 'en' ? `flowvium:latest-updates:v3:${locale}` : 'flowvium:latest-updates:v3';

  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return NextResponse.json({ items: cached, cached: true, source: 'cached', locale }, { headers: CDN_HEADERS });
    } catch { /* non-fatal */ }
  }

  const [fgItems, flowItems, macroItems, fedItem, newsItems, moverItems] = await Promise.all([
    getFearGreedItems(redis, base, locale),
    getCapitalFlowItems(redis, base, locale),
    getMacroItems(redis, base, locale),
    getFedWatchItem(redis, base, locale),
    getNewsCascadeItems(redis, base, locale),
    getMarketMoverItems(redis, base, locale),
  ]);

  const newsGapItems = getNewsGapItems(locale);
  const econItems = getEconCalendarItems(locale);
  const liveSignals = await getBaseSignals(redis);
  const signalItems = getSignalItems(liveSignals, locale);

  // 모든 아이템 한 풀에 던지고 시간 desc + 타입 연속 최대 2로 혼합
  const all: UpdateItem[] = [
    ...fgItems,
    ...flowItems,
    ...macroItems,
    ...(fedItem ? [fedItem] : []),
    ...newsItems,
    ...newsGapItems,
    ...signalItems,
    ...moverItems,
    ...econItems,
  ];

  // Deduplicate by id
  const seen = new Set<string>();
  const unique = all.filter(it => {
    if (seen.has(it.id)) return false;
    seen.add(it.id);
    return true;
  });

  const items = interleaveByTimeWithTypeCap(unique, 2, 40);

  if (redis) {
    try {
      await loggedRedisSet(redis, 'api.latest-updates', cacheKey, items, { ex: CACHE_TTL });
    } catch (err) {
      logger.error('latest-updates', 'save_failed', { key: cacheKey, error: err instanceof Error ? err.message : String(err) });
    }
  }

  logger.info('latest-updates', 'aggregated', {
    redis: !!redis,
    total: items.length,
    byType: items.reduce((acc, it) => { acc[it.type] = (acc[it.type] ?? 0) + 1; return acc; }, {} as Record<string, number>),
  });

  return NextResponse.json({ items, cached: false, source: 'live' }, { headers: CDN_HEADERS });
}
