/**
 * thresholds.ts — FlowVium 투자 판단 임계값 중앙 관리
 *
 * 여기서 숫자 하나만 바꾸면 전체 UI/API/알림에 반영됨.
 * 환경변수로 override 가능: NEXT_PUBLIC_FG_EXTREME_FEAR=20 등
 *
 * 임계값 변경 시 이 파일만 수정하고 git commit 메시지에 이유 명시.
 */

// ── Fear & Greed ─────────────────────────────────────────────────────────────
export const FG = {
  EXTREME_FEAR:  parseInt(process.env.NEXT_PUBLIC_FG_EXTREME_FEAR  ?? '25', 10),
  FEAR:          parseInt(process.env.NEXT_PUBLIC_FG_FEAR          ?? '40', 10),
  GREED:         parseInt(process.env.NEXT_PUBLIC_FG_GREED         ?? '60', 10),
  EXTREME_GREED: parseInt(process.env.NEXT_PUBLIC_FG_EXTREME_GREED ?? '75', 10),
} as const;

export type FGLevel = 'extreme-fear' | 'fear' | 'neutral' | 'greed' | 'extreme-greed';

export function getFGLevel(score: number): FGLevel {
  if (score <= FG.EXTREME_FEAR) return 'extreme-fear';
  if (score <= FG.FEAR)         return 'fear';
  if (score >= FG.EXTREME_GREED) return 'extreme-greed';
  if (score >= FG.GREED)        return 'greed';
  return 'neutral';
}

export const FG_LABELS: Record<FGLevel, { ko: string; en: string; color: string }> = {
  'extreme-fear':  { ko: '극단적 공포', en: 'Extreme Fear',  color: '#ef4444' },
  'fear':          { ko: '공포',        en: 'Fear',          color: '#f97316' },
  'neutral':       { ko: '중립',        en: 'Neutral',       color: '#eab308' },
  'greed':         { ko: '탐욕',        en: 'Greed',         color: '#84cc16' },
  'extreme-greed': { ko: '극단적 탐욕', en: 'Extreme Greed', color: '#22c55e' },
};

// ── VIX (CBOE Volatility Index) ───────────────────────────────────────────────
export const VIX = {
  LOW:       18,  // 저변동성 (bull market calm)
  NORMAL:    22,  // 정상
  ELEVATED:  25,  // 경계
  HIGH:      30,  // 고변동성 (risk-off)
  EXTREME:   40,  // 극단 (crisis)
} as const;

export type VIXRegime = 'low' | 'normal' | 'elevated' | 'high' | 'extreme';

export function getVIXRegime(vix: number): VIXRegime {
  if (vix < VIX.LOW)      return 'low';
  if (vix < VIX.NORMAL)   return 'normal';
  if (vix < VIX.ELEVATED) return 'elevated';
  if (vix < VIX.HIGH)     return 'high';
  return 'extreme';
}

// ── Credit Spreads ────────────────────────────────────────────────────────────
export const SPREADS = {
  IG_NORMAL:   1.0,   // IG OAS (bps → %) normal threshold
  IG_ELEVATED: 1.5,
  HY_NORMAL:   3.5,
  HY_ELEVATED: 5.5,
  HY_STRESS:   8.0,
} as const;

// ── Short Squeeze Score ───────────────────────────────────────────────────────
export const SQUEEZE = {
  MIN_SIGNAL: 25,    // 신호 표시 최소값
  CAUTION:    45,    // 주의
  DANGER:     70,    // 위험 (높은 공매도 = 숏 스퀴즈 가능성)
} as const;

// ── Portfolio Allocation Defaults ─────────────────────────────────────────────
// (not `as const` — these values are used as mutable starting points)
export const PORTFOLIO = {
  DEFAULT_SPY:  35 as number,
  DEFAULT_QQQ:  25 as number,
  DEFAULT_GLD:  15 as number,
  DEFAULT_TLT:  15 as number,
  DEFAULT_CASH: 10 as number,
  HIGH_VOL_SPY_REDUCE:  10 as number,
  HIGH_VOL_CASH_ADD:    10 as number,
  GREED_SPY_REDUCE:      5 as number,
  GREED_GLD_ADD:         5 as number,
};

// ── Cascade Detection ─────────────────────────────────────────────────────────
export const CASCADE = {
  LEADER_TRIGGER_PCT: 5,   // 리더 1주간 ±5% 이상 = cascade 활성
  FOLLOWER_WINDOW_DAYS: 5, // 팔로워 관찰 기간 (영업일)
} as const;

// ── Retrospective Evaluation ──────────────────────────────────────────────────
export const RETRO = {
  TARGET_HIT_RATIO:   0.8,   // 목표가 80% 이상 달성 = 성공
  TARGET_PARTIAL:     0.4,   // 40-80% = 부분 성공
  EVAL_DAYS:          14,    // 14일 후 평가
  LEADER_TRIGGER_PCT: 5,     // 리더 ±5% 이상 = cascade 활성
} as const;
