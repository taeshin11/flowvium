/**
 * Single source of truth for time-frame related constants.
 *
 * 배경 (2026-05-10): 1주 탭에서 "3주 전 시작" 라벨이 표시되는 버그가 발생.
 * 원인은 `rotations1w` 가 `estimateRotationStart` 에 `maxWeeks=4` 를 넘긴
 * 단순 오타였고, 비슷한 매핑이 여러 파일에 흩어져 있던 게 화근. 이후
 * 모든 timeframe-derived 상수(retKey/rotKey/maxWeeks/tradingDays/label)는
 * 이 모듈에서 파생한다.
 *
 * 호출자 규칙:
 * - URL 쿼리에서 tf 받을 때 반드시 `parseTimeframe()` 으로 정규화
 * - retKey/rotKey/maxWeeks/tradingDays 가 필요하면 `TIMEFRAME[tf].xxx` 사용
 * - 새 timeframe 추가 시 객체 한 곳에만 추가하면 호출 측 자동 전파
 */

export const TIMEFRAME = {
  '1w': {
    label: '1W',
    weeks: 1,
    tradingDays: 5,
    retKey: 'ret1w',
    rotKey: 'rotations1w',
  },
  '4w': {
    label: '4W',
    weeks: 4,
    tradingDays: 20,
    retKey: 'ret4w',
    rotKey: 'rotations4w',
  },
  '13w': {
    label: '13W',
    weeks: 13,
    tradingDays: 65,
    retKey: 'ret13w',
    rotKey: 'rotations13w',
  },
} as const;

export type Timeframe = keyof typeof TIMEFRAME;
export type TimeframeRetKey = typeof TIMEFRAME[Timeframe]['retKey'];
export type TimeframeRotKey = typeof TIMEFRAME[Timeframe]['rotKey'];

export const TIMEFRAME_KEYS = Object.keys(TIMEFRAME) as Timeframe[];

/**
 * Validate + normalize a tf input from URL/external source.
 * Invalid 값은 fallback (default '4w') 으로 정규화한다 — 캐시 키 오염 방지.
 */
export function parseTimeframe(
  v: string | null | undefined,
  fallback: Timeframe = '4w',
): Timeframe {
  return v && (v in TIMEFRAME) ? (v as Timeframe) : fallback;
}

/** Type guard variant — caller decides what to do on invalid. */
export function isTimeframe(v: unknown): v is Timeframe {
  return typeof v === 'string' && v in TIMEFRAME;
}
