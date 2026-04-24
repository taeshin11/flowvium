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
import { Redis } from '@upstash/redis';
import { institutionalSignals, type InstitutionalSignal } from '@/data/institutional-signals';
import { newsGapData } from '@/data/news-gap';

export const dynamic = 'force-dynamic';

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

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

async function getBaseSignals(redis: Redis | null): Promise<InstitutionalSignal[]> {
  if (!redis) return institutionalSignals;
  try {
    const data = await redis.get('flowvium:13f-signals:v1');
    if (Array.isArray(data) && data.length > 0) return data as InstitutionalSignal[];
  } catch { /* non-fatal */ }
  return institutionalSignals;
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

async function getFearGreedItems(redis: Redis | null, base: string): Promise<UpdateItem[]> {
  // Redis shortcut: US 단일 키만 직접 읽기 (v6 현재 버전)
  if (redis) {
    try {
      const us = await redis.get<FGEntry>('flowvium:fg:v6:SPY');
      if (us?.score != null) {
        return [fgItemFromEntry(us, '🇺🇸')];
      }
    } catch { /* non-fatal */ }
  }
  // Fallback: full API fetch — US + 상위 변동 국가 3개 반환
  const data = await safeJson<{ byCountry: FGEntry[]; byAsset: FGEntry[]; updatedAt: string }>(`${base}/api/fear-greed`);
  if (!data?.byCountry?.length) return [];
  const items: UpdateItem[] = [];
  const us = data.byCountry.find(e => e.id === 'us');
  if (us) items.push(fgItemFromEntry(us, '🇺🇸'));
  // 공포탐욕 변화폭 큰 국가 2개 추가 (미국 제외, 5pt 이상 변화)
  const topDelta = data.byCountry
    .filter(e => e.id !== 'us' && e.prevScore != null && Math.abs((e.score ?? 0) - (e.prevScore ?? 0)) >= 5)
    .sort((a, b) => Math.abs((b.score ?? 0) - (b.prevScore ?? 0)) - Math.abs((a.score ?? 0) - (a.prevScore ?? 0)))
    .slice(0, 2);
  for (const e of topDelta) items.push(fgItemFromEntry(e, ''));
  return items;
}

function fgItemFromEntry(e: FGEntry, flag: string): UpdateItem {
  const score = e.score;
  const prev = e.prevScore;
  const change = prev != null ? score - prev : 0;
  const changeStr = change > 0 ? ` (+${Math.round(change)})` : change < 0 ? ` (${Math.round(change)})` : '';
  const levelLabel = score >= 75 ? '극단적 탐욕' : score >= 55 ? '탐욕' : score >= 45 ? '중립' : score >= 25 ? '공포' : '극단적 공포';
  const now = new Date().toISOString();
  const direction: UpdateItem['direction'] = score >= 55 ? 'up' : score <= 45 ? 'down' : 'neutral';
  const badgeColor = score >= 60 ? '#10b981' : score >= 45 ? '#f59e0b' : '#ef4444';
  return {
    id: `fg-${e.id}`,
    type: 'fear',
    headline: `${flag} ${e.label} 공포탐욕 ${score}${changeStr} — ${levelLabel}`,
    sub: e.source === 'cnn' ? 'CNN 공식 F&G Index' : 'RSI · SMA 모멘텀 · 변동성 블렌드',
    source: e.source === 'cnn' ? 'CNN Fear & Greed' : 'FlowVium composite',
    time: fmtTime(now),
    sortTime: now,
    badge: '시장심리',
    badgeColor,
    link: '/intelligence',
    direction,
  };
}

// ── 2. Capital Flows ──────────────────────────────────────────────────────────
interface CFAsset { ticker: string; label: string; flag?: string; ret1w?: number; ret4w?: number; ret13w?: number; }

async function getCapitalFlowItems(redis: Redis | null, base: string): Promise<UpdateItem[]> {
  let assets: CFAsset[] = [];
  let updatedAt = new Date().toISOString();
  if (redis) {
    try {
      const [d1, d2] = await Promise.all([
        redis.get<{ assets: CFAsset[]; updatedAt: string }>('flowvium:capital-flows:v9:yahoo'),
        redis.get<{ assets: CFAsset[]; updatedAt: string }>('flowvium:capital-flows:v9:twelve'),
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
        headline: `${a.flag ?? ''} ${a.label} ${pct} (1주)`,
        sub: `${a.ret4w != null ? `4주 ${a.ret4w > 0 ? '+' : ''}${a.ret4w.toFixed(1)}%` : '자금흐름'}`,
        source: 'Capital Flows',
        time: fmtTime(updatedAt),
        sortTime: updatedAt,
        badge: '자금흐름',
        badgeColor: isUp ? '#10b981' : '#ef4444',
        link: '/intelligence',
        direction: isUp ? 'up' as const : 'down' as const,
      };
    });
}

// ── 3. Macro Indicators ───────────────────────────────────────────────────────
interface MacroInd { id: string; nameKo: string; actual: number | null; previous: number | null; forecast: number | null; unit: string; releaseDate: string; surprise: string; rateImpactKo: string; }

async function getMacroItems(redis: Redis | null, base: string): Promise<UpdateItem[]> {
  let indicators: MacroInd[] = [];
  if (redis) {
    try {
      const kstDate = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
      const [d1, d2] = await Promise.all([
        redis.get<{ indicators: MacroInd[] }>(`flowvium:macro-indicators:v9:${kstDate}`),
        redis.get<{ indicators: MacroInd[] }>(`flowvium:macro-indicators:v8:${kstDate}`),
      ]);
      const d = d1?.indicators?.length ? d1 : (d2?.indicators?.length ? d2 : null);
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
      const surpriseEmoji = ind.surprise === 'beat' ? ' ↑예상상회' : ind.surprise === 'miss' ? ' ↓예상하회' : '';
      const direction: UpdateItem['direction'] = ind.surprise === 'beat' ? 'up' : ind.surprise === 'miss' ? 'down' : 'neutral';
      const badgeColor = ind.surprise === 'beat' ? '#10b981' : ind.surprise === 'miss' ? '#ef4444' : '#6366f1';
      const changeStr = ind.previous != null ? ` (전월 ${ind.previous}${ind.unit})` : '';
      return {
        id: `macro-${ind.id}`,
        type: 'macro' as const,
        headline: `${ind.nameKo} ${ind.actual}${ind.unit}${surpriseEmoji}`,
        sub: `${ind.rateImpactKo}${changeStr}`,
        source: 'FRED · US Bureau',
        time: fmtTime(ind.releaseDate),
        sortTime: ind.releaseDate,
        badge: '거시경제',
        badgeColor,
        link: '/intelligence',
        direction,
      };
    });
}

// ── 4. FedWatch ───────────────────────────────────────────────────────────────
interface FedData { currentRateMid?: number | string; meetings?: Array<{ date: string; label: string; probHold: number; probCut25: number; probHike25: number }>; updatedAt?: string; }

async function getFedWatchItem(redis: Redis | null, base: string): Promise<UpdateItem | null> {
  let data: FedData | null = null;
  if (redis) {
    try {
      const hour = new Date().toISOString().slice(0, 13);
      data = await redis.get<FedData>(`flowvium:fedwatch:v1:${hour}`);
    } catch { /* non-fatal */ }
  }
  if (!data?.meetings?.length) {
    data = await safeJson<FedData>(`${base}/api/fedwatch`);
  }
  if (!data?.meetings?.length) return null;

  const next = data.meetings[0];
  const cutProb = Math.round(next.probCut25 ?? 0);
  const holdProb = Math.round(next.probHold ?? 0);
  const updatedAt = data.updatedAt ?? new Date().toISOString();
  const direction: UpdateItem['direction'] = cutProb > 50 ? 'up' : holdProb > 50 ? 'neutral' : 'down';
  return {
    id: 'fedwatch',
    type: 'fed',
    headline: `FOMC ${next.label} — 동결 ${holdProb}% / 인하 ${cutProb}%`,
    sub: `현재 기준금리 ${data.currentRateMid ?? '-'}%`,
    source: 'CME FedWatch',
    time: fmtTime(updatedAt),
    sortTime: updatedAt,
    badge: 'FedWatch',
    badgeColor: cutProb > 50 ? '#10b981' : '#6366f1',
    link: '/intelligence',
    direction,
  };
}

// ── 5. News Cascade ──────────────────────────────────────────────────────────
async function getNewsCascadeItems(redis: Redis | null, base: string): Promise<UpdateItem[]> {
  // Redis list 구조라 Redis 있을 때만 직접 읽기
  if (redis) {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const ids = await redis.lrange(`flowvium:news-cascade:v1:list:${today}`, 0, 6);
      if (ids?.length) {
        type ArticleData = { title: string; pubDate: string; source: string; sentiment: string; cascades?: Array<{ asset: string; direction: string }> };
        const fetched = await Promise.allSettled(
          ids.map(id => redis.get<ArticleData>(`flowvium:news-cascade:v1:article:${id}`).then(a => ({ id, a })))
        );
        const items: UpdateItem[] = fetched
          .filter((r): r is PromiseFulfilledResult<{ id: string; a: ArticleData | null }> => r.status === 'fulfilled')
          .filter(r => r.value.a != null && withinDays(r.value.a.pubDate, 3))
          .map(r => newsItemFrom(r.value.a!, r.value.id));
        if (items.length) return items;
      }
    } catch { /* non-fatal */ }
  }
  // Fallback: /api/news-cascade가 articles 배열로 최근 기사 반환
  const d = await safeJson<{ articles?: Array<{ id?: string; title: string; pubDate: string; source: string; sentiment: string; cascades?: Array<{ asset: string; direction: string }> }> }>(`${base}/api/news-cascade`);
  const arts = d?.articles ?? [];
  return arts
    .filter(a => a.pubDate && withinDays(a.pubDate, 3))
    .slice(0, 5)
    .map(a => newsItemFrom(a, a.id ?? a.title));
}

function newsItemFrom(article: { title: string; pubDate: string; source: string; sentiment: string; cascades?: Array<{ asset: string; direction: string }> }, id: string): UpdateItem {
  const cascades = article.cascades ?? [];
  const cascadeStr = cascades.slice(0, 3).map(c => `${c.asset}${c.direction === 'positive' ? '↑' : c.direction === 'negative' ? '↓' : ''}`).join(' ');
  return {
    id: `news-${id}`,
    type: 'news',
    headline: (article.title ?? '').slice(0, 65),
    sub: cascadeStr ? `연쇄반응: ${cascadeStr}` : (article.source ?? ''),
    source: article.source || 'Reuters/CNBC',
    time: fmtTime(article.pubDate),
    sortTime: article.pubDate,
    badge: article.sentiment === 'bullish' ? '호재' : article.sentiment === 'bearish' ? '악재' : '뉴스',
    badgeColor: article.sentiment === 'bullish' ? '#10b981' : article.sentiment === 'bearish' ? '#ef4444' : '#6366f1',
    link: '/cascade',
    direction: article.sentiment === 'bullish' ? 'up' : article.sentiment === 'bearish' ? 'down' : 'neutral',
  };
}

// ── 6. News Gap 정적 데이터 ───────────────────────────────────────────────────
function getNewsGapItems(): UpdateItem[] {
  const items: UpdateItem[] = [];
  for (const entry of newsGapData) {
    const ownership = entry.ownershipData ?? [];
    for (const o of ownership.slice(0, 3)) {
      if (!o.prevPct || Math.abs(o.pctOfShares - o.prevPct) < 0.5) continue;
      const change = o.pctOfShares - o.prevPct;
      const isUp = change > 0;
      const changeStr = (isUp ? '+' : '') + change.toFixed(2) + '%p';
      const sortTime = `${o.quarter.replace(/^Q\d\s+/, '')}-01-01`;
      items.push({
        id: `ownership-${entry.ticker}-${o.institution}`,
        type: 'newsgap',
        headline: `${o.institution} — ${entry.companyName} 지분 ${changeStr}`,
        sub: `${o.pctOfShares}% 보유 ($${o.valueM}M) · ${o.quarter}`,
        source: 'SEC EDGAR 13F',
        time: o.quarter,
        sortTime,
        badge: '지분변화',
        badgeColor: isUp ? '#10b981' : '#ef4444',
        link: '/news-gap',
        direction: isUp ? 'up' : 'down',
      });
    }
    for (const article of (entry.recentArticles ?? []).slice(0, 2)) {
      if (!article.date || !withinDays(article.date, 7)) continue;
      items.push({
        id: `newsgap-${entry.ticker}-${article.url ?? article.title}`,
        type: 'newsgap',
        headline: `[${entry.ticker}] ${(article.title ?? '').slice(0, 55)}`,
        sub: article.source ?? '',
        source: article.source ?? 'Alpha Vantage',
        time: fmtTime(article.date),
        sortTime: article.date,
        badge: '뉴스갭',
        badgeColor: '#8b5cf6',
        link: '/news-gap',
        direction: 'neutral',
      });
    }
  }
  return items;
}

// ── 7. Institutional Signals (13F) ──────────────────────────────────────────
function getSignalItems(signals: InstitutionalSignal[]): UpdateItem[] {
  return signals
    .sort((a, b) => b.filingDate.localeCompare(a.filingDate))
    .slice(0, 30)
    .map(s => {
      const actionLabel = s.action === 'accumulating' ? '매집'
        : s.action === 'new_position' ? '신규 편입'
        : s.action === 'reducing' ? '비중 축소' : '전량 청산';
      const isUp = s.action === 'accumulating' || s.action === 'new_position';
      return {
        id: `signal-${s.id}`,
        type: 'signal' as const,
        headline: `${s.institution} — ${s.companyName} ${actionLabel}`,
        sub: `${s.estimatedValue} · ${s.sector}`,
        source: 'SEC EDGAR 13F',
        time: s.filingDate,
        sortTime: s.filingDate,
        badge: '기관',
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

// ── Main ──────────────────────────────────────────────────────────────────────
function getBaseUrl(req: Request): string {
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

export async function GET(req: Request) {
  const redis = createRedis();
  const base = getBaseUrl(req);
  const cacheKey = 'flowvium:latest-updates:v3';

  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return NextResponse.json({ items: cached, cached: true }, { headers: CDN_HEADERS });
    } catch { /* non-fatal */ }
  }

  const [fgItems, flowItems, macroItems, fedItem, newsItems] = await Promise.all([
    getFearGreedItems(redis, base),
    getCapitalFlowItems(redis, base),
    getMacroItems(redis, base),
    getFedWatchItem(redis, base),
    getNewsCascadeItems(redis, base),
  ]);

  const newsGapItems = getNewsGapItems();
  const liveSignals = await getBaseSignals(redis);
  const signalItems = getSignalItems(liveSignals);

  // 모든 아이템 한 풀에 던지고 시간 desc + 타입 연속 최대 2로 혼합
  const all: UpdateItem[] = [
    ...fgItems,
    ...flowItems,
    ...macroItems,
    ...(fedItem ? [fedItem] : []),
    ...newsItems,
    ...newsGapItems,
    ...signalItems,
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

  return NextResponse.json({ items, cached: false }, { headers: CDN_HEADERS });
}
