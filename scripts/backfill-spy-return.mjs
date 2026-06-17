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
import { pathToFileURL } from 'url';

const DRY = process.argv.includes('--dry');

async function fetchSpySeries(fromMs, toMs) {
  // 여유 마진 — 진입일 직전 거래일 close 를 잡으려면 시작을 앞당김.
  const p1 = Math.floor(fromMs / 1000) - 14 * 86400;
  const p2 = Math.floor(toMs / 1000) + 2 * 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/SPY?period1=${p1}&period2=${p2}&interval=1d`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'Mozilla/5.0' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`Yahoo SPY ${res.status}`);
  const d = await res.json();
  const result = d?.chart?.result?.[0];
  const ts = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  // timestamp ↔ close 정렬 보존(결측 close 만 제거, index 동기).
  const series = [];
  for (let i = 0; i < ts.length; i++) {
    if (typeof closes[i] === 'number' && closes[i] > 0) series.push({ tMs: ts[i] * 1000, close: closes[i] });
  }
  series.sort((a, b) => a.tMs - b.tMs);
  return series;
}

// 해당 시각 *이하* 의 마지막 거래일 close (없으면 첫 close).
function closeOnOrBefore(series, dateMs) {
  let pick = null;
  for (const s of series) { if (s.tMs <= dateMs) pick = s; else break; }
  return pick ?? series[0] ?? null;
}

export async function backfillSpyReturn({ dry = false, log = console.log } = {}) {
  const db = openDb();
  const rows = db.prepare(`
    SELECT o.id AS oid, o.evaluated_at AS closeAt, r.generated_at AS entryAt
    FROM recommendation_outcomes o
    JOIN recommendations r ON r.id = o.recommendation_id
    WHERE o.spy_return IS NULL AND o.evaluated_at IS NOT NULL AND r.generated_at IS NOT NULL
  `).all();
  if (!rows.length) { log('[backfill-spy] NULL spy_return 행 없음 — skip'); return { updated: 0, total: 0 }; }

  let minMs = Infinity, maxMs = -Infinity;
  for (const r of rows) {
    const e = Date.parse(r.entryAt), c = Date.parse(r.closeAt);
    if (isFinite(e)) { minMs = Math.min(minMs, e); maxMs = Math.max(maxMs, e); }
    if (isFinite(c)) { minMs = Math.min(minMs, c); maxMs = Math.max(maxMs, c); }
  }
  const series = await fetchSpySeries(minMs, maxMs);
  if (series.length < 2) throw new Error('SPY series 부족');
  log(`[backfill-spy] 대상 ${rows.length}행, SPY 시계열 ${series.length}일 (${new Date(series[0].tMs).toISOString().slice(0,10)}~${new Date(series.at(-1).tMs).toISOString().slice(0,10)})`);

  const upd = db.prepare(`UPDATE recommendation_outcomes SET spy_return = ? WHERE id = ?`);
  let updated = 0, skipped = 0;
  const txn = db.transaction((items) => {
    for (const r of items) {
      const eMs = Date.parse(r.entryAt), cMs = Date.parse(r.closeAt);
      if (!isFinite(eMs) || !isFinite(cMs)) { skipped++; continue; }
      const eSpy = closeOnOrBefore(series, eMs), cSpy = closeOnOrBefore(series, cMs);
      if (!eSpy || !cSpy || eSpy.close <= 0) { skipped++; continue; }
      const ret = parseFloat(((cSpy.close - eSpy.close) / eSpy.close * 100).toFixed(2));
      if (!dry) upd.run(ret, r.oid);
      updated++;
    }
  });
  txn(rows);
  log(`[backfill-spy] ${dry ? '(DRY) ' : ''}업데이트 ${updated}행, skip ${skipped}행`);
  return { updated, skipped, total: rows.length };
}

// 직접 실행 시 (Windows file:/// 정규화 — pathToFileURL 로 비교)
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  backfillSpyReturn({ dry: DRY }).then(r => {
    console.log('완료:', JSON.stringify(r));
    process.exit(0);
  }).catch(e => { console.error('[FATAL]', e?.stack ?? e?.message); process.exit(1); });
}
