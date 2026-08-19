/**
 * market-lessons.mjs — 이 시스템이 자기 실측에서 배운 것을 DB 에서 유도한다.
 *
 * 왜 필요한가: 지식층(judgment-doctrine / investor-wisdom → RAG)은 구루의 시대불변 원칙이고,
 *   프롬프트 주입 루프(F22 성과통계 · F26 환각 · F19 품질)는 종목·품질 차원뿐이다.
 *   "이 시장이 우리 룰에 어떻게 작동했는가"라는 구조 차원의 학습 자리가 비어 있었다.
 *
 * 설계 원칙:
 *   · 값을 파일에 적어두지 않는다. 매번 recommendation_outcomes 에서 유도한다.
 *     (손으로 적으면 다음 달에 틀린 값이 남는다.)
 *   · 표본이 minSample 미만이면 교훈을 만들지 않는다. 근거 없이 단정하지 않는다.
 *   · 모든 교훈에 표본수(sample)와 근거(evidence)를 붙인다. 프롬프트가 그대로 인용할 수 있게.
 *   · 라벨 왜곡을 피하려고 실현손익(realized-pnl.mjs)으로 다시 계산한다.
 */
import Database from 'better-sqlite3';
import { realizedPnlPct } from './realized-pnl.mjs';

const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const pct = x => `${x >= 0 ? '+' : ''}${x.toFixed(2)}%`;

export function deriveLessons({ dbPath = 'data/flowvium.db', minSample = 10, sinceDays = 180 } = {}) {
  let db;
  try { db = new Database(dbPath, { readonly: true }); } catch { return []; }
  const since = new Date(Date.now() - sinceDays * 864e5).toISOString();
  let rows;
  try {
    rows = db.prepare(`
      SELECT o.outcome, o.spy_return, o.price_at_eval,
             r.market, r.confidence, r.entry_low, r.price_at_gen, r.target, r.stop_loss
      FROM recommendation_outcomes o JOIN recommendations r ON r.id = o.recommendation_id
      WHERE o.evaluated_at >= ? AND r.action != 'watch'`).all(since);
  } catch { return []; }
  const withPnl = rows.map(r => ({
    ...r,
    pnl: realizedPnlPct({ outcome: r.outcome, entry: r.entry_low ?? r.price_at_gen, stop: r.stop_loss, target: r.target, lastClose: r.price_at_eval }),
  })).filter(r => r.pnl != null);

  const out = [];
  const group = (key, val) => withPnl.filter(r => r[key] === val);

  // ① 시장별 성적 — 어느 시장이 우리 룰에 맞았는가
  const markets = [...new Set(withPnl.map(r => r.market))].filter(Boolean);
  const perMarket = markets.map(m => {
    const v = group('market', m);
    return { m, n: v.length, pnl: avg(v.map(x => x.pnl)), spy: avg(v.map(x => x.spy_return).filter(x => x != null)),
             win: v.filter(x => x.pnl > 0).length / (v.length || 1) };
  }).filter(x => x.n >= minSample);
  for (const x of perMarket) {
    const ex = x.spy != null ? x.pnl - x.spy : null;
    out.push({
      id: `market_${x.m}`,
      sample: x.n,
      lesson: `${x.m.toUpperCase()} 추천 실적: 평균 ${pct(x.pnl)}, 승률 ${Math.round(x.win * 100)}%` +
              (ex != null ? `, 벤치마크 대비 ${pct(ex)}p` : ''),
      evidence: `recommendation_outcomes n=${x.n} (최근 ${sinceDays}일, 실현손익 기준)`,
      severity: ex != null && ex < -3 ? 'high' : ex != null && ex < 0 ? 'medium' : 'info',
    });
  }
  // ①-b 시장 간 격차가 크면 별도 경고 — 배분 결정에 직접 쓰인다
  if (perMarket.length >= 2) {
    const s = [...perMarket].sort((a, b) => b.pnl - a.pnl);
    const gap = s[0].pnl - s.at(-1).pnl;
    if (gap >= 5) out.push({
      id: `market_gap_${s[0].m}_vs_${s.at(-1).m}`,
      sample: s[0].n + s.at(-1).n,
      lesson: `시장 간 실적 격차 ${gap.toFixed(1)}%p — ${s[0].m.toUpperCase()} ${pct(s[0].pnl)} vs ${s.at(-1).m.toUpperCase()} ${pct(s.at(-1).pnl)}. 열위 시장은 고확신 후보만 담고 슬롯을 강제 배분하지 말 것`,
      evidence: `${s[0].m} n=${s[0].n}, ${s.at(-1).m} n=${s.at(-1).n}`,
      severity: 'high',
    });
  }

  // ② 확신도가 실제로 예측력이 있는가 — 역전이면 확신도 산출을 믿지 말라는 신호
  const confs = ['high', 'medium', 'low'].map(c => {
    const v = group('confidence', c);
    return { c, n: v.length, pnl: avg(v.map(x => x.pnl)), win: v.filter(x => x.pnl > 0).length / (v.length || 1) };
  }).filter(x => x.n >= minSample);
  const hi = confs.find(x => x.c === 'high'), mid = confs.find(x => x.c === 'medium');
  if (hi && mid && hi.pnl < mid.pnl) out.push({
    id: 'confidence_inversion',
    sample: hi.n + mid.n,
    lesson: `확신도 역전: high ${pct(hi.pnl)}(승률 ${Math.round(hi.win*100)}%, n=${hi.n}) < medium ${pct(mid.pnl)}(승률 ${Math.round(mid.win*100)}%, n=${mid.n}). 확신도 라벨을 비중 결정 근거로 쓰지 말 것`,
    evidence: `high n=${hi.n}, medium n=${mid.n} (실현손익)`,
    severity: 'high',
  });

  // ③ 손절이 목표보다 훨씬 자주 걸리면 손절폭이 노이즈 안에 있다는 신호
  for (const m of markets) {
    const v = group('market', m);
    if (v.length < minSample) continue;
    const st = v.filter(x => x.outcome === 'stop_loss').length, ht = v.filter(x => x.outcome === 'hit_target').length;
    if (st >= 3 && st >= ht * 3) out.push({
      id: `stop_noise_${m}`,
      sample: v.length,
      lesson: `${m.toUpperCase()} 손절 ${st}건 vs 목표 ${ht}건 — 손절폭이 이 시장의 장중 변동폭 안에 있을 가능성. 손절은 ATR(장중 범위) 기준으로 잡고, 필요 폭이 상한을 넘으면 진입을 보류할 것`,
      evidence: `stop_loss=${st}, hit_target=${ht}, n=${v.length}`,
      severity: 'high',
    });
  }
  return out;
}

/** 프롬프트 주입용 텍스트. 근거 없는 문장을 만들지 않는다 — 표본수를 함께 싣는다. */
export function formatForPrompt(lessons) {
  if (!lessons?.length) return '';
  const order = { high: 0, medium: 1, info: 2 };
  const sorted = [...lessons].sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
  return '[실측 학습 — 이 시스템 자신의 추천 성과에서 유도. 일반론이 아니라 우리 데이터다]\n' +
    sorted.map(l => `- (${l.severity}, n=${l.sample}) ${l.lesson}`).join('\n');
}
