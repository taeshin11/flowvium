// IV summary E2E test with synthetic chain (no Yahoo dependency)
import { execSync } from 'child_process';
const tmp = '.tmp-summary-bundle.mjs';
const tmpMath = '.tmp-math-bundle.mjs';
execSync(
  `npx esbuild src/lib/options/iv-summary.ts --bundle --platform=node --format=esm --external:@/lib/redis --external:@/lib/logger --outfile=${tmp}`,
  { stdio: 'inherit' },
);
execSync(`npx esbuild src/lib/options/iv-math.ts --bundle --platform=node --format=esm --outfile=${tmpMath}`, { stdio: 'inherit' });
const mod = await import(`./../${tmp}`);
const math = await import(`./../${tmpMath}`);

let pass = 0, fail = 0;
function check(name, cond, info = '') {
  if (cond) { pass++; console.log(`✅ ${name}`); }
  else { fail++; console.error(`❌ ${name} ${info}`); }
}

// Synthetic chain: 30d + 90d expiry, F=100, σ=0.30 ATM, slight skew, no rate
const F = 100, sigma = 0.30, r = 0.04;
function makeContract(K, T, type, vol = sigma) {
  const px = math.black76Price(F, K, T, vol, r, type);
  // bid/ask spread: ~4% wide of mid
  const mid = px;
  const half = Math.max(0.05, mid * 0.02);
  return {
    strike: K,
    bid: Math.max(0.01, mid - half),
    ask: mid + half,
    impliedVolatility: vol,
    openInterest: 500,
    volume: 100,
    lastTradeDate: Math.floor(Date.now() / 1000) - 1800, // 30 min ago
  };
}

function makeExpiry(daysToExpiry, smile = false) {
  const T = daysToExpiry / 365;
  const strikes = [80, 85, 90, 95, 100, 105, 110, 115, 120];
  const calls = strikes.map(K => makeContract(K, T, 'call', smile ? sigma + 0.05 * (1 - K / F) : sigma));
  const puts = strikes.map(K => makeContract(K, T, 'put', smile ? sigma + 0.05 * (1 - K / F) : sigma));
  const u = Math.floor(Date.now() / 1000) + daysToExpiry * 86400;
  return {
    expirationDate: new Date(u * 1000).toISOString().slice(0, 10),
    expirationUnix: u,
    daysToExpiry,
    calls,
    puts,
  };
}

const chain = {
  ticker: 'TEST',
  spot: F,
  asOf: new Date().toISOString(),
  expiries: [makeExpiry(30, false), makeExpiry(90, false), makeExpiry(15, false), makeExpiry(60, false)],
  source: 'live',
};

const summary = mod.summarizeIv(chain);
check('source=live', summary.source === 'live', `got ${summary.source}`);
check('atmIv30d ≈ 0.30', summary.atmIv30d != null && Math.abs(summary.atmIv30d - 0.30) < 0.02, `got ${summary.atmIv30d}`);
check('atmIv90d ≈ 0.30', summary.atmIv90d != null && Math.abs(summary.atmIv90d - 0.30) < 0.02, `got ${summary.atmIv90d}`);
check('termSlope ≈ 0', summary.termSlope != null && Math.abs(summary.termSlope) < 0.02, `got ${summary.termSlope}`);
check('expiriesUsed ≥ 3', summary.expiriesUsed >= 3, `got ${summary.expiriesUsed}`);
check('quality 70+', summary.qualityScore >= 70, `got ${summary.qualityScore}`);

// 2: Skewed chain (volatility smile — put 비싸짐)
const skewedChain = {
  ...chain,
  expiries: [makeExpiry(30, true), makeExpiry(60, true), makeExpiry(90, true)],
};
const ss = mod.summarizeIv(skewedChain);
check('skew25d 양수 (put > call IV)', ss.skew25d != null && ss.skew25d > 0, `got ${ss.skew25d}`);

// 3: empty chain
const empty = mod.summarizeIv({ ticker: 'EMPTY', spot: null, asOf: '', expiries: [], source: 'error' });
check('empty chain → atmIv30d null', empty.atmIv30d == null);

console.log(`\n${pass} passed / ${fail} failed`);
try { require('fs').unlinkSync(tmp); } catch {}
process.exit(fail > 0 ? 1 : 0);
