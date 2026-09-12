#!/usr/bin/env node
/**
 * buy-alpha.test.mjs — 감시가 성과를 스스로 읽는가, 그리고 모를 때 모른다고 하는가.
 *
 * 배경(2026-09-12): 알파를 내는 check-prospective-gaps.mjs 가 크론에 없다.
 *   손으로 부를 때만 돌아서, 벤치마크·분모 결함으로 알파가 -2.17% 로 잘못 나오던
 *   3개월간 아무도 몰랐다. 그래서 감시(check-stall)가 DB 를 직접 읽게 했다.
 */
import { requires } from './test-env.mjs';
await requires({ dbTables: ['recommendation_outcomes', 'recommendations'] });

let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const { buyAlpha } = await import('./buy-alpha.mjs');

// [1] 실제 DB 에서 값이 나온다
const r = buyAlpha({ days: 30 });
(typeof r.line === 'string' && r.line.length > 0 && ['ahead', 'behind', 'unknown'].includes(r.verdict))
  ? ok(`실측: ${r.line} → ${r.verdict}`)
  : bad(`판정을 못 낸다: ${JSON.stringify(r).slice(0, 120)}`);

// [2] 분모가 sold 를 포함한다 — 빼면 표본이 절반 밑으로 준다
{
  const { openDb } = await import('./db.mjs');
  const db = openDb();
  const withSold = db.prepare(`
    SELECT COUNT(*) c FROM recommendation_outcomes o JOIN recommendations r ON r.id=o.recommendation_id
    WHERE r.action='buy' AND o.outcome IN ('hit_target','stop_loss','sold')
      AND o.spy_return IS NOT NULL AND o.pnl_pct IS NOT NULL`).get().c;
  const without = db.prepare(`
    SELECT COUNT(*) c FROM recommendation_outcomes o JOIN recommendations r ON r.id=o.recommendation_id
    WHERE r.action='buy' AND o.outcome IN ('hit_target','stop_loss')
      AND o.spy_return IS NOT NULL AND o.pnl_pct IS NOT NULL`).get().c;
  withSold > without * 1.5
    ? ok(`sold 포함 분모 ${withSold} vs 제외 ${without} — 빼면 통계가 달라진다`)
    : bad(`분모 차이가 없다 (${withSold} vs ${without}) — sold 가 안 들어갔거나 데이터가 없다`);
}

// [3] 표본이 없는 창에서는 'unknown' — 없는 걸 '졌다' 로 읽지 않는다
{
  const far = buyAlpha({ days: 0 });
  far.verdict === 'unknown'
    ? ok("표본 0 인 창 → 'unknown' (없음을 패배로 읽지 않는다)")
    : bad(`표본 0 인데 ${far.verdict} 로 판정한다`);
}

console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
