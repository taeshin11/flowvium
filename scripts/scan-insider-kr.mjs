#!/usr/bin/env node
/**
 * scripts/scan-insider-kr.mjs — KR 임원·주요주주 지분공시 시장 피드 빌더 (2026-06-17).
 *
 * 사용자 "이거(내부자 거래) KS종목에 대해서는 파악안됨?" — US Form 4 시장피드(/api/insider-trades)의 KR 대응.
 *   DART elestock/majorstock 는 corp_code 별 조회만 가능(시장 getcurrent 없음) → 후보 KR 종목을 순회하며
 *   /api/insider-kr/[ticker] (lib 단일소스, 12h Redis 캐시) 를 호출, 최근 N일 공시만 모아 피드 생성.
 *   결과: data/insider-kr-feed.json — insider 페이지 korea 탭이 "최근 KR 내부자 지분공시"로 노출.
 *
 * 사용: PORT=3000 node scripts/scan-insider-kr.mjs
 * 비-GPU. 크론 2회/일 권장. 로컬 라우트 의존(웹서버 down 시 graceful 빈 피드).
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;
const RECENT_DAYS = 60;       // 최근 60일 공시만 피드에 노출
const MAX_FEED = 60;          // 피드 최대 건수
const CONC = 4;

const cand = JSON.parse(readFileSync(resolve(ROOT, 'data/candidate-tickers.json'), 'utf8'));
const tickers = (cand.tickers ?? []).filter(t => /\.(KS|KQ)$/.test(t));
console.log(`KR 내부자 지분공시 스캔: ${tickers.length}종 (최근 ${RECENT_DAYS}일)`);

const cutoff = Date.now() - RECENT_DAYS * 86400 * 1000;
const feed = [];
let live = 0, naFew = 0, errCnt = 0;

async function fetchTicker(t) {
  try {
    const r = await fetch(`${BASE}/api/insider-kr/${encodeURIComponent(t)}`, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) { errCnt++; return; }
    const j = await r.json();
    if (j.source === 'dart-live' || j.source === 'dart-stale') live++;
    else if (j.source === 'not-applicable') naFew++;
    const nm = cand.meta?.[t]?.name ?? j.corpName ?? t;
    for (const f of (j.items ?? [])) {
      const ts = Date.parse(f.filedAt);
      if (!Number.isFinite(ts) || ts < cutoff) continue;
      feed.push({ ticker: t, name: nm, ...f });
    }
  } catch { errCnt++; }
}

for (let i = 0; i < tickers.length; i += CONC) {
  await Promise.all(tickers.slice(i, i + CONC).map(fetchTicker));
  if (i % 60 === 0) console.log(`  ... ${Math.min(i + CONC, tickers.length)}/${tickers.length} (피드 ${feed.length})`);
}

// 최신순(접수일 desc, 동일자는 증감수량 절대값 큰 것 우선) 정렬 후 cap
feed.sort((a, b) => (b.filedAt.localeCompare(a.filedAt)) || (Math.abs(b.sharesDelta ?? 0) - Math.abs(a.sharesDelta ?? 0)));
const out = {
  generatedAt: new Date().toISOString(),
  scanned: tickers.length,
  withFilings: live,
  recentDays: RECENT_DAYS,
  count: Math.min(feed.length, MAX_FEED),
  totalRecent: feed.length,
  feed: feed.slice(0, MAX_FEED),
};
writeFileSync(resolve(ROOT, 'data/insider-kr-feed.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`\n✅ KR 내부자 공시 ${feed.length}건(최근 ${RECENT_DAYS}일, ${live}종 보고) → data/insider-kr-feed.json (notApplicable ${naFew}, err ${errCnt})`);
for (const f of feed.slice(0, 10)) {
  const d = f.direction === 'buy' ? '매수' : f.direction === 'sell' ? '매도' : '변동';
  console.log(`  ${f.filedAt} ${String(f.name).slice(0, 8).padEnd(9)} ${f.kind === 'major' ? '대량보유' : '임원'} ${f.reporter} ${d} ${f.sharesDelta ?? '-'}주`);
}
