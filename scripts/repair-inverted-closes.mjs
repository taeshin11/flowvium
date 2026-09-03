#!/usr/bin/env node
/**
 * repair-inverted-closes.mjs — 청산이 추천보다 앞선 마감 기록을 되돌린다.
 *
 * 2026-09-04 실측: 매도추천이 그 종목의 열린 매수를 **시각 확인 없이** 전부 닫아,
 *   005380.KS 06-03 추천이 05-29 매도로 닫혔다(-5.2일). 사지도 않은 것을 그 전에 판 기록이다.
 *   OHLC 구간이 음수라 Yahoo 가 HTTP 400 을 주고, 손익이 영영 안 채워진다(126건).
 *
 * 되돌리는 방식: 마감 기록을 **지운다**. 없애면 그 추천은 다시 '열린 상태'가 되고
 *   evaluate-recommendations 가 정상 구간으로 다시 평가한다.
 *   손익을 억지로 만들어 넣지 않는다 — 없는 값을 지어내는 게 더 나쁘다.
 *
 * 지우기 전에 지운 내용을 파일로 남긴다. 되돌릴 수 있어야 한다.
 */
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { openDb } from './lib/db.mjs';
import { ROOT } from './lib/project-root.mjs';

const CONFIRM = process.argv.includes('--confirm');
const db = openDb();

const rows = db.prepare(`
  SELECT o.id o_id, o.evaluated_at, o.outcome, o.pnl_pct, o.details_json,
         r.id r_id, r.ticker, r.generated_at
    FROM recommendation_outcomes o JOIN recommendations r ON r.id = o.recommendation_id
   WHERE o.outcome = 'sold' AND o.pnl_pct IS NULL
     AND datetime(o.evaluated_at) < datetime(r.generated_at, '+1 day')
   ORDER BY r.ticker, r.generated_at`).all();

if (!rows.length) { console.log('되돌릴 것 없음 ✓'); process.exit(0); }

const inverted = rows.filter((r) => new Date(r.evaluated_at) < new Date(r.generated_at));
console.log(`${CONFIRM ? '되돌리기 실행' : '미리보기 — 실제로 지우려면 --confirm'}\n`);
console.log(`  대상 ${rows.length}건 (그중 청산이 추천보다 앞선 것 ${inverted.length}건)`);
const byTicker = new Map();
for (const r of rows) byTicker.set(r.ticker, (byTicker.get(r.ticker) ?? 0) + 1);
console.log('  종목:', [...byTicker].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, n]) => `${t}(${n})`).join(' '));
console.log('\n  예시 5건:');
for (const r of rows.slice(0, 5)) {
  const d = ((new Date(r.evaluated_at) - new Date(r.generated_at)) / 86400000).toFixed(1);
  console.log(`    ${String(r.ticker).padEnd(11)} 추천 ${r.generated_at.slice(0, 10)} → 청산 ${r.evaluated_at.slice(0, 10)}  (${d}일)`);
}
if (!CONFIRM) process.exit(0);

const backup = resolve(ROOT, `reports/verify/inverted-closes-${Date.now()}.json`);
writeFileSync(backup, JSON.stringify(rows, null, 1));
console.log(`\n  백업: ${backup.replace(ROOT, '.')}`);

const del = db.prepare('DELETE FROM recommendation_outcomes WHERE id = ?');
db.transaction((list) => { for (const r of list) del.run(r.o_id); })(rows);
console.log(`✅ ${rows.length}건 마감 취소 — 그 추천들은 다시 열린 상태가 되어 정상 구간으로 재평가된다`);
