#!/usr/bin/env node
/**
 * ingest-short-interest.mjs — 종목 풀 전체의 공매도 잔고를 순환하며 채운다. (2026-09-13 신설)
 *
 * 왜 (실측): /api/short-interest 가 코드에 박힌 33종만 본다(TRACKED_TICKERS).
 *   종목 풀은 1,338종이다. 33종만 재면서 "숏스퀴즈를 찾는다" 고 할 수 없다 —
 *   매수룰 micro_squeeze_score 는 개통 이래 **0건 발화**했고, 그 33종 중 임계 50을 넘는 건
 *   MRNA(65)·COIN(55) 둘뿐인데 둘 다 후보 30위 안에 든 적이 없다.
 *   즉 룰이 고장 난 게 아니라 **볼 수 있는 범위가 33종뿐**이었다.
 *
 * 왜 실시간이 아니라 적재인가: 공매도 잔고는 FINRA 결제일 기준 **월 2회** 갱신된다.
 *   분 단위로 받을 이유가 없고, 보고서가 호출하는 API 는 12초 예산이라 수백 종을
 *   그 자리에서 받을 수도 없다. 백그라운드가 순환하며 채우고 API 는 읽기만 한다.
 *
 * 한 번에 다 받지 않는다: 오래된 것부터 한 묶음씩. 며칠이면 한 바퀴가 돈다.
 *   연속 실패가 쌓인 티커(상장폐지·표기 차이)는 뒤로 밀어 큐를 막지 않는다.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
import { getYahooCrumb, YAHOO_UA } from './lib/yahoo-crumb.mjs';
import { toYahooTicker } from './lib/ticker-normalize.mjs';
import { pickShortInterestQueue, saveShortInterest, shortInterestCoverage } from './lib/db.mjs';

const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.split('=')[1] : d; };
const LIMIT = Number(arg('limit', 150));
const STALE_H = Number(arg('stale-hours', 72));
const CONCURRENT = Number(arg('concurrent', 4));
const DRY = process.argv.includes('--dry');

/**
 * 대상 종목. 미국 주식만 — Yahoo 의 shortPercentOfFloat 는 한국 종목에 값이 없고,
 * ETF 는 공매도 비중 개념이 종목과 달라 스퀴즈 판단에 쓰지 않는다.
 */
function universe() {
  const j = JSON.parse(readFileSync(resolve(ROOT, 'data/candidate-tickers.json'), 'utf8'));
  // 이 파일의 tickers 는 **납작한 문자열 배열**이다. byBand 는 개수만 있고 종목별 밴드는 없다.
  const list = (Array.isArray(j.tickers) ? j.tickers : Object.values(j.tickers ?? {}).flat())
    .map((x) => (typeof x === 'string' ? x : (x?.ticker ?? x?.symbol)))
    .filter(Boolean);

  // ETF 는 공매도 비중 개념이 종목과 달라 스퀴즈 판단에 쓰지 않는다. 이름 목록이 이미 있다.
  let etf = new Set();
  try { etf = new Set(Object.keys(JSON.parse(readFileSync(resolve(ROOT, 'data/etf-names.json'), 'utf8')))); } catch { /* 없으면 그냥 진행 */ }

  const out = [];
  for (const t of list) {
    if (/\.(KS|KQ)$/i.test(t)) continue;   // 한국 종목은 Yahoo 에 shortPercentOfFloat 가 없다
    if (etf.has(t)) continue;
    out.push(t);
  }
  return [...new Set(out)];
}

const rawVal = (f) => {
  if (f && typeof f === 'object') { const v = f.raw; return typeof v === 'number' ? v : null; }
  return typeof f === 'number' ? f : null;
};

async function fetchOne(ticker, crumb, cookie) {
  const sym = toYahooTicker(ticker);
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}`
    + `?modules=defaultKeyStatistics&crumb=${encodeURIComponent(crumb)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': YAHOO_UA, Cookie: cookie },
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ks = (await res.json())?.quoteSummary?.result?.[0]?.defaultKeyStatistics ?? {};
  const pct = rawVal(ks.shortPercentOfFloat);
  const ratio = rawVal(ks.shortRatio);
  // 둘 다 없으면 "받았지만 값이 없다" — 실패로 세지 않는다(재시도해도 같다).
  return {
    shortPctFloat: pct != null ? parseFloat((pct * 100).toFixed(2)) : null,
    shortRatio: ratio != null ? parseFloat(ratio.toFixed(2)) : null,
  };
}

const all = universe();
const queue = pickShortInterestQueue(all, { limit: LIMIT, staleHours: STALE_H });
const before = shortInterestCoverage();
console.log(`대상 풀 ${all.length}종 · 이번 회차 ${queue.length}종 (${STALE_H}시간 지난 것 + 미수집 우선)`);
console.log(`현재 적재: 시도 ${before.attempted} · 값 있음 ${before.withData ?? 0} · 포기 ${before.givenUp ?? 0}\n`);
if (!queue.length) { console.log('받을 것 없음 — 전부 신선하다'); process.exit(0); }

const auth = await getYahooCrumb();
if (!auth?.crumb || !auth?.cookie) { console.error('[FATAL] Yahoo crumb 획득 실패 — 이번 회차 건너뜀'); process.exit(1); }

let ok = 0, empty = 0, fail = 0;
const work = [...queue];
async function worker() {
  for (;;) {
    const t = work.shift();
    if (!t) return;
    try {
      const r = await fetchOne(t, auth.crumb, auth.cookie);
      if (r.shortPctFloat == null && r.shortRatio == null) empty++;
      else ok++;
      if (!DRY) saveShortInterest({ ticker: t, ...r });
    } catch (e) {
      fail++;
      if (!DRY) saveShortInterest({ ticker: t, error: e.message });
    }
    await new Promise((r) => setTimeout(r, 120));   // Yahoo 429 는 자초하는 것 — 간격을 둔다
  }
}
await Promise.all(Array.from({ length: CONCURRENT }, worker));

const after = shortInterestCoverage();
console.log(`\n받음 ${ok} · 값 없음 ${empty} · 실패 ${fail}`);
console.log(`적재 후: 시도 ${after.attempted}/${all.length} (${(after.attempted / all.length * 100).toFixed(0)}%) · 값 있음 ${after.withData ?? 0}`);
if (DRY) console.log('(--dry: DB 미기록)');
process.exit(0);
