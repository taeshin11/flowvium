#!/usr/bin/env node
/**
 * scripts/scan-accumulation.mjs — 작전주 "오르기 前 매집" 스크리너 (2026-06-14).
 *
 * 사용자 "이미 오른(투자위험) 게 아니라 *오르기 전 조짐*을 포착하라" + "시장에서 찾아라(스크리너)".
 *   manipulation-risk route 의 per-ticker 선행탐지(거래량추세·변동성수축·종가강도·거래량급증 + 투자자
 *   수급 분산/매집)를 **KOSDAQ 후보 풀 전체**에 적용 → accumulation 단계 종목 워치리스트.
 *   가격 급등(후행)에 의존 안 함. 결과: data/accumulation-watchlist.json (보고서/페이지가 읽어 경계 표출).
 *
 * 사용: node scripts/scan-accumulation.mjs [--all]   (기본 KOSDAQ .KQ, --all 은 KR 전체)
 * 비-GPU. 주기 실행 권장(일 1회). KRX 소수계좌 거래집중(OTP bld 미해결)은 투자자 수급으로 proxy.
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { fetchMarketAlerts, resolveTickerByName } from './lib/krx-market-alert.mjs';
import { computeAccumulationSignals, isAccumulation } from '../src/lib/accumulation-detector.mjs';  // route 와 단일소스(drift 제거)

const ROOT = resolve(import.meta.dirname, '..');
const ALL = process.argv.includes('--all');
const KRW_PER_USD = 1380;

async function dailyChart(ticker) {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=3mo`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const res = (await r.json())?.chart?.result?.[0]; const q = res?.indicators?.quote?.[0] ?? {};
    const rows = [];
    for (let i = 0; i < (res?.timestamp ?? []).length; i++) {
      if (q.close?.[i] > 0 && q.volume?.[i] != null) rows.push({ c: q.close[i], v: q.volume[i], h: q.high?.[i] ?? q.close[i], l: q.low?.[i] ?? q.close[i] });
    }
    return rows.length >= 25 ? rows : null;
  } catch { return null; }
}
async function naverFlow(code) {
  try {
    const r = await fetch(`https://m.stock.naver.com/api/stock/${code}/integration`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(7000) });
    if (!r.ok) return null;
    const d = (await r.json())?.dealTrendInfos?.[0]; if (!d) return null;
    const n = (v) => { const x = parseFloat(String(v ?? '').replace(/[^\d.\-]/g, '')); return Number.isFinite(x) ? x : 0; };
    return { indiv: n(d.individualPureBuyQuant), foreign: n(d.foreignerPureBuyQuant), organ: n(d.organPureBuyQuant) };
  } catch { return null; }
}
// median/detectAccumulation → 공용 모듈 computeAccumulationSignals(accumulation-detector.mjs) 로 대체

const cand = JSON.parse(readFileSync(resolve(ROOT, 'data/candidate-tickers.json'), 'utf8'));
const tickers = (cand.tickers ?? []).filter(t => ALL ? /\.(KS|KQ)$/.test(t) : /\.KQ$/.test(t));
console.log(`작전주 매집 스캔: ${tickers.length}종 (${ALL ? 'KR 전체' : 'KOSDAQ'}) — 오르기 前 선행조짐`);

// 거래소 공식 시장경보 — '소수계좌 거래집중'(투자주의) = 작전주 선행 surveillance flag. 매집 탐지와
//   교차검증: 스크리너가 잡은 종목 ∩ 공식 소수계좌 flag = 최고 신뢰(오르기 前). name/ticker 양쪽 매칭.
const alertByName = new Map(), alertByTicker = new Map();
try {
  const alerts = await fetchMarketAlerts(10);
  const fa = alerts.filter(a => a.fewAccount);
  console.log(`거래소 시장경보: 총 ${alerts.length}건, 소수계좌 거래집중 ${fa.length}건 (교차검증용)`);
  for (const a of alerts) alertByName.set(a.name, a);
  // 소수계좌 flag 종목만 ticker 해소(가벼움)
  for (const a of fa) { const tk = await resolveTickerByName(a.name); if (tk) alertByTicker.set(tk, a); }
} catch (e) { console.warn('시장경보 수집 실패(스크리너만 진행):', e?.message ?? e); }
function surveillanceFor(ticker, name) {
  return alertByTicker.get(ticker) ?? (name ? alertByName.get(name) : null) ?? null;
}

const watch = [];
const CONC = 5;
for (let i = 0; i < tickers.length; i += CONC) {
  const batch = tickers.slice(i, i + CONC);
  const res = await Promise.all(batch.map(async (t) => {
    const rows = await dailyChart(t); if (!rows) return null;
    const sig = computeAccumulationSignals(rows, { krwPerUsd: KRW_PER_USD, isKR: true });  // route 와 동일 모듈
    // prelim 후보: 가격평탄 + 유동성 + coFire>=2 + score>=24 (최종은 수급/공식 맥락으로 아래 게이트)
    if (!(sig.priceFlat && sig.liquidityOk && sig.accumCoFire >= 2 && sig.accumScore >= 24)) return null;
    const nm = cand.meta?.[t]?.name ?? t;
    const lead = [...sig.lead];
    const flow = await naverFlow(t.replace(/\.(KS|KQ)$/, ''));
    let smartAccum = false;
    if (flow) { const smart = flow.foreign + flow.organ; smartAccum = smart > 0 && flow.indiv <= 0; if (smartAccum) lead.push('세력 매집(기관·외인 순매수)'); }
    // 거래소 공식 시장경보 교차검증 — 매집 ∩ 소수계좌 = 최고신뢰(오르기 前)
    const alert = surveillanceFor(t, nm);
    let officialBoost = 0, official = null;
    if (alert) {
      official = { category: alert.category, reason: alert.reason, fewAccount: alert.fewAccount, designatedDate: alert.designatedDate };
      if (alert.fewAccount) { officialBoost = 25; lead.push(`🚨 거래소 소수계좌 거래집중(공식 ${alert.designatedDate ?? ''})`); }
      else if (alert.category === 'caution') { officialBoost = 12; lead.push(`⚠️ 거래소 투자주의: ${alert.reason ?? ''}`); }
    }
    // 최종 게이트(공용 isAccumulation) — 강한 수급 또는 공식 소수계좌면 coFire>=2, 아니면 >=3 + score>=32.
    if (!isAccumulation(sig, { strongSmart: smartAccum, officialFewAccount: !!alert?.fewAccount, isMarkup: false })) return null;
    return { ticker: t, name: nm, score: sig.accumScore + (smartAccum ? 10 : 0) + officialBoost, coFire: sig.accumCoFire, lead, runup20dPct: +sig.runup20d.toFixed(1), medDollarVolUsd: Math.round(sig.medDollarVol), smartAccum, official };
  }));
  for (const r of res) if (r) watch.push(r);
  if (i % 50 === 0) console.log(`  ... ${i + batch.length}/${tickers.length} (포착 ${watch.length})`);
  await new Promise(s => setTimeout(s, 200));
}
watch.sort((a, b) => b.score - a.score);
const officialCount = watch.filter(w => w.official?.fewAccount).length;
const out = { generatedAt: new Date().toISOString(), universe: ALL ? 'KR' : 'KOSDAQ', scanned: tickers.length, count: watch.length, officialFewAccount: officialCount, watchlist: watch.slice(0, 40) };
writeFileSync(resolve(ROOT, 'data/accumulation-watchlist.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`\n✅ 매집 의심(오르기 前) ${watch.length}종 → data/accumulation-watchlist.json`);
for (const w of watch.slice(0, 12)) console.log(`  ${w.ticker.padEnd(11)} ${String(w.name).slice(0, 10).padEnd(11)} score=${w.score} (20d ${w.runup20dPct >= 0 ? '+' : ''}${w.runup20dPct}%, $${(w.medDollarVolUsd / 1e6).toFixed(1)}M): ${w.lead.join('·')}`);
