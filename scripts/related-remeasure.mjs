#!/usr/bin/env node
/**
 * related-remeasure.mjs — '관련 동영상 → 같은 사건·주제 쇼츠'(b710c0bc, 10/19 14:10 업로드부터) 7일 재측정. (2026-10-18)
 *
 * Mac mini2(10/18): 세션이 닫혀도 돌게 launchd 로, 결과는 파일로. launchd 가 매년 같은 날 부르므로
 *   결과 파일이 이미 있으면 바로 끝낸다(한 번만).
 * 잰다: 바꾸기 전(10/12~10/19 14:10) vs 후(10/19 14:10~) 쇼츠, 각 72시간 넘은 편만(channel-performance).
 *   1천회당 구독(합/합) · 본 비율(중앙) · 내 다른 영상에서 온 조회 비율(YT_CHANNEL+YT_OTHER_PAGE, 평균) · 3일 조회(중앙).
 *   무작위 재배치 p<0.05 일 때만 좋아짐/나빠짐, n<20 이면 모름. **되돌리지 않는다** — 판정만 적고 사람이 정한다.
 *   10/14~10/17 에 걸기 실패해 나중에 채운 편(logs/related-backfill.json)은 뺀다.
 *   걸기 성공률: logs/related-new.log 의 ✅/실패, 같은 주제 쇼츠 vs 사이트 롱폼 비율(~/flowvium_runtime/video.log).
 * 사용: node scripts/related-remeasure.mjs [--since 2026-10-19T05:00:00Z] [--base-from 2026-10-11T15:00:00Z] [--force]
 */
import { spawnSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { resolve, join } from 'path';
import { homedir } from 'os';
import { ROOT } from './lib/project-root.mjs';
import { pooledRate, median, compareGroups } from './lib/group-compare.mjs';
import { isReportPipelineRunning } from './lib/report-running.mjs';
import { trialIds } from './lib/slot-trial.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SINCE = arg('--since', '2026-10-19T05:00:00Z');
const BASE_FROM = arg('--base-from', '2026-10-11T15:00:00Z');
const OUT = resolve(ROOT, 'logs/related-remeasure.json');
const log = (...a) => console.log(new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 19), '[related-remeasure]', ...a);

if (existsSync(OUT) && !process.argv.includes('--force')) {
  try { if (JSON.parse(readFileSync(OUT, 'utf8')).since === SINCE) { log('이미 쟀다 — 끝'); process.exit(0); } } catch { /* 깨졌으면 다시 잰다 */ }
}
// 보고서 생성 중이면 기다린다(최대 90분) — 그 사이엔 무거운 일을 하지 않는다.
for (let w = 0; w < 18 && await isReportPipelineRunning(ROOT); w++) { log('보고서 생성 중 — 5분 뒤 다시'); await new Promise((r) => setTimeout(r, 5 * 60_000)); }

const cp = spawnSync(process.execPath, [resolve(ROOT, 'scripts/channel-performance.mjs'), '--days', '16', '--min-age-h', '72'],
  { cwd: ROOT, encoding: 'utf8', timeout: 20 * 60_000 });
const file = String(cp.stdout ?? '').match(/→ (\S+\.json)/)?.[1];
if (cp.status !== 0 || !file || !existsSync(file)) { log(`❌ channel-performance 실패(${cp.status}): ${String(cp.stderr ?? '').slice(-200)}`); process.exit(1); }
// 2026-10-19 Mac mini2: 관련 동영상을 나중에 채워 넣은 편(logs/related-backfill.json)은 전·후 어디에도 넣지 않는다 — 비교를 흐린다.
let backfilled = new Set();
try { backfilled = new Set(JSON.parse(readFileSync(resolve(ROOT, 'logs/related-backfill.json'), 'utf8')).ids ?? []); } catch { /* 없으면 뺄 것 없음 */ }
// 2026-10-19: 10/20~10/26 22:45 9번째 칸 시험(lib/slot-trial)도 뺀다 — 같은 기간에 바꾸기 전엔 없던 시각대 편이라 전·후 비교를 흐린다.
const trialled = trialIds(resolve(ROOT, 'logs/slot-trial.json'));
const rows = JSON.parse(readFileSync(file, 'utf8')).rows.filter((r) => r.kind === 'short' && r.views3d > 0 && !backfilled.has(r.id) && !trialled.has(r.id));
const before = rows.filter((r) => r.publishedAt >= BASE_FROM && r.publishedAt < SINCE);
const after = rows.filter((r) => r.publishedAt >= SINCE);

const own = (g) => { const v = g.map((r) => (r.traffic?.YT_CHANNEL ?? 0) + (r.traffic?.YT_OTHER_PAGE ?? 0)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const metrics = {
  subsPer1k: (g) => pooledRate(g, 'subs3d', 'views3d', 1000),
  viewedRate: (g) => median(g.map((r) => r.viewedRate)),
  ownTraffic: own,
  views3d: (g) => median(g.map((r) => r.views3d)),
};
const result = Object.fromEntries(Object.entries(metrics).map(([k, metric]) => [k, compareGroups(before, after, { metric, minN: 20 })]));
for (const [k, metric] of Object.entries(metrics)) { result[k].before ??= metric(before); result[k].after ??= metric(after); }

// 걸기 결과
const sinceMs = Date.parse(SINCE);
const lines = (p) => { try { return readFileSync(p, 'utf8').split('\n'); } catch { return []; } };
const at = (l) => Date.parse(l.slice(0, 19).replace(' ', 'T') + '+09:00');
const rel = lines(resolve(ROOT, 'logs/related-new.log')).filter((l) => at(l) >= sinceMs);
const pub = lines(join(homedir(), 'flowvium_runtime/video.log')).filter((l) => at(l) >= sinceMs);
const linking = {
  ok: rel.filter((l) => /\[related\] \S+ ✅/.test(l)).length,
  failed: rel.filter((l) => /\[related\] \S+ 실패/.test(l)).length,
  toShort: pub.filter((l) => /관련 동영상 → 같은 (사건|주제) 쇼츠/.test(l)).length,
  toSite: pub.filter((l) => /관련 동영상\(같은 주제 쇼츠가 없어 사이트 소개 롱폼\)/.test(l)).length,
};
const word = { better: '좋아짐', worse: '나빠짐', same: '차이 없음', unknown: '모름' };
const f = (x, d = 2) => (x == null ? '?' : Number(x).toFixed(d));
const summary = `관련 동영상→같은 주제 쇼츠 7일(전 ${before.length}편 · 후 ${after.length}편): `
  + `구독/천 ${f(result.subsPer1k.before)}→${f(result.subsPer1k.after)} ${word[result.subsPer1k.verdict]}(${result.subsPer1k.why}) · `
  + `본 비율 ${f(result.viewedRate.before, 3)}→${f(result.viewedRate.after, 3)} ${word[result.viewedRate.verdict]} · `
  + `내 영상 유입 ${f(100 * (result.ownTraffic.before ?? NaN), 1)}%→${f(100 * (result.ownTraffic.after ?? NaN), 1)}% ${word[result.ownTraffic.verdict]} · `
  + `3일 조회 ${f(result.views3d.before, 0)}→${f(result.views3d.after, 0)} ${word[result.views3d.verdict]} · `
  + `걸기 ✅${linking.ok}/실패${linking.failed} · 쇼츠 ${linking.toShort}/사이트 ${linking.toSite}`;
writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), since: SINCE, baseFrom: BASE_FROM, source: file, excludedBackfill: backfilled.size, excludedTrial: trialled.size, n: { before: before.length, after: after.length }, result, linking, summary }, null, 1));
appendFileSync(resolve(ROOT, 'logs/related-remeasure.log'), `${new Date().toISOString()} ${summary}\n`);
log(summary);
