#!/usr/bin/env node
/**
 * backfill-spy-return.mjs — recommendation_outcomes.spy_return 백필 (2026-06-18 신설)
 *
 * 발생 경위: closeOutcome(매도 처리)가 spy_return 을 계산하지 않아 outcome='sold' 661행(전체 80%)이
 *   spy_return NULL. evaluate-recommendations 는 활성 큐만 처리 → 매도 포지션은 벤치마크 영구 누락 →
 *   alpha(pnl - spy) 계산 불가 = Karpathy outcome 학습루프 사각지대. audit-coverage 도 "미인지 NULL"로 차단.
 *
 * 동작: SPY 1d 시계열을 timestamp 정렬로 1회 fetch → 각 NULL-spy outcome 의
 *   진입(recommendations.generated_at) ~ 청산(outcomes.evaluated_at) 구간 SPY 수익률 계산 → UPDATE.
 *   --dry 로 미적용 미리보기. import 로 backfillSpyReturn() 재사용(자가치유 배선용).
 */
import { openDb } from './lib/db.mjs';
import { fetchSpySeries, spyReturnBetween, spanOf } from './lib/spy-benchmark.mjs';
import { pathToFileURL } from 'url';

const DRY = process.argv.includes('--dry');
const ALL = process.argv.includes('--all');

export async function backfillSpyReturn({ dry = false, all = false, log = console.log } = {}) {
  const db = openDb();
  // all=true 면 이미 값이 있는 행도 다시 잰다 — 컬럼의 의미를 하나로 유지하는 자가치유 경로.
  //   (2026-09-12) evaluate-recommendations 가 배치 1회분 SPY 를 전 행에 스탬프해 둔 189행이
  //   이 경로로 건별 값으로 교정된다. 재계산은 (진입시각, 청산시각)만의 함수라 몇 번 돌려도 같다.
  const rows = db.prepare(`
    SELECT o.id AS oid, o.evaluated_at AS closeAt, o.spy_return AS was, r.generated_at AS entryAt
    FROM recommendation_outcomes o
    JOIN recommendations r ON r.id = o.recommendation_id
    WHERE ${all ? '1=1' : 'o.spy_return IS NULL'}
      AND o.evaluated_at IS NOT NULL AND r.generated_at IS NOT NULL
  `).all();
  if (!rows.length) { log(`[backfill-spy] 대상 행 없음 — skip`); return { updated: 0, skipped: 0, total: 0 }; }

  const span = spanOf(rows, 'entryAt', 'closeAt');
  if (!span) throw new Error('유효한 시각이 있는 행이 없다');
  const series = await fetchSpySeries(span.minMs, span.maxMs);
  if (series.length < 2) throw new Error('SPY series 부족');
  log(`[backfill-spy] 대상 ${rows.length}행${all ? ' (전체 재계산)' : ''}, SPY 시계열 ${series.length}일 `
    + `(${new Date(series[0].tMs).toISOString().slice(0,10)}~${new Date(series.at(-1).tMs).toISOString().slice(0,10)})`);

  const upd = db.prepare(`UPDATE recommendation_outcomes SET spy_return = ? WHERE id = ?`);
  let updated = 0, skipped = 0, unchanged = 0;
  const txn = db.transaction((items) => {
    for (const r of items) {
      const ret = spyReturnBetween(series, Date.parse(r.entryAt), Date.parse(r.closeAt));
      if (ret === null) { skipped++; continue; }
      if (r.was !== null && Math.abs(r.was - ret) < 0.005) { unchanged++; continue; }
      if (!dry) upd.run(ret, r.oid);
      updated++;
    }
  });
  txn(rows);
  log(`[backfill-spy] ${dry ? '(DRY) ' : ''}변경 ${updated}행, 그대로 ${unchanged}행, 잴 수 없음 ${skipped}행`);
  return { updated, unchanged, skipped, total: rows.length };
}

// 직접 실행 시 (Windows file:/// 정규화 — pathToFileURL 로 비교)
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  backfillSpyReturn({ dry: DRY, all: ALL }).then(r => {
    console.log('완료:', JSON.stringify(r));
    process.exit(0);
  }).catch(e => { console.error('[FATAL]', e?.stack ?? e?.message); process.exit(1); });
}
