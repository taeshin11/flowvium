#!/usr/bin/env node
/**
 * enforce-outcome-invariants.mjs — 성과 데이터가 지켜야 할 규약을 강제한다.
 *
 * 배경(2026-08-20): "수익률이 처참하다"를 파다가 통계 자체를 못 믿는 상태를 발견했다.
 *   ① not_entered 인데 손익이 붙어 있다 — realized-pnl.mjs:12 규약 위반.
 *      5월 구버전 코드가 시가평가값을 넣었고, 그게 남아 199건 평균 60.85% 로 전체를 부풀렸다.
 *      안 산 종목의 '수익'은 성과가 아니다.
 *   ② 체결 근거(low_seen) 없이 손익만 있다 — OHLC 를 못 가져온 건은 체결 여부를 모른다.
 *      모르면 주장하지 않는다. 0 으로 채우지도 않는다(평균 희석).
 *
 * 손익을 지우기만 하고 outcome 라벨은 남긴다 — 무슨 일이 있었는지의 기록은 유지하되
 * '얼마 벌었다'는 주장만 거둔다.
 *
 * 사용: node scripts/enforce-outcome-invariants.mjs [--dry]
 */
import Database from 'better-sqlite3';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';

const DRY = process.argv.includes('--dry');
const db = new Database(resolve(ROOT, 'data/flowvium.db'));

const rules = [
  {
    name: 'not_entered 는 손익 없음',
    why: 'realized-pnl.mjs:12 — 체결되지 않았으므로 손익이 존재하지 않는다',
    count: `SELECT COUNT(*) c FROM recommendation_outcomes WHERE outcome='not_entered' AND pnl_pct IS NOT NULL`,
    fix:   `UPDATE recommendation_outcomes SET pnl_pct=NULL, quality_score=NULL WHERE outcome='not_entered' AND pnl_pct IS NOT NULL`,
  },
  {
    name: '체결 근거 없이 손익 주장 금지',
    why: 'low_seen 이 없으면 진입가에 닿았는지 모른다 — 모르면 주장하지 않는다',
    count: `SELECT COUNT(*) c FROM recommendation_outcomes WHERE pnl_pct IS NOT NULL AND low_seen IS NULL`,
    fix:   `UPDATE recommendation_outcomes SET pnl_pct=NULL, quality_score=NULL WHERE pnl_pct IS NOT NULL AND low_seen IS NULL`,
  },
];

let total = 0;
for (const r of rules) {
  const n = db.prepare(r.count).get().c;
  console.log(`  ${n === 0 ? '✅' : '🔧'} ${r.name}: ${n}건`);
  if (n) console.log(`       ${r.why}`);
  if (n && !DRY) { const ch = db.prepare(r.fix).run().changes; console.log(`       → ${ch}건 손익 제거(라벨은 유지)`); total += ch; }
}
console.log(DRY ? '\n  (dry — 변경 없음)' : `\n  총 ${total}건 정리`);

// 남은 복사 손익은 데이터로 못 고친다(원래 진입가별 청산가를 알 수 없음) — 규모만 보고한다.
const dup = db.prepare(`
  SELECT COUNT(*) c FROM (
    SELECT r.ticker, o.evaluated_at, o.pnl_pct, COUNT(*) n, COUNT(DISTINCT r.entry_high) de
    FROM recommendation_outcomes o JOIN recommendations r ON r.id=o.recommendation_id
    WHERE o.pnl_pct IS NOT NULL
    GROUP BY r.ticker,o.evaluated_at,o.pnl_pct HAVING n>1 AND de>1)`).get().c;
console.log(`  남은 손익복사 그룹 ${dup}개 — 재평가(--verify)로만 줄어든다`);
db.close();
