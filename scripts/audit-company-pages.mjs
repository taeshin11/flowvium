#!/usr/bin/env node
/**
 * scripts/audit-company-pages.mjs
 *
 * 1,210 종목의 company-* API 응답 깊이 검증.
 *   - company-financials/{ticker}: US (SEC EDGAR) — revenueUSD / latestAnnual
 *   - company-kr/{ticker}: KR (DART) — 6자리 코드 (.KS/.KQ 제거)
 *   - company-news/{ticker}: 뉴스 기사 array
 *   - company-recs/{ticker}: 추천 history
 *
 * 측정: 4 endpoint × sample 종목 N개 = status 분포 + body 검증.
 *   - ok: 정상 응답 + 데이터 있음
 *   - empty: 200 응답 but data 비어있음
 *   - error: HTTP 4XX/5XX 또는 body 에 error 필드
 */
import { readFileSync } from 'node:fs';

const BASE = process.env.AUDIT_BASE ?? 'https://flowvium.net';
const SAMPLE_SIZE = parseInt(process.argv[2] ?? '40', 10); // 기본 40 ticker
const TIMEOUT = 30000;  // DART API 가 ~15-20s 소요 — 12s 부족

const candidates = JSON.parse(readFileSync('data/candidate-tickers.json', 'utf8'));
const us = candidates.tickers.filter(t => !t.endsWith('.KS') && !t.endsWith('.KQ'));
const kr = candidates.tickers.filter(t => t.endsWith('.KS') || t.endsWith('.KQ'));

// 무작위 sample
function pick(arr, n) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}
const usSample = pick(us, Math.ceil(SAMPLE_SIZE / 2));
const krSample = pick(kr, Math.floor(SAMPLE_SIZE / 2));

console.log(`\n═══════════════════════════════════════════════════════════`);
console.log(`  Company pages audit — US ${usSample.length} + KR ${krSample.length} = ${usSample.length + krSample.length} 종목`);
console.log(`  Base: ${BASE} | Timeout: ${TIMEOUT}ms`);
console.log(`═══════════════════════════════════════════════════════════\n`);

async function check(url, validator) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), cache: 'no-store' });
    const status = res.status;
    let body = null;
    try { body = await res.json(); } catch { /* */ }
    if (status < 200 || status >= 300) return { status, kind: 'error', detail: body?.error ?? `HTTP ${status}` };
    if (body?.error) return { status, kind: 'error', detail: String(body.error).slice(0, 40) };
    const v = validator(body);
    if (v.ok) return { status, kind: 'ok', detail: v.summary };
    return { status, kind: 'empty', detail: v.reason };
  } catch (e) {
    return { status: null, kind: 'error', detail: String(e.message).slice(0, 50) };
  }
}

const stats = {
  'company-financials':   { ok: 0, empty: 0, error: 0, samples: { ok: [], empty: [], error: [] } },
  'company-kr':           { ok: 0, empty: 0, error: 0, samples: { ok: [], empty: [], error: [] } },
  'company-news':         { ok: 0, empty: 0, error: 0, samples: { ok: [], empty: [], error: [] } },
  'company-recs':         { ok: 0, empty: 0, error: 0, samples: { ok: [], empty: [], error: [] } },
  'stock-price':          { ok: 0, empty: 0, error: 0, samples: { ok: [], empty: [], error: [] } },
  'market-caps':          { ok: 0, empty: 0, error: 0, samples: { ok: [], empty: [], error: [] } },
  'price-history':        { ok: 0, empty: 0, error: 0, samples: { ok: [], empty: [], error: [] } },
  'analyst-target':       { ok: 0, empty: 0, error: 0, samples: { ok: [], empty: [], error: [] } },
  'iv':                   { ok: 0, empty: 0, error: 0, samples: { ok: [], empty: [], error: [] } },
};

// 2026-05-31: 사용자 지적 — 4/11 만 검토했음. 11 endpoint 모두 audit.
const validators = {
  'company-financials': (b) => b?.revenueUSD > 0 ? { ok: true, summary: `rev=$${(b.revenueUSD/1e9).toFixed(1)}B` } : { ok: false, reason: 'no revenueUSD' },
  'company-kr':         (b) => (b?.annuals?.length > 0 || b?.fiscalYear) ? { ok: true, summary: `annuals=${b.annuals?.length ?? 0}` } : { ok: false, reason: 'no annuals' },
  'company-news':       (b) => (b?.news?.length > 0 || b?.articles?.length > 0) ? { ok: true, summary: `news=${b.news?.length ?? b.articles?.length}` } : { ok: false, reason: 'no news' },
  'company-recs':       (b) => (b?.recs?.length > 0 || b?.recommendations?.length > 0) ? { ok: true, summary: `recs=${b.recs?.length ?? b.recommendations?.length}` } : { ok: false, reason: 'no recs' },
  'stock-price':        (b) => (typeof b?.price === 'number' && b.price > 0) ? { ok: true, summary: `price=${b.price}` } : { ok: false, reason: 'no price' },
  // 2026-05-31 validator fix: 응답 구조는 b.bands[ticker] = band 단어. b.band (단수) 가 아님.
  'market-caps':        (b) => (b?.bands && Object.values(b.bands).some(v => v) || b?.marketCap > 0) ? { ok: true, summary: `bands=${Object.keys(b.bands ?? {}).length}` } : { ok: false, reason: 'no bands' },
  'price-history':      (b) => (b?.history?.length > 0 || b?.points?.length > 0) ? { ok: true, summary: `pts=${b.history?.length ?? b.points?.length}` } : { ok: false, reason: 'no history' },
  // validator fix: targetMean / targetMedian / targetHigh
  'analyst-target':     (b) => (typeof b?.targetMean === 'number' || typeof b?.targetMedian === 'number' || typeof b?.target === 'number') ? { ok: true, summary: `target=${b.targetMean ?? b.targetMedian ?? b.target}` } : { ok: false, reason: 'no target' },
  'iv':                 (b) => (typeof b?.iv === 'number' || b?.atmIv30d || b?.ivRank) ? { ok: true, summary: `iv=${b.iv ?? b.atmIv30d}` } : { ok: false, reason: 'no iv' },
};

// 병렬 8 = balance speed/rate-limit
const CONCURRENCY = 8;

async function runFor(name, tickers) {
  for (let i = 0; i < tickers.length; i += CONCURRENCY) {
    const batch = tickers.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(async t => {
      // company-kr 은 .KS/.KQ 제거된 6자리 사용
      const apiTicker = name === 'company-kr' ? t.replace(/\.(KS|KQ)$/, '') : t;
      // query param 방식: company-news / market-caps / price-history
      const url = (name === 'company-news' || name === 'market-caps' || name === 'price-history')
        ? `${BASE}/api/${name}?ticker=${encodeURIComponent(apiTicker)}`
        : `${BASE}/api/${name}/${apiTicker}`;
      const r = await check(url, validators[name]);
      return { ticker: t, ...r };
    }));
    for (const r of results) {
      stats[name][r.kind]++;
      const samples = stats[name].samples[r.kind];
      if (samples.length < 5) samples.push(`${r.ticker}(${r.detail})`);
    }
  }
}

// US 종목: company-financials + company-news + company-recs + 공통 7개
// KR 종목: company-kr + company-news + company-recs + 공통 7개
await runFor('company-financials', usSample);
await runFor('company-kr', krSample);
await runFor('company-news', [...usSample, ...krSample]);
await runFor('company-recs', [...usSample, ...krSample]);
await runFor('stock-price', [...usSample, ...krSample]);
await runFor('market-caps', [...usSample, ...krSample]);
await runFor('price-history', [...usSample, ...krSample]);
await runFor('analyst-target', usSample); // KR 은 analyst target 없음
await runFor('iv', usSample); // KR 은 IV 없음

console.log(`## API 별 응답 분포 (sample)\n`);
for (const [api, s] of Object.entries(stats)) {
  const total = s.ok + s.empty + s.error;
  const okPct = total ? (s.ok / total * 100).toFixed(0) : 0;
  const emptyPct = total ? (s.empty / total * 100).toFixed(0) : 0;
  const errPct = total ? (s.error / total * 100).toFixed(0) : 0;
  console.log(`/${api.padEnd(20)} ✅ ok ${String(s.ok).padStart(3)}/${total} (${okPct}%) | ⚠️  empty ${s.empty} (${emptyPct}%) | ❌ error ${s.error} (${errPct}%)`);
  if (s.samples.error.length) console.log(`  error samples: ${s.samples.error.slice(0, 3).join(', ')}`);
  if (s.samples.empty.length) console.log(`  empty samples: ${s.samples.empty.slice(0, 3).join(', ')}`);
}

const totalChecks = Object.values(stats).reduce((s, v) => s + v.ok + v.empty + v.error, 0);
const okTotal = Object.values(stats).reduce((s, v) => s + v.ok, 0);
console.log(`\n## 종합: ${okTotal}/${totalChecks} ok (${(okTotal/totalChecks*100).toFixed(0)}%)`);
process.exit(0);
