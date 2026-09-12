/**
 * edge-significance.mjs — 이긴 비율이 동전 던지기와 구별되는가. (2026-09-12 신설)
 *
 * 왜 필요한가: 룰 점수 자동튜닝의 관문이 `n >= 5` 라는 **개수**뿐이었다.
 *   6번 중 5번 이긴 룰과 70번 중 58번 이긴 룰이 같은 대접을 받는다.
 *   앞의 것은 공정한 동전으로도 11% 확률로 나온다.
 *
 *   문턱 숫자를 손으로 올리는 것(5 → 20 → 30 …)은 또 하나의 감이고 곧 낡는다.
 *   대신 **표본 크기와 치우침을 같이 보는** 이항비율 구간을 쓴다.
 *   Wilson 점수구간은 정규근사(Wald)와 달리 n 이 작거나 비율이 0/1 에 붙어도
 *   구간이 무너지지 않는다 — 여기 표본이 딱 그렇다.
 *
 * 한쪽 90% 경계를 쓴다. 틀려도 주 1회 재튜닝에서 되돌아오므로 95% 까지 조일 이유가 없고,
 * 반대로 80% 면 n=6 짜리가 통과한다(실측으로 확인).
 */

/** 한쪽 90% — 정규분포 상위 10% 지점. */
const Z = 1.6449;

/** 이항비율 Wilson 점수구간 [lo, hi]. n=0 이면 null. */
export function wilsonInterval(wins, n, z = Z) {
  if (!(n > 0) || !(wins >= 0) || wins > n) return null;
  const p = wins / n;
  const z2n = z * z / n;
  const center = (p + z2n / 2) / (1 + z2n);
  const margin = (z / (1 + z2n)) * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [center - margin, center + margin];
}

function counts(e) {
  const wins = Number(e?.wins ?? 0);
  const losses = Number(e?.losses ?? 0);
  return { wins, n: wins + losses };
}

/**
 * 동전(0.5)과 구별되는가 — 구간이 0.5 를 아예 넘거나 아예 밑돌 때만 true.
 * 표본이 없으면 false. "모름" 을 "아니다" 로 쓰지 않게, 판정 근거는 direction() 과 함께 본다.
 */
export function isDecisive(e, z = Z) {
  const { wins, n } = counts(e);
  const ci = wilsonInterval(wins, n, z);
  if (!ci) return false;
  return ci[0] > 0.5 || ci[1] < 0.5;
}

/** +1 = 유의하게 좋다, -1 = 유의하게 나쁘다, 0 = 판정 없음. */
export function direction(e, z = Z) {
  const { wins, n } = counts(e);
  const ci = wilsonInterval(wins, n, z);
  if (!ci) return 0;
  if (ci[0] > 0.5) return 1;
  if (ci[1] < 0.5) return -1;
  return 0;
}

/** 로그용 한 줄 — 왜 통과/보류인지 사람이 읽게. */
export function describe(e, z = Z) {
  const { wins, n } = counts(e);
  const ci = wilsonInterval(wins, n, z);
  if (!ci) return '표본 0';
  return `${wins}/${n} (90% 구간 ${(ci[0] * 100).toFixed(0)}~${(ci[1] * 100).toFixed(0)}%)`;
}
