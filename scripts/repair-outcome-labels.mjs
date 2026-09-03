#!/usr/bin/env node
/**
 * repair-outcome-labels.mjs — 손절선을 깼는데 'sold' 로 기록된 과거 성과를 바로잡는다.
 *
 * 사용자(2026-09-03): 매수엔진 성적을 못 믿겠다는 지적에서 출발했다.
 *
 * 무엇이 틀렸나:
 *   매도추천이 나오면 db.mjs 가 그 종목의 열린 매수추천을 'sold' 로 마감한다.
 *   그 뒤 재평가(verifyUnverified)가 돌 때 `rec.o_outcome === 'sold' ? 'sold' : judge.outcome` 라
 *   **손절 판정이 나와도 'sold' 를 유지**했다. 보유 중에 손절선을 깬 사실이 지워진 것이다.
 *
 * 무엇이 틀리지 않았나 (중요):
 *   손익 숫자는 맞게 기록돼 있었다(그 건들 평균 -1.51%). 수익률이 부풀려진 게 아니다.
 *   틀린 것은 **위험도**다 — 손절률이 9.8% 로 보였지만 실제로는 23.4% 다.
 *   열 번에 한 번 손절하는 시스템과 네 번에 한 번 손절하는 시스템은 전혀 다른 물건이다.
 *
 * 판정 기준은 **실제로 손절선을 깬 것만**(low <= stop).
 *   judgeOutcome 은 1.02 배 여유를 두지만 그건 앞을 보는 탐지 기준이다. 과거에 그대로 소급하면
 *   안 깬 것까지 손실로 만든다 — 실측: 005380.KS 손절 650000 · 저점 651000 인데 +6.32% 가
 *   -4.41% 로 바뀌었다. 과거를 고치는 일에서는 논란의 여지가 없는 것만 건드린다.
 *
 * 손익도 라벨에 맞춰 다시 쓴다 — 'stop_loss' 는 손절가에 청산한 것으로 계산한다(realizedPnlPct 규칙).
 *   라벨만 바꾸고 손익을 그대로 두면 그 자체가 새로운 불일치다.
 *
 * 원본은 details_json 에 남긴다. 되돌릴 수 있어야 한다.
 *
 * 사용:
 *   node scripts/repair-outcome-labels.mjs             # 미리보기
 *   node scripts/repair-outcome-labels.mjs --confirm   # 실제 수정
 */
import { openDb } from './lib/db.mjs';
import { realizedPnlPct } from './lib/realized-pnl.mjs';

const a = process.argv.slice(2);
const CONFIRM = a.includes('--confirm');
// 기준은 **실제로 손절선을 깬 것만**(low <= stop). judgeOutcome 은 1.02 배 여유를 두지만
//   그건 앞을 보는 탐지 기준이고, 과거에 소급하면 안 깬 것까지 손실로 만든다 —
//   실측: 005380.KS 손절 650000 · 저점 651000(안 깸)인데 +6.32% 가 -4.41% 로 바뀌었다.
//   과거 기록을 고치는 일에서는 **논란의 여지가 없는 것만** 건드린다.
const TOL = Number((a.find((x) => x.startsWith('--tolerance=')) ?? '').split('=')[1] ?? 1.0);

const db = openDb();
const rows = db.prepare(
  `SELECT o.id o_id, o.pnl_pct, o.details_json, o.low_seen,
          r.id r_id, r.ticker, r.entry_low, r.price_at_gen, r.stop_loss, r.target, r.generated_at
     FROM recommendation_outcomes o JOIN recommendations r ON r.id = o.recommendation_id
    WHERE o.outcome = 'sold' AND r.stop_loss IS NOT NULL AND o.low_seen IS NOT NULL
      AND o.low_seen <= r.stop_loss * ?`).all(TOL);

if (!rows.length) { console.log('바로잡을 것 없음 ✓'); process.exit(0); }

const plan = rows.map((r) => {
  const entry = r.entry_low ?? r.price_at_gen;
  const next = realizedPnlPct({ outcome: 'stop_loss', entry, stop: r.stop_loss, target: r.target, lastClose: null, exit: null });
  return { ...r, entry, nextPnl: next, delta: (next != null && r.pnl_pct != null) ? next - r.pnl_pct : null };
});

const withPnl = plan.filter((p) => p.nextPnl != null);
const before = withPnl.reduce((s, p) => s + (p.pnl_pct ?? 0), 0) / (withPnl.length || 1);
const after = withPnl.reduce((s, p) => s + p.nextPnl, 0) / (withPnl.length || 1);

console.log(`${CONFIRM ? '수정 실행' : '미리보기 — 실제로 고치려면 --confirm'}  (기준 low <= stop × ${TOL})\n`);
console.log(`  대상 ${rows.length}건`);
console.log(`  손익 평균  ${before.toFixed(2)}%  →  ${after.toFixed(2)}%  (손절가 기준으로 재계산)`);
const st = db.prepare("SELECT COUNT(*) n FROM recommendation_outcomes WHERE outcome='stop_loss'").get().n;
const sd = db.prepare("SELECT COUNT(*) n FROM recommendation_outcomes WHERE outcome='sold'").get().n;
console.log(`  손절률     ${(st / (st + sd) * 100).toFixed(1)}%  →  ${((st + rows.length) / (st + sd) * 100).toFixed(1)}%`);
console.log('\n  예시 5건:');
for (const p of plan.slice(0, 5)) {
  console.log(`    ${String(p.ticker).padEnd(11)} ${p.generated_at.slice(0, 10)}  진입 ${p.entry} 손절 ${p.stop_loss} 저점 ${Number(p.low_seen).toFixed(2)}`
    + `  pnl ${p.pnl_pct ?? '-'}% → ${p.nextPnl}%`);
}
if (!CONFIRM) process.exit(0);

const upd = db.prepare('UPDATE recommendation_outcomes SET outcome=?, pnl_pct=?, details_json=? WHERE id=?');
const tx = db.transaction((list) => {
  for (const p of list) {
    let det = {}; try { det = JSON.parse(p.details_json ?? '{}'); } catch { /* 손상된 것은 새로 쓴다 */ }
    // 되돌릴 수 있게 원본을 남긴다.
    det.repairedAt = new Date().toISOString();
    det.repairedFrom = { outcome: 'sold', pnl_pct: p.pnl_pct };
    det.repairReason = `보유 중 저점 ${Number(p.low_seen).toFixed(2)} <= 손절 ${p.stop_loss} × ${TOL} — judgeOutcome 과 같은 기준`;
    upd.run('stop_loss', p.nextPnl, JSON.stringify(det), p.o_id);
  }
});
tx(plan);
console.log(`\n✅ ${plan.length}건 재분류 (원본은 details_json.repairedFrom 에 보존)`);
