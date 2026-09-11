#!/usr/bin/env node
/**
 * shorts-health.mjs — 쇼츠 조회수 추세를 매일 판정해 로그에 남긴다.
 *
 * 왜 (2026-09-09): 09-08 부터 조회수가 1/3 로 떨어졌는데 사흘 뒤 사용자가 물어서야 알았다.
 *   수집은 자동이었지만 판정이 없었다. 이제 모니터가 매일 이걸 읽고 말한다.
 *
 * 사용: node scripts/shorts-health.mjs [--days 7] [--json]
 */
import { openDb } from './lib/db.mjs';
import { dailyTrend, verdict } from './lib/shorts-health.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DAYS = Number(arg('--days', 7));
const JSON_OUT = process.argv.includes('--json');

const db = openDb();
// 발행 시각으로 KST 하루를 정한다 — 측정 시각이 아니다. 같은 편의 표본은 한 날에 모여야 한다.
const rows = db.prepare(`
  SELECT s.video_id, s.views, s.age_hours,
         date(p.published_at, '+9 hours') AS day
    FROM shorts_stats s
    JOIN shorts_published p ON p.video_id = s.video_id
   WHERE p.retracted_at IS NULL
     AND date(p.published_at, '+9 hours') >= date('now', '+9 hours', ?)
`).all(`-${DAYS} days`);
db.close();

const trend = dailyTrend(rows);
const v = verdict(trend);

if (JSON_OUT) { console.log(JSON.stringify({ trend, verdict: v }, null, 2)); process.exit(0); }

console.log('  날짜        발행 8시간 조회수(중앙)   표본');
for (const d of trend) {
  console.log(`   ${d.day}   ${String(d.median ?? '—').padStart(10)}   ${String(d.n).padStart(6)}편`);
}
const mark = { down: '⚠', up: '↑', flat: '·', unknown: '?' }[v.state];
console.log(`\n  ${mark} ${v.line}`);

// 2026-09-11 정정: 종전에는 하락이면 종료코드 1 로 끝냈다. 크론은 그걸 **작업 실패**로 읽는다 —
//   20분마다 재시도하며 실패 로그만 쌓았고, 이 검사는 한 번도 제 역할을 못 했다(실패 4회 · skip 8회).
//   "재는 일" 은 성공했다. 하락은 **결과**이지 실패가 아니다.
//   경보는 모니터(check-stall)가 같은 lib 로 직접 판정해 올린다 — 여기서는 재고 알리기만 한다.
process.exit(0);
