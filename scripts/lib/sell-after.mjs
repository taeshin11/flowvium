/**
 * sell-after.mjs — 매도엔진이 판 뒤 주가가 어떻게 갔나. **너무 빨리 팔았나**를 잰다. (2026-09-25 신설)
 *
 * 사장님 "우리가 놓친 요소가 없는지 항상 확인해야되. 너무 빨리 팔지는 않았는지도".
 * analyze-exit-quality 는 손절·목표 청산만 일봉으로 다시 판정했다. 최근 30일 청산 622건 중
 * **331건이 매도엔진 신호로 판 것**이었는데 이건 한 번도 사후 평가하지 않았다 — 놓친 요소 그 자체였다.
 *
 * 판정(판 값 대비 이후 N거래일 종가):
 *   +5% 넘게 올랐다  → early (더 들고 있었어야)
 *   -5% 넘게 내렸다  → right (판 게 맞았다)
 *   그 사이           → flat  (차이 없음 — 판단 보류)
 * 5% 는 한 달 치 보통 흔들림을 넘는 폭으로 잡았다. 판정이 아니라 **규칙끼리 비교**하는 잣대다.
 * 5거래일이 안 지난 건은 판정하지 않는다 — 모르는 것을 '맞았다' 로 세지 않는다.
 */

const BAND = 5;
const MIN_DAYS = 5;

/**
 * @param {{exitPrice:number, after:{days:number,high:number,low:number,last:number}|null}} s
 * @returns {{lastPct:number, highPct:number, days:number, verdict:'early'|'right'|'flat'}|null}
 */
export function judgeSale({ exitPrice, after }) {
  if (!(exitPrice > 0) || !after || !(after.days >= MIN_DAYS)) return null;
  const lastPct = (after.last / exitPrice - 1) * 100;
  const highPct = (after.high / exitPrice - 1) * 100;
  const verdict = lastPct > BAND ? 'early' : lastPct < -BAND ? 'right' : 'flat';
  return { lastPct, highPct, days: after.days, verdict };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * 규칙(sellType)별 요약. **성급한 비율이 높은 규칙부터** 정렬한다 — 고칠 곳이 위에 온다.
 * @param {{sellType:string, exitPrice:number, after:any}[]} rows
 */
export function summarizeSales(rows) {
  const judged = rows.map((r) => ({ ...r, j: judgeSale(r) })).filter((r) => r.j);
  const group = (list) => ({
    n: list.length,
    early: list.filter((r) => r.j.verdict === 'early').length,
    right: list.filter((r) => r.j.verdict === 'right').length,
    flat: list.filter((r) => r.j.verdict === 'flat').length,
    medianLastPct: median(list.map((r) => r.j.lastPct)),
    medianHighPct: median(list.map((r) => r.j.highPct)),
  });
  const types = [...new Set(judged.map((r) => r.sellType ?? '(모름)'))];
  const byType = types.map((t) => ({ sellType: t, ...group(judged.filter((r) => (r.sellType ?? '(모름)') === t)) }))
    .sort((a, b) => b.early / b.n - a.early / a.n || b.n - a.n);
  return { ...group(judged), byType };
}

/**
 * 매도 평가의 잣대(evaluate-sell-outcomes 가 2026-06-12 부터 쓰던 것 그대로). 튜닝 입력이다.
 *   -3% 이하 → good_call(판 게 맞았다) · +5% 이상 → missed_upside(놓친 상승) · 그 사이 → neutral
 */
export function classifySellDelta(delta) {
  return delta <= -3 ? 'good_call' : delta >= 5 ? 'missed_upside' : 'neutral';
}

/**
 * 판 뒤 n번째 거래일 종가의 변화율(%). 거래일이 모자라면 null — 모르는 것을 판정하지 않는다.
 * (2026-09-25: 평가가 판 뒤 5~6일에 한 번만 매겨져, 한 달 안에 오른 매도를 절반쯤 놓쳤다.)
 * @param {{close:number}[]} path 판 다음 거래일부터의 일봉
 */
export function deltaAtDay(path, sellPrice, n = 20) {
  if (!(sellPrice > 0) || !Array.isArray(path) || path.length < n) return null;
  const c = path[n - 1]?.close;
  return c > 0 ? (c / sellPrice - 1) * 100 : null;
}
