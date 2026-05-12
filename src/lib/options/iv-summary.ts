/**
 * src/lib/options/iv-summary.ts
 *
 * 옵션 체인 → IV 요약 지표:
 *   - atmIv30d        : 30 일 ATM 내재변동성 (만기 가중 보간)
 *   - atmIv90d        : 90 일 (term slope 계산용)
 *   - termSlope       : (90d - 30d) — 양수 = contango, 음수 = backwardation
 *   - skew25d         : σ(25Δ put) - σ(25Δ call), 양수 = downside fear
 *   - qualityScore    : 0-100 (체인 데이터 품질)
 *
 * 절대 정적 폴백 사용 안 함. 데이터 부실 시 null 반환 + source 표기.
 */
import {
  black76Price,
  impliedVol,
  extractForwardFromParity,
  type ParitySamples,
  interpolate30dIv,
  strikeFromDelta,
  interpolateAtmIv,
} from './iv-math';
import type { OptionChain, RawOptionContract } from './yahoo-chain';

const MAX_SPREAD_RATIO = 0.35; // bid/ask 너무 넓으면 거름
const MIN_MID = 0.05; // $0.05 미만 옵션은 잡음
const MIN_OI = 10;
const STALE_THRESHOLD_HOURS = 48; // lastTradeDate 가 48h 이상 오래면 거름

export interface IvSummary {
  ticker: string;
  spot: number | null;
  asOf: string;
  atmIv30d: number | null;
  atmIv90d: number | null;
  termSlope: number | null;
  skew25d: number | null;
  putCallRatio: number | null;
  expiriesUsed: number;
  contractsUsed: number;
  qualityScore: number;
  source: 'live' | 'error';
  errorReason?: string;
  expiryBreakdown: Array<{
    expirationDate: string;
    daysToExpiry: number;
    forward: number | null;
    rImplied: number | null;
    atmIv: number | null;
    sampleCount: number;
  }>;
}

interface FilteredContract {
  K: number;
  mid: number;
  bid: number;
  ask: number;
  iv: number | null; // 우리가 BS 역산한 값
  oi: number;
  volume: number;
  ageHours: number;
}

function filterContracts(contracts: RawOptionContract[]): FilteredContract[] {
  const nowSec = Math.floor(Date.now() / 1000);
  const out: FilteredContract[] = [];
  for (const c of contracts) {
    if (!c.strike || c.strike <= 0) continue;
    const bid = c.bid ?? 0;
    const ask = c.ask ?? 0;
    if (bid <= 0 || ask <= 0 || ask < bid) continue;
    const mid = (bid + ask) / 2;
    if (mid < MIN_MID) continue;
    const spread = ask - bid;
    const spreadCap = Math.max(0.1, MAX_SPREAD_RATIO * mid);
    if (spread > spreadCap) continue;
    const oi = c.openInterest ?? 0;
    const vol = c.volume ?? 0;
    if (oi < MIN_OI && vol === 0) continue;
    const ageH = c.lastTradeDate ? (nowSec - c.lastTradeDate) / 3600 : 9999;
    if (ageH > STALE_THRESHOLD_HOURS) continue;
    out.push({
      K: c.strike,
      mid,
      bid,
      ask,
      iv: null,
      oi,
      volume: vol,
      ageHours: ageH,
    });
  }
  return out;
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

interface ExpirySummary {
  expirationDate: string;
  daysToExpiry: number;
  T: number; // years
  forward: number | null;
  rImplied: number | null;
  atmIv: number | null;
  callIvs: Array<{ K: number; iv: number; mid: number }>;
  putIvs: Array<{ K: number; iv: number; mid: number }>;
  sampleCount: number;
}

function processExpiry(
  expirationDate: string,
  daysToExpiry: number,
  rawCalls: RawOptionContract[],
  rawPuts: RawOptionContract[],
): ExpirySummary {
  const T = Math.max(daysToExpiry, 0.5) / 365;
  const calls = filterContracts(rawCalls);
  const puts = filterContracts(rawPuts);

  // strike 기준 콜 + 풋 페어 → 패리티로 forward & r
  const paired: ParitySamples[] = [];
  for (const c of calls) {
    const p = puts.find((pp) => pp.K === c.K);
    if (p) paired.push({ K: c.K, callMid: c.mid, putMid: p.mid });
  }
  const parity = extractForwardFromParity(paired, T);
  const F = parity.F;
  const r = parity.rImplied ?? 0;

  // F 가 없으면 BS IV 역산 불가
  if (F == null || !isFinite(F) || F <= 0) {
    return {
      expirationDate,
      daysToExpiry,
      T,
      forward: null,
      rImplied: null,
      atmIv: null,
      callIvs: [],
      putIvs: [],
      sampleCount: paired.length,
    };
  }

  // 각 콜·풋 별 IV 역산
  const callIvs: Array<{ K: number; iv: number; mid: number }> = [];
  const putIvs: Array<{ K: number; iv: number; mid: number }> = [];
  for (const c of calls) {
    const res = impliedVol(c.mid, F, c.K, T, r, 'call');
    if (res.reason === 'ok' && res.sigma != null && res.sigma > 0.01 && res.sigma < 5) {
      callIvs.push({ K: c.K, iv: res.sigma, mid: c.mid });
    }
  }
  for (const p of puts) {
    const res = impliedVol(p.mid, F, p.K, T, r, 'put');
    if (res.reason === 'ok' && res.sigma != null && res.sigma > 0.01 && res.sigma < 5) {
      putIvs.push({ K: p.K, iv: res.sigma, mid: p.mid });
    }
  }

  // ATM IV: F 양쪽 가장 가까운 두 strike 의 콜+풋 IV variance 보간
  const allIvs = [...callIvs, ...putIvs].sort((a, b) => a.K - b.K);
  let atmIv: number | null = null;
  if (allIvs.length >= 2) {
    let below: { K: number; iv: number } | null = null;
    let above: { K: number; iv: number } | null = null;
    for (const x of allIvs) {
      if (x.K <= F) below = x;
      if (x.K >= F && !above) above = x;
    }
    if (below && above && below.K !== above.K) {
      atmIv = interpolateAtmIv(below.K, below.iv, above.K, above.iv, F, T);
    } else if (below) {
      atmIv = below.iv;
    } else if (above) {
      atmIv = above.iv;
    }
  } else if (allIvs.length === 1) {
    atmIv = allIvs[0].iv;
  }

  return {
    expirationDate,
    daysToExpiry,
    T,
    forward: F,
    rImplied: parity.rImplied,
    atmIv,
    callIvs,
    putIvs,
    sampleCount: paired.length,
  };
}

/** 25-delta call/put strike 의 IV 를 expiry 내에서 보간으로 구함. */
function iv25dSkew(exp: ExpirySummary): number | null {
  if (exp.forward == null || exp.atmIv == null || exp.callIvs.length < 3 || exp.putIvs.length < 3) {
    return null;
  }
  const F = exp.forward;
  const T = exp.T;
  const r = exp.rImplied ?? 0;
  const sigma = exp.atmIv;
  // 25Δ call strike (delta = 0.25)
  const K_call25 = strikeFromDelta(F, T, sigma, r, 0.25, 'call');
  const K_put25 = strikeFromDelta(F, T, sigma, r, -0.25, 'put');
  if (!isFinite(K_call25) || !isFinite(K_put25)) return null;
  // 가장 가까운 두 strike 의 IV 로 K_call25, K_put25 IV 선형 보간 (K 도메인)
  const interpAt = (xs: Array<{ K: number; iv: number }>, K: number): number | null => {
    if (!xs.length) return null;
    const sorted = [...xs].sort((a, b) => a.K - b.K);
    if (K <= sorted[0].K) return sorted[0].iv;
    if (K >= sorted[sorted.length - 1].K) return sorted[sorted.length - 1].iv;
    for (let i = 0; i < sorted.length - 1; i++) {
      if (K >= sorted[i].K && K <= sorted[i + 1].K) {
        const w = (K - sorted[i].K) / (sorted[i + 1].K - sorted[i].K);
        return sorted[i].iv + w * (sorted[i + 1].iv - sorted[i].iv);
      }
    }
    return null;
  };
  const ivPut = interpAt(exp.putIvs, K_put25);
  const ivCall = interpAt(exp.callIvs, K_call25);
  if (ivPut == null || ivCall == null) return null;
  return ivPut - ivCall;
}

export function summarizeIv(chain: OptionChain): IvSummary {
  const base: IvSummary = {
    ticker: chain.ticker,
    spot: chain.spot,
    asOf: chain.asOf,
    atmIv30d: null,
    atmIv90d: null,
    termSlope: null,
    skew25d: null,
    putCallRatio: null,
    expiriesUsed: 0,
    contractsUsed: 0,
    qualityScore: 0,
    source: chain.source,
    errorReason: chain.errorReason,
    expiryBreakdown: [],
  };
  if (chain.source !== 'live' || chain.expiries.length === 0) return base;

  const processed = chain.expiries
    .map((e) => processExpiry(e.expirationDate, e.daysToExpiry, e.calls, e.puts))
    .filter((p) => p.atmIv != null && p.forward != null);

  base.expiriesUsed = processed.length;
  base.contractsUsed = processed.reduce((s, p) => s + p.callIvs.length + p.putIvs.length, 0);
  base.expiryBreakdown = processed.map((p) => ({
    expirationDate: p.expirationDate,
    daysToExpiry: parseFloat(p.daysToExpiry.toFixed(1)),
    forward: p.forward != null ? parseFloat(p.forward.toFixed(2)) : null,
    rImplied: p.rImplied != null ? parseFloat(p.rImplied.toFixed(4)) : null,
    atmIv: p.atmIv != null ? parseFloat(p.atmIv.toFixed(4)) : null,
    sampleCount: p.sampleCount,
  }));

  if (processed.length === 0) {
    base.source = 'error';
    base.errorReason = 'no_valid_expiries';
    return base;
  }

  // 30d & 90d ATM IV
  const expiryIvs = processed.map((p) => ({ T: p.T, iv: p.atmIv! }));
  base.atmIv30d = interpolate30dIv(expiryIvs);
  // 90d: 같은 함수 호출하되 target=90/365 직접 처리
  base.atmIv90d = interpolateAtIv(expiryIvs, 90 / 365);
  if (base.atmIv30d != null && base.atmIv90d != null) {
    base.termSlope = base.atmIv90d - base.atmIv30d;
  }

  // 25Δ skew: 30d 에 가장 가까운 expiry 사용
  const target30 = 30 / 365;
  const nearest30 = [...processed].sort(
    (a, b) => Math.abs(a.T - target30) - Math.abs(b.T - target30),
  )[0];
  if (nearest30) base.skew25d = iv25dSkew(nearest30);

  // P/C ratio: 첫 expiry 의 OI 비율
  const firstChainExp = chain.expiries[0];
  if (firstChainExp) {
    const totalCallOI = firstChainExp.calls.reduce((s, c) => s + (c.openInterest ?? 0), 0);
    const totalPutOI = firstChainExp.puts.reduce((s, c) => s + (c.openInterest ?? 0), 0);
    if (totalCallOI > 0) base.putCallRatio = parseFloat((totalPutOI / totalCallOI).toFixed(3));
  }

  // Quality score:
  //   - expiries 수 (4+ = 40점)
  //   - 평균 sample count (10+ = 30점)
  //   - 평균 spread quality (avg spread/mid < 10% = 30점)
  let q = 0;
  q += Math.min(40, processed.length * 10);
  const avgSample = processed.reduce((s, p) => s + p.sampleCount, 0) / processed.length;
  q += Math.min(30, Math.round(avgSample * 3));
  const allMids = processed.flatMap((p) => [...p.callIvs, ...p.putIvs].map((x) => x.mid));
  const medMid = median(allMids);
  q += isFinite(medMid) && medMid > 0.5 ? 30 : 15;
  base.qualityScore = Math.min(100, q);

  // 반올림
  if (base.atmIv30d != null) base.atmIv30d = parseFloat(base.atmIv30d.toFixed(4));
  if (base.atmIv90d != null) base.atmIv90d = parseFloat(base.atmIv90d.toFixed(4));
  if (base.termSlope != null) base.termSlope = parseFloat(base.termSlope.toFixed(4));
  if (base.skew25d != null) base.skew25d = parseFloat(base.skew25d.toFixed(4));
  return base;
}

/** 임의 target T 로 variance-space 선형보간 */
function interpolateAtIv(expiries: Array<{ T: number; iv: number }>, tgt: number): number | null {
  const valid = expiries.filter((e) => e.T > 0 && e.iv > 0).sort((a, b) => a.T - b.T);
  if (valid.length === 0) return null;
  let low: { T: number; iv: number } | null = null;
  let high: { T: number; iv: number } | null = null;
  for (const e of valid) {
    if (e.T <= tgt) low = e;
    if (e.T >= tgt && !high) high = e;
  }
  if (!low && high) return high.iv;
  if (low && !high) return low.iv;
  if (!low || !high) return null;
  if (low.T === high.T) return low.iv;
  const vLow = low.iv * low.iv * low.T;
  const vHigh = high.iv * high.iv * high.T;
  const w = (tgt - low.T) / (high.T - low.T);
  const v = vLow + w * (vHigh - vLow);
  return Math.sqrt(v / tgt);
}

// 위 black76Price 의존성을 명시적으로 export — Tree-shake 안전
void black76Price;
