/**
 * src/lib/options/iv-math.ts
 *
 * Pure-TS IV math core. No I/O, no async, no project deps.
 *
 * Bloomberg-style 내재변동성 계산의 수학적 핵심:
 *   1. Black-76 forward-based pricer (이산배당 우회 — forward 만 알면 됨)
 *   2. 콜-풋 패리티로 expiry 별 forward & carry 자동 추출 (r, q 가정 불필요)
 *   3. Brent's method 로 σ 역산 (vega 가 0 근처여도 안정)
 *   4. 아비트라지 바운드 검증 + 신뢰도 quality_score
 *
 * 정확도 목표 (MVP): vendor (Polygon/Tradier) 와 ATM IV 1-3 vol-point 이내.
 * 미국형 조기행사 프리미엄은 European 가정으로 잠재 오차 0.3-0.8 vol-point —
 * 신호 순위 관점에서 무시 가능. v2 에서 Bjerksund-Stensland 추가 고려.
 */

// ── Normal CDF / PDF (Abramowitz-Stegun 7.1.26 — 7-digit accuracy) ─────────────
export function normalCdf(x: number): number {
  // Φ(x) = (1 + erf(x/√2)) / 2
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

export function normalPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function erf(x: number): number {
  // Abramowitz-Stegun 7.1.26, max error 1.5e-7
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

// ── Black-76 (forward-based) pricer ──────────────────────────────────────────
// F = forward, K = strike, T = time-to-expiry (years), σ = vol, r = risk-free
// Discount = e^{-rT} (할인은 따로 — forward 이미 carry 내장)
export type OptionType = 'call' | 'put';

export function black76Price(
  F: number,
  K: number,
  T: number,
  sigma: number,
  r: number,
  type: OptionType,
): number {
  if (T <= 0) {
    const intrinsic = type === 'call' ? Math.max(F - K, 0) : Math.max(K - F, 0);
    return intrinsic * Math.exp(-r * T);
  }
  if (sigma <= 0) {
    // 0-vol limit: forward intrinsic discounted
    const intrinsic = type === 'call' ? Math.max(F - K, 0) : Math.max(K - F, 0);
    return intrinsic * Math.exp(-r * T);
  }
  const sqrtT = Math.sqrt(T);
  const vol = sigma * sqrtT;
  const d1 = (Math.log(F / K) + 0.5 * vol * vol) / vol;
  const d2 = d1 - vol;
  const disc = Math.exp(-r * T);
  if (type === 'call') {
    return disc * (F * normalCdf(d1) - K * normalCdf(d2));
  } else {
    return disc * (K * normalCdf(-d2) - F * normalCdf(-d1));
  }
}

/** Vega — 1% vol 변화당 가격 변화 (Black-76, forward). */
export function black76Vega(F: number, K: number, T: number, sigma: number, r: number): number {
  if (T <= 0 || sigma <= 0) return 0;
  const sqrtT = Math.sqrt(T);
  const vol = sigma * sqrtT;
  const d1 = (Math.log(F / K) + 0.5 * vol * vol) / vol;
  return F * Math.exp(-r * T) * normalPdf(d1) * sqrtT;
}

// ── Brent's method (root finder — Wikipedia 의사코드 변형) ────────────────────
// f 가 [a, b] 에서 부호 바뀐다는 전제 (f(a)·f(b) < 0).
export function brent(
  f: (x: number) => number,
  a: number,
  b: number,
  tol = 1e-7,
  maxIter = 100,
): number | null {
  let fa = f(a);
  let fb = f(b);
  if (fa * fb > 0) return null; // 부호 같음 → bracket 무효

  if (Math.abs(fa) < Math.abs(fb)) {
    [a, b] = [b, a];
    [fa, fb] = [fb, fa];
  }
  let c = a;
  let fc = fa;
  let mflag = true;
  let s = b;
  let d = 0;

  for (let iter = 0; iter < maxIter; iter++) {
    if (fb === 0 || Math.abs(b - a) < tol) return b;

    if (fa !== fc && fb !== fc) {
      // inverse quadratic interpolation
      s =
        (a * fb * fc) / ((fa - fb) * (fa - fc)) +
        (b * fa * fc) / ((fb - fa) * (fb - fc)) +
        (c * fa * fb) / ((fc - fa) * (fc - fb));
    } else {
      // secant
      s = b - fb * ((b - a) / (fb - fa));
    }

    const cond1 = !(s > (3 * a + b) / 4 && s < b) && !(s < (3 * a + b) / 4 && s > b);
    const cond2 = mflag && Math.abs(s - b) >= Math.abs(b - c) / 2;
    const cond3 = !mflag && Math.abs(s - b) >= Math.abs(c - d) / 2;
    const cond4 = mflag && Math.abs(b - c) < tol;
    const cond5 = !mflag && Math.abs(c - d) < tol;
    if (cond1 || cond2 || cond3 || cond4 || cond5) {
      s = (a + b) / 2;
      mflag = true;
    } else {
      mflag = false;
    }

    const fs = f(s);
    d = c;
    c = b;
    fc = fb;

    if (fa * fs < 0) {
      b = s;
      fb = fs;
    } else {
      a = s;
      fa = fs;
    }
    if (Math.abs(fa) < Math.abs(fb)) {
      [a, b] = [b, a];
      [fa, fb] = [fb, fa];
    }
  }
  return b;
}

// ── Implied volatility 역산 ───────────────────────────────────────────────────
export interface ImpliedVolResult {
  sigma: number | null;
  reason: 'ok' | 'no_bracket' | 'arbitrage' | 'extreme' | 'invalid_input';
  intrinsic?: number;
}

/**
 * Forward-based BS price → σ 역산.
 * @param marketPrice 시장 옵션 가격 (mid 가 표준 — bid/ask 평균)
 * @param F forward (콜-풋 패리티로 구한 값 권장)
 * @param K strike
 * @param T time-to-expiry (years)
 * @param r risk-free (실수)
 * @param type 'call' | 'put'
 */
export function impliedVol(
  marketPrice: number,
  F: number,
  K: number,
  T: number,
  r: number,
  type: OptionType,
): ImpliedVolResult {
  if (!isFinite(marketPrice) || !isFinite(F) || !isFinite(K) || !isFinite(T)) {
    return { sigma: null, reason: 'invalid_input' };
  }
  if (marketPrice <= 0 || F <= 0 || K <= 0 || T <= 0) {
    return { sigma: null, reason: 'invalid_input' };
  }

  // 아비트라지 바운드: 콜 ≥ disc·max(F-K, 0), 풋 ≥ disc·max(K-F, 0)
  // 콜 ≤ disc·F, 풋 ≤ disc·K
  const disc = Math.exp(-r * T);
  const intrinsic = type === 'call' ? Math.max(F - K, 0) : Math.max(K - F, 0);
  const lower = disc * intrinsic;
  const upper = type === 'call' ? disc * F : disc * K;
  if (marketPrice < lower - 1e-9 || marketPrice > upper + 1e-9) {
    return { sigma: null, reason: 'arbitrage', intrinsic: lower };
  }

  // Brent bracket: σ ∈ [0.0001, 5.0] — 500% vol cap (extreme stress)
  const f = (sigma: number) => black76Price(F, K, T, sigma, r, type) - marketPrice;
  let sigma = brent(f, 1e-4, 5.0, 1e-6, 100);
  if (sigma == null) {
    // 확장: 1000% 까지 (deep OTM, near-expiry meme stock)
    sigma = brent(f, 1e-4, 10.0, 1e-6, 100);
    if (sigma == null) return { sigma: null, reason: 'no_bracket' };
  }
  if (sigma <= 0 || sigma >= 9.99) return { sigma: null, reason: 'extreme' };
  return { sigma, reason: 'ok' };
}

// ── 콜-풋 패리티로 forward + discount 추출 ──────────────────────────────────
// C - P = e^{-rT} · (F - K)   →   같은 expiry 안에서 strike K vs (C-P) 회귀
// 기울기 = -e^{-rT},  절편 = e^{-rT} · F   →   r 과 F 동시 추출
export interface ParitySamples {
  K: number;
  callMid: number;
  putMid: number;
}

export interface ParityResult {
  F: number | null;
  rImplied: number | null; // 연속복리 (carry = r - q 와 동치)
  rSquared: number | null;
  sampleCount: number;
  reason: 'ok' | 'insufficient_data' | 'singular';
}

export function extractForwardFromParity(samples: ParitySamples[], T: number): ParityResult {
  const valid = samples.filter(
    (s) =>
      isFinite(s.K) &&
      s.K > 0 &&
      isFinite(s.callMid) &&
      isFinite(s.putMid) &&
      s.callMid > 0 &&
      s.putMid > 0,
  );
  if (valid.length < 3) {
    return { F: null, rImplied: null, rSquared: null, sampleCount: valid.length, reason: 'insufficient_data' };
  }
  // 회귀: y = (C - P), x = K  →  y = β·x + α,  β = -disc,  α = disc·F
  const n = valid.length;
  const xs = valid.map((s) => s.K);
  const ys = valid.map((s) => s.callMid - s.putMid);
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0,
    den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den < 1e-9) {
    return { F: null, rImplied: null, rSquared: null, sampleCount: n, reason: 'singular' };
  }
  const beta = num / den;
  const alpha = meanY - beta * meanX;
  const disc = -beta;
  if (disc <= 0 || disc > 1) {
    return { F: null, rImplied: null, rSquared: null, sampleCount: n, reason: 'singular' };
  }
  const F = alpha / disc;
  const rImplied = -Math.log(disc) / T;
  // R² 계산
  let ssRes = 0,
    ssTot = 0;
  for (let i = 0; i < n; i++) {
    const yHat = alpha + beta * xs[i];
    ssRes += (ys[i] - yHat) ** 2;
    ssTot += (ys[i] - meanY) ** 2;
  }
  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : null;
  return { F, rImplied, rSquared, sampleCount: n, reason: 'ok' };
}

// ── 25-Δ skew 계산 ────────────────────────────────────────────────────────────
// Black-76 콜 델타 = e^{-rT}·N(d1).  특정 Δ 에 대응하는 K 를 역산.
export function strikeFromDelta(
  F: number,
  T: number,
  sigma: number,
  r: number,
  delta: number,
  type: OptionType,
): number {
  // type=call 이면 delta ∈ (0, 1), put 이면 (-1, 0).
  // d1 = N⁻¹(delta · e^{rT})  (call), put: d1 = N⁻¹(1 + delta · e^{rT})
  const adjDelta = type === 'call' ? delta * Math.exp(r * T) : 1 + delta * Math.exp(r * T);
  const d1 = inverseNormalCdf(adjDelta);
  // ln(F/K) = -d1·σ√T + 0.5·σ²·T  →  K = F · exp(-d1·σ√T + 0.5·σ²·T)
  return F * Math.exp(-d1 * sigma * Math.sqrt(T) + 0.5 * sigma * sigma * T);
}

/** Inverse normal CDF — Beasley-Springer/Moro algorithm (max error ~1e-9). */
export function inverseNormalCdf(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q: number, r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

// ── ATM forward IV (variance space 보간) ─────────────────────────────────────
/**
 * 두 strike 의 IV 를 ATM strike (K=F) 로 variance-space 선형 보간.
 * total variance v = σ² · T (linear in K 가 아니라 logmoneyness 에서 부드러움)
 */
export function interpolateAtmIv(
  Klow: number,
  ivLow: number,
  Khigh: number,
  ivHigh: number,
  F: number,
  T: number,
): number | null {
  if (Klow >= Khigh) return null;
  if (F <= Klow) return ivLow;
  if (F >= Khigh) return ivHigh;
  const xLow = Math.log(Klow / F);
  const xHigh = Math.log(Khigh / F);
  const w = (0 - xLow) / (xHigh - xLow);
  const vLow = ivLow * ivLow * T;
  const vHigh = ivHigh * ivHigh * T;
  const v = vLow + w * (vHigh - vLow);
  if (v <= 0) return null;
  return Math.sqrt(v / T);
}

// ── 30일 만기 페어 선택 + variance 보간 (VIX-style 시간가중) ──────────────────
export interface ExpiryIv {
  T: number; // years
  iv: number;
}

/**
 * 30일 (= 30/365 년) 만기로 보간된 IV. CBOE VIX 방식의 시간가중 variance 선형보간.
 * 가까운 두 expiry 가 7d-90d 범위에 있고, 30 일을 사이에 둘 때만 보간.
 */
export function interpolate30dIv(expiries: ExpiryIv[]): number | null {
  const tgt = 30 / 365;
  const valid = expiries
    .filter((e) => e.T > 7 / 365 && e.T < 1 && e.iv > 0 && e.iv < 5)
    .sort((a, b) => a.T - b.T);
  if (valid.length === 0) return null;
  // bracket: T_low ≤ 30d ≤ T_high
  let low: ExpiryIv | null = null;
  let high: ExpiryIv | null = null;
  for (const e of valid) {
    if (e.T <= tgt) low = e;
    if (e.T >= tgt && !high) high = e;
  }
  if (!low && high) return high.iv; // 30 일보다 모두 길면 가장 짧은 만기 사용
  if (low && !high) return low.iv; // 30 일보다 모두 짧으면 가장 긴 만기 사용
  if (!low || !high) return null;
  if (low.T === high.T) return low.iv;
  // total variance 선형 보간
  const vLow = low.iv * low.iv * low.T;
  const vHigh = high.iv * high.iv * high.T;
  const w = (tgt - low.T) / (high.T - low.T);
  const v = vLow + w * (vHigh - vLow);
  return Math.sqrt(v / tgt);
}
