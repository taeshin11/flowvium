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
 *       node scripts/scan-accumulation.mjs --us       (US 전체 — Yahoo 거래량 기반, 2026-06-17 추가)
 * 비-GPU. 주기 실행 권장(일 1회). KRX 소수계좌 거래집중(OTP bld 미해결)은 투자자 수급으로 proxy.
 *
 * 2026-06-17 (사용자 "이게(작전주 매집) us종목에 대해서는 파악안됨?"): US 커버리지 추가. 탐지 코어
 *   (computeAccumulationSignals/accumulationTier)는 시장 무관 — US 는 KRX 시장경보·Naver 수급 proxy 가
 *   없어 거래량/변동성/종가강도 기반 'strong' tier 만 포착(corroboration 없는 약신호는 과탐 방지차 제외).
 *   출력: data/accumulation-watchlist-us.json. KR 와 동일 스키마(official=null).
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { fetchMarketAlerts, resolveTickerByName } from './lib/krx-market-alert.mjs';
import { computeAccumulationSignals, accumulationTier } from '../src/lib/accumulation-detector.mjs';  // route 와 단일소스(drift 제거)

const ROOT = resolve(import.meta.dirname, '..');
const ALL = process.argv.includes('--all');
const US = process.argv.includes('--us');   // 2026-06-17: US 시장 모드
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

// US 는 소형주 유니버스(build-us-smallcap-universe.mjs 산출) — 대형주 candidate 풀은 매집 신호 0(구조적).
//   파일 부재 시 candidate 의 US(대형주)로 폴백(빈 결과 가능).
const UNIVERSE_FILE = US ? 'data/us-smallcap-universe.json' : 'data/candidate-tickers.json';
let cand;
try { cand = JSON.parse(readFileSync(resolve(ROOT, UNIVERSE_FILE), 'utf8')); }
catch { cand = JSON.parse(readFileSync(resolve(ROOT, 'data/candidate-tickers.json'), 'utf8')); }
const tickers = US
  ? (cand.tickers ?? []).filter(t => !/\.(KS|KQ)$/.test(t))   // 소형주 유니버스는 이미 US-only
  : (cand.tickers ?? []).filter(t => ALL ? /\.(KS|KQ)$/.test(t) : /\.KQ$/.test(t));
const MARKET = US ? 'US' : ALL ? 'KR' : 'KOSDAQ';
console.log(`작전주 매집 스캔: ${tickers.length}종 (${MARKET}) — 오르기 前 선행조짐`);

// 거래소 공식 시장경보 — '소수계좌 거래집중'(투자주의) = 작전주 선행 surveillance flag. 매집 탐지와
//   교차검증: 스크리너가 잡은 종목 ∩ 공식 소수계좌 flag = 최고 신뢰(오르기 前). name/ticker 양쪽 매칭.
//   US 모드: KRX 시장경보·Naver 수급은 KR 전용 → skip(거래량/변동성 코어만).
const alertByName = new Map(), alertByTicker = new Map();
if (!US) try {
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
    // US 대형주 풀은 ADV 가 커 KR 작전주 유동성 상한($5M/$15M)이면 전부 탈락 → mid-cap 매집 포착 위해 $30M/$100M.
    const sig = computeAccumulationSignals(rows, US
      ? { isKR: false, liquidityStrictUsd: 3e7, liquidityLooseUsd: 1e8 }
      : { krwPerUsd: KRW_PER_USD, isKR: true });  // route 와 동일 모듈
    // prelim 후보: 가격평탄 + 유동성 + coFire>=2 + score>=14 (watch tier 하한; 최종 tier 는 아래 accumulationTier)
    if (!(sig.priceFlat && sig.liquidityOk && sig.accumCoFire >= 2 && sig.accumScore >= 14)) return null;
    const nm = cand.meta?.[t]?.name ?? t;
    const lead = [...sig.lead];
    // Naver 투자자 수급(세력 매집 proxy)은 KR 전용. US 는 수급 proxy 없음 → smartAccum=false.
    const flow = US ? null : await naverFlow(t.replace(/\.(KS|KQ)$/, ''));
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
    // 2-tier 게이트(공용 accumulationTier) — 'strong'=고확신 매집, 'watch'=관찰(세력매집 corroboration 약신호),
    //   null=제외(5일 급등=markup 포함). 사용자 "관찰 목적 살리되 false 작전주 막기".
    // US: Naver/KRX corroboration 부재 → 거래량 기술패턴만으로 watch 허용(volumeOnlyWatch). KR: 기존 게이트.
    const tier = accumulationTier(sig, { strongSmart: smartAccum, officialFewAccount: !!alert?.fewAccount, isMarkup: false, volumeOnlyWatch: US });
    if (!tier) return null;
    return { ticker: t, name: nm, tier, score: sig.accumScore + (smartAccum ? 10 : 0) + officialBoost, coFire: sig.accumCoFire, lead, runup20dPct: +sig.runup20d.toFixed(1), runup5dPct: +sig.runup5d.toFixed(1), medDollarVolUsd: Math.round(sig.medDollarVol), smartAccum, official };
  }));
  for (const r of res) if (r) watch.push(r);
  if (i % 50 === 0) console.log(`  ... ${i + batch.length}/${tickers.length} (포착 ${watch.length})`);
  await new Promise(s => setTimeout(s, 200));
}
// tier 우선(strong 먼저) → 점수순. count 는 tier별 분리 노출.
const tierRank = (t) => (t === 'strong' ? 0 : 1);
watch.sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || b.score - a.score);
const officialCount = watch.filter(w => w.official?.fewAccount).length;
const strongCount = watch.filter(w => w.tier === 'strong').length;
const watchCount = watch.filter(w => w.tier === 'watch').length;
const out = { generatedAt: new Date().toISOString(), universe: MARKET, scanned: tickers.length, count: watch.length, strongCount, watchCount, officialFewAccount: officialCount, watchlist: watch.slice(0, 40) };
const OUT_FILE = US ? 'data/accumulation-watchlist-us.json' : 'data/accumulation-watchlist.json';
writeFileSync(resolve(ROOT, OUT_FILE), JSON.stringify(out, null, 2) + '\n');
console.log(`\n✅ 매집 ${watch.length}종 (강한 ${strongCount} + 관찰 ${watchCount}) → ${OUT_FILE}`);
for (const w of watch.slice(0, 12)) console.log(`  [${w.tier === 'strong' ? '강' : '관'}] ${w.ticker.padEnd(11)} ${String(w.name).slice(0, 10).padEnd(11)} score=${w.score} (20d ${w.runup20dPct >= 0 ? '+' : ''}${w.runup20dPct}%, 5d ${w.runup5dPct >= 0 ? '+' : ''}${w.runup5dPct}%): ${w.lead.join('·')}`);
