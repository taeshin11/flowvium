/**
 * src/lib/market-alerts.ts — KRX 시장경보(투자주의/경고/위험) 라이브 수집 (2026-06-14).
 *
 * 사용자 "KRX 소수계좌 거래집중 직접 API 막혔다 → 뚫어봐". data.krx.co.kr getJsonData 는
 *   anti-bot LOGOUT 으로 차단되나, **KIND**(kind.krx.co.kr) 의 investattentwarnrisky.do 는
 *   세션 쿠키(GET)+정확한 폼(method=investattentwarnriskySub, forward=invstcautnisu_sub,
 *   startDate=endDate 일자필수)로 뚫림. 검증: 2026-06-14 투자주의에 '소수지점/계좌'(=소수계좌
 *   거래집중) 사유로 HS화성(002460)·녹십자홀딩스(005250) 포착.
 *
 * '소수지점/계좌' = 거래가 소수 계좌에 집중 → **오르기 前 작전주 선행 surveillance flag** (사용자가
 *   원한 "이미 오른 게 아니라 조짐"). 투자경고/위험은 이미 급등 진행(후행) flag.
 *
 * 권위 소스(거래소 공식)라 결정론 4시그니처/매집 스크리너를 ground-truth 로 보강.
 */
import type { Redis } from '@upstash/redis';
import { loggedRedisSet } from '@/lib/logger';

export type AlertCategory = 'caution' | 'warning' | 'risk';

export interface MarketAlert {
  region?: 'KR' | 'US';          // 2026-06-14: US 병합 후 구분 (기본 KR)
  category: AlertCategory;        // caution=투자주의, warning=투자경고, risk=투자위험
  name: string;                  // 회사명(한글)
  ticker: string | null;         // 6자리.KS/.KQ (해소 시) | null
  market: 'kospi' | 'kosdaq' | 'konex' | null;
  reason: string | null;         // 지정 사유 (투자주의만; '소수지점/계좌' 등)
  fewAccount: boolean;           // 소수계좌 거래집중 (오르기 前 선행 flag)
  designatedDate: string | null; // 지정일(YYYY-MM-DD)
  releaseDate: string | null;    // 해제(예정)일
}

const KIND = 'https://kind.krx.co.kr/investwarn/investattentwarnrisky.do';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const TABS: { category: AlertCategory; mi: number; fwd: string; om: number }[] = [
  { category: 'caution', mi: 1, fwd: 'invstcautnisu_sub', om: 4 },
  { category: 'warning', mi: 2, fwd: 'invstwarnisu_sub', om: 3 },
  { category: 'risk', mi: 3, fwd: 'invstriskisu_sub', om: 3 },
];

function ymd(d: Date) { return d.toISOString().slice(0, 10); }
function stripTags(s: string) { return s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(); }

function marketFromAlt(alt: string | undefined): MarketAlert['market'] {
  if (!alt) return null;
  if (alt.includes('유가') || alt.includes('코스피')) return 'kospi';
  if (alt.includes('코스닥')) return 'kosdaq';
  if (alt.includes('코넥스')) return 'konex';
  return null;
}

/** KIND 세션 쿠키 확보 (GET 시 Set-Cookie). */
async function kindSession(): Promise<string> {
  const g = await fetch(`${KIND}?method=investattentwarnriskyMain`, {
    headers: { 'User-Agent': UA, 'Referer': 'https://kind.krx.co.kr/main.do' },
    signal: AbortSignal.timeout(9000),
    cache: 'no-store',
  });
  await g.text();
  const setc = (g.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  return setc.map((c) => c.split(';')[0]).join('; ');
}

async function fetchTab(tab: typeof TABS[number], cookie: string, startDate: string, endDate: string): Promise<MarketAlert[]> {
  const body = new URLSearchParams({
    method: 'investattentwarnriskySub', forward: tab.fwd, menuIndex: String(tab.mi),
    marketType: '', currentPageSize: '100', pageIndex: '1', orderMode: String(tab.om), orderStat: 'D',
    searchCorpName: '', searchFromDate: endDate, startDate, endDate,
  });
  const r = await fetch(KIND, {
    method: 'POST',
    headers: {
      'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Referer': `${KIND}?method=investattentwarnriskyMain`, 'Origin': 'https://kind.krx.co.kr',
      'X-Requested-With': 'XMLHttpRequest', ...(cookie ? { Cookie: cookie } : {}),
    },
    body, signal: AbortSignal.timeout(11000), cache: 'no-store',
  });
  const html = await r.text();
  if (!r.ok || html.includes('잠시 후')) return [];

  const out: MarketAlert[] = [];
  for (const m of Array.from(html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g))) {
    const tr = m[1];
    const tds = Array.from(tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map((c) => c[1]);
    if (tds.length < 3) continue;                              // 헤더/빈 row 스킵
    const nameCell = tds[1] ?? '';
    const name = stripTags(nameCell);
    if (!name || name.includes('결과값이 없습니다')) continue;
    const alt = (nameCell.match(/alt=['"]([^'"]+)['"]/) || [])[1];
    const market = marketFromAlt(alt);
    const dates = tds.map(stripTags).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x));
    const reason = tab.category === 'caution' ? stripTags(tds[2] ?? '') || null : null;
    out.push({
      region: 'KR', category: tab.category, name, ticker: null, market,
      // 소수/단일 계좌 집중 + 매매관여 과다 = 거래소가 집계한 소수계좌 거래집중 계열(작전주 선행 flag)
      reason, fewAccount: tab.category === 'caution' && /소수\s*지점|소수\s*계좌|계좌\s*집중|단일\s*계좌|관여\s*과다/.test(reason || ''),
      designatedDate: dates[0] ?? null, releaseDate: dates[dates.length - 1] ?? null,
    });
  }
  return out;
}

/** 3개 탭(투자주의/경고/위험) 라이브 수집. ticker 미해소(name 만). lookback 일수 내 지정분. */
export async function fetchMarketAlertsRaw(lookbackDays = 10): Promise<MarketAlert[]> {
  const cookie = await kindSession();
  const now = new Date();
  const start = new Date(now); start.setDate(start.getDate() - lookbackDays);
  const sd = ymd(start), ed = ymd(now);
  const all: MarketAlert[] = [];
  for (const tab of TABS) {
    try { all.push(...await fetchTab(tab, cookie, sd, ed)); } catch { /* 탭 실패는 부분 결과 허용 */ }
  }
  return all;
}

/** Naver autocomplete 로 회사명→6자리 ticker(.KS/.KQ) 해소. Redis 30일 memo. */
export async function resolveTicker(name: string, redis: Redis | null): Promise<string | null> {
  const key = `malert:tk:${name}`;
  if (redis) { try { const c = await redis.get<string>(key); if (c) return c === '_' ? null : c; } catch { /* miss */ } }
  let resolved: string | null = null;
  try {
    const r = await fetch(`https://ac.stock.naver.com/ac?q=${encodeURIComponent(name)}&target=stock`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://m.stock.naver.com/' },
      signal: AbortSignal.timeout(6000), cache: 'no-store',
    });
    if (r.ok) {
      const items = ((await r.json())?.items ?? []) as { code?: string; name?: string; typeCode?: string }[];
      const exact = items.find((it) => it.name === name) ?? items[0];
      if (exact?.code && /^\d{6}$/.test(exact.code)) {
        const suffix = (exact.typeCode || '').toUpperCase().includes('KOSDAQ') ? '.KQ' : '.KS';
        resolved = exact.code + suffix;
      }
    }
  } catch { /* keep null */ }
  if (redis) { try { await redis.set(key, resolved ?? '_', { ex: 60 * 60 * 24 * 30 }); } catch { /* best effort */ } }
  return resolved;
}

const CACHE_KEY = 'market-alerts:v1';
const TTL = 60 * 60 * 3; // 3h

export interface MarketAlertsResult { alerts: MarketAlert[]; source: 'live' | 'cache' | 'empty'; asOf: string }

/** 캐시만 읽음(라이브 fetch 안 함). per-ticker 핫패스(manipulation-risk)용 — cold penalty 회피. */
export async function peekMarketAlerts(redis: Redis | null): Promise<MarketAlertsResult | null> {
  if (!redis) return null;
  try { const c = await redis.get<MarketAlertsResult>(CACHE_KEY); return c?.alerts ? { ...c, source: 'cache' } : null; } catch { return null; }
}

/**
 * Redis 캐시(3h) 시장경보. miss 시 라이브 수집 + ticker 해소 후 write. 실패 시 빈 배열(source='empty').
 * 정적 폴백 금지 규칙: 시계열 surveillance 데이터라 miss 폴백은 [] (정적 사용 금지).
 */
export async function getMarketAlerts(redis: Redis | null, opts?: { resolveTickers?: boolean }): Promise<MarketAlertsResult> {
  if (redis) {
    try {
      const cached = await redis.get<MarketAlertsResult>(CACHE_KEY);
      if (cached?.alerts) return { ...cached, source: 'cache' };
    } catch { /* fall through to live */ }
  }
  let alerts: MarketAlert[] = [];
  try { alerts = await fetchMarketAlertsRaw(10); } catch { alerts = []; }
  if (!alerts.length) return { alerts: [], source: 'empty', asOf: new Date().toISOString() };

  if (opts?.resolveTickers !== false) {
    // 고유 회사명만 해소 (중복 dedupe), conc 8, Redis memo 로 cold 만 Naver 타격.
    const names = Array.from(new Set(alerts.map((a) => a.name)));
    const map = new Map<string, string | null>();
    const CONC = 8;
    for (let i = 0; i < names.length; i += CONC) {
      const batch = names.slice(i, i + CONC);
      const res = await Promise.all(batch.map((nm) => resolveTicker(nm, redis)));
      batch.forEach((nm, j) => map.set(nm, res[j]));
    }
    for (const a of alerts) a.ticker = map.get(a.name) ?? null;
  }

  const result: MarketAlertsResult = { alerts, source: 'live', asOf: new Date().toISOString() };
  await loggedRedisSet(redis, 'market-alerts', CACHE_KEY, result, { ex: TTL });
  return result;
}
