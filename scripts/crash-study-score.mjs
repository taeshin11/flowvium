#!/usr/bin/env node
/**
 * crash-study-score.mjs — 급락장 전향 기록(data/crash-study-2026-11.json)을 만기마다 채점한다. 2026-11-07 신설.
 * 기록은 건드리지 않는다. 결과는 매번 처음부터 다시 계산해 data/crash-study-2026-11-score.json 에 쓴다(결정론).
 *
 *   F1·F2  n 거래일 뒤 종가 > 기준 종가 → Brier·로그 점수(예측 셋 각각)
 *   F3     기준일 뒤 60거래일 안 종가 최저 ≤ 기준 × 0.9 — 닿으면 그날 확정, 아니면 60번째 거래일에 확정
 *   E1     KOSPI 11/06 종가 → 20거래일 뒤 종가, 그리고 engine-ledger 에서 KR 판정이 처음 wait·defensive 가 아닌 회차
 *   E2     거부 종목 동일가중: 11/09 시가(t=0) → 5·20거래일 뒤 종가, 같은 시장 지수 같은 시점 대비 순초과
 * 만기 전 항목은 'pending' — 숫자를 지어내지 않는다. 가격을 못 받은 종목은 빼고 몇 개 뺐는지 적는다.
 *
 *   node scripts/crash-study-score.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';

const DRY = process.argv.includes('--dry');
const REC = JSON.parse(readFileSync(resolve(ROOT, 'data/crash-study-2026-11.json'), 'utf8'));
const OUT = resolve(ROOT, 'data/crash-study-2026-11-score.json');
const BASE_DATE = REC.event.kospi.base.date;          // 2026-11-06
const ENTRY_DATE = '2026-11-09';                       // E2 진입(시가)
const BASE = { KS11: REC.event.kospi.base.close, KQ11: REC.event.kosdaq.base.close };

async function bars(sym, from) {
  const p1 = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000) - 7 * 86400;
  const p2 = Math.floor(Date.now() / 1000) + 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${p1}&period2=${p2}&interval=1d`;
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000), cache: 'no-store' });
    if (!res.ok || !/json/.test(res.headers.get('content-type') ?? '')) return null;
    const r = (await res.json()).chart?.result?.[0];
    const q = r?.indicators?.quote?.[0] ?? {};
    return (r?.timestamp ?? []).map((s, i) => ({ d: new Date(s * 1000 + 9 * 3600e3).toISOString().slice(0, 10), o: q.open?.[i], c: q.close?.[i] }))
      .filter((x) => x.c > 0 && x.o > 0);
  } catch { return null; }
}
const brier = (p, y) => (p - y) ** 2;
const logS = (p, y) => -Math.log(Math.max(1e-6, y ? p : 1 - p));
const scoreP = (p, y) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, { brier: +brier(v, y).toFixed(4), log: +logS(v, y).toFixed(4) }]));

const out = { at: new Date().toISOString(), version: REC.version, primary: REC.analog.primary?.forecaster, forecasts: [], engine: {} };
const idx = {};
for (const k of ['KS11', 'KQ11']) {
  const b = await bars(`^${k}`, BASE_DATE);
  if (!b) { console.error(`^${k} 가격을 못 받았다`); process.exit(1); }
  const k0 = b.findIndex((x) => x.d === BASE_DATE);
  // 기준일 종가는 기록값(네이버)으로 — 야후 값과 달라도 기록과 같은 기준으로 잰다.
  idx[k] = { after: b.slice(k0 >= 0 ? k0 + 1 : b.findIndex((x) => x.d > BASE_DATE)), all: b };
}

for (const f of REC.forecasts) {
  const k = f.id.endsWith('KOSPI') ? 'KS11' : 'KQ11';
  const base = BASE[k], after = idx[k].after;
  let y = null, decidedOn = null, value = null;
  if (f.id.startsWith('F1') || f.id.startsWith('F2')) {
    const h = f.id.startsWith('F1') ? 5 : 20;
    if (after.length >= h) { value = after[h - 1].c; y = value > base ? 1 : 0; decidedOn = after[h - 1].d; }
  } else {
    const lim = base * 0.9, w = after.slice(0, 60);
    const hit = w.find((x) => x.c <= lim);
    if (hit) { y = 1; decidedOn = hit.d; value = hit.c; } else if (w.length >= 60) { y = 0; decidedOn = w[59].d; value = Math.min(...w.map((x) => x.c)); }
  }
  out.forecasts.push({ id: f.id, q: f.q, outcome: y, decidedOn, value, score: y == null ? 'pending' : scoreP(f.p, y) });
}

// E1 — KR 판정이 처음 바뀐 회차(11/06 뒤)
{
  const L = readFileSync(resolve(ROOT, 'data/engine-ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const flip = L.find((r) => new Date(Date.parse(r.recordedAt) + 9 * 3600e3).toISOString().slice(0, 10) > BASE_DATE
    && r.krVerdict?.verdict && !['wait', 'defensive'].includes(r.krVerdict.verdict));
  const after = idx.KS11.after;
  const fd = flip ? new Date(Date.parse(flip.recordedAt) + 9 * 3600e3).toISOString().slice(0, 10) : null;
  out.engine.E1 = {
    kospi20d: after.length >= 20 ? { to: after[19].d, ret: +(after[19].c / BASE.KS11 - 1).toFixed(4) } : 'pending',
    firstNonDefensive: flip ? { at: flip.recordedAt, verdict: flip.krVerdict.verdict, kospiClose: idx.KS11.all.find((x) => x.d === fd)?.c ?? null } : 'not yet',
  };
}

// E2 — 거부 종목 동일가중 vs 같은 시장 지수
{
  const tick = REC.engine.find((e) => e.id.startsWith('E2')).tickers.map((x) => x.t);
  const res = { n: tick.length, missing: [], h5: 'pending', h20: 'pending' };
  const rows = [];
  for (const t of tick) {
    const b = await bars(t, ENTRY_DATE);
    const i0 = b ? b.findIndex((x) => x.d === ENTRY_DATE) : -1;
    if (i0 < 0) { res.missing.push(t); continue; }
    rows.push({ t, b: b.slice(i0), k: t.endsWith('.KQ') ? 'KQ11' : 'KS11' });
  }
  for (const h of [5, 20]) {
    const ok = rows.filter((r) => r.b.length > h);
    if (!rows.length || ok.length < rows.length) continue;   // 한 종목이라도 만기 전이면 기다린다
    const ex = ok.map((r) => {
      const ib = idx[r.k].all, j0 = ib.findIndex((x) => x.d === ENTRY_DATE);
      if (j0 < 0 || ib.length <= j0 + h) return null;
      return (r.b[h].c / r.b[0].o - 1) - (ib[j0 + h].c / ib[j0].o - 1);
    }).filter((x) => x != null);
    if (ex.length === ok.length) res[`h${h}`] = { to: ok[0].b[h].d, n: ex.length, meanExcess: +(ex.reduce((a, x) => a + x, 0) / ex.length).toFixed(4), positive: ex.filter((x) => x > 0).length };
  }
  if (res.missing.length && Date.now() < Date.parse(`${ENTRY_DATE}T07:00:00Z`)) res.missing = `진입 전(${ENTRY_DATE})`;
  out.engine.E2 = res;
}

console.log(JSON.stringify(out, null, 1));
if (!DRY) writeFileSync(OUT, JSON.stringify(out, null, 1));
