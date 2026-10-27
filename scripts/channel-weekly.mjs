/**
 * channel-weekly.mjs — 채널 전체 주간 성적: 지난 7일 vs 그 전 7일 vs 28일(4주) 가운데 값. (2026-10-27 신설)
 *
 * 왜: 10/27 사장님 지시(Mac mini2 전달) "채널마다 지표 감사 — 7일 대 직전 7일, 28일 가운데 값, ▲(+10%↑)■▼(−10%↓),
 *   조회 500 미만은 표본 적음". 편마다 재는 channel-performance 와 달리 채널 합계를 쇼츠·롱폼으로 나눠 잰다.
 *   API 가 주지 않는 것(노출 클릭률·재방문/순시청자)은 빈칸 — 지어내지 않는다.
 *   분석 데이터는 이틀 늦게 찬다 → 이틀 전까지를 '지난 7일'로 본다.
 *
 *   node scripts/channel-weekly.mjs [--out logs/channel-weekly]
 */
import { google } from 'googleapis';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { authorizedClient } from './lib/youtube.mjs';
import { ROOT } from './lib/project-root.mjs';
import { weekCompare } from './lib/channel-weekly.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = resolve(ROOT, arg('--out', 'logs/channel-weekly'));
const auth = await authorizedClient();
const ya = google.youtubeAnalytics({ version: 'v2', auth });

const day = (off) => new Date(Date.now() - 7 * 3600e3 - off * 864e5).toISOString().slice(0, 10);   // 태평양 날짜
const endDate = day(2), startDate = day(2 + 34);
const M = ['views', 'engagedViews', 'estimatedMinutesWatched', 'averageViewDuration', 'averageViewPercentage',
  'subscribersGained', 'subscribersLost', 'likes', 'comments', 'shares'];
const q = async (dims, metrics, filters) => (await ya.reports.query({ ids: 'channel==MINE', startDate, endDate, dimensions: dims, metrics: metrics.join(','), ...(filters ? { filters } : {}), sort: 'day' })).data;

const out = { at: new Date().toISOString(), startDate, endDate, kinds: {} };
for (const [kind, ct] of [['shorts', 'shorts'], ['long', 'videoOnDemand']]) {
  const d = await q('day', M, `creatorContentType==${ct}`);
  const cols = d.columnHeaders.map((c) => c.name);
  const rows = (d.rows ?? []).map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
  const t = await q('day,insightTrafficSourceType', ['views'], `creatorContentType==${ct}`);
  const traffic = (t.rows ?? []).map(([dd, src, v]) => ({ day: dd, src, views: v }));
  out.kinds[kind] = weekCompare(rows, traffic, endDate);
}
mkdirSync(OUT, { recursive: true });
const file = resolve(OUT, `${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace(':', '')}.json`);
writeFileSync(file, JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(out.kinds)) {
  console.log(`\n[${k}] ${v.weeks.map((w) => w.from).join(' / ')} (최근 주 먼저)`);
  for (const m of v.metrics) console.log(`  ${m.mark} ${m.name.padEnd(22)} ${String(m.last).padStart(9)}  전주 ${String(m.prev).padStart(9)}  28일중앙 ${String(m.median28).padStart(9)}${m.lowN ? '  (표본 적음)' : ''}`);
}
console.log(`\n→ ${file}`);
