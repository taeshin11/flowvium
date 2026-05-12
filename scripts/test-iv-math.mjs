// 수학 sanity test: BS price → IV 역산 roundtrip
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';

// transpile TS via esbuild (already a dep) → temp .mjs
const tmp = '.tmp-iv-test.mjs';
execSync(`npx esbuild src/lib/options/iv-math.ts --bundle --platform=node --format=esm --outfile=${tmp}`, { stdio: 'inherit' });
const mod = await import(`./../${tmp}`);

let pass = 0, fail = 0;
function check(name, cond, info = '') {
  if (cond) { pass++; console.log(`✅ ${name}`); }
  else { fail++; console.error(`❌ ${name} ${info}`); }
}

// Test 1: Black-76 roundtrip — F=100, K=100, T=0.25, σ=0.30, r=0.05, call
const F = 100, K = 100, T = 0.25, sigma = 0.30, r = 0.05;
const callPx = mod.black76Price(F, K, T, sigma, r, 'call');
const putPx = mod.black76Price(F, K, T, sigma, r, 'put');
check('Black-76 call > 0', callPx > 0);
check('Black-76 put > 0', putPx > 0);
// Put-call parity (ATM): C - P = e^{-rT}(F - K) = 0
const parity = Math.abs(callPx - putPx);
check('PCP at ATM ≈ 0', parity < 1e-6, `diff=${parity}`);

const ivCall = mod.impliedVol(callPx, F, K, T, r, 'call');
const ivPut = mod.impliedVol(putPx, F, K, T, r, 'put');
check('IV call roundtrip', ivCall.reason === 'ok' && Math.abs(ivCall.sigma - sigma) < 1e-4, `got ${ivCall.sigma}`);
check('IV put roundtrip', ivPut.reason === 'ok' && Math.abs(ivPut.sigma - sigma) < 1e-4, `got ${ivPut.sigma}`);

// Test 2: deep OTM
const K_otm = 130;
const px_otm = mod.black76Price(F, K_otm, T, sigma, r, 'call');
const iv_otm = mod.impliedVol(px_otm, F, K_otm, T, r, 'call');
check('IV deep OTM roundtrip', iv_otm.reason === 'ok' && Math.abs(iv_otm.sigma - sigma) < 1e-3, `got ${iv_otm?.sigma}`);

// Test 3: very short T (1 day)
const T_short = 1 / 365;
const px_short = mod.black76Price(F, 102, T_short, sigma, r, 'call');
const iv_short = mod.impliedVol(px_short, F, 102, T_short, r, 'call');
check('IV short T roundtrip', iv_short.reason === 'ok' && Math.abs(iv_short.sigma - sigma) < 1e-3, `got ${iv_short?.sigma}`);

// Test 4: arbitrage bound rejection — deep ITM call with px below intrinsic
const arb = mod.impliedVol(1.0, F, 80, T, r, 'call'); // intrinsic ≈ disc·20 ≈ 19.75, px=1 위반
check('Arbitrage low rejected', arb.reason === 'arbitrage', `reason=${arb.reason}`);

// Test 5: Call-Put parity forward extraction
// 가정: F=105, T=0.25, r=0.04, σ=0.25 → 8 strike 의 (C-P) 로 F 역산
const F_true = 105, T2 = 0.25, r2 = 0.04, sigma2 = 0.25;
const strikes = [85, 90, 95, 100, 105, 110, 115, 120];
const samples = strikes.map(K => ({
  K,
  callMid: mod.black76Price(F_true, K, T2, sigma2, r2, 'call'),
  putMid: mod.black76Price(F_true, K, T2, sigma2, r2, 'put'),
}));
const parityRes = mod.extractForwardFromParity(samples, T2);
check('Parity forward extraction', parityRes.reason === 'ok' && Math.abs(parityRes.F - F_true) < 0.5, `F=${parityRes.F} expected ${F_true}`);
check('Parity r extraction', Math.abs(parityRes.rImplied - r2) < 0.005, `r=${parityRes.rImplied} expected ${r2}`);
check('Parity R² > 0.99', parityRes.rSquared > 0.99, `R²=${parityRes.rSquared}`);

// Test 6: 30d interpolation
const iv30 = mod.interpolate30dIv([
  { T: 21/365, iv: 0.30 },
  { T: 49/365, iv: 0.28 },
]);
check('interpolate30dIv returns finite', iv30 != null && isFinite(iv30) && iv30 > 0 && iv30 < 1, `iv=${iv30}`);

// Test 7: inverseNormalCdf
check('invNormCdf(0.5) ≈ 0', Math.abs(mod.inverseNormalCdf(0.5)) < 1e-7);
check('invNormCdf(0.975) ≈ 1.96', Math.abs(mod.inverseNormalCdf(0.975) - 1.959964) < 1e-4);
check('invNormCdf(0.025) ≈ -1.96', Math.abs(mod.inverseNormalCdf(0.025) + 1.959964) < 1e-4);

console.log(`\n${pass} passed / ${fail} failed`);
try { require('fs').unlinkSync(tmp); } catch {}
process.exit(fail > 0 ? 1 : 0);
