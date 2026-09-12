/**
 * buy-alpha.mjs — 매수 추천이 SPY 를 이기고 있나, 최근에도 그런가. (2026-09-12 신설)
 *
 * 왜 필요한가: 이 숫자를 내는 check-prospective-gaps.mjs 는 **크론에 없다.**
 *   사람이 손으로 부를 때만 돈다. 그래서 알파가 -2.17% 로 잘못 읽히던 3개월 동안
 *   아무도 그걸 몰랐다(원인은 벤치마크·분모 두 곳의 측정 결함이었다).
 *   재는데 보지 않으면 재지 않는 것과 같다 — check-stall.mjs 가 스스로 적어 둔 말이다.
 *
 * 파일로 내보내고 크론을 하나 더 거는 대신 **감시가 DB 를 직접 읽는다.**
 *   중간 파일이 없으면 그 파일이 낡을 일도 없다.
 *
 * 판정: 이겼다/졌다를 평균만으로 말하지 않는다. SPY 를 이긴 비율이 동전과 구별되는지
 *   같이 본다(edge-significance) — n 이 적으면 "아직 모른다" 로 남긴다.
 */
import { openDb } from './db.mjs';
import { REALIZED, sqlIn } from './outcome-classes.mjs';
import { direction, describe } from './edge-significance.mjs';

/**
 * @param {{ days?: number, db?: any }} opt  days = 최근 몇 일치 *평가* 를 볼 것인가
 * @returns {{ window: object, prior: object, verdict: 'ahead'|'behind'|'unknown', line: string }}
 */
export function buyAlpha({ days = 30, db = openDb() } = {}) {
  const q = (since, until) => db.prepare(`
    SELECT COUNT(*) n,
           ROUND(AVG(o.pnl_pct), 2)                  pnl,
           ROUND(AVG(o.spy_return), 2)               spy,
           ROUND(AVG(o.pnl_pct - o.spy_return), 2)   alpha,
           SUM(CASE WHEN o.pnl_pct > o.spy_return THEN 1 ELSE 0 END) beat,
           SUM(CASE WHEN o.pnl_pct < o.spy_return THEN 1 ELSE 0 END) lose
    FROM recommendation_outcomes o
    JOIN recommendations r ON r.id = o.recommendation_id
    WHERE r.action = 'buy' AND o.outcome ${sqlIn(REALIZED)}
      AND o.spy_return IS NOT NULL AND o.pnl_pct IS NOT NULL
      AND datetime(o.evaluated_at) >= datetime('now', ?)
      ${until ? "AND datetime(o.evaluated_at) < datetime('now', ?)" : ''}
  `).get(...(until ? [since, until] : [since]));

  // 평균이 마이너스인데 이긴 건이 더 많을 때, 그게 소수의 큰 손실 때문인지 세어 둔다.
  //   말로 짐작하지 않고 기여분을 잰다 — 실측(2026-09-12): 424건 중 -10%p 밑 29건이
  //   전체 결손 -360%p 중 -325%p(90%)를 만들었다.
  const tail = (since) => db.prepare(`
    SELECT COUNT(*) n, ROUND(SUM(o.pnl_pct - o.spy_return), 0) sum
    FROM recommendation_outcomes o
    JOIN recommendations r ON r.id = o.recommendation_id
    WHERE r.action = 'buy' AND o.outcome ${sqlIn(REALIZED)}
      AND o.spy_return IS NOT NULL AND o.pnl_pct IS NOT NULL
      AND (o.pnl_pct - o.spy_return) < -10
      AND datetime(o.evaluated_at) >= datetime('now', ?)
  `).get(since);

  const window = q(`-${days} days`, null);
  const prior  = q(`-${days * 2} days`, `-${days} days`);

  const dir = direction({ wins: window.beat, losses: window.lose });
  const verdict = dir > 0 ? 'ahead' : dir < 0 ? 'behind' : 'unknown';

  const trend = (prior.n > 0 && window.alpha != null && prior.alpha != null)
    ? ` (직전 ${days}일 ${prior.alpha > 0 ? '+' : ''}${prior.alpha}%p)` : '';
  // 결손의 몇 %가 꼬리 몇 건에서 나왔나 — "큰 손실 몇 건 탓" 을 짐작 대신 숫자로.
  const t = window.n > 0 ? tail(`-${days} days`) : { n: 0, sum: 0 };
  const deficit = window.n > 0 && window.alpha < 0 ? window.alpha * window.n : 0;
  const tailShare = deficit < 0 && t.sum < 0 ? Math.min(100, Math.round(t.sum / deficit * 100)) : null;

  const line = window.n === 0
    ? `최근 ${days}일 평가된 실현 건 없음`
    : `최근 ${days}일 알파 ${window.alpha > 0 ? '+' : ''}${window.alpha}%p · SPY 승 ${describe({ wins: window.beat, losses: window.lose })}${trend}`;

  return { window, prior, verdict, line, days, tail: { ...t, share: tailShare } };
}
