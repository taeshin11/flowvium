/**
 * track-record.mjs — 종목 **자신의** 최근 성적으로 신규 매수를 막는다. (2026-09-26 신설)
 *
 * 근거(전향 평가 실측, 미래 정보 없이 추천일 이전에 결과가 난 것만):
 *   직전 30일 결과 3건+ 중 수익 34% 미만 → 다음 추천 41건 수익 34% · 평균 -1.33% (그 밖 62~67% · +1.7%, z≈-4)
 *   엔진은 종목 자신의 성적을 보지 않았다(214450.KQ 파마리서치 9/1~9/7, 003230.KS 삼양식품 14일 중 1일 수익).
 * 같은 날 여러 보고서의 같은 판단은 **(종목, 추천일) 하나로** 센다. 자세한 근거는 track-record.test.mjs 머리말.
 */
export const TRACK_DAYS = 30;
export const TRACK_MIN_N = 3;
export const TRACK_MAX_WIN = 0.34;

/** @param {{day:string, pnl:number}[]} list 결과가 난 판단들(여러 행 가능) → (날) 단위 요약 */
export function summarizeTrack(list) {
  const byDay = new Map();
  for (const x of list ?? []) if (x?.day && Number.isFinite(x.pnl) && !byDay.has(x.day)) byDay.set(x.day, x.pnl);
  const pnls = [...byDay.values()];
  return { n: pnls.length, wins: pnls.filter((p) => p > 0).length, avg: pnls.length ? pnls.reduce((a, b) => a + b, 0) / pnls.length : null };
}

/** veto 사유(string) 또는 null. 표본이 모자라면 판단하지 않는다. */
export function trackRecordVeto(list) {
  const s = summarizeTrack(list);
  if (s.n < TRACK_MIN_N) return null;
  if (s.wins / s.n >= TRACK_MAX_WIN) return null;
  return `종목 성적 veto: 최근 ${TRACK_DAYS}일 이 종목 판단 ${s.wins}/${s.n} 만 수익(평균 ${s.avg.toFixed(1)}%) — 같은 조건에서 다음 추천도 수익 34%·평균 -1.3% 였다(전향 실측)`;
}

/**
 * DB 에서 종목별 최근 기록을 읽는다 — **지금 이전에 결과가 난** 매수 판단만.
 * @param {import('better-sqlite3').Database} db
 * @returns {Map<string, {day:string, pnl:number}[]>}
 */
export function recentTrackFromDb(db, { days = TRACK_DAYS } = {}) {
  const rows = db.prepare(`
    SELECT r.ticker t, date(r.generated_at) day, o.pnl_pct pnl
      FROM recommendation_outcomes o JOIN recommendations r ON r.id = o.recommendation_id
     WHERE r.action = 'buy' AND o.pnl_pct IS NOT NULL
       AND o.evaluated_at < datetime('now')
       AND date(r.generated_at) >= date('now', ?)
     ORDER BY r.generated_at`).all(`-${days} days`);
  const m = new Map();
  for (const r of rows) { if (!m.has(r.t)) m.set(r.t, []); m.get(r.t).push({ day: r.day, pnl: r.pnl }); }
  return m;
}
