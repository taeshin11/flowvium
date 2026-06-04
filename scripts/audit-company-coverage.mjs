#!/usr/bin/env node
/**
 * scripts/audit-company-coverage.mjs — *전수* company 페이지 core 커버리지 (2026-06-05 신설).
 *
 * 사각지대 배경: audit-company-pages 가 기본 40종목 표본만 봐서 "94%" 가 3% 표본인 줄 안 보였음
 *   (사용자 "왜 280개밖에? 1200개 넘는데"). deep 9-API 전수는 ~20분이라 라우틴 부적합 →
 *   이 스크립트가 *가장 가벼운 필수 엔드포인트*(stock-price)를 1338 전종목 동시 핑해 빠르게(~1-2분)
 *   "모든 /company 페이지가 핵심 데이터 보유" 를 전수 보장. deep 표본은 audit-company-pages 가 담당.
 *
 * 사용: node scripts/audit-company-coverage.mjs   (exit 1 = 임계 초과 결손)
 */
import { readFileSync } from 'fs';

const BASE = process.env.AUDIT_BASE ?? 'https://flowvium.net';
const CONCURRENCY = 16;
const TIMEOUT = 12000;
const FAIL_PCT = 5;   // 핵심 데이터 결손이 5% 초과면 exit 1

const candidates = JSON.parse(readFileSync('data/candidate-tickers.json', 'utf8'));
const all = candidates.tickers;
const us = all.filter(t => !t.endsWith('.KS') && !t.endsWith('.KQ'));
const kr = all.filter(t => t.endsWith('.KS') || t.endsWith('.KQ'));

console.log(`\n[company-coverage 전수 ${all.length} 종목 (US ${us.length} + KR ${kr.length})] core=stock-price\n`);

async function hasPrice(ticker) {
  try {
    const res = await fetch(`${BASE}/api/stock-price/${encodeURIComponent(ticker)}`, {
      signal: AbortSignal.timeout(TIMEOUT), cache: 'no-store',
    });
    if (!res.ok) return false;
    const j = await res.json();
    const p = j?.price ?? j?.regularMarketPrice ?? j?.c ?? j?.close;
    return typeof p === 'number' && p > 0;
  } catch { return false; }
}

const missing = [];
let done = 0;
for (let i = 0; i < all.length; i += CONCURRENCY) {
  const batch = all.slice(i, i + CONCURRENCY);
  const results = await Promise.all(batch.map(async t => ({ t, ok: await hasPrice(t) })));
  for (const r of results) { if (!r.ok) missing.push(r.t); done++; }
  if (done % 160 === 0) console.log(`  ... ${done}/${all.length} (결손 ${missing.length})`);
}

const alive = all.length - missing.length;
const missPct = (missing.length / all.length) * 100;
const missUS = missing.filter(t => !t.endsWith('.KS') && !t.endsWith('.KQ'));
const missKR = missing.filter(t => t.endsWith('.KS') || t.endsWith('.KQ'));

console.log(`\n## 전수 결과: ${alive}/${all.length} alive (${(alive / all.length * 100).toFixed(1)}%) — 결손 ${missing.length} (US ${missUS.length} / KR ${missKR.length})`);
if (missing.length) {
  console.log(`   결손 종목(최대 30): ${missing.slice(0, 30).join(', ')}${missing.length > 30 ? ` … +${missing.length - 30}` : ''}`);
}
if (missPct > FAIL_PCT) {
  console.log(`\n❌ FAIL — 핵심 데이터 결손 ${missPct.toFixed(1)}% > ${FAIL_PCT}% (stock-price 소스/풀 정합 점검)`);
  process.exit(1);
} else {
  console.log(`\n✅ OK — 전수 ${all.length} 종목 core 데이터 ${(100 - missPct).toFixed(1)}% 보유 (결손 ${missPct.toFixed(1)}% ≤ ${FAIL_PCT}%)`);
  process.exit(0);
}
