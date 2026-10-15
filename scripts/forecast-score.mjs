#!/usr/bin/env node
/**
 * forecast-score.mjs — 장이 끝난 기록을 채점하고, 주 단위로 집계한다. 2026-10-15 신설. 기록은 forecast-record.mjs.
 *
 * 채점은 data/forecast-scores.jsonl 에 따로 쌓는다 — 장 전 기록(forecast-ledger.jsonl)은 한 글자도 고치지 않는다.
 *   같은 id 는 한 번만 채점한다. 목표일 봉이 없고 사흘이 지났으면 휴장으로 적는다.
 * 놓친 사건: |등락| ≥ 2% 인데 보고서가 그 방향을 말하지 않은 날(틀렸거나 기권). 유형은 lib/forecast-ledger missType
 *   (전날 밤 SOX ±4%·원/달러 ±2%·VIX +20%), 모르면 '미분류' — 그날 뉴스 상위 헤드라인을 같이 남겨 사람이 붙인다.
 * 집계: data/forecast-summary.json — 전체·주(ISO 주, 목표일 기준)별 시장마다 적중률(기권 제외)·Brier·기후값 대비 skill·보정표.
 *
 * 사용: node scripts/forecast-score.mjs
 */
import { readFileSync, appendFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
import { fetchBars } from './lib/ohlc.mjs';
import { scoreRecord, aggregate, missType } from './lib/forecast-ledger.mjs';

const DIR = process.env.FORECAST_DIR ?? resolve(ROOT, 'data');   // 시험할 때만 바꾼다 — 운영 장부를 건드리지 않게
const LEDGER = resolve(DIR, 'forecast-ledger.jsonl');
const SCORES = resolve(DIR, 'forecast-scores.jsonl');
const SUMMARY = resolve(DIR, 'forecast-summary.json');
const log = (...a) => console.log(new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 19), '[forecast-score]', ...a);
const readJsonl = (p) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

const ledger = readJsonl(LEDGER);
const scores = readJsonl(SCORES);
const done = new Set(scores.map((s) => s.id));
const now = new Date();
// 장 마감 뒤 여유를 두고 채점한다: KR 15:30 KST → 16:00. US 16:00 ET 은 서머타임이면 20:00Z, 아니면 21:00Z —
//   고정 오프셋 하나로 쓰면 겨울에 마감 전 채점이 된다. 둘 다 넘는 22:00Z 로 둔다.
const closedAt = (r) => new Date(r.market === 'kr' ? `${r.targetDate}T16:00:00+09:00` : `${r.targetDate}T22:00:00Z`);
const day = (t) => new Date(t).toISOString().slice(0, 10);

async function dayRet(sym, date) {
  const from = new Date(new Date(`${date}T00:00:00Z`).getTime() - 12 * 864e5).toISOString();
  const b = await fetchBars(sym, from, new Date(new Date(`${date}T00:00:00Z`).getTime() + 2 * 864e5).toISOString());
  const bars = b?.bars ?? [];
  const i = bars.findIndex((x) => day(x.t) === date);
  if (i < 1) return null;
  return bars[i].c / bars[i - 1].c - 1;
}
/** date 보다 앞선 마지막 장의 등락(미국 지표를 KR 날짜에 붙일 때). */
async function prevSessionRet(sym, date) {
  const from = new Date(new Date(`${date}T00:00:00Z`).getTime() - 12 * 864e5).toISOString();
  const b = await fetchBars(sym, from, `${date}T00:00:00Z`);
  const bars = (b?.bars ?? []).filter((x) => day(x.t) < date);
  return bars.length >= 2 ? bars.at(-1).c / bars.at(-2).c - 1 : null;
}
/** 그날 시장 관련 헤드라인 몇 줄(놓친 사건을 사람이 분류할 단서). pub_date 는 RFC 문자열이라 captured_at(UTC) 으로 고른다. */
async function topNews(date, market) {
  try {
    const { openDb } = await import('./lib/db.mjs');   // 지연 import — DB 가 없거나 잠겨도 채점은 한다
    const [loc, kw] = market === 'kr' ? ['ko', ['코스피', '증시', '반도체', '환율', '외국인']] : ['en', ['stock', 'Nasdaq', 'S&P', 'market', 'chip']];
    const prev = new Date(new Date(`${date}T00:00:00Z`).getTime() - 864e5).toISOString().slice(0, 10);
    return openDb().prepare(`SELECT headline FROM news_archive WHERE locale=? AND substr(captured_at,1,10) IN (?,?) AND (${kw.map(() => 'headline LIKE ?').join(' OR ')})
      ORDER BY CASE importance WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, captured_at DESC LIMIT 5`).all(loc, prev, date, ...kw.map((k) => `%${k}%`)).map((r) => r.headline);
  } catch { return []; }
}

let added = 0;
for (const r of ledger) {
  if (done.has(r.id) || now < closedAt(r)) continue;
  const ret = await dayRet(r.symbol, r.targetDate);
  if (ret == null) {
    if (now - closedAt(r) > 3 * 864e5) { appendFileSync(SCORES, JSON.stringify({ id: r.id, scoredAt: now.toISOString(), noSession: true }) + '\n'); added++; log(`${r.id}: 봉 없음 — 휴장으로 적는다`); }
    continue;
  }
  const s = scoreRecord(r, ret);
  const line = { id: r.id, market: r.market, index: r.index, targetDate: r.targetDate, scoredAt: now.toISOString(), ...s };
  const rep = r.forecasts?.report;
  if (Math.abs(ret) >= 0.02 && rep?.dir !== (ret < 0 ? 'down' : 'up')) {
    const fx = r.market === 'kr' ? await dayRet('KRW=X', r.targetDate) : null;
    const vix = r.market === 'kr' ? await prevSessionRet('^VIX', r.targetDate) : await dayRet('^VIX', r.targetDate);
    line.miss = { types: missType({ ret, sox: r.inputs?.sox, fx, vix }), report: rep, sox: r.inputs?.sox ?? null, fx, vix, news: await topNews(r.targetDate, r.market) };
  }
  appendFileSync(SCORES, JSON.stringify(line) + '\n');
  added++;
  log(`${r.id}: 실제 ${(ret * 100).toFixed(2)}% · 보고서 ${rep?.dir ?? '기권'}(${s.forecasts.report?.hit ?? '-'}) · base p하락 ${r.forecasts.base?.pDown?.toFixed(2)} · ${line.miss ? '놓침 ' + line.miss.types.join('/') : ''}`);
}

// 집계 — ISO 주(목표일 기준)
const all = readJsonl(SCORES).filter((s) => !s.noSession);
const isoWeek = (d) => { const t = new Date(`${d}T00:00:00Z`); const wd = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - wd + 3); const y = t.getUTCFullYear(); const w1 = new Date(Date.UTC(y, 0, 4)); return `${y}-W${String(1 + Math.round(((t - w1) / 864e5 - 3 + ((w1.getUTCDay() + 6) % 7)) / 7)).padStart(2, '0')}`; };
const recs = all.map((s) => ({ market: s.market, week: isoWeek(s.targetDate), scored: s }));
const weeks = {};
for (const w of [...new Set(recs.map((r) => r.week))].sort()) weeks[w] = aggregate(recs.filter((r) => r.week === w));
const misses = all.filter((s) => s.miss).map((s) => ({ id: s.id, ret: s.ret, types: s.miss.types }));
const missByType = {};
for (const m of misses) for (const t of m.types) missByType[t] = (missByType[t] ?? 0) + 1;
writeFileSync(SUMMARY, JSON.stringify({ at: now.toISOString(), recorded: ledger.length, scored: all.length, overall: aggregate(recs), weeks, missByType, misses }, null, 1));
log(`채점 ${added}줄 추가 · 누적 ${all.length} · 놓친 날 ${misses.length} → ${SUMMARY}`);
