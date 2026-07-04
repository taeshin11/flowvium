/**
 * /api/fund-flows — ICI 주간 ETF Estimated Net Issuance (2026-07-04 신설)
 *
 * 자산이동 "실측성" 강화(ChatGPT 리뷰 차용 D3): 국가/자산군 ETF 수익률은 가격 proxy 일 뿐 —
 * ICI 주간 net issuance 는 미국 ETF 의 실제 창설/상환 기반 *실측 추정치*(공식, 주간 지연).
 * 용도: 일간 매수 gate 가 아니라 macro posture·thesis 의 broad risk-on/off 확인.
 * 소스: https://www.ici.org/research/stats/etf_flows (HTML 테이블, 최근 5주). 키 불필요.
 */
import { NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import { logger, loggedRedisSet } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const CACHE_KEY = 'flowvium:fund-flows:ici:v1';
const CACHE_TTL = 12 * 3600;          // 12h — 주간 데이터
const STALE_KEY = 'flowvium:fund-flows:ici:stale:v1';
const STALE_TTL = 10 * 86400;

// 실측 라인 구조(2026-07-04 curl): 라벨은 "Domestic"/"World" 단독 행, 값 5개는 *최신이 첫 열*(6/24, 6/17, ...).
const CATEGORIES: Array<[key: string, label: RegExp]> = [
  ['total', /^Total$/i],
  ['equity', /^Equity$/i],
  ['domesticEquity', /^Domestic(\s+Equity)?$/i],
  ['worldEquity', /^World(\s+Equity)?$/i],
  ['hybrid', /^Hybrid$/i],
  ['bond', /^Bond$/i],
  ['commodity', /^Commodit(y|ies)$/i],
];

function parseIci(html: string) {
  // 태그 제거 → 셀 단위 토큰화. 음수는 "-1,234" 또는 "(1,234)" 표기 대응.
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&');
  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);

  // 주말(week-ended) 날짜 행: "6/24/2026" 류 날짜 5개 내외가 연속 등장
  const dateIdx: string[] = [];
  for (const l of lines) {
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(l)) dateIdx.push(l);
    if (dateIdx.length >= 8) break;
  }
  const asOfWeekEnded = dateIdx.length ? dateIdx[0] : null; // 첫 열 = 최신 주 (2026-07-04 실측: 6/24 가 첫 날짜)

  const num = (s: string): number | null => {
    const t = s.replace(/[$,\s]/g, '');
    if (/^\(\d+(\.\d+)?\)$/.test(t)) return -Number(t.slice(1, -1));
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
    return null;
  };

  const categories: Record<string, number | null> = {};
  const weeks: Record<string, Array<number | null>> = {};
  for (const [key, re] of CATEGORIES) {
    const i = lines.findIndex((l) => re.test(l));
    if (i < 0) { categories[key] = null; continue; }
    const vals: Array<number | null> = [];
    for (let j = i + 1; j < Math.min(i + 12, lines.length) && vals.length < 6; j++) {
      const v = num(lines[j]);
      if (v == null && vals.length) break;   // 숫자 연속 구간 종료
      if (v != null) vals.push(v);
    }
    weeks[key] = vals;
    categories[key] = vals.length ? vals[0] : null;  // 첫 열 = 최신 주
  }
  const parsedOk = categories.total != null || (categories.equity != null && categories.bond != null);
  return { parsedOk, asOfWeekEnded, categories, weeks };
}

export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get('refresh') === '1';
  const redis = createRedis();
  if (redis && !force) {
    try { const c = await redis.get(CACHE_KEY); if (c) return NextResponse.json({ ...(c as object), cached: true }); } catch { /* */ }
  }
  try {
    const r = await fetch('https://www.ici.org/research/stats/etf_flows', {
      headers: { 'user-agent': 'Mozilla/5.0 (FlowVium research; contact via site)' },
      signal: AbortSignal.timeout(15000), cache: 'no-store',
    });
    if (!r.ok) throw new Error(`ICI HTTP ${r.status}`);
    const { parsedOk, asOfWeekEnded, categories, weeks } = parseIci(await r.text());
    if (!parsedOk) throw new Error('ICI 테이블 파싱 실패(포맷 변경 의심)');
    const payload = {
      source: 'ICI', measurement: 'estimated_net_issuance', frequency: 'weekly',
      unit: 'USD_millions', lag: 'weekly', confidence: 'official_estimate',
      asOfWeekEnded, categories, weeks, updatedAt: new Date().toISOString(),
    };
    if (redis) {
      await loggedRedisSet(redis, 'api.fund-flows', CACHE_KEY, payload, { ex: CACHE_TTL });
      await loggedRedisSet(redis, 'api.fund-flows', STALE_KEY, payload, { ex: STALE_TTL });
    }
    logger.info('api.fund-flows', 'ici_parsed', { asOfWeekEnded, total: categories.total });
    return NextResponse.json(payload);
  } catch (e) {
    // stale 폴백 (주간 데이터라 수일 stale 도 유효) — 없으면 명시적 에러(정적 위장 금지)
    if (redis) {
      try { const s = await redis.get(STALE_KEY); if (s) return NextResponse.json({ ...(s as object), cached: true, stale: true }); } catch { /* */ }
    }
    logger.warn('api.fund-flows', 'fetch_failed', { error: String(e) });
    return NextResponse.json({ error: String(e), source: 'ICI' }, { status: 502 });
  }
}
