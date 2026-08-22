/**
 * outcome-comparability.mjs — 결과 행이 집계에 섞여도 되는가.
 *
 * 왜(2026-08-22): 오늘 성과를 세 번 잘못 읽었고 매번 원인이 같았다 —
 *   저장된 진입가가 관측 가격대와 **배수로** 어긋난 행이 누적 통계에 섞여 있었다.
 *     QQQ entry 180~185 vs 관측 677~714 · SPY 430~440 vs 721~740 · TSM 55~57 vs 392~420
 *   그런 행으로 "진입 못 했다" 를 세면 진입 캘리브레이션 문제로 오해한다.
 *
 * 날짜로 자르지 않는다. "언제 이전은 레거시" 는 손으로 정한 경계이고 곧 낡는다.
 *   행 자체에서 판정한다. 실측 분포(1,204행)가 이중이라 경계가 자의적이지 않다:
 *     entry_high / low_seen  →  0.9~1.1 구간에 1,017행(84%) · 극단(<0.5, >=2)은 38행
 *   0.5~2.0 은 "관측 가격대와 같은 자릿수" 라는 뜻이다. 진입가가 저가보다 몇 % 낮은 것은
 *   **정상적인 미체결**이므로 걸러내면 안 된다 — 진짜 신호를 잃는다.
 *
 * 근거가 없으면(진입가·관측저가 결측) 배제하지 않는다. 모르는 걸 오염으로 단정하지 않는다.
 */

/**
 * 진입가가 생성 시점 가격과 얼마나 떨어져도 정상으로 볼지. 실측에서 유도한다 —
 *   entry_high / price_at_gen 분포(1,080행): 0.95~1.05 에 1,029행(95%), 0.8 미만 0건.
 *   진입가는 생성가 근처에 잡히도록 설계돼 있으므로(ENTRY_CALIBRATION) 이 범위를
 *   크게 벗어난 값은 저장 오류다.
 */
const MIN_RATIO = 0.5;
const MAX_RATIO = 2.0;

/**
 * 집계에 포함해도 되는가.
 *
 * 기준은 **생성 시점 가격(price_at_gen)이 기록돼 있는가** 다. 없으면 진입가를 무엇과도
 *   비교할 수 없어 "진입 못 했다" 가 캘리브레이션 문제인지 저장 오류인지 구분이 안 된다.
 *   실측: 결측 261행은 **전부 2026-05** 이고, QQQ(entry 185 vs 관측 677)·SPY(440 vs 721)·
 *   TSM(57 vs 392) 같은 오염 사례가 모두 여기 속한다. 날짜를 박지 않아도 스키마 사실 하나로
 *   갈린다 — 그 시기 이후로는 항상 기록되므로 경계가 저절로 따라온다.
 *
 * 기록돼 있으면 비율로 한 번 더 본다(저장 오류 방어). 진입가가 생성가보다 몇 % 낮은 것은
 *   **정상적인 미체결**이므로 걸러내면 안 된다 — 진짜 신호를 잃는다.
 *
 * @param {{price_at_gen?: number, entry_high?: number}} row
 * @returns {boolean}
 */
export function isComparable(row) {
  const gen = Number(row?.price_at_gen);
  if (!Number.isFinite(gen) || gen <= 0) return false;   // 비교 기준 자체가 없다
  const entry = Number(row?.entry_high);
  if (!Number.isFinite(entry) || entry <= 0) return true; // 진입가 결측은 다른 문제 — 여기서 판정 안 함
  const ratio = entry / gen;
  return ratio >= MIN_RATIO && ratio < MAX_RATIO;
}

/** 집계용 필터. 배제된 행 수를 함께 돌려준다 — 조용히 버리지 않는다. */
export function splitComparable(rows) {
  const keep = [], dropped = [];
  for (const r of rows ?? []) (isComparable(r) ? keep : dropped).push(r);
  return { keep, dropped };
}
