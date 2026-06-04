#!/usr/bin/env node
/**
 * scripts/prune-dead-tickers.mjs — 모니터링 풀에서 거래불가(상장폐지/피인수/외국거래소) 종목 감지.
 *
 * "1200+ 다 자세히" 검증(2026-06-04): 전수 sweep 결과 ~30종목이 시세 0(상장폐지 ATVI/ANSS/HES/MRO/
 *   JNPR/WBA/PARA/WRK… + 외국거래소 6752.T/1211.HK/BA.L + 폐지 KR). 죽은 티커가 풀에 남아 LLM 점수·
 *   NE 환각 노이즈. 데이터 기반(하드코딩 금지)으로 감지 → data/delisted-tickers.json 생성.
 *   build-candidate-tickers.mjs 가 이 파일 + 외국 suffix 규칙으로 제외.
 *
 * 판정: stock-price 가 2회 시도(transient 회복 기회) 후에도 가격 없음 = dead.
 * 사용: node scripts/prune-dead-tickers.mjs   (data/delisted-tickers.json 갱신)
 */
import { readFileSync, writeFileSync } from 'fs';

const SITE = 'http://localhost:3000';
const cand = JSON.parse(readFileSync('data/candidate-tickers.json', 'utf8'));
// 2026-06-04: 풀(필터 후) ∪ 기존 delisted 를 sweep — 이미 제외된 dead 도 재확인(revival 감지) +
//   delisted 를 빈값으로 덮어쓰던 버그 방지. (풀만 sweep 하면 제외된 30 을 못 봐 delisted=0 으로 손실.)
let prevDelisted = [];
try { prevDelisted = JSON.parse(readFileSync('data/delisted-tickers.json', 'utf8')).tickers || []; } catch { /* */ }
const tickers = [...new Set([...(Array.isArray(cand.tickers) ? cand.tickers : []), ...prevDelisted])].filter(Boolean);
const FOREIGN = /\.(T|HK|L|TO|PA|DE|SW|AS|MI|MC|ST|HE|OL|CO|VX|SI|AX|NZ|TW|SS|SZ|F|BR|MX|JO|IS)$/;

async function price(t) {
  try {
    const r = await fetch(`${SITE}/api/stock-price/${t}`, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return null;
    const j = await r.json();
    return (j.price != null && j.price > 0) ? j.price : null;
  } catch { return null; }
}

async function run(items, limit, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
  }));
  return out;
}

const t0 = Date.now();
// 2026-06-04: 동시성 6→3 + 재시도 2회 — 1300종목 sweep 시 Yahoo throttle 로 유효 ETF(VEA/BND/IBIT 등)
//   가 false-positive dead 로 잡히던 문제(40개 전부 오탐 확인) 방지. dead 판정은 보수적으로.
const checked = await run(tickers, 3, async (t) => {
  if (FOREIGN.test(t)) return { t, dead: true, reason: 'foreign-exchange' };
  let p = await price(t);
  for (let i = 0; i < 2 && !p; i++) { await new Promise(r => setTimeout(r, 600)); p = await price(t); }
  return { t, dead: !p, reason: p ? null : 'no-price' };
});

const dead = checked.filter(c => c.dead);
const foreign = dead.filter(c => c.reason === 'foreign-exchange').map(c => c.t);
const noPrice = dead.filter(c => c.reason === 'no-price').map(c => c.t);
const out = {
  generatedAt: new Date().toISOString(),
  count: dead.length,
  note: 'stock-price 2회 시도 후에도 가격 없음 또는 외국거래소 suffix. build-candidate-tickers 가 제외.',
  tickers: dead.map(c => c.t).sort(),
  foreign, noPrice,
};
writeFileSync('data/delisted-tickers.json', JSON.stringify(out, null, 2) + '\n');
console.log(`[prune-dead] ${tickers.length} 검사 ${((Date.now() - t0) / 1000).toFixed(0)}s → dead ${dead.length} (외국 ${foreign.length}, 시세없음 ${noPrice.length})`);
console.log('  → data/delisted-tickers.json');
console.log('  외국:', foreign.join(', '));
console.log('  시세없음:', noPrice.join(', '));
