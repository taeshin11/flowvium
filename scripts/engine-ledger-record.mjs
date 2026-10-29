#!/usr/bin/env node
/**
 * engine-ledger-record.mjs — 보고서 회차가 내린 결정(종목선정·매수 후보 점수·심판·매도)을 **발간 직후** 장부에 고정 기록.
 * 2026-10-15 신설 — 사장님 "flowvium 예측력 전향적 연구 — 종목선정·매수엔진·매도엔진·심판엔진 다 검증".
 * 프로토콜: docs/prospective-study-protocol.md · 계산: lib/engine-ledger.mjs(+test).
 *
 * 무엇을 적나(보고서 JSON 에서 — 그 회차가 실제로 낸 것만):
 *   pick        최종 포트폴리오(진입대·손절·목표·비중)            → H1·H8
 *   cand        매수 후보 상위 30(점수·발동 규칙, 뽑혔는지)          → H2·H3
 *   judge_*     심판 결정(veto·downgrade·pass, 걸린 규칙)              → H5
 *   sell        매도 추천(대표 규칙·발동 규칙 전부·긴급도)            → H4
 *   그리고 규칙 파일 해시·git 커밋(규칙 버전), KR 판정 (b)/(a).
 * 대조군: 연구 시작 때 한 번 정한 유니버스 표본(data/engine-study.json, 시드 고정) — 채점이 같은 규칙으로 잰다.
 * 진입 기준 시각 = 이 장부에 적은 시각(recordedAt). 보고서 생성 시각보다 늦거나 같다 → 커밋 시각으로 증명되는 쪽.
 * 이미 적힌 회차는 다시 안 적는다. 생성 뒤 6시간이 지난 회차는 적지 않는다(사후 기록 방지 — '늦어서 못 적음' 으로 센다).
 *
 * 사용: node scripts/engine-ledger-record.mjs [--dry]
 */
import { readFileSync, appendFileSync, existsSync, readdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { ROOT } from './lib/project-root.mjs';
import { isEtf, isCashLikeEtf } from './lib/etf-filter.mjs';
import { freshBreadth } from './lib/funnel-breadth.mjs';

const DIR = process.env.ENGINE_LEDGER_DIR || resolve(ROOT, 'data');
const LEDGER = resolve(DIR, 'engine-ledger.jsonl');
const STUDY = resolve(DIR, 'engine-study.json');
const DRY = process.argv.includes('--dry');
const MAX_AGE_MS = 6 * 3600_000;
const RULE_FILES = ['data/buy-rules-tuned.json', 'data/sell-rules-tuned.json'];

const sha = (p) => { try { return createHash('sha256').update(readFileSync(resolve(ROOT, p))).digest('hex').slice(0, 16); } catch { return null; } };
const gitHead = () => { try { return execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return null; } };
const mkt = (ticker, m) => (/\.(KS|KQ)$/i.test(ticker) || m === 'korea' || m === 'kr' ? 'kr' : 'us');

/** 결정론 표본(시드 문자열) — mulberry32. */
function seeded(seed) {
  let h = 0; for (const ch of seed) h = Math.imul(31, h) + ch.charCodeAt(0) | 0;
  return () => { h = h + 0x6D2B79F5 | 0; let t = Math.imul(h ^ h >>> 15, 1 | h); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function ensureStudy() {
  if (existsSync(STUDY)) return JSON.parse(readFileSync(STUDY, 'utf8'));
  const u = JSON.parse(readFileSync(resolve(ROOT, 'data/candidate-tickers.json'), 'utf8'));
  // 엔진과 같은 규칙으로 ETF·현금성 ETF 를 뺀다(lib/etf-filter — generate-report-local 의 깔때기 1단계와 같은 함수).
  //   현금성 판정의 52주 레인지 조건은 여기선 가격이 없어 이름 조건만 쓴다.
  const etfCount = { n: 0 };
  const pool = (u.tickers ?? []).filter((t) => { const meta = u.meta?.[t] ?? {}; const e = isEtf(t, meta) || isCashLikeEtf(meta.name); if (e) etfCount.n++; return !e; });
  const pick = (arr, n, rnd) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n).sort(); };
  const seed = 'flowvium-prospective-2026-10-15';
  const study = {
    startedAt: new Date().toISOString(), protocol: 'docs/prospective-study-protocol.md v0.1', seed,
    v0: { git: gitHead(), rules: Object.fromEntries(RULE_FILES.map((p) => [p, sha(p)])) },
    control: { us: pick(pool.filter((t) => mkt(t) === 'us'), 100, seeded(seed + ':us')), kr: pick(pool.filter((t) => mkt(t) === 'kr'), 60, seeded(seed + ':kr')) },
    universe: { file: 'data/candidate-tickers.json', generatedAt: u.generatedAt, total: u.total, etfExcluded: etfCount.n },
  };
  if (!DRY) writeFileSync(STUDY, JSON.stringify(study, null, 1) + '\n');
  return study;
}

/** 보고서 한 편 → 기록 줄. 보고서가 낸 값만 옮긴다(계산·보정 없음). */
export function decisionsOf(r) {
  const out = [];
  const picks = new Set();
  for (const p of r.portfolio ?? []) {
    picks.add(p.ticker);
    out.push({ role: 'pick', ticker: p.ticker, market: mkt(p.ticker, p.market), alloc: p.allocation ?? null, conf: p.confidence ?? null,
      entryZone: p.entryZone ?? null, stop: p.stopLoss ?? null, target: p.target ?? null });
  }
  (r.buyCandidateScoring?.top30 ?? []).forEach((c, i) => out.push({ role: 'cand', ticker: c.ticker, market: mkt(c.ticker, c.market), rank: i + 1,
    score: c.score ?? null, rules: c.reasons ?? [], picked: picks.has(c.ticker) }));
  const rec = r.buySellReconciliation ?? {};
  for (const c of rec.candidates ?? []) out.push({ role: `judge_${c.tier ?? 'unknown'}`, ticker: c.ticker, market: mkt(c.ticker), hardHit: c.hardHit ?? null,
    buyConviction: c.buyConviction ?? null, netSoft: c.netSoft ?? null });
  for (const d of rec.downgraded ?? []) out.push({ role: 'judge_downgraded', ticker: d.ticker ?? d, market: mkt(d.ticker ?? d) });
  // 2026-10-30 (protocol v0.3 A·B): Stage2 에서 거부돼 후보 30에 못 든 종목 — '거부 안 했으면' 대조군. 보고서가 낸 목록 그대로.
  for (const v of r.buyCandidateScoring?.funnel?.vetoed ?? []) out.push({ role: `funnel_veto_${v.kind}`, ticker: v.ticker, market: mkt(v.ticker, v.market), score: v.score ?? null, why: v.why ?? null });
  const sr = r.sellRecommendations;
  const sells = Array.isArray(sr) ? sr : [...(sr?.us ?? []), ...(sr?.kr ?? [])];
  for (const s of sells) out.push({ role: 'sell', ticker: s.ticker, market: mkt(s.ticker, s.market), ruleId: s.ruleId ?? null, score: s.score ?? null,
    urgency: s.urgency ?? null, hits: (s.sellHits ?? []).map((h) => h.ruleId), pnlPct: s.pnlPct ?? null, heldDays: s.heldDays ?? null });
  return out;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const study = ensureStudy();
  const done = new Set(existsSync(LEDGER) ? readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).id) : []);
  const now = Date.now();
  const files = readdirSync(resolve(ROOT, 'reports')).filter((f) => /^report-\d{4}-\d{2}-\d{2}-[a-z]+-ko\.json$/.test(f));
  let wrote = 0, late = 0;
  for (const f of files) {
    const m = /^report-(\d{4}-\d{2}-\d{2})-([a-z]+)-ko\.json$/.exec(f);
    const id = `${m[1]}:${m[2]}`;
    if (done.has(id)) continue;
    let r; try { r = JSON.parse(readFileSync(resolve(ROOT, 'reports', f), 'utf8')); } catch { continue; }
    const gen = Date.parse(r.generatedAt);
    if (!Number.isFinite(gen) || gen < Date.parse(study.startedAt) - MAX_AGE_MS) continue;   // 연구 시작 전 회차는 대상 아님
    if (now - gen > MAX_AGE_MS) { late++; console.log(`[늦음] ${id} 생성 ${r.generatedAt} — 6시간 지나 기록 안 함`); continue; }
    const kv = r.marketVerdict?.krVerdict;
    const line = {
      id, recordedAt: new Date(now).toISOString(), generatedAt: r.generatedAt, session: r.session ?? m[2],
      git: gitHead(), rules: Object.fromEntries(RULE_FILES.map((p) => [p, sha(p)])),
      // 결정 당시 입력 증거(ChatGPT 10/15 P0): 보고서 원문 전체·유니버스 파일의 해시. 원문은 reports/ 에 남고, 해시로 나중에 바뀌지 않았음을 확인한다.
      inputs: { report: sha(`reports/${f}`), universe: sha('data/candidate-tickers.json'), model: r.model ?? null, buildId: r.buildId ?? null },
      krVerdict: kv ? { verdict: kv.verdict ?? null, verdictA: kv.verdictA ?? kv.verdict ?? null } : null,
      // 2026-10-30: 그 회차가 본 시장 폭(200일선 아래·데드크로스 비율) — v0.3 B 가설(폭 70% 이상일 때)의 국면 표시.
      //   보고서가 이미 새것만 넣지만(freshBreadth) 그 회차 생성 시각 기준으로 한 번 더 본다 — 오래된 폭으로 국면을 판정하지 않게.
      breadth: (() => { const b = freshBreadth(r.buyCandidateScoring?.funnel?.breadth, gen); return b ? { at: b.at ?? null, kr: b.kr?.pct ?? null, us: b.us?.pct ?? null } : null; })(),
      usVerdict: r.marketVerdict?.verdict ?? null, warn: r.earlyWarning ? { level: r.earlyWarning.level, score: r.earlyWarning.score } : null,
      decisions: decisionsOf(r),
    };
    console.log(`${DRY ? '[dry] ' : ''}${id} — 결정 ${line.decisions.length}개(pick ${line.decisions.filter((d) => d.role === 'pick').length}·cand ${line.decisions.filter((d) => d.role === 'cand').length}·judge ${line.decisions.filter((d) => d.role.startsWith('judge_')).length}·sell ${line.decisions.filter((d) => d.role === 'sell').length}·깔때기 거부 ${line.decisions.filter((d) => d.role.startsWith('funnel_veto_')).length})`);
    if (!DRY) appendFileSync(LEDGER, JSON.stringify(line) + '\n');
    wrote++;
  }
  console.log(`기록 ${wrote} · 늦음 ${late} · 대조군 us ${study.control.us.length}·kr ${study.control.kr.length}`);
}
