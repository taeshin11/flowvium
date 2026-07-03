#!/usr/bin/env node
/**
 * scripts/backtest-rules.mjs — shadow 룰 백테스트 사전심사 (2026-07-03, 전향 연구 파이프라인)
 *
 * shadow-rules.json 후보를 과거 2년 일봉에 리플레이: 매일 롤링 지표(RSI/SMA/20d고가/volPct)로
 * 조건 발화 → 발화 후 5/10/20 거래일 방향수익(sell 가설은 부호 반전) 집계. 전향 누적(eval-shadow-rules)
 * 전에 가설을 싸게 거르는 1차 필터. 표본: candidate-tickers 상위 유동성 US 50 + KR 20 (+발화당 1회,
 * 5거래일 쿨다운으로 중복 신호 제거).
 *
 * 사용: node scripts/backtest-rules.mjs [--tickers=60]
 * 주의: 지표 헬퍼는 백테스트 전용 롤링 구현(생성기 함수는 시점 고정이라 재사용 불가 — 사유 기록).
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { evaluateBuyRule, evaluateSellRule } from '../src/lib/buy-sell-engine.mjs';

const N_ARG = Number((process.argv.find(a => a.startsWith('--tickers=')) ?? '').split('=')[1]) || 70;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const specPath = (process.argv.find(a => a.startsWith('--spec=')) ?? '').split('=')[1] || 'data/shadow-rules.json';
const spec = JSON.parse(readFileSync(resolve(process.cwd(), specPath), 'utf8'));
const cand = JSON.parse(readFileSync(resolve(process.cwd(), 'data/candidate-tickers.json'), 'utf8'));
const all = Object.keys(cand.meta ?? {});
const us = all.filter(t => !/\.(KS|KQ)$/.test(t)).slice(0, Math.round(N_ARG * 0.7));
const kr = all.filter(t => /\.(KS|KQ)$/.test(t)).slice(0, N_ARG - us.length);
const tickers = [...us, ...kr];

async function fetchDaily(ticker) {
  const yt = /\.(KS|KQ)$/.test(ticker) ? ticker : ticker.replace(/\./g, '-');
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yt)}?range=2y&interval=1d`,
    { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) return null;
  const res = (await r.json())?.chart?.result?.[0];
  const cl = res?.indicators?.quote?.[0]?.close ?? [], vo = res?.indicators?.quote?.[0]?.volume ?? [];
  const closes = [], volumes = [];
  for (let i = 0; i < cl.length; i++) if (cl[i] != null && cl[i] > 0) { closes.push(cl[i]); volumes.push(vo[i] ?? 0); }
  return closes.length >= 260 ? { closes, volumes } : null;
}
// 롤링 지표 (i = 당일 인덱스, 당일 종가 포함 기준 — 생성기 stage-2 와 동일 의미)
const smaAt = (a, i, n) => i + 1 >= n ? a.slice(i + 1 - n, i + 1).reduce((x, y) => x + y, 0) / n : null;
function rsiAt(a, i, p = 14) {
  if (i < p) return null;
  let g = 0, l = 0;
  for (let k = i - p + 1; k <= i; k++) { const d = a[k] - a[k - 1]; if (d >= 0) g += d; else l -= d; }
  if (g + l === 0) return 50;
  return Math.round(100 - 100 / (1 + (g / p) / ((l / p) || 1e-9)));
}
function volPctAt(v, i, p = 20) {
  if (i < p + 1) return null;
  const avg = v.slice(i - p, i).reduce((x, y) => x + (y ?? 0), 0) / p;
  return avg > 0 ? Math.round((v[i] / avg - 1) * 100) : null;
}

const agg = new Map(); // ruleId → {side, trig, f5:[], f10:[], f20:[]}
let done = 0, skipped = 0;
for (const t of tickers) {
  let d = null;
  try { d = await fetchDaily(t); } catch { /* */ }
  await sleep(200);
  if (!d) { skipped++; continue; }
  const { closes, volumes } = d;
  const lastCool = new Map();
  for (let i = 210; i < closes.length - 20; i++) {
    const ctx = {
      price: closes[i], change1d: (closes[i] / closes[i - 1] - 1) * 100,
      sma50: smaAt(closes, i, 50), sma200: smaAt(closes, i, 200),
      rsi: rsiAt(closes, i), volPct: volPctAt(volumes, i),
      high20d: Math.max(...closes.slice(i - 20, i)),
      high52w: Math.max(...closes.slice(Math.max(0, i - 251), i + 1)),
      low52w: Math.min(...closes.slice(Math.max(0, i - 251), i + 1)),
    };
    for (const r of spec.rules) {
      if ((lastCool.get(r.id) ?? -99) > i - 5) continue;  // 5거래일 쿨다운
      const hit = r.side === 'sell' ? evaluateSellRule(r, ctx) : evaluateBuyRule(r, ctx);
      if (!hit) continue;
      lastCool.set(r.id, i);
      const dir = r.side === 'sell' ? -1 : 1;
      const a = agg.get(r.id) ?? { side: r.side, trig: 0, f5: [], f10: [], f20: [] };
      a.trig++;
      a.f5.push((closes[i + 5] / closes[i] - 1) * 100 * dir);
      a.f10.push((closes[i + 10] / closes[i] - 1) * 100 * dir);
      a.f20.push((closes[i + 20] / closes[i] - 1) * 100 * dir);
      agg.set(r.id, a);
    }
  }
  done++;
  if (done % 20 === 0) console.log(`  ...${done}/${tickers.length} 종목`);
}

console.log(`\n백테스트: ${done}종목 (skip ${skipped}) × 2년 일봉, 발화당 5거래일 쿨다운`);
console.log('| rule | side | 발화 | 방향수익 5d | 10d | 20d | 승률5d |');
const stats = (arr) => arr.length ? { avg: arr.reduce((x, y) => x + y, 0) / arr.length, win: arr.filter(x => x > 0).length / arr.length * 100 } : null;
for (const [id, a] of agg) {
  const s5 = stats(a.f5), s10 = stats(a.f10), s20 = stats(a.f20);
  console.log(`| ${id} | ${a.side} | ${a.trig} | ${s5.avg.toFixed(2)}% | ${s10.avg.toFixed(2)}% | ${s20.avg.toFixed(2)}% | ${s5.win.toFixed(0)}% |`);
}
console.log('\n(방향수익 = sell 가설은 하락 시 +. 기준선 없이 절대수익 — 강세장 바이어스 감안해 buy 룰끼리/sell 룰끼리 상대 비교 권장)');
