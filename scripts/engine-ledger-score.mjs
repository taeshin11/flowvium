#!/usr/bin/env node
/**
 * engine-ledger-score.mjs — 엔진 결정 장부(data/engine-ledger.jsonl)를 고정 규칙으로 채점·집계. 2026-10-15 신설.
 * 규칙: lib/engine-ledger.mjs(+test) · 프로토콜 docs/prospective-study-protocol.md.
 *   진입 = 장부 기록 시각(recordedAt) 뒤 첫 정규장 시가 · h = 1·5·20·60 거래일 · 기준 US=SPY, KOSPI=^KS11, KOSDAQ=^KQ11.
 *   채점은 장부와 가격만으로 다시 계산된다(결정론) — 그래서 덧붙이기가 아니라 매번 전체를 다시 쓴다. 장부는 건드리지 않는다.
 * 집계(역할 × 시장 × h): 새 신호만, 날짜 포트폴리오 순초과 평균 + Newey-West(lag=h-1).
 *   대조: pick−control(H1), pick−cand 안 뽑힘(H2), judge_veto−judge_pass(H5), sell(H4, 음수면 판 게 맞음).
 * 사용: node scripts/engine-ledger-score.mjs [--dry]
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
import { fetchBars } from './lib/ohlc.mjs';
import { scoreSignal, isNewSignal, dailySeries, neweyWest } from './lib/engine-ledger.mjs';

const DIR = process.env.ENGINE_LEDGER_DIR || resolve(ROOT, 'data');
const LEDGER = resolve(DIR, 'engine-ledger.jsonl');
const STUDY = resolve(DIR, 'engine-study.json');
const OUT = resolve(DIR, 'engine-summary.json');
const DRY = process.argv.includes('--dry');
const HS = [1, 5, 20, 60];
// 날짜가 이보다 적으면 t 를 내지 않는다 — NW 분산이 0 근처로 무너져 t 가 수백·수천이 된다(10/15 시험: 2일에 t=-1070).
const MIN_DAYS_T = 10;
const benchOf = (t, market) => (market === 'kr' ? (/\.KQ$/i.test(t) ? '^KQ11' : '^KS11') : 'SPY');
const kstDay = (iso) => new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 10);

if (!existsSync(LEDGER) || !existsSync(STUDY)) { console.log('장부 없음 — 기록 전'); process.exit(0); }
const study = JSON.parse(readFileSync(STUDY, 'utf8'));
const lines = readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

// 신호 펼치기 + 새 신호 표시(장부 순서 = 시간 순). 대조군은 그날 첫 기록 시각에 하루 한 번.
const sigs = [];
const seenDay = new Set();
for (const L of lines) {
  for (const d of L.decisions) {
    const role = d.role === 'cand' ? (d.picked ? 'cand_picked' : 'cand_unpicked') : d.role;
    const s = { id: L.id, day: kstDay(L.recordedAt), decidedAt: L.recordedAt, role, ticker: d.ticker, market: d.market, score: d.score ?? null };
    s.isNew = isNewSignal(sigs, s);
    sigs.push(s);
  }
  const day = kstDay(L.recordedAt);
  if (!seenDay.has(day)) {
    seenDay.add(day);
    for (const m of ['us', 'kr']) for (const t of study.control[m]) sigs.push({ id: L.id, day, decidedAt: L.recordedAt, role: 'control', ticker: t, market: m, isNew: true });
  }
}

// 가격 — 종목·기준 한 번씩.
const from = new Date(Date.parse(lines[0].recordedAt) - 3 * 86_400_000).toISOString();
const to = new Date(Date.now() + 86_400_000).toISOString();
const need = new Set(sigs.flatMap((s) => [s.ticker, benchOf(s.ticker, s.market)]));
const bars = new Map();
const queue = [...need];
let failed = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (queue.length) {
    const t = queue.shift();
    const r = await fetchBars(t, from, to);
    if (r?.bars?.length) bars.set(t, r.bars); else failed++;
  }
}));

const now = Date.now();
const rows = [];
const status = {};
for (const s of sigs) {
  if (!s.isNew) continue;
  for (const h of HS) {
    const b = bars.get(s.ticker); const bb = bars.get(benchOf(s.ticker, s.market));
    const k = `${s.role}|${s.market}|${h}`;
    const st = status[k] ??= { new: 0, ok: 0, stale: 0, mismatch: 0, pending: 0, noData: 0 };
    st.new++;
    if (!b || !bb) { st.noData++; continue; }
    const r = scoreSignal({ bars: b, bench: bb, decidedAt: s.decidedAt, market: s.market, h, now });
    if (!r) { st.pending++; continue; }
    if (r.status === 'date_mismatch') { st.mismatch++; continue; }
    st[r.status === 'stale' ? 'stale' : 'ok']++;
    rows.push({ day: s.day, role: s.role, market: s.market, h, ticker: s.ticker, net: r.net, excess: r.excess, ret: r.ret, score: s.score });
  }
}

// 집계
const fmt = (x) => (x == null ? null : Math.round(x * 1e5) / 1e5);
const agg = {};
for (const k of Object.keys(status)) {
  const [role, market, h] = k.split('|');
  const ser = dailySeries(rows.filter((r) => r.market === market && r.h === Number(h)), role);
  const nw = neweyWest(ser.map((x) => x.v), Number(h) - 1);
  const tOk = ser.length >= MIN_DAYS_T && nw.t != null;
  agg[k] = { ...status[k], days: ser.length, meanNet: fmt(nw.mean), se: tOk ? fmt(nw.se) : null, t: tOk ? Math.round(nw.t * 100) / 100 : null };
}
// 차이 시계열(같은 날짜에 둘 다 있을 때만)
function diff(a, b, market, h) {
  const A = new Map(dailySeries(rows.filter((r) => r.market === market && r.h === h), a).map((x) => [x.day, x.v]));
  const B = new Map(dailySeries(rows.filter((r) => r.market === market && r.h === h), b).map((x) => [x.day, x.v]));
  const d = [...A.keys()].filter((k) => B.has(k)).sort().map((k) => A.get(k) - B.get(k));
  const nw = neweyWest(d, h - 1);
  const tOk = d.length >= MIN_DAYS_T && nw.t != null;
  return { days: d.length, mean: fmt(nw.mean), se: tOk ? fmt(nw.se) : null, t: tOk ? Math.round(nw.t * 100) / 100 : null };
}
const contrasts = {};
for (const m of ['us', 'kr']) for (const h of HS) {
  contrasts[`H1 pick-control|${m}|${h}`] = diff('pick', 'control', m, h);
  contrasts[`H2 pick-cand_unpicked|${m}|${h}`] = diff('pick', 'cand_unpicked', m, h);
  contrasts[`H5 judge_veto-judge_pass|${m}|${h}`] = diff('judge_veto', 'judge_pass', m, h);
}
const summary = {
  at: new Date().toISOString(), protocol: study.protocol, studyStartedAt: study.startedAt,
  ledgerLines: lines.length, signals: sigs.length, newSignals: sigs.filter((s) => s.isNew).length, priceFetchFailed: failed,
  note: '순초과 = 종목 - 기준지수 - 왕복비용(US 15bp·KR 40bp 가정). t 는 Newey-West(lag=h-1). 확증은 24주(20일) — 그 전 숫자는 방향만.',
  byRoleMarketH: agg, contrasts,
};
if (!DRY) writeFileSync(OUT, JSON.stringify(summary, null, 1) + '\n');
console.log(`장부 ${lines.length}줄 · 신호 ${sigs.length}(새 ${summary.newSignals}) · 채점 ${rows.length} · 가격 실패 ${failed}`);
for (const [k, v] of Object.entries(agg)) if (v.ok + v.stale) console.log(`  ${k}: 채점 ${v.ok + v.stale}/${v.new} 날 ${v.days} 평균순초과 ${v.meanNet} t ${v.t}`);
