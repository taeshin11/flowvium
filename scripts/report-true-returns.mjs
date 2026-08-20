#!/usr/bin/env node
/**
 * report-true-returns.mjs — 검증된 결과만으로 성과를 낸다.
 *
 * 배경(2026-08-20): 종전 수익률 통계는 두 가지 이유로 측정이 아니었다.
 *   ① 체결 미검증 — recommendation_outcomes 의 73%('sold' 976건)가 low_seen/ohlc_days NULL.
 *      매도추천이 나오면 db.mjs 가 OHLC 없이 매수추천을 마감했기 때문이다.
 *      진입가가 시장가 아래인데 가격이 내려오지 않은 건도 '샀다 팔았다'로 기록됐다.
 *   ② 손익 복사 — 매도엔진의 단일 pnlPct 가 진입가가 다른 여러 건에 그대로 들어갔다
 *      (NVDA -0.3% → 진입가 32종 77건. 그런 그룹 84개).
 *
 * 그래서 '검증된 것만' 과 '전체' 를 나란히 낸다. 숫자가 갈리면 그 차이가 곧 오염분이다.
 * not_entered 는 손익 없음(null)이라 평균에서 제외한다 — 0% 로 채우면 평균이 희석된다.
 */
import Database from 'better-sqlite3';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';

const db = new Database(resolve(ROOT, 'data/flowvium.db'), { readonly: true });
const num = (n, d = 2) => (n == null || Number.isNaN(n) ? 'n/a' : Number(n).toFixed(d));

function stats(where, label) {
  const rows = db.prepare(`
    SELECT o.outcome, o.pnl_pct, o.spy_return, r.market
    FROM recommendation_outcomes o JOIN recommendations r ON r.id = o.recommendation_id
    WHERE r.action='buy' AND ${where}`).all();
  const withPnl = rows.filter(r => r.pnl_pct != null);
  const avg = withPnl.length ? withPnl.reduce((s, r) => s + r.pnl_pct, 0) / withPnl.length : null;
  const wins = withPnl.filter(r => r.pnl_pct > 0).length;
  const ne = rows.filter(r => r.outcome === 'not_entered').length;
  console.log(`\n  ── ${label}`);
  console.log(`     표본 ${rows.length}건 · 손익 있는 것 ${withPnl.length}건 · 미체결 ${ne}건`);
  console.log(`     평균 손익 ${num(avg)}% · 승률 ${withPnl.length ? num(100 * wins / withPnl.length, 1) : 'n/a'}%`);
  const byOut = {};
  for (const r of rows) (byOut[r.outcome] ??= []).push(r.pnl_pct);
  for (const [k, v] of Object.entries(byOut).sort((a, b) => b[1].length - a[1].length)) {
    const p = v.filter(x => x != null);
    console.log(`       ${k.padEnd(14)} ${String(v.length).padStart(4)}건  평균 ${p.length ? num(p.reduce((s, x) => s + x, 0) / p.length) + '%' : '손익없음'}`);
  }
  for (const m of ['us', 'kr']) {
    const s = withPnl.filter(r => r.market === m);
    if (s.length) console.log(`       [${m}] ${s.length}건 평균 ${num(s.reduce((a, r) => a + r.pnl_pct, 0) / s.length)}%`);
  }
}

console.log('═══ 매수 추천 성과 ═══');
stats('1=1', '전체 (검증 여부 무관 — 종전 통계)');
stats('o.low_seen IS NOT NULL', '검증된 것만 (체결 여부를 OHLC 로 확인)');
const un = db.prepare(`SELECT COUNT(*) c FROM recommendation_outcomes o JOIN recommendations r ON r.id=o.recommendation_id
                       WHERE r.action='buy' AND o.low_seen IS NULL`).get().c;
console.log(`\n  미검증 잔여 ${un}건 (티커가 실존하지 않아 OHLC 조회 불가한 과거분 등)`);
db.close();
