/**
 * /api/osint/social
 * 주요 인물 실제 트윗(Nitter RSS) + 뉴스 피드 혼합
 * Fed 위원 투표권 여부 + 파급 cascade 포함
 * Cache: 30min
 */
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { logger, loggedRedisSet } from '@/lib/logger';
export const dynamic = 'force-dynamic';

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export interface SocialEntry {
  person: string;
  role: string;
  flag: string;
  tag: string;
  title: string;
  summary: string;
  source: string;
  url: string;
  publishedAt: string;
  sentiment: 'hawkish' | 'dovish' | 'bullish' | 'bearish' | 'neutral';
  impact: 'high' | 'medium' | 'low';
  istweet: boolean;
  isFed: boolean;
  votingMember: boolean;   // FOMC 투표권 보유 여부 (2025)
  cascade: string[];       // 파급 효과 체인
}

// ── Nitter mirrors ─────────────────────────────────────────────────────────────
const NITTER_INSTANCES = [
  'https://nitter.poast.org',
  'https://nitter.privacydev.net',
  'https://nitter.cz',
  'https://nitter.1d4.us',
  'https://nitter.unixfox.eu',
];

// ── Key figures ────────────────────────────────────────────────────────────────
// FOMC 2025 투표권:
//   상임: Powell(의장), Jefferson(부의장), Barr, Cook, Kugler, Waller, Bowman (이사회 전원)
//         + Williams (뉴욕 Fed 총재, 항상 투표)
//   로테이션 2025: Goolsbee(시카고), Barkin(리치먼드), Hammack(클리블랜드), Schmid(캔자스)
const KEY_FIGURES = [
  // ── 정치·경제 ──────────────────────────────────────────────────────────────
  { name: 'Donald Trump',      role: '미국 대통령',         flag: '🇺🇸', tag: 'Trump',    twitter: 'realDonaldTrump', keywords: ['trump', 'donald trump'], isFed: false, votingMember: false },
  { name: 'Elon Musk',         role: 'Tesla/SpaceX CEO',    flag: '🇺🇸', tag: 'Musk',     twitter: 'elonmusk',        keywords: ['elon musk', 'musk'],     isFed: false, votingMember: false },
  { name: 'Sam Altman',        role: 'OpenAI CEO',          flag: '🇺🇸', tag: 'Altman',   twitter: 'sama',            keywords: ['sam altman', 'openai'],  isFed: false, votingMember: false },
  { name: 'Scott Bessent',     role: '미 재무장관',          flag: '🇺🇸', tag: 'Bessent',  twitter: null,              keywords: ['bessent', 'scott bessent', 'treasury secretary'], isFed: false, votingMember: false },
  { name: 'Christine Lagarde', role: 'ECB 총재',             flag: '🇪🇺', tag: 'ECB',      twitter: 'Lagarde',         keywords: ['lagarde', 'ecb', 'european central bank'], isFed: false, votingMember: false },
  { name: 'Xi Jinping',        role: '중국 국가주석',        flag: '🇨🇳', tag: 'Xi',       twitter: null,              keywords: ['xi jinping', 'china president'], isFed: false, votingMember: false },
  { name: 'Warren Buffett',    role: 'Berkshire CEO',       flag: '🇺🇸', tag: 'Buffett',  twitter: null,              keywords: ['buffett', 'warren buffett', 'berkshire'], isFed: false, votingMember: false },

  // ── Fed 상임 투표권 ────────────────────────────────────────────────────────
  { name: 'Jerome Powell',     role: 'Fed 의장',             flag: '🇺🇸', tag: 'Powell',   twitter: null,              keywords: ['powell', 'jerome powell', 'fed chair', 'federal reserve chair'], isFed: true, votingMember: true },
  { name: 'Philip Jefferson',  role: 'Fed 부의장',           flag: '🇺🇸', tag: 'Jefferson',twitter: null,              keywords: ['jefferson', 'philip jefferson', 'fed vice'],    isFed: true, votingMember: true },
  { name: 'Christopher Waller',role: 'Fed 이사',             flag: '🇺🇸', tag: 'Waller',   twitter: null,              keywords: ['waller', 'christopher waller'],                 isFed: true, votingMember: true },
  { name: 'Michelle Bowman',   role: 'Fed 이사',             flag: '🇺🇸', tag: 'Bowman',   twitter: null,              keywords: ['bowman', 'michelle bowman'],                    isFed: true, votingMember: true },
  { name: 'Lisa Cook',         role: 'Fed 이사',             flag: '🇺🇸', tag: 'Cook',     twitter: null,              keywords: ['lisa cook', 'fed governor cook'],               isFed: true, votingMember: true },
  { name: 'Adriana Kugler',    role: 'Fed 이사',             flag: '🇺🇸', tag: 'Kugler',   twitter: null,              keywords: ['kugler', 'adriana kugler'],                     isFed: true, votingMember: true },
  { name: 'John Williams',     role: '뉴욕 Fed 총재 (상임)', flag: '🇺🇸', tag: 'Williams', twitter: null,              keywords: ['john williams', 'ny fed', 'new york fed'],      isFed: true, votingMember: true },

  // ── Fed 2025 로테이션 투표권 ───────────────────────────────────────────────
  { name: 'Austan Goolsbee',   role: '시카고 Fed 총재 (투표)',flag: '🇺🇸', tag: 'Goolsbee', twitter: 'austan_goolsbee', keywords: ['goolsbee', 'austan goolsbee', 'chicago fed'],  isFed: true, votingMember: true },
  { name: 'Thomas Barkin',     role: '리치먼드 Fed 총재 (투표)',flag: '🇺🇸',tag: 'Barkin',  twitter: null,              keywords: ['barkin', 'thomas barkin', 'richmond fed'],     isFed: true, votingMember: true },
  { name: 'Beth Hammack',      role: '클리블랜드 Fed 총재 (투표)',flag:'🇺🇸',tag:'Hammack', twitter: null,              keywords: ['hammack', 'beth hammack', 'cleveland fed'],    isFed: true, votingMember: true },
  { name: 'Jeff Schmid',       role: '캔자스시티 Fed 총재 (투표)',flag:'🇺🇸',tag:'Schmid',  twitter: null,              keywords: ['schmid', 'jeff schmid', 'kansas city fed'],    isFed: true, votingMember: true },

  // ── Fed 2025 비투표권 (발언은 시장 영향) ──────────────────────────────────
  { name: 'Neel Kashkari',     role: '미니애폴리스 Fed 총재', flag: '🇺🇸', tag: 'Kashkari', twitter: null,              keywords: ['kashkari', 'neel kashkari', 'minneapolis fed'], isFed: true, votingMember: false },
  { name: 'Lorie Logan',       role: '댈러스 Fed 총재',       flag: '🇺🇸', tag: 'Logan',    twitter: null,              keywords: ['lorie logan', 'dallas fed'],                    isFed: true, votingMember: false },
  { name: 'Raphael Bostic',    role: '애틀란타 Fed 총재',     flag: '🇺🇸', tag: 'Bostic',   twitter: null,              keywords: ['bostic', 'raphael bostic', 'atlanta fed'],      isFed: true, votingMember: false },
  { name: 'Mary Daly',         role: '샌프란시스코 Fed 총재', flag: '🇺🇸', tag: 'Daly',     twitter: null,              keywords: ['mary daly', 'san francisco fed'],               isFed: true, votingMember: false },
];

// Tested 2026-04-25: Yahoo Finance (404), Reuters (000), CNBC (403), MarketWatch → personal finance
// Replaced with confirmed working sources matching news-cascade feeds
const NEWS_RSS_FEEDS: { url: string; source: string }[] = [
  { url: 'https://feeds.bloomberg.com/markets/news.rss',     source: 'Bloomberg' },
  { url: 'https://feeds.bloomberg.com/economics/news.rss',   source: 'Bloomberg Economics' },
  { url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml',   source: 'WSJ Markets' },
  { url: 'https://seekingalpha.com/market_currents.xml',     source: 'Seeking Alpha' },
];

interface RssItem { title: string; description: string; link: string; pubDate: string; source: string }

function parseRssXml(xml: string, sourceName: string, limit = 30): RssItem[] {
  const items: RssItem[] = [];
  const itemMatches = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/gi));
  for (const m of itemMatches) {
    const content = m[1];
    const title = content.match(/<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i)?.[1]?.trim() ?? '';
    const desc = content.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i)?.[1]?.trim() ?? '';
    const link = content.match(/<link[^>]*>(.*?)<\/link>/i)?.[1]?.trim()
      ?? content.match(/<guid[^>]*>(https?:\/\/[^<]+)<\/guid>/i)?.[1]?.trim() ?? '';
    const pubDate = content.match(/<pubDate[^>]*>(.*?)<\/pubDate>/i)?.[1]?.trim() ?? '';
    if (title) items.push({ title, description: desc.replace(/<[^>]+>/g, '').slice(0, 300), link, pubDate, source: sourceName });
  }
  return items.slice(0, limit);
}

async function fetchNitterRss(handle: string): Promise<RssItem[]> {
  for (const base of NITTER_INSTANCES) {
    try {
      const res = await fetch(`${base}/${handle}/rss`, {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/rss+xml, application/xml' },
        signal: AbortSignal.timeout(6000),
        cache: 'no-store',
      });
      if (!res.ok) continue;
      const xml = await res.text();
      if (!xml.includes('<item>')) continue;
      const items = parseRssXml(xml, `@${handle}`, 5);
      if (items.length > 0) return items;
    } catch { /* try next */ }
  }
  return [];
}

async function fetchNewsRss(url: string, sourceName: string): Promise<RssItem[]> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/rss+xml, application/xml' },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    if (!res.ok) return [];
    return parseRssXml(await res.text(), sourceName, 30);
  } catch { return []; }
}

function detectSentiment(text: string): 'hawkish' | 'dovish' | 'bullish' | 'bearish' | 'neutral' {
  const t = text.toLowerCase();
  if (/hike|tighten|hawkish|inflation fear|rate rise|higher for longer|not cut/.test(t)) return 'hawkish';
  if (/cut|ease|dovish|recession|slowdown|lower rate|rate reduction/.test(t)) return 'dovish';
  if (/surge|rally|record|gain|bull|soar|jump/.test(t)) return 'bullish';
  if (/crash|slump|fall|bear|plunge|rout|collapse|selloff/.test(t)) return 'bearish';
  return 'neutral';
}

function detectImpact(text: string, isFed: boolean, votingMember: boolean): 'high' | 'medium' | 'low' {
  const t = text.toLowerCase();
  if (isFed && votingMember) return 'high'; // 투표권 있는 Fed 위원 발언은 항상 high
  if (/tariff|sanction|war|crisis|emergency|rate decision|fomc|gdp|nfp/.test(t)) return 'high';
  if (isFed) return 'medium'; // 비투표권 Fed 위원
  if (/earnings|guidance|forecast|inflation|trade|policy/.test(t)) return 'medium';
  return 'low';
}

// ── 파급 효과 체인 생성 ────────────────────────────────────────────────────────
function buildCascade(
  figure: typeof KEY_FIGURES[0],
  sentiment: string,
  text: string
): string[] {
  const { isFed, votingMember, name } = figure;
  const t = text.toLowerCase();

  if (isFed) {
    const weight = votingMember ? '' : ' (비투표권, 영향 제한적)';
    if (sentiment === 'hawkish') return [
      `금리인하 기대↓${weight}`,
      '미국채 2년물 금리↑',
      'USD 강세 압력',
      '성장주·기술주 밸류에이션↓',
      '신흥국 통화·채권 약세',
    ];
    if (sentiment === 'dovish') return [
      `금리인하 기대↑${weight}`,
      '미국채 금리↓',
      'USD 약세',
      '금·원자재↑',
      '신흥국 자금유입',
    ];
    return [`Fed ${votingMember ? '투표권 위원' : '비투표 위원'} 발언 — 시장 주시`];
  }

  if (name.includes('Trump')) {
    if (/tariff|trade|china|관세/.test(t)) return [
      '관세 인상 우려',
      '수입 물가↑ → 인플레 압력',
      '피관세국 증시↓',
      '미 소비재 기업 마진↓',
      '달러 단기 강세',
    ];
    if (/rate|fed|powell/.test(t)) return [
      'Fed 독립성 우려',
      '달러 신뢰도↓',
      '금·비트코인 헤지 수요↑',
    ];
  }

  if (name.includes('Musk')) {
    if (/bitcoin|crypto|btc|doge/.test(t)) return [
      '암호화폐 변동성↑',
      'DOGE/BTC 단기 급등 가능',
      '개인투자자 매수세',
    ];
    if (/tesla|ev/.test(t)) return ['TSLA 주가 변동', '전기차 섹터 연동'];
  }

  if (name.includes('Lagarde') || name.includes('ECB')) {
    if (sentiment === 'hawkish') return ['ECB 금리동결 기대↑', 'EUR 강세', '유럽 성장주↓'];
    if (sentiment === 'dovish') return ['ECB 금리인하 기대↑', 'EUR 약세', '유럽 채권↑'];
  }

  if (name.includes('Xi') || name.includes('China')) {
    return ['중국 정책 리스크', '원자재 수요 전망 변동', '아시아 증시 연동'];
  }

  return [];
}

export async function GET() {
  const redis = createRedis();
  const cacheKey = `flowvium:osint:social:v3:${new Date().toISOString().slice(0, 13)}`;

  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return NextResponse.json({ ...(cached as object), cached: true });
    } catch { /* non-fatal */ }
  }

  // ── 1. Nitter (parallel) ──────────────────────────────────────────────────────
  const nitterResults = await Promise.allSettled(
    KEY_FIGURES.map(f => f.twitter ? fetchNitterRss(f.twitter) : Promise.resolve([] as RssItem[]))
  );

  // ── 2. News RSS (parallel) ────────────────────────────────────────────────────
  const newsResults = await Promise.allSettled(
    NEWS_RSS_FEEDS.map(f => fetchNewsRss(f.url, f.source))
  );
  const allNewsItems: RssItem[] = newsResults.flatMap(r => r.status === 'fulfilled' ? r.value : []);

  // ── 3. Build entries ──────────────────────────────────────────────────────────
  const entries: SocialEntry[] = [];

  KEY_FIGURES.forEach((figure, idx) => {
    const tweets: RssItem[] = nitterResults[idx].status === 'fulfilled' ? nitterResults[idx].value : [];

    // Real tweets first
    for (const item of tweets.slice(0, 3)) {
      const text = `${item.title} ${item.description}`;
      const sentiment = detectSentiment(text);
      entries.push({
        person: figure.name, role: figure.role, flag: figure.flag, tag: figure.tag,
        title: item.title,
        summary: item.description.slice(0, 200),
        source: item.source, url: item.link,
        publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
        sentiment,
        impact: detectImpact(text, figure.isFed, figure.votingMember),
        istweet: true,
        isFed: figure.isFed,
        votingMember: figure.votingMember,
        cascade: buildCascade(figure, sentiment, text),
      });
    }

    // News mentions
    const matched = allNewsItems.filter(item => {
      const text = `${item.title} ${item.description}`.toLowerCase();
      return figure.keywords.some(kw => text.includes(kw));
    });
    const newsLimit = tweets.length > 0 ? 1 : 3;
    for (const item of matched.slice(0, newsLimit)) {
      const text = `${item.title} ${item.description}`;
      const sentiment = detectSentiment(text);
      entries.push({
        person: figure.name, role: figure.role, flag: figure.flag, tag: figure.tag,
        title: item.title,
        summary: item.description.replace(/<[^>]+>/g, '').slice(0, 200),
        source: item.source, url: item.link,
        publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
        sentiment,
        impact: detectImpact(text, figure.isFed, figure.votingMember),
        istweet: false,
        isFed: figure.isFed,
        votingMember: figure.votingMember,
        cascade: buildCascade(figure, sentiment, text),
      });
    }
  });

  // ── 4. Sort + deduplicate ─────────────────────────────────────────────────────
  const seen = new Set<string>();
  const deduped = entries
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .filter(e => { if (seen.has(e.url)) return false; seen.add(e.url); return true; });

  const tweetCount = deduped.filter(e => e.istweet).length;
  const result = {
    entries: deduped,
    total: deduped.length,
    tweetCount,
    newsCount: deduped.length - tweetCount,
    updatedAt: new Date().toISOString(),
    cached: false,
  };

  if (redis) {
    await loggedRedisSet(redis, 'api.osint.social', cacheKey, result, { ex: 30 * 60 });
  }

  return NextResponse.json(result);
}
