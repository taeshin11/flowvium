/**
 * prior-macro-state.mjs — 직전 회차의 거시·섹터·지역 스탠스를 매수 후보 단계에 넘긴다.
 *
 * 왜 (2026-09-10, 사용자 승인):
 *   매수 후보 점수(Stage 1)는 거시·포트폴리오·지역 분석(Wave 1)보다 **먼저** 돈다.
 *   그래서 buyMacroCtx 의 riskLevel·sectorStanceMap·regionStanceMap 이 항상 비어 있었고,
 *   이를 쓰는 룰 5개가 개통 이래 한 번도 발화하지 못했다 —
 *     rotation_sector_in · rotation_defensive · macro_low_risk
 *     micro_sector_overweight · micro_region_bullish   (점수 비중 19/293 = 6.5%)
 *   2026-08-22 에 발견됐지만 "순서를 바꾸는 건 투자 로직 결정" 이라 경고만 띄운 채 19일이 흘렀다.
 *
 * 왜 순서를 안 바꾸고 직전 값을 쓰나: 순서를 바꾸면 후보 선정 자체가 달라져 추천이 흔들린다.
 *   반면 리스크 레벨·섹터/지역 스탠스는 한 회차(3~5시간) 사이에 잘 뒤집히지 않는다.
 *   같은 날의 직전 판단을 쓰는 것은 "어제 판단으로 오늘 고르기" 와 다르다.
 *
 * 무엇을 지키나: **지금 값인 척하지 않는다.** 어느 회차의 몇 시간 된 값인지 근거에 적는다.
 *   그리고 오래된 값은 쓰지 않는다 — 며칠 전 리스크 레벨로 오늘 종목을 고르면 근거가 아니라 잡음이다.
 */

/** 이 시간을 넘으면 쓰지 않는다. 회차 간격(3~5시간)의 두 배쯤 — 한 회차를 걸러도 살아남되 하루는 못 넘긴다. */
import { canonSector } from './sector-canon.mjs';

export const MAX_AGE_H = 10;

/** reports 행 하나에서 거시 상태를 뽑는다. 없거나 깨졌으면 null — 지어내지 않는다. */
export function fromReport(row) {
  if (!row?.full_json) return null;
  let j;
  try { j = JSON.parse(row.full_json); } catch { return null; }

  // 2026-09-10: 그냥 소문자로 맞추면 **14개 중 1개만 일치**했다 — 보고서는 GICS 계열,
  //   종목 메타는 야후 계열에 슬러그·한글까지 섞여 있다. 정규 이름으로 모은다.
  const sectorStanceMap = new Map(
    (j.sectorAllocation ?? [])
      .filter((s) => s?.sector && s?.stance)
      .map((s) => [canonSector(s.sector), s.stance])
      .filter(([k]) => k),
  );
  // 매수 ctx 는 시장을 'kr' / 'us' 로 쓴다. 보고서는 'korea' 로 적는다 — 여기서 맞춘다.
  const regionStanceMap = new Map(
    Object.entries(j.regionStances ?? {})
      .filter(([, v]) => v?.stance)
      .map(([k, v]) => [k === 'korea' ? 'kr' : k, v.stance]),
  );

  const ageHours = (Date.now() - Date.parse(row.generated_at)) / 3600000;
  return {
    riskLevel: j.riskLevel ?? null,
    sectorStanceMap,
    regionStanceMap,
    ageHours,
    reportId: row.id,
    provenance: `직전 회차 ${row.id} (${ageHours.toFixed(1)}시간 전)`,
  };
}

/** 너무 오래되지 않았는가. */
export function isFresh(state) {
  return !!state && Number.isFinite(state.ageHours) && state.ageHours <= MAX_AGE_H;
}

/** DB 에서 직전 회차를 읽어 상태로 만든다. 쓸 수 없으면 null. */
export function loadPriorMacroState(db, { locale = 'ko' } = {}) {
  const row = db.prepare(
    `SELECT id, generated_at, full_json FROM reports
      WHERE id LIKE ? ORDER BY generated_at DESC LIMIT 1`,
  ).get(`%:${locale}`);
  const s = fromReport(row);
  return isFresh(s) ? s : null;
}
