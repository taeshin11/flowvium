#!/usr/bin/env node
/**
 * slot-trial-judge.mjs — 22:45 9번째 칸 7일 시험(lib/slot-trial) 판정. (2026-10-19)
 *
 * Mac mini2(사장님 결정): 10/20 부터 7일, **10/19 에 잰 것과 같은 잣대** — 편당 3일 조회 중앙값과 하루 합.
 * 잰다(channel-performance, 72h 넘은 편만, 다 익은 날만 — lib/slot-trial matureDays):
 *   ① 희석: 시험 기간 정규 8칸 편 vs 시험 전 14일 편 — 편당 3일 조회 중앙(무작위 재배치, n<20 모름).
 *   ② 하루 합: 시험 날 vs 시험 전 날 — 날 단위라 표본이 작다(n<5 모름).
 *   ③ 9번째 칸 편 자체의 3일 조회 중앙·편수, 거른 날(logs/slot-trial.json 에 id 가 없는 날).
 * ⚠ 같은 기간에 '관련 동영상 → 같은 주제 쇼츠'(10/19 14:10~)가 바뀌었다 — ①②의 전·후 차이는 그 효과와 섞인다.
 *   그래서 결론에 그 단서를 붙인다. **되돌리지 않는다** — 판정만 적고 사람이 정한다.
 * 사용: node scripts/slot-trial-judge.mjs --label prelim|final [--trial 2026-10-20:2026-10-26] [--base-days 14] [--out logs/slot-trial-judge.json] [--force]
 *   결과 logs/slot-trial-judge.json(라벨별) + .log. 같은 라벨 결과가 있으면 바로 끝(launchd 는 매년 같은 날 부른다).
 */
import { spawnSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
import { median, compareGroups } from './lib/group-compare.mjs';
import { isReportPipelineRunning } from './lib/report-running.mjs';
import { parseTrial, matureDays, trialIds, kstDay } from './lib/slot-trial.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const LABEL = arg('--label', 'final');
const TRIAL_ARG = arg('--trial', '2026-10-20:2026-10-26');
const TRIAL = parseTrial(TRIAL_ARG);
const BASE_DAYS = Number(arg('--base-days', '14'));
const OUT = resolve(ROOT, arg('--out', 'logs/slot-trial-judge.json'));   // 시험 돌림은 --out 으로 운영 원장을 안 건드린다
const log = (...a) => console.log(new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 19), '[slot-trial]', ...a);
if (!TRIAL) { log(`❌ --trial 이 깨졌다: ${TRIAL_ARG}`); process.exit(1); }

let saved = {};
try { saved = JSON.parse(readFileSync(OUT, 'utf8')); } catch { /* 처음 */ }
if (saved[LABEL]?.trial === TRIAL_ARG && !process.argv.includes('--force')) { log(`${LABEL} 이미 쟀다 — 끝`); process.exit(0); }
for (let w = 0; w < 18 && await isReportPipelineRunning(ROOT); w++) { log('보고서 생성 중 — 5분 뒤 다시'); await new Promise((r) => setTimeout(r, 5 * 60_000)); }

const now = Date.now();
const span = (from, n) => Array.from({ length: n }, (_, k) => kstDay(Date.parse(`${from}T12:00:00+09:00`) + k * 864e5));
const trialAll = span(TRIAL.from, Math.round((Date.parse(TRIAL.until) - Date.parse(TRIAL.from)) / 864e5) + 1);
const baseAll = span(kstDay(Date.parse(`${TRIAL.from}T12:00:00+09:00`) - BASE_DAYS * 864e5), BASE_DAYS);
const trialDays = matureDays(trialAll, now), baseDays = matureDays(baseAll, now);
const daysBack = Math.ceil((now - Date.parse(`${baseAll[0]}T00:00:00+09:00`)) / 864e5) + 1;

const cp = spawnSync(process.execPath, [resolve(ROOT, 'scripts/channel-performance.mjs'), '--days', String(daysBack), '--min-age-h', '72'],
  { cwd: ROOT, encoding: 'utf8', timeout: 20 * 60_000 });
const file = String(cp.stdout ?? '').match(/→ (\S+\.json)/)?.[1];
if (cp.status !== 0 || !file || !existsSync(file)) { log(`❌ channel-performance 실패(${cp.status}): ${String(cp.stderr ?? '').slice(-200)}`); process.exit(1); }
const rows = JSON.parse(readFileSync(file, 'utf8')).rows.filter((r) => r.kind === 'short' && r.views3d > 0);
const ninth = trialIds(resolve(ROOT, 'logs/slot-trial.json'), TRIAL_ARG);
const dayOf = (r) => kstDay(Date.parse(r.publishedAt));
const inDays = (ds) => rows.filter((r) => ds.includes(dayOf(r)));

// ① 희석 — 정규 칸 편만(9번째 칸 편은 뺀다)
const baseVids = inDays(baseDays), trialRegular = inDays(trialDays).filter((r) => !ninth.has(r.id)), ninthVids = inDays(trialDays).filter((r) => ninth.has(r.id));
const medViews = (g) => median(g.map((r) => r.views3d));
const perVideo = compareGroups(baseVids, trialRegular, { metric: medViews, minN: 20 });
perVideo.before ??= medViews(baseVids); perVideo.after ??= medViews(trialRegular);
// ② 하루 합 — 날 단위
const dayRows = (ds) => ds.map((d) => ({ day: d, n: rows.filter((r) => dayOf(r) === d).length, total: rows.filter((r) => dayOf(r) === d).reduce((s, r) => s + r.views3d, 0) }));
// 0편인 날은 편성 문제가 아니라 고장이다(10/08 업로드 401 로 하루 0편) — 하루 합 비교에서 빼고 따로 적는다.
const baseAllTot = dayRows(baseDays), trialAllTot = dayRows(trialDays);
const baseTot = baseAllTot.filter((x) => x.n > 0), trialTot = trialAllTot.filter((x) => x.n > 0);
const outage = [...baseAllTot, ...trialAllTot].filter((x) => x.n === 0).map((x) => x.day);
const medTotal = (g) => median(g.map((x) => x.total));
const dayTotal = compareGroups(baseTot, trialTot, { metric: medTotal, minN: 5 });
dayTotal.before ??= medTotal(baseTot); dayTotal.after ??= medTotal(trialTot);
// ③ 9번째 칸
const ranDays = new Set(ninthVids.map(dayOf));
const skipped = trialDays.filter((d) => !ranDays.has(d));

const word = { better: '좋아짐', worse: '나빠짐', same: '차이 없음', unknown: '모름' };
const f0 = (x) => (x == null ? '?' : Math.round(x));
const summary = `[${LABEL}] 9번째 칸 시험 ${TRIAL_ARG} — 다 익은 날 ${trialDays.length}/${trialAll.length}(비교 ${baseDays.length}일): `
  + `정규 편당 3일 조회 ${f0(perVideo.before)}→${f0(perVideo.after)} ${word[perVideo.verdict]}(${perVideo.why}, 전 ${baseVids.length}편·후 ${trialRegular.length}편) · `
  + `하루 합 ${f0(dayTotal.before)}→${f0(dayTotal.after)} ${word[dayTotal.verdict]}(${dayTotal.why}${outage.length ? `, 0편 날 ${outage.join(',')} 뺌` : ''}) · `
  + `9번째 칸 ${ninthVids.length}편 중앙 ${f0(medViews(ninthVids))} · 거른 날 ${skipped.length}${skipped.length ? `(${skipped.join(',')})` : ''} · `
  + `⚠ 관련 동영상 변경(10/19 14:10~)과 같은 기간이라 전·후 차이는 섞인다`;
saved[LABEL] = { at: new Date().toISOString(), trial: TRIAL_ARG, source: file, trialDays, baseDays, ninthIds: [...ninth],
  perVideo, dayTotal, daily: { base: baseAllTot, trial: trialAllTot, outage }, ninth: { n: ninthVids.length, medianViews3d: medViews(ninthVids), skipped }, summary };
writeFileSync(OUT, JSON.stringify(saved, null, 1));
appendFileSync(OUT.replace(/\.json$/, '.log'), `${new Date().toISOString()} ${summary}\n`);
log(summary);
