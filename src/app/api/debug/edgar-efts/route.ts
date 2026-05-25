/**
 * /api/debug/edgar-efts — 임시 진단 endpoint
 *
 * 2026-05-25 사건: ownership-alerts 가 Vercel 환경에서 0 items 반환.
 * 직접 EFTS 호출은 385 hits 정상. 원인 진단 필요.
 *
 * 이 endpoint 는 prod (Vercel) 환경에서 EFTS 호출 결과 raw 노출 →
 * status / body / latency / 에러 reason 파악 후 적합한 fix 결정 후 제거.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TODAY = new Date().toISOString().slice(0, 10);
const WEEK_AGO = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

const TARGETS = [
  {
    name: 'efts-schedule-13D',
    url: `https://efts.sec.gov/LATEST/search-index?q=%22schedule%2013D%22&startdt=${WEEK_AGO}&enddt=${TODAY}`,
  },
  {
    name: 'efts-schedule-13G',
    url: `https://efts.sec.gov/LATEST/search-index?q=%22schedule%2013G%22&startdt=${WEEK_AGO}&enddt=${TODAY}`,
  },
  {
    name: 'edgar-getcurrent-13D',
    url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=SC+13D&output=atom&count=20',
  },
];

export async function GET() {
  const results = [];
  for (const t of TARGETS) {
    const t0 = Date.now();
    try {
      const res = await fetch(t.url, {
        headers: {
          'User-Agent': 'FlowVium/1.0 taeshinkim11@gmail.com',
          'Accept': 'application/xml,text/html',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });
      const body = await res.text();
      let hitsCount = null;
      try {
        const j = JSON.parse(body);
        hitsCount = j?.hits?.hits?.length ?? null;
      } catch { /* not JSON */ }
      results.push({
        name: t.name,
        status: res.status,
        ok: res.ok,
        latencyMs: Date.now() - t0,
        bodyLength: body.length,
        bodyHead: body.slice(0, 400),
        bodyTail: body.length > 400 ? body.slice(-200) : null,
        hitsCount,
      });
    } catch (e) {
      results.push({
        name: t.name,
        error: String(e),
        latencyMs: Date.now() - t0,
      });
    }
  }
  return NextResponse.json({
    timestamp: new Date().toISOString(),
    runtime: process.env.VERCEL ? 'vercel' : 'local',
    results,
  });
}
