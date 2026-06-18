/** 작전주 매집 선행신호 공용 탐지 (accumulation-detector.mjs 타입) */
export interface OHLCV { c: number; v: number; h: number; l: number }

export interface AccumulationSignals {
  runup5d: number; runup20d: number; recentVol: number; volSpike: number; medDollarVol: number;
  vol10: number; vol30: number; atrRecent: number; atrPrior: number;
  volTrendUp: boolean; volContraction: boolean; closeStrength: number; priceFlat: boolean; liquidityOk: boolean;
  absorptionBars: number; lowerWickBars: number; absorption: boolean;
  accumScore: number; accumCoFire: number; lead: string[];
}

export function computeAccumulationSignals(
  rows: OHLCV[],
  opts?: { krwPerUsd?: number; isKR?: boolean },
): AccumulationSignals;

export function isAccumulation(
  sig: AccumulationSignals,
  ctx?: { strongSmart?: boolean; officialFewAccount?: boolean; isMarkup?: boolean },
): boolean;

export function accumulationTier(
  sig: AccumulationSignals,
  ctx?: { strongSmart?: boolean; officialFewAccount?: boolean; isMarkup?: boolean },
): 'strong' | 'watch' | null;
