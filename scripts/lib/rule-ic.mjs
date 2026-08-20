/**
 * rule-ic.mjs — 룰별 정보계수(IC)를 실측 성과에서 유도한다.
 *
 * 왜: 선정이 '총점 합산 순위'인데 총점↔초과수익 상관이 r=0.333 으로 약하다(2026-08-20 실측).
 *   룰별 초과수익은 +8.32%p ~ -4.10%p 로 크게 갈리는데 점수는 그 차이를 반영하지 않아,
 *   약한 룰 여러 개가 강한 룰 하나를 이긴다(신호 희석). 선행연구의 표준 처방이 IC 가중이다.
 *
 * 설계:
 *   · 강한 룰 목록을 코드에 박지 않는다. recommendation_outcomes 에서 매번 유도한다.
 *   · 표본(minSample) 미만이면 아예 제외한다 — 근거 없이 가중하지 않는다.
 *   · 초과수익이 음수인 룰은 가중을 0 이하로 둔다. 점수를 더해주면 안 된다.
 *   · 라벨 왜곡을 피하려 realized-pnl.mjs 로 다시 계산한다.
 *   · 이것은 '관측'이다. 선정에 바로 쓰지 않고 shadow 로 먼저 성적을 쌓는다
 *     (이 시스템의 승격 기준: n≥30 + edge 확인 후 live).
 */
import Database from 'better-sqlite3';
import { realizedPnlPct } from './realized-pnl.mjs';

const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;

export function deriveRuleIC({ dbPath = 'data/flowvium.db', minSample = 20, sinceDays = 365 } = {}) {
  let db;
  try { db = new Database(dbPath, { readonly: true }); } catch { return []; }
  const since = new Date(Date.now() - sinceDays * 864e5).toISOString();
  let rows;
  try {
    rows = db.prepare(`
      SELECT bc.matched_rules, o.outcome, o.price_at_eval, o.spy_return,
             r.entry_low, r.price_at_gen, r.target, r.stop_loss
      FROM buy_candidates bc
      JOIN recommendations r ON r.ticker = bc.ticker AND r.report_id = bc.report_id
      JOIN recommendation_outcomes o ON o.recommendation_id = r.id
      WHERE r.action != 'watch' AND r.generated_at >= ?`).all(since);
  } catch { return []; }

  const byRule = new Map();
  for (const r of rows) {
    const pnl = realizedPnlPct({
      outcome: r.outcome, entry: r.entry_low ?? r.price_at_gen,
      stop: r.stop_loss, target: r.target, lastClose: r.price_at_eval,
    });
    if (pnl == null) continue;
    const ex = r.spy_return != null ? pnl - r.spy_return : null;
    if (ex == null) continue;
    let ids = [];
    try { ids = [...new Set(JSON.parse(r.matched_rules || '[]').map(m => m.ruleId ?? m))]; } catch { continue; }
    for (const id of ids) {
      if (!byRule.has(id)) byRule.set(id, []);
      byRule.get(id).push({ pnl, ex });
    }
  }

  const raw = [...byRule.entries()]
    .filter(([, v]) => v.length >= minSample)
    .map(([id, v]) => ({
      id, n: v.length,
      excess: +avg(v.map(x => x.ex)).toFixed(3),
      pnl: +avg(v.map(x => x.pnl)).toFixed(3),
      win: +(v.filter(x => x.pnl > 0).length / v.length).toFixed(3),
    }));
  if (!raw.length) return [];

  // 가중 = 초과수익을 최대 절대값으로 정규화. 음수는 그대로 음수로 남긴다(감점).
  //   표본이 작을수록 축소한다(shrinkage) — n 이 minSample 이면 절반, 커질수록 1 에 수렴.
  const maxAbs = Math.max(...raw.map(x => Math.abs(x.excess))) || 1;
  return raw.map(x => ({
    ...x,
    shrink: +(x.n / (x.n + minSample)).toFixed(3),
    weight: +((x.excess / maxAbs) * (x.n / (x.n + minSample))).toFixed(4),
  })).sort((a, b) => b.weight - a.weight);
}

/** 발화한 룰 목록 → IC 가중 점수. 가중이 없는(표본 미달) 룰은 기여 0 — 모르는 것을 점수화하지 않는다. */
export function icWeightedScore(ruleIds, icTable) {
  const w = new Map(icTable.map(x => [x.id, x.weight]));
  return [...new Set(ruleIds)].reduce((s, id) => s + (w.get(id) ?? 0), 0);
}

export function formatICTable(ic) {
  if (!ic.length) return '(표본 부족 — IC 미산출)';
  return ic.map(x => `${x.id.padEnd(30)} n=${String(x.n).padStart(3)} 초과 ${(x.excess >= 0 ? '+' : '') + x.excess.toFixed(2)}%p 승률 ${Math.round(x.win * 100)}% → w=${x.weight.toFixed(3)}`).join('\n');
}
