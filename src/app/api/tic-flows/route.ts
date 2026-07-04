/**
 * /api/tic-flows — TIC 월간 외국인 미국채 보유 실측 (2026-07-04 이연 이행)
 *
 * 소스: Treasury TIC SLT Table 5 (Major Foreign Holders of Treasury Securities, 월간, ~6주 지연).
 * https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table5.txt
 * 탭 구분 텍스트 — Country 헤더행(YYYY-MM 월 컬럼, 첫 컬럼=최신) + 국가행 + Grand Total.
 *
 * 용도: 자산이동 서사의 *국가 단위 실측* 맥락(일본/중국/한국의 미국채 매수·매도) — 월간·지연이 커서
 * flow claim 은 걸지 않고 macro prompt 배경 블록 전용. measurement 명시(가격 proxy 아님).
 * 실측 검증(2026-07-04): 2026-04 최신 — Japan 1209.9 / China 651.1 / Korea 135.2 / Total 9352.6 ($B).
 */
import { NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import { logger, loggedRedisSet } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const SRC = 'https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table5.txt';
const KEY = 'flowvium:tic-flows:v1';
const STALE_KEY = 'flowvium:tic-flows:stale:v1';
const TTL = 24 * 3600;           // 월간 데이터 — 24h 캐시
const STALE_TTL = 45 * 86400;

const FOCUS = ['Japan', 'China, Mainland', 'United Kingdom', 'Korea, South', 'Taiwan', 'Grand Total'];

interface HolderRow { country: string; latest: number; delta1m: number | null; delta3m: number | null; delta12m: number | null; }

function parseSlt5(txt: string): { asOfMonth: string; holders: HolderRow[] } | null {
  const lines = txt.split('\n').map((l) => l.replace(/\r$/, ''));
  const header = lines.find((l) => l.startsWith('Country\t'));
  if (!header) return null;
  const months = header.split('\t').slice(1).map((s) => s.trim()).filter((s) => /^\d{4}-\d{2}$/.test(s));
  if (!months.length) return null;
  const holders: HolderRow[] = [];
  for (const line of lines) {
    const cells = line.split('\t').map((s) => s.trim());
    if (!FOCUS.includes(cells[0])) continue;
    const vals = cells.slice(1, 1 + months.length).map((v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; });
    if (vals[0] == null) continue;
    const d = (i: number) => (vals[i] != null ? +(vals[0]! - vals[i]!).toFixed(1) : null);
    holders.push({ country: cells[0], latest: vals[0]!, delta1m: d(1), delta3m: d(3), delta12m: d(12) });
  }
  if (!holders.length) return null;
  return { asOfMonth: months[0], holders };
}

export async function GET() {
  const redis = createRedis();
  if (redis) {
    try {
      const cached = await redis.get(KEY);
      if (cached) return NextResponse.json(typeof cached === 'string' ? JSON.parse(cached) : cached);
    } catch { /* cache miss 처리 */ }
  }
  try {
    const res = await fetch(SRC, { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = parseSlt5(await res.text());
    if (!parsed) throw new Error('parse 실패 (Country 헤더/월 컬럼 미검출)');
    const payload = {
      ...parsed,
      unit: 'USD billions',
      measurement: 'measured_treasury_holdings_monthly',  // 실측 보유액 — 가격 proxy 아님
      lagNote: '월간, 약 6주 지연 (TIC SLT)',
      source: 'live',
      updatedAt: new Date().toISOString(),
    };
    if (redis) {
      await loggedRedisSet(redis, 'api.tic-flows', KEY, payload, { ex: TTL });
      await loggedRedisSet(redis, 'api.tic-flows', STALE_KEY, payload, { ex: STALE_TTL });
    }
    return NextResponse.json(payload);
  } catch (e) {
    logger.error('tic-flows', 'fetch_or_parse_failed', { error: String(e).slice(0, 120) });
    if (redis) {
      try {
        const stale = await redis.get(STALE_KEY);
        if (stale) {
          const p = typeof stale === 'string' ? JSON.parse(stale) : stale;
          return NextResponse.json({ ...p, source: 'stale' });
        }
      } catch { /* stale 도 없음 */ }
    }
    // 정적 위장 금지 — 명시적 실패
    return NextResponse.json({ error: `TIC fetch/parse 실패: ${String(e).slice(0, 80)}` }, { status: 502 });
  }
}
