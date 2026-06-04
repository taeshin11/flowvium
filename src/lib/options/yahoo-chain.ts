/**
 * src/lib/options/yahoo-chain.ts
 *
 * Yahoo Finance v7/finance/options 풀-체인 fetcher.
 *
 * 크럼 인증: sector-pe / analyst-target 가 `flowvium:yahoo:crumb:v1` Redis 키에
 * 22h TTL 로 캐싱한 크럼/쿠키를 공유 사용. Redis miss 시 신규 발급 + 저장.
 *
 * Vercel 클라우드 IP 가 Yahoo 에 차단된 경우 모든 fetch 가 401 또는 429 — 캐시 또는
 * source: 'error' 응답으로 처리. 정적 폴백 절대 사용 금지 (시계열 시장 데이터).
 */
import { createRedis } from '@/lib/redis';
import type { Redis } from '@upstash/redis';
import { loggedRedisSet, logger } from '@/lib/logger';

const YF_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const CRUMB_KEY = 'flowvium:yahoo:crumb:v1';
const CRUMB_TTL = 22 * 60 * 60;
const SOURCE = 'yahoo.options-chain';

export interface RawOptionContract {
  contractSymbol?: string;
  strike?: number;
  expiration?: number; // unix seconds
  bid?: number;
  ask?: number;
  lastPrice?: number;
  lastTradeDate?: number; // unix seconds
  volume?: number;
  openInterest?: number;
  impliedVolatility?: number; // Yahoo 의 IV (참조용 — 우리는 재계산)
  inTheMoney?: boolean;
}

export interface OptionExpiry {
  expirationDate: string; // ISO
  expirationUnix: number;
  daysToExpiry: number;
  calls: RawOptionContract[];
  puts: RawOptionContract[];
}

export interface OptionChain {
  ticker: string;
  spot: number | null;
  asOf: string;
  expiries: OptionExpiry[];
  source: 'live' | 'error';
  errorReason?: string;
}

async function getYahooCrumb(redis: Redis | null): Promise<{ crumb: string; cookie: string } | null> {
  if (redis) {
    try {
      const cached = await redis.get<{ crumb: string; cookie: string }>(CRUMB_KEY);
      if (cached?.crumb) return cached;
    } catch {
      /* non-fatal */
    }
  }
  try {
    // 2026-06-04: finance.yahoo.com/ 홈은 응답 헤더가 과대해 Node undici 가 UND_ERR_HEADERS_OVERFLOW
    //   로 fetch 실패 → 쿠키 획득 불가 → crumb 없음 → 옵션 401 → IV 전멸. fc.yahoo.com(404 지만 A3
    //   쿠키 set, 헤더 작음)이 canonical 쿠키 소스. 이걸로 교체해 IV 파이프라인 복구.
    const homeRes = await fetch('https://fc.yahoo.com/', {
      headers: { 'User-Agent': YF_UA },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    const rawCookies = homeRes.headers.getSetCookie?.() ?? [];
    const cookie = rawCookies
      .map((c) => c.split(';')[0])
      .filter((c) => c.startsWith('A1=') || c.startsWith('A3=') || c.startsWith('A1S='))
      .join('; ');
    if (!cookie) return null;
    const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': YF_UA, Cookie: cookie },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!crumbRes.ok) return null;
    const crumb = (await crumbRes.text()).trim();
    if (!crumb || crumb.startsWith('{')) return null;
    const result = { crumb, cookie };
    if (redis) {
      await loggedRedisSet(redis, SOURCE, CRUMB_KEY, result, { ex: CRUMB_TTL });
    }
    return result;
  } catch (e) {
    logger.warn(SOURCE, 'crumb_acquire_failed', { error: String(e) });
    return null;
  }
}

interface YahooOptionsResult {
  underlyingSymbol?: string;
  expirationDates?: number[];
  quote?: { regularMarketPrice?: number };
  options?: Array<{
    expirationDate?: number;
    calls?: RawOptionContract[];
    puts?: RawOptionContract[];
  }>;
}

async function fetchExpirationDates(
  ticker: string,
  crumb: string | null,
  cookie: string | null,
): Promise<{ result: YahooOptionsResult; status: number } | null> {
  const params = crumb ? `?crumb=${encodeURIComponent(crumb)}` : '';
  const url = `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(ticker)}${params}`;
  try {
    const hdrs: Record<string, string> = cookie ? { 'User-Agent': YF_UA, Cookie: cookie } : { 'User-Agent': YF_UA };
    let res = await fetch(url, { headers: hdrs, cache: 'no-store', signal: AbortSignal.timeout(8000) });
    // 2026-06-04: Yahoo 429(rate-limit) 시 1회 백오프 재시도 — prewarm burst 로 자주 발생.
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1200));
      res = await fetch(url, { headers: hdrs, cache: 'no-store', signal: AbortSignal.timeout(8000) });
    }
    if (!res.ok) {
      logger.warn(SOURCE, 'fetch_failed', { ticker, status: res.status });
      return null;
    }
    const json = await res.json();
    const result = json?.optionChain?.result?.[0];
    if (!result) return null;
    return { result, status: res.status };
  } catch (e) {
    logger.warn(SOURCE, 'fetch_error', { ticker, error: String(e) });
    return null;
  }
}

async function fetchExpiry(
  ticker: string,
  expirationUnix: number,
  crumb: string | null,
  cookie: string | null,
): Promise<YahooOptionsResult | null> {
  const params = crumb
    ? `?date=${expirationUnix}&crumb=${encodeURIComponent(crumb)}`
    : `?date=${expirationUnix}`;
  const url = `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(ticker)}${params}`;
  try {
    const hdrs: Record<string, string> = cookie ? { 'User-Agent': YF_UA, Cookie: cookie } : { 'User-Agent': YF_UA };
    let res = await fetch(url, { headers: hdrs, cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1200));
      res = await fetch(url, { headers: hdrs, cache: 'no-store', signal: AbortSignal.timeout(8000) });
    }
    if (!res.ok) return null;
    const json = await res.json();
    return json?.optionChain?.result?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Yahoo 옵션 풀 체인 가져오기 — 7d~120d 만기만 (LEAPS 제외).
 * 최대 6 expiry 까지 (Vercel 8s timeout 안에 들어오게).
 */
export async function fetchYahooOptionChain(ticker: string): Promise<OptionChain> {
  const asOf = new Date().toISOString();
  const redis = createRedis();
  const crumbRes = await getYahooCrumb(redis);
  const crumb = crumbRes?.crumb ?? null;
  const cookie = crumbRes?.cookie ?? null;

  // Step 1: get expiration dates list (first request also returns first expiry's calls/puts)
  const first = await fetchExpirationDates(ticker, crumb, cookie);
  if (!first) {
    return { ticker, spot: null, asOf, expiries: [], source: 'error', errorReason: 'no_expirations' };
  }
  const spot = first.result.quote?.regularMarketPrice ?? null;
  const allUnix = first.result.expirationDates ?? [];
  const nowSec = Math.floor(Date.now() / 1000);
  const targetUnix = allUnix.filter((u) => {
    const dte = (u - nowSec) / 86400;
    return dte >= 7 && dte <= 120;
  });
  if (targetUnix.length === 0 && allUnix.length > 0) {
    // 7~120일 비어있으면 가장 가까운 만기만이라도 사용
    targetUnix.push(allUnix[0]);
  }
  // 2026-06-04: 만기 6→4 축소 — 30d/90d ATM 보간엔 4개면 충분. 요청수 감소로 Yahoo 429 회피.
  const limited = targetUnix.slice(0, 4);

  const expiries: OptionExpiry[] = [];
  // 첫 번째 응답에 이미 가까운 만기 calls/puts 가 있으면 활용
  if (first.result.options?.[0]) {
    const firstOpt = first.result.options[0];
    const exp = firstOpt.expirationDate ?? limited[0];
    if (exp != null && limited.includes(exp)) {
      const dte = (exp - nowSec) / 86400;
      expiries.push({
        expirationDate: new Date(exp * 1000).toISOString().slice(0, 10),
        expirationUnix: exp,
        daysToExpiry: dte,
        calls: firstOpt.calls ?? [],
        puts: firstOpt.puts ?? [],
      });
    }
  }

  // 나머지 만기 병렬 fetch
  const need = limited.filter((u) => !expiries.some((e) => e.expirationUnix === u));
  const results = await Promise.allSettled(need.map((u) => fetchExpiry(ticker, u, crumb, cookie)));
  for (let i = 0; i < need.length; i++) {
    const r = results[i];
    if (r.status !== 'fulfilled' || !r.value) continue;
    const opt = r.value.options?.[0];
    if (!opt) continue;
    const u = need[i];
    const dte = (u - nowSec) / 86400;
    expiries.push({
      expirationDate: new Date(u * 1000).toISOString().slice(0, 10),
      expirationUnix: u,
      daysToExpiry: dte,
      calls: opt.calls ?? [],
      puts: opt.puts ?? [],
    });
  }
  expiries.sort((a, b) => a.expirationUnix - b.expirationUnix);

  if (expiries.length === 0) {
    return { ticker, spot, asOf, expiries: [], source: 'error', errorReason: 'no_contracts' };
  }
  return { ticker, spot, asOf, expiries, source: 'live' };
}
