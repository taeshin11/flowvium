/**
 * portfolio-churn.mjs — 회차 사이에 추천 종목이 얼마나 갈아엎히는가.
 *
 * 왜 (2026-09-10): 하루 4~5회차가 각각 다른 포트폴리오를 낸다. 실측 7일 —
 *   직전 회차와 평균 48% 겹치고, 31쌍 중 9건은 25% 이하였다(사실상 전면 교체).
 *   보고서를 따라가는 사람에게 몇 시간마다 목록이 뒤집히는 것은 따라갈 수 없는 신호다.
 *
 * 그런데 **갈아엎는 것 자체가 결함은 아니다** — 새 데이터가 들어오면 판단이 바뀔 수 있다.
 *   무엇이 맞는지는 투자 판단이라 여기서 정하지 않는다. 대신 **보이게** 한다:
 *   얼마나 바뀌는지 모르면 바꿀지 말지도 정할 수 없다.
 *
 * 2026-09-14: 미뤄 뒀던 그 물음에 답을 냈다 — **값을 하는가?**
 *   회차 시각 이후 5거래일 수익률로 넣은 종목·뺀 종목을 같은 회차 안에서 짝지어 비교했다
 *   (analyze-churn-value.mjs, 185쌍·측정 가능 1,971건):
 *       넣은 종목  642건  평균 -1.34%
 *       뺀 종목    644건  평균 -1.48%
 *       유지 종목  685건  평균 -2.20%
 *       넣은 쪽이 이긴 회차 94/185 (Wilson 90% 구간 45~57%) · 평균 차이 -0.04%
 *   **정확히 동전이다.** 갈아엎어서 얻는 것이 없다. 그렇다고 잃는 것도 확인되지 않는다.
 *
 *   그래서 선정 로직을 손대지 않았다. 이득이 없다는 근거로 바꾸는 것은
 *   손해가 없다는 근거로 바꾸는 것과 같고, 둘 다 근거가 아니다.
 *   대신 경보를 낮춘다 — 숫자는 계속 보여주되 "볼 것" 이라고 재촉하지 않는다.
 *   이미 봤고, 답은 "여기서 얻을 게 없다" 다.
 *
 *   딸린 사실 하나: **유지한 종목이 제일 나쁘다(-2.20%).** 오래 들고 있을수록 나빠진다는
 *   뜻이므로, 고칠 데가 있다면 갈아엎기가 아니라 진입·청산 쪽이다
 *   (analyze-exit-quality.mjs 가 같은 방향을 가리킨다 — 손익비 1.13:1 에 승률 37%).
 */

/** 전면 교체로 볼 기준. 자주 울리면 아무도 안 보므로 낮게 잡는다. */
export const CHURN_FLOOR = 0.25;

/** 새 목록 중 이전에도 있던 비율. 어느 한쪽이 비면 null — 0% 라고 단정하지 않는다. */
export function overlapRate(cur, prev) {
  const c = [...new Set(cur ?? [])];
  const p = new Set(prev ?? []);
  if (!c.length || !p.size) return null;
  return c.filter((t) => p.has(t)).length / c.length;
}

/**
 * @param {{id:string, tickers:string[]}[]} sessions 시간 순
 * @returns {{pairs:number, avg:number|null, wiped:{id:string, rate:number}[]}}
 */
export function churnSummary(sessions = []) {
  const rates = [];
  const wiped = [];
  for (let i = 1; i < sessions.length; i++) {
    const r = overlapRate(sessions[i].tickers, sessions[i - 1].tickers);
    if (r == null) continue;
    rates.push(r);
    if (r <= CHURN_FLOOR) wiped.push({ id: sessions[i].id, rate: r });
  }
  return {
    pairs: rates.length,
    avg: rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null,
    wiped,
  };
}
