// series-ab.mjs — 11/24 변경(㉠ 시리즈 표지 + ㉡ 첫 훅을 시청자 돈 영향으로)을 번갈아 잰다(2026-11-27 mini2).
//   48h 재측정에서 A 9편이 거의 11/24 하루치라 날 효과와 못 갈랐다(3일 조회 중앙값 0.26배, 구독/1천 상승은 3-AI 3/3 우연).
//   뉴스 쇼츠(video-publish → make-shorts)만 번갈아 — 예비·상시 편은 미리 만들어 둬서 갈래가 없다(arm 비움, 재기에서 뺀다).
//   11/30 KST 끝까지. 결정 전까지는 지금 모습(A). 11/30 에 3일 조회 중앙값 먼저, 구독/1천 다음 — A 가 B 의 0.6배 미만이면 B 로 되돌린다.
export const AB_UNTIL = '2026-11-30T15:00:00Z';
export function seriesArm({ lastArm = null, now = Date.now() } = {}) {
  if (now >= Date.parse(AB_UNTIL)) return 'A';
  return lastArm === 'A' ? 'B' : 'A';
}
export function armEnv(arm) {
  const on = arm === 'B' ? '0' : '1';
  return { SHORTS_ARM: arm, SHORTS_SERIES: on, SHORTS_STAKE: on };
}
