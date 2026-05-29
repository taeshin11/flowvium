#!/usr/bin/env node
/**
 * scripts/prefetch-dart-financials.mjs
 *
 * KOSPI 200 + KOSDAQ 150 (data/kr-major-indexes.json) 345개 종목의
 * /api/company-kr/{code} 를 일괄 호출 → 서버 Redis 캐시 (24h) 갱신.
 *
 * 기업별 페이지가 ondemand fetch 라 portfolio 외 종목은 stale 상태.
 * 매일 03:00 KST 실행 → KR 345종목 전부 fresh.
 *
 * 환경변수: NEXT_PUBLIC_SITE_URL (기본 https://flowvium.net)
 * 실행: node scripts/prefetch-dart-financials.mjs
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://flowvium.net').replace(/\/$/, '');
const CONCURRENCY = 4; // DART rate limit (OpenAPI 분당 100 호출 한도) 보호
const PER_BATCH_DELAY_MS = 800;
const REQUEST_TIMEOUT_MS = 45_000;

const idx = JSON.parse(readFileSync(resolve(ROOT, 'data/kr-major-indexes.json'), 'utf8'));
const codes = [
  ...idx.kospi.tickers.map(t => ({ code: t.replace(/\.KS$/, ''), market: 'KOSPI' })),
  ...idx.kosdaq.tickers.map(t => ({ code: t.replace(/\.KQ$/, ''), market: 'KOSDAQ' })),
];

console.log(`▶ DART prefetch ${codes.length} 종목 (KOSPI ${idx.kospi.total} + KOSDAQ ${idx.kosdaq.total})`);
console.log(`  target=${SITE}, concurrency=${CONCURRENCY}, batch delay=${PER_BATCH_DELAY_MS}ms`);

let ok = 0, fail = 0, cached = 0;
const failures = [];
const startMs = Date.now();

for (let i = 0; i < codes.length; i += CONCURRENCY) {
  const batch = codes.slice(i, i + CONCURRENCY);
  const results = await Promise.allSettled(batch.map(async ({ code, market }) => {
    const url = `${SITE}/api/company-kr/${code}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.error) {
      throw new Error(`${code} (${market}) HTTP ${res.status} ${body?.error ?? ''}`);
    }
    return { code, market, cached: !!body?.cached };
  }));
  for (const r of results) {
    if (r.status === 'fulfilled') {
      ok++;
      if (r.value?.cached) cached++;
    } else {
      fail++;
      failures.push(String(r.reason?.message ?? r.reason).slice(0, 100));
    }
  }
  if ((i / CONCURRENCY) % 10 === 0 || i + CONCURRENCY >= codes.length) {
    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    console.log(`  ${Math.min(i + CONCURRENCY, codes.length)}/${codes.length} (ok=${ok} fail=${fail} cached=${cached}, ${elapsed}s)`);
  }
  if (i + CONCURRENCY < codes.length) await new Promise(r => setTimeout(r, PER_BATCH_DELAY_MS));
}

const totalSec = ((Date.now() - startMs) / 1000).toFixed(1);
console.log(`\n✅ 완료: ${ok}/${codes.length} (cached hit ${cached}, fresh fetch ${ok - cached}, fail ${fail}) — ${totalSec}s`);

if (failures.length) {
  console.log(`\n실패 sample (max 5):`);
  for (const f of failures.slice(0, 5)) console.log('  - ' + f);
}

if (fail > codes.length * 0.2) {
  console.error(`\n⚠️ 실패율 ${(fail / codes.length * 100).toFixed(1)}% — DART API 키 / rate limit 점검 필요`);
  process.exit(1);
}
