#!/usr/bin/env node
/**
 * scorecard.mjs — 지난 매수 추천을 모두 같은 방법으로 다시 채점해 공개 성적표와 시장별 매수 축소 판정을 만든다. (2026-10-25 신설)
 *
 * 왜(근거는 lib/scorecard.test.mjs · lib/judge-outcome.test.mjs 머리말): 사장님 "이런 전향적 연구 안 하냐".
 *   recommendation_outcomes 는 판정이 틀려 있었고(손절 ×1.02·목표 ×0.98·추천 전 가격) 매도 추천이 중간에 닫은 건이 섞여
 *   '이 추천을 따랐다면' 을 바로 읽을 수 없다. 여기서는 추천마다 같은 규칙으로 14일 따라간다 — 지난 기록을 고치지 않고 새로 잰다.
 * 규칙: 추천 뒤에 열린 장부터 14일 · 매수 가격대에 닿아야 산 것 · 손절가·목표가는 실제로 닿았을 때 · 끝까지 안 닿으면 14일째 종가.
 *   지수: 미국 SPY, 한국 코스피 — 같은 날 시가에 사서 같은 날 종가에 판 것과 비교.
 * 출력: data/scorecard.json(gitignore — 매일 다시 만든다). 화면(/[locale]/track-record)과 보고서 생성기(시장 축소)가 읽는다.
 * 그림자: 축소로 화면에서 뺀 추천은 data/scorecard-shadow.jsonl 에 남는다(generate-report-local). 공개 성적엔 안 섞고 풀림 판정에만.
 *
 * 사용: node scripts/scorecard.mjs [--dry]
 */
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { judgeOutcome, barsFromChart } from './lib/judge-outcome.mjs';
import { summarize, gateFor, gateSince, bestHits, kstDate, HORIZON_DAYS } from './lib/scorecard.mjs';
import { toYahooTicker } from './lib/ticker-normalize.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, 'data/scorecard.json');
const SHADOW = resolve(ROOT, 'data/scorecard-shadow.jsonl');
const DRY = process.argv.includes('--dry');
const H = HORIZON_DAYS * 86400;

async function fetchBars(sym, p1, p2) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${p1}&period2=${p2}&interval=1d`;
  for (let k = 0; k < 3; k++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000), cache: 'no-store' });
      if (r.ok) { const res = (await r.json())?.chart?.result?.[0]; return res ? barsFromChart(res) : []; }
      if (r.status === 404) return [];
    } catch { /* 아래에서 다시 */ }
    await new Promise((s) => setTimeout(s, 1500 * (k + 1)));
  }
  return null;   // 모름 — 그 종목은 이번 회차 채점에서 빠진다(지어내지 않는다)
}

/** 추천 하나 → 성적표 행 */
export function scoreOne(rec, bars, idxBars, nowSec) {
  const g = Date.parse(rec.generated_at) / 1000;
  const done = nowSec - g >= H;
  const win = bars.filter((b) => b.t >= g && b.t < g + H);
  const j = judgeOutcome(rec, win);
  let res = j.outcome, exit = j.exitPrice;
  if (res === 'still_holding' && done) { res = 'time_exit'; exit = j.lastClose; }
  let pnl = null, bench = null, exitDate = null;
  if (j.entryPrice && exit && (res === 'stop_loss' || res === 'hit_target' || res === 'time_exit')) {
    pnl = (exit / j.entryPrice - 1) * 100;
    const eh = rec.entry_high ?? rec.entry_low;
    const entryBar = win.find((b) => b.l <= eh);
    const exitBar = res === 'time_exit' ? win.at(-1)
      : win.find((b) => b.t >= entryBar.t && (res === 'stop_loss' ? b.l <= rec.stop_loss : b.h >= rec.target));
    const bi = idxBars.find((b) => b.t >= entryBar.t), bo = [...idxBars].reverse().find((b) => b.t <= exitBar.t);
    if (bi && bo && bo.t >= bi.t) bench = (bo.c / bi.o - 1) * 100;
    exitDate = kstDate(exitBar.t * 1000);
  }
  return { market: rec.market, ticker: rec.ticker, name: rec.name, gen: rec.generated_at, done: done && res !== 'unknown', res, pnl, bench, exitDate, shadow: !!rec.shadow };
}

async function main() {
  const db = new Database(resolve(ROOT, 'data/flowvium.db'), { readonly: true, fileMustExist: true });
  const recs = db.prepare(`SELECT ticker, name, market, generated_at, entry_low, entry_high, stop_loss, target
                             FROM recommendations WHERE action = 'buy' ORDER BY generated_at`).all();
  db.close();
  const shadow = existsSync(SHADOW) ? readFileSync(SHADOW, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [{ ...JSON.parse(l), shadow: true }]; } catch { return []; } }) : [];
  const all = [...recs, ...shadow];
  const nowSec = Math.floor(Date.now() / 1000);
  const p1 = Math.floor(Math.min(...all.map((r) => Date.parse(r.generated_at))) / 1000) - 86400;
  const syms = [...new Set(all.map((r) => toYahooTicker(r.ticker)))];
  const bars = new Map();
  for (const s of [...syms, 'SPY', '^KS11']) { bars.set(s, await fetchBars(s, p1, nowSec)); await new Promise((r) => setTimeout(r, 150)); }
  const miss = [...bars].filter(([, b]) => b == null).map(([s]) => s);
  if (!bars.get('SPY')?.length || !bars.get('^KS11')?.length) throw new Error('지수 시세를 못 받았다 — 성적표를 갱신하지 않는다');
  const rows = [];
  for (const r of all) {
    const b = bars.get(toYahooTicker(r.ticker));
    if (!b) continue;
    rows.push(scoreOne(r, b, bars.get(r.market === 'kr' ? '^KS11' : 'SPY'), nowSec));
  }
  const prev = existsSync(OUT) ? (() => { try { return JSON.parse(readFileSync(OUT, 'utf8')); } catch { return null; } })() : null;
  const now = Date.now();
  const gate = Object.fromEntries(['us', 'kr'].map((m) => [m, gateFor(m, rows, { now, wasReduced: !!prev?.gate?.[m]?.reduce })]));
  const today = new Date(now + 9 * 3600e3).toISOString().slice(0, 10);   // KST 날짜
  for (const m of ['us', 'kr']) gate[m].since = gateSince(gate[m], prev?.gate?.[m], today);
  const out = { generatedAt: new Date(now).toISOString(), horizonDays: HORIZON_DAYS, markets: summarize(rows, { now }), gate, hits: bestHits(rows), missingTickers: miss.length, shadowRows: shadow.length };
  for (const m of ['us', 'kr']) {
    const s = out.markets[m];
    console.log(`${m}: 추천 ${s.recommended} · 미진입 ${s.notEntered} · 추적 중 ${s.tracking} · 끝남 ${s.finished} | 이익 ${s.profitShare}% · 중앙 ${s.medianPct}% · 평균 ${s.meanPct}% · 지수 대비 중앙 ${s.vsIndexMedian}%p · 손절 ${s.stopShare}% · 최악 ${s.worstPct}%`);
    console.log(`   축소 판정: ${gate[m].reduce ? '줄임' : '그대로'} — ${gate[m].reason}`);
  }
  if (miss.length) console.log(`시세 못 받은 종목 ${miss.length}개 — 이번 채점에서 뺐다: ${miss.slice(0, 10).join(', ')}`);
  if (DRY) { console.log('--dry: 파일을 쓰지 않는다'); return; }
  const tmp = `${OUT}.tmp`;
  writeFileSync(tmp, JSON.stringify(out));
  renameSync(tmp, OUT);   // 화면이 반쯤 쓴 파일을 읽지 않게
  console.log(`→ ${OUT}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error('[FATAL]', e?.stack ?? e?.message); process.exit(1); });
}
