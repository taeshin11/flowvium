/**
 * squeeze-staleness.mjs — 숏스퀴즈 목록에 **너무 오래 눌러앉은 종목**을 뺀다. (2026-09-18)
 *
 * 왜 (실측): 5/5~9/17 기록 895건을 등재 시점별로 갈라 이후 20거래일을 재니 —
 *     첫 등재        n= 41  지수 대비 +27.3%p  이긴비율 85%
 *     재등재 1~7일차  n= 66          +4.6%p        52%
 *     재등재 8~30일   n=224          +5.3%p        53%
 *     재등재 30일 초과 n=212         **-11.0%p**    **11%**
 *   같은 종목이 매일 다시 실린다(COIN 226회·MRNA 186회). 오래 눌러앉은 등재가 성과를 깎는다.
 *   "스퀴즈 임박" 은 며칠짜리 주장인데 두 달째 같은 말을 하고 있으면 그건 예측이 아니다.
 *
 * 규칙: **연속 등재 기간**(중간에 gapDays 이상 빠진 적이 없는 구간)이 maxStreakDays 를 넘으면 뺀다.
 *   중간에 빠졌다가 다시 잡히면 새 구간으로 본다 — 조건이 다시 성립한 것이므로 새 주장이다.
 *   날짜 기록이 없으면 빼지 않는다(모르면 건드리지 않는다).
 */
export const MAX_STREAK_DAYS = Number(process.env.SQUEEZE_MAX_STREAK_DAYS ?? 30);
// 2026-09-18 사용자 "그럼 첫등재만 넣지?" — 실측이 그쪽을 가리킨다:
//   첫 등재 +27.3%p(85%) · 1~7일차 +4.6%p(52%) · 8~30일 +5.3%p(53%) · 30일 초과 -11.0%p(11%).
//   첫날만 남긴다. 대가로 새 종목이 없는 회차에는 이 항목이 빈다 — 없는 주장을 만들어 내는 것보다 낫다.
export const FRESH_DAYS = Number(process.env.SQUEEZE_FRESH_DAYS ?? 1);
export const STREAK_GAP_DAYS = Number(process.env.SQUEEZE_STREAK_GAP_DAYS ?? 7);

/** 등재 날짜들(ms 오름차순)에서 now 기준 **현재 연속 구간의 시작**. 없으면 null. */
export function streakStart(datesMs, nowMs, gapDays = STREAK_GAP_DAYS) {
  const d = [...(datesMs ?? [])].filter((x) => Number.isFinite(x) && x <= nowMs).sort((a, b) => a - b);
  if (!d.length) return null;
  const gap = gapDays * 86400000;
  if (nowMs - d[d.length - 1] > gap) return null;      // 최근에 빠져 있었다 → 이번이 새 시작
  let start = d[d.length - 1];
  for (let i = d.length - 1; i > 0; i--) {
    if (d[i] - d[i - 1] > gap) break;
    start = d[i - 1];
  }
  return start;
}

/** 연속 등재가 며칠째인가. 기록이 없으면 null. */
export function streakDays(datesMs, nowMs, gapDays = STREAK_GAP_DAYS) {
  const s = streakStart(datesMs, nowMs, gapDays);
  return s == null ? null : (nowMs - s) / 86400000;
}

/**
 * 첫 등재(또는 오래 빠졌다 다시 잡힌 첫날)만 남긴다.
 * 기록이 없으면 새 종목이므로 남긴다 — 모르면 빼지 않는다.
 */
export function keepFreshOnly(entries, historyOf, { nowMs = Date.now(), maxAgeDays = FRESH_DAYS, gapDays = STREAK_GAP_DAYS } = {}) {
  const kept = []; const dropped = [];
  for (const e of entries ?? []) {
    const days = streakDays(historyOf(e?.ticker) ?? [], nowMs, gapDays);
    if (days == null || days <= maxAgeDays) kept.push(e);
    else dropped.push({ ticker: e.ticker, days: Math.round(days) });
  }
  return { kept, dropped };
}

/**
 * @param {Array<{ticker:string}>} entries  이번 회차 숏스퀴즈 후보
 * @param {(ticker:string)=>number[]} historyOf  종목의 과거 등재 시각(ms) 목록
 * @returns {{kept:Array, dropped:Array<{ticker:string, days:number}>}}
 */
export function dropStaleSqueeze(entries, historyOf, { nowMs = Date.now(), maxStreakDays = MAX_STREAK_DAYS, gapDays = STREAK_GAP_DAYS } = {}) {
  const kept = []; const dropped = [];
  for (const e of entries ?? []) {
    const days = streakDays(historyOf(e?.ticker) ?? [], nowMs, gapDays);
    if (days != null && days > maxStreakDays) dropped.push({ ticker: e.ticker, days: Math.round(days) });
    else kept.push(e);
  }
  return { kept, dropped };
}
