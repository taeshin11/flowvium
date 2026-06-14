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
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

function detectAccumulation(rows) {
  const n = rows.length, last = rows[n - 1].c;
  const runup20d = n >= 21 ? (last / rows[n - 21].c - 1) * 100 : 0;
  const recentVol = rows.slice(-5).reduce((s, r) => s + r.v, 0) / 5;
  const prior = rows.slice(0, n - 5); const priorVol = prior.reduce((s, r) => s + r.v, 0) / prior.length;
  const volSpike = priorVol > 0 ? recentVol / priorVol : 1;
  const medDollarVol = median(rows.map(r => r.c * r.v / KRW_PER_USD));
  const atr = (sl) => sl.length ? sl.reduce((s, r) => s + (r.h - r.l) / Math.max(r.c, 1e-9), 0) / sl.length : 0;
  const vol10 = rows.slice(-10).reduce((s, r) => s + r.v, 0) / 10;
  const p30 = rows.slice(-40, -10); const vol30 = p30.length ? p30.reduce((s, r) => s + r.v, 0) / p30.length : 0;
  const volTrendUp = vol30 > 0 && vol10 > vol30 * 1.5;
  const volContraction = atr(rows.slice(-30, -10)) > 0 && atr(rows.slice(-10)) < atr(rows.slice(-30, -10)) * 0.7;
  const closeStrength = rows.slice(-10).filter(r => (r.h - r.l) > 0 && (r.c - r.l) / (r.h - r.l) > 0.6).length / 10;
  const priceFlat = runup20d < 12 && runup20d > -15;
  const lead = []; let score = 0;
  if (priceFlat && medDollarVol < 1.5e7) {
    if (volTrendUp) { score += 18; lead.push(`거래량추세 ${(vol10 / vol30).toFixed(1)}×`); }
    if (volSpike >= 2.5) { score += 10; lead.push(`거래량 ${volSpike.toFixed(1)}×급증`); }
    if (volContraction) { score += 14; lead.push('변동성수축'); }
    if (closeStrength >= 0.6) { score += 12; lead.push(`종가상단 ${Math.round(closeStrength * 100)}%`); }
  }
  const coFire = [volTrendUp, volSpike >= 2.5, volContraction, closeStrength >= 0.6].filter(Boolean).length;
  return { isAccum: priceFlat && coFire >= 2 && score >= 24, score, coFire, lead, runup20d: +runup20d.toFixed(1), medDollarVol: Math.round(medDollarVol) };
}

const cand = JSON.parse(readFileSync(resolve(ROOT, 'data/candidate-tickers.json'), 'utf8'));
const tickers = (cand.tickers ?? []).filter(t => ALL ? /\.(KS|KQ)$/.test(t) : /\.KQ$/.test(t));
console.log(`작전주 매집 스캔: ${tickers.length}종 (${ALL ? 'KR 전체' : 'KOSDAQ'}) — 오르기 前 선행조짐`);

const watch = [];
const CONC = 5;
for (let i = 0; i < tickers.length; i += CONC) {
  const batch = tickers.slice(i, i + CONC);
  const res = await Promise.all(batch.map(async (t) => {
    const rows = await dailyChart(t); if (!rows) return null;
    const a = detectAccumulation(rows); if (!a.isAccum) return null;
    const flow = await naverFlow(t.replace(/\.(KS|KQ)$/, ''));
    let smartAccum = false;
    if (flow) { const smart = flow.foreign + flow.organ; smartAccum = smart > 0 && flow.indiv <= 0; if (smartAccum) a.lead.push('세력 매집(기관·외인 순매수)'); }
    return { ticker: t, name: cand.meta?.[t]?.name ?? t, score: a.score + (smartAccum ? 10 : 0), coFire: a.coFire, lead: a.lead, runup20dPct: a.runup20d, medDollarVolUsd: a.medDollarVol, smartAccum };
  }));
  for (const r of res) if (r) watch.push(r);
  if (i % 50 === 0) console.log(`  ... ${i + batch.length}/${tickers.length} (포착 ${watch.length})`);
  await new Promise(s => setTimeout(s, 200));
}
watch.sort((a, b) => b.score - a.score);
const out = { generatedAt: new Date().toISOString(), universe: ALL ? 'KR' : 'KOSDAQ', scanned: tickers.length, count: watch.length, watchlist: watch.slice(0, 40) };
writeFileSync(resolve(ROOT, 'data/accumulation-watchlist.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`\n✅ 매집 의심(오르기 前) ${watch.length}종 → data/accumulation-watchlist.json`);
for (const w of watch.slice(0, 12)) console.log(`  ${w.ticker.padEnd(11)} ${String(w.name).slice(0, 10).padEnd(11)} score=${w.score} (20d ${w.runup20dPct >= 0 ? '+' : ''}${w.runup20dPct}%, $${(w.medDollarVolUsd / 1e6).toFixed(1)}M): ${w.lead.join('·')}`);
