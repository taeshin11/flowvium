/**
 * insider-count.mjs — 종목별 내부자 *매수* 건수.
 *
 * 왜(2026-08-22): generate-report-local.mjs:6969 가 이렇게 세고 있었다.
 *     insiderMap: new Map((ctxRaw?.insider ?? []).map(i => [i.ticker, i.filings ?? i.count ?? 1]))
 *   실행 시점 모양(logs/ctx-shapes.json) 기준 insider 원소 키 20종에 filings 도 count 도 없다
 *   (direction·transactionCode·shares·ticker·transactionValueUsd·…).
 *   → 값이 항상 1 → 룰 `micro_insider_buying {filings_gte: 3}` 이 구조적으로 발화 불가였다.
 *   check-rule-firing 이 "배선의심 0-발화" 로 표시하던 것의 정확한 원인이다.
 *   `?? 1` 폴백이 조용히 삼켜 몇 달간 증상이 없었다.
 *
 * 단순히 행 수를 세면 안 된다 — 라이브 피드 실측이 **매도 48 / 매수 1** 이다.
 *   전체를 세면 내부자 *매도* 를 매수 신호로 만든다. 방향을 봐야 한다.
 *   방향 해석은 이미 단일 출처가 있다(insider-direction.mjs) — 새로 구현하지 않는다.
 *   해석 불가는 세지 않는다: 모르는 걸 매수로 치지 않는다.
 */
import { insiderDirection } from './insider-direction.mjs';

/**
 * @param {Array<{ticker?: string, direction?: string}>} items  ctxRaw.insider
 * @returns {Map<string, number>} ticker → 매수 건수
 */
export function buildInsiderBuyMap(items) {
  const m = new Map();
  if (!Array.isArray(items)) return m;
  for (const it of items) {
    const ticker = it?.ticker;
    if (!ticker) continue;
    if (insiderDirection(it) !== 'buy') continue;
    m.set(ticker, (m.get(ticker) ?? 0) + 1);
  }
  return m;
}
