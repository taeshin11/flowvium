/**
 * kst-session.mjs — 지금 라이브에 떠 있어야 할 보고서 회차.
 *
 * 왜 (2026-09-09): check-report-page 가 "로컬 최신 보고서 = 라이브" 를 가정해 매일 밤 거짓 경보를 냈다.
 *   자정 회차는 22:30 에 시작해 23:41 에 끝나지만, API 의 cacheKey 는 **현재 시각으로** 세션을 정한다.
 *   21:30 이후는 evening 이므로 23:41~24:00 사이엔 자정 회차가 아직 안 나가는 것이 정상이다.
 *   그걸 결함으로 찍으면 매일 밤 ❌ 가 뜨고, 진짜 배포 실패가 그 잡음에 묻힌다.
 *
 * 경계는 src/app/api/investment-strategy/route.ts 의 getKstSession 과 **같아야 한다**.
 *   두 곳에 적으면 갈라지므로 kst-session.test.mjs 가 route.ts 를 직접 읽어 대조한다.
 *   (TS 를 .mjs 에서 못 불러 값을 복제할 수밖에 없다면, 최소한 갈라짐은 테스트가 잡게 한다.)
 */

/** 세션이 시작되는 KST 분(minute of day). 이 값 이상이면 그 세션이다. */
export const BOUNDARIES = { morning: 7 * 60, noon: 12 * 60, afternoon: 16 * 60, evening: 21 * 60 + 30 };

export function kstSession(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 3600000);
  const hm = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  if (hm < BOUNDARIES.morning) return 'midnight';
  if (hm < BOUNDARIES.noon) return 'morning';
  if (hm < BOUNDARIES.afternoon) return 'noon';
  if (hm < BOUNDARIES.evening) return 'afternoon';
  return 'evening';
}

export function kstDate(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
}

/** 지금 이 순간 라이브가 서빙해야 할 보고서 id. */
export function expectedReportId(now = new Date(), locale = 'ko') {
  return `${kstDate(now)}:${kstSession(now)}:${locale}`;
}
