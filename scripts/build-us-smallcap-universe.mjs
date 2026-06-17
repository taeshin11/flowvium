#!/usr/bin/env node
/**
 * scripts/build-us-smallcap-universe.mjs — US 소형주 매집 스캔 유니버스 빌더 (2026-06-17).
 *
 * 왜: scan-accumulation --us 가 candidate-tickers(대형주 873종)를 쓰니 매집 포착 0 — 작전주/비정상거래량
 *   매집은 *저유동성 소형주* 현상이라 대형주 풀엔 구조적으로 신호가 없음(ADV 수십억$, coiling 부재).
 *   Yahoo predefined screener 'aggressive_small_caps'(저시총·고성장 추정)로 진짜 소형주 풀을 구성.
 *
 * 출력: data/us-smallcap-universe.json { tickers:[...], meta:{TICK:{name,marketCap}} }
 * 사용: node scripts/build-us-smallcap-universe.mjs   (주 1회 크론 권장 — 풀은 천천히 변함)
 */
import { writeFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const SCR_IDS = ['aggressive_small_caps', 'small_cap_gainers'];
const PER = 100, MAX_PER_ID = 300;
const MIN_PRICE = 1.0;        // 페니주(<$1) 제외 — 노이즈
const MAX_MKTCAP = 5e9;       // $5B 초과 = 소형주 아님

async function fetchScreen(id, start) {
  const url = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?count=${PER}&start=${start}&scrIds=${id}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) return { quotes: [], total: 0 };
  const q = (await r.json())?.finance?.result?.[0];
  return { quotes: q?.quotes ?? [], total: q?.total ?? 0 };
}

const tickers = [];
const meta = {};
const seen = new Set();
for (const id of SCR_IDS) {
  let start = 0, total = Infinity, got = 0;
  while (start < Math.min(total, MAX_PER_ID)) {
    const { quotes, total: tt } = await fetchScreen(id, start);
    total = tt || 0;
    if (!quotes.length) break;
    for (const x of quotes) {
      const sym = x.symbol;
      if (!sym || seen.has(sym) || /[-^.]/.test(sym)) continue;          // 인덱스/우선주(-P)/워런트/유닛 스킵
      const price = x.regularMarketPrice ?? 0;
      const mc = x.marketCap ?? 0;
      if (price < MIN_PRICE) continue;
      if (mc && mc > MAX_MKTCAP) continue;
      seen.add(sym);
      tickers.push(sym);
      meta[sym] = { name: x.shortName ?? x.longName ?? sym, marketCap: mc || null };
      got++;
    }
    start += PER;
    await new Promise(s => setTimeout(s, 300));
  }
  console.log(`${id}: +${got}종 (누적 ${tickers.length})`);
}

const out = { generatedAt: new Date().toISOString(), source: 'yahoo-screener', screens: SCR_IDS, count: tickers.length, tickers, meta };
writeFileSync(resolve(ROOT, 'data/us-smallcap-universe.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`\n✅ US 소형주 유니버스 ${tickers.length}종 → data/us-smallcap-universe.json`);
console.log('샘플:', tickers.slice(0, 12).join(', '));
