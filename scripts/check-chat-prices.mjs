#!/usr/bin/env node
/**
 * check-chat-prices.mjs — 심판엔진 가격 grounding 전수 검증 (2026-06-18)
 * 채팅 가격 환각은 grounding(Yahoo) 가 null 일 때 LLM 이 지어내는 데서 발생.
 * candidate-tickers 전 종목에 대해 engine 과 동일한 Yahoo chart fetch 로 price 회수율을 검증.
 * null/0 인 종목 = 환각 위험군. 사용: node scripts/check-chat-prices.mjs [conc]
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

const meta = JSON.parse(readFileSync(resolve(process.cwd(), 'data/candidate-tickers.json'), 'utf8'))?.meta ?? {};
const tickers = Object.keys(meta);
const CONC = parseInt(process.argv[2] || '24', 10);

async function yh(ticker) {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=5d&interval=1d`, {
      headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) return { ticker, ok: false, reason: `http ${r.status}` };
    const d = await r.json();
    const p = d?.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (typeof p === 'number' && p > 0) return { ticker, ok: true, price: p };
    return { ticker, ok: false, reason: p === 0 ? 'zero' : 'null-price' };
  } catch (e) { return { ticker, ok: false, reason: e.message.slice(0, 30) }; }
}

const results = [];
for (let i = 0; i < tickers.length; i += CONC) {
  const batch = tickers.slice(i, i + CONC);
  results.push(...await Promise.all(batch.map(yh)));
  if ((i / CONC) % 5 === 0) process.stdout.write(`\r[${results.length}/${tickers.length}]`);
}
const ok = results.filter(r => r.ok);
const fail = results.filter(r => !r.ok);
console.log(`\n\n=== 가격 grounding 전수 검증 ===`);
console.log(`총 ${tickers.length} · 가격회수 ${ok.length} (${(ok.length / tickers.length * 100).toFixed(1)}%) · 실패 ${fail.length}`);
const byReason = {};
for (const f of fail) byReason[f.reason] = (byReason[f.reason] || 0) + 1;
console.log('실패 사유:', JSON.stringify(byReason));
console.log('실패 종목(환각 위험군):', fail.map(f => `${f.ticker}(${f.reason})`).slice(0, 60).join(', '));
