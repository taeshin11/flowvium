#!/usr/bin/env node
/**
 * market-breadth.mjs — 시장 폭: 유니버스(data/candidate-tickers.json)에서 200일선 아래 또는 데드크로스(50<200)인 종목 비율, 시장별.
 * 2026-10-30 신설 — 보고서 '한국 0종' 이유 한 줄(lib/funnel-breadth krFunnelReason)과 전향 연구 v0.3 의 B 가설(폭이 넓을 때 추세 거부)의 입력.
 * 출력: data/market-breadth.json {at, kr, us} (최신) + data/market-breadth.jsonl (이력, 덧붙이기).
 * 사용: node scripts/market-breadth.mjs [--dry]
 */
import { readFileSync, writeFileSync, appendFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './lib/project-root.mjs';
import { fetchBars } from './lib/ohlc.mjs';
import { breadthOf, breadthUsable } from './lib/funnel-breadth.mjs';
import { isEtf, isCashLikeEtf } from './lib/etf-filter.mjs';

const DRY = process.argv.includes('--dry');
const u = JSON.parse(readFileSync(resolve(ROOT, 'data/candidate-tickers.json'), 'utf8'));
// 엔진 깔때기와 같은 유니버스 — ETF·현금성 ETF 는 뺀다(engine-ledger-record 대조군과 같은 함수).
const tickers = (u.tickers ?? []).filter((t) => { const meta = u.meta?.[t] ?? {}; return !(isEtf(t, meta) || isCashLikeEtf(meta.name)); });
const from = new Date(Date.now() - 420 * 86_400_000).toISOString();
const to = new Date().toISOString();
const closes = { kr: [], us: [] };
let failed = 0;
const queue = [...tickers];
await Promise.all(Array.from({ length: 4 }, async () => {
  while (queue.length) {
    const t = queue.shift();
    const r = await fetchBars(t, from, to);
    const c = (r?.bars ?? []).map((b) => b.c).filter(Number.isFinite);
    if (!c.length) { failed++; continue; }
    closes[/\.(KS|KQ)$/i.test(t) ? 'kr' : 'us'].push(c);
  }
}));
const isKr = (t) => /\.(KS|KQ)$/i.test(t);
const total = { kr: tickers.filter(isKr).length, us: tickers.filter((t) => !isKr(t)).length };
const rec = { at: new Date().toISOString(), universe: tickers.length, failed, kr: breadthOf(closes.kr), us: breadthOf(closes.us) };
console.log(`시장 폭: KR ${rec.kr.either}/${rec.kr.n} (${Math.round((rec.kr.pct ?? 0) * 100)}%) · US ${rec.us.either}/${rec.us.n} (${Math.round((rec.us.pct ?? 0) * 100)}%) · 실패 ${failed}/${tickers.length}`);
// 시장마다 절반 넘게 200봉으로 못 받았으면 쓰지 않는다 — 깨진 폭을 '새 값'으로 남기면 보고서가 그걸 믿는다.
//   전체 합산으로 보면 KR(전체의 ~40%)이 통째로 죽어도 통과한다(10/30 agy 리뷰).
const bad = ['kr', 'us'].filter((m) => !breadthUsable(rec[m], total[m]));
if (bad.length) { console.error(`❌ ${bad.map((m) => `${m.toUpperCase()} ${rec[m].n}/${total[m]}`).join(' · ')} 만 200봉 — 기록 안 함`); process.exit(1); }
if (!DRY) {
  const out = resolve(ROOT, 'data/market-breadth.json');
  writeFileSync(`${out}.tmp`, JSON.stringify(rec, null, 1) + '\n');
  renameSync(`${out}.tmp`, out);
  appendFileSync(resolve(ROOT, 'data/market-breadth.jsonl'), JSON.stringify(rec) + '\n');
}
