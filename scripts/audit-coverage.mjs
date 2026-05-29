#!/usr/bin/env node
/**
 * scripts/audit-coverage.mjs
 *
 * "있어야 할 것" vs "실제 적재" 비교 — silent NULL + endpoint 미스매치 +
 * archive 누락 자동 detect. audit-all 의 표면 점검 보완.
 *
 * 매주 또는 매 fix push 후 실행 권장.
 */
import Database from 'better-sqlite3';
const db = new Database('C:/NoAddsMakingApps/FlowVium/data/flowvium.db', { readonly: true });

let errCount = 0;
const ERR = '❌', WARN = '⚠️ ', OK = '✅';
function err(msg) { console.log(`${ERR} ${msg}`); errCount++; }
function warn(msg) { console.log(`${WARN} ${msg}`); }
function ok(msg) { console.log(`${OK} ${msg}`); }

console.log('═══════════════════════════════════════════════════════════');
console.log('  Coverage Audit — "있어야 할 것" vs "실제 적재"');
console.log('═══════════════════════════════════════════════════════════\n');

// ═══════ Probe 1: 모든 테이블의 column NULL 비율 ═══════
console.log('## [1] silent NULL audit (column 있는데 항상 NULL)\n');

const tables = db.prepare(`
  SELECT name FROM sqlite_master
  WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%' AND name NOT LIKE '%_data' AND name NOT LIKE '%_idx' AND name NOT LIKE '%_docsize' AND name NOT LIKE '%_config' AND name NOT LIKE '%_content'
`).all().map(r => r.name);

for (const t of tables) {
  const total = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
  if (total < 10) continue; // 적은 데이터 skip
  const cols = db.prepare(`PRAGMA table_info(${t})`).all();
  const lowCovCols = [];
  for (const c of cols) {
    if (['id', 'created_at'].includes(c.name)) continue;
    if (c.notnull) continue; // NOT NULL constraint
    const nullCnt = db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE ${c.name} IS NULL`).get().c;
    const nullPct = (nullCnt / total) * 100;
    if (nullPct >= 80) lowCovCols.push(`${c.name}(${nullPct.toFixed(0)}%null)`);
  }
  if (lowCovCols.length > 0) {
    err(`${t}: ${lowCovCols.length} col NULL ≥80% — ${lowCovCols.slice(0, 5).join(', ')}`);
  } else {
    ok(`${t}: ${total} rows / 모든 column coverage 정상`);
  }
}

// ═══════ Probe 2: endpoint 적재 vs 인텔리전스 탭 expected ═══════
console.log('\n## [2] endpoint 적재 vs intelligence/signals 페이지 의존 비교\n');

// app pages 가 호출하는 endpoint (manifest)
const EXPECTED_PAGE_ENDPOINTS = {
  intelligence: [
    '/api/fear-greed', '/api/capital-flows', '/api/macro-indicators', '/api/credit-balance',
    '/api/sector-pe', '/api/sector-metrics', '/api/yield-curve', '/api/fedwatch',
    '/api/commodity-curve', '/api/cot-positions', '/api/korea-flow',
  ],
  signals: [
    '/api/signals', '/api/short-interest', '/api/insider-trades', '/api/ownership-alerts',
    '/api/nport-holdings', '/api/supply-chain-signals',
  ],
  volatility: ['/api/iv-screener', '/api/volatility'],
  heatmap: ['/api/market-heatmap', '/api/market-caps'],
  news: ['/api/news-cascade', '/api/cascade-events', '/api/economic-calendar'],
  company: ['/api/company-financials', '/api/company-kr'],
};

const captured = db.prepare(`
  SELECT DISTINCT endpoint FROM endpoint_snapshots
  WHERE captured_at >= datetime('now','-3 days')
`).all().map(r => r.endpoint);
const capSet = new Set(captured);
// /api/X?param 도 /api/X 로 normalize
const capNormSet = new Set(captured.map(e => e.split('?')[0]).concat(captured));

for (const [page, eps] of Object.entries(EXPECTED_PAGE_ENDPOINTS)) {
  const missing = eps.filter(e => !capNormSet.has(e) && !capSet.has(e));
  if (missing.length === 0) {
    ok(`/${page} page: ${eps.length}/${eps.length} endpoint 적재 중`);
  } else {
    warn(`/${page} page: ${eps.length - missing.length}/${eps.length} — 누락: ${missing.join(', ')}`);
  }
}

// ═══════ Probe 3: domain archive 적재 비교 (보고서마다 적재되어야 할 것) ═══════
console.log('\n## [3] domain archive 적재율 (매 보고서마다 있어야 함)\n');

const totalReports = db.prepare(`SELECT COUNT(*) c FROM reports WHERE generated_at >= datetime('now','-7 days')`).get().c;
const archiveTables = [
  { name: 'recommendations',         expected: totalReports * 6,  perReport: '6-8 종목' },
  { name: 'endpoint_snapshots',      expected: totalReports * 24, perReport: '24 endpoint' },
  { name: 'news_archive',            expected: totalReports * 5,  perReport: '5+ 뉴스' },
  { name: 'macro_snapshots',         expected: totalReports,      perReport: '1 시점 압축' },
  { name: 'short_squeeze_archive',   expected: totalReports * 3,  perReport: '3 종목' },
  { name: 'earnings_archive',        expected: totalReports * 3,  perReport: '3 회사' },
  { name: 'insider_archive',         expected: totalReports * 2,  perReport: '2 신호' },
  { name: 'fg_archive',              expected: totalReports * 10, perReport: '10 국가' },
  { name: 'asset_flow_archive',      expected: totalReports * 15, perReport: '15 자산' },
];

for (const at of archiveTables) {
  // 테이블별 timestamp column 자동 선택
  const cols = db.prepare(`PRAGMA table_info(${at.name})`).all().map(c => c.name);
  const ts = cols.includes('captured_at') ? 'captured_at'
    : cols.includes('generated_at') ? 'generated_at'
    : cols.includes('evaluated_at') ? 'evaluated_at'
    : null;
  if (!ts) { warn(`${at.name}: timestamp column 없음`); continue; }
  const actual = db.prepare(`SELECT COUNT(*) c FROM ${at.name} WHERE ${ts} >= datetime('now','-7 days')`).get().c;
  const ratio = at.expected > 0 ? (actual / at.expected) * 100 : 0;
  if (ratio >= 80) {
    ok(`${at.name.padEnd(28)} ${actual}/${at.expected} (${ratio.toFixed(0)}%) — ${at.perReport}`);
  } else if (ratio >= 30) {
    warn(`${at.name.padEnd(28)} ${actual}/${at.expected} (${ratio.toFixed(0)}%) — 부분 적재`);
  } else {
    err(`${at.name.padEnd(28)} ${actual}/${at.expected} (${ratio.toFixed(0)}%) — 적재 거의 안 됨`);
  }
}

// ═══════ Probe 3b: S&P 500 / KOSPI 커버 ═══════
console.log('\n## [3a] S&P 500 / KOSPI / KOSDAQ candidate 커버 ===\n');
import { readFileSync } from 'fs';
try {
  const sp500 = JSON.parse(readFileSync('C:/NoAddsMakingApps/FlowVium/data/sp500-tickers.json', 'utf8'));
  const cand = JSON.parse(readFileSync('C:/NoAddsMakingApps/FlowVium/data/candidate-tickers.json', 'utf8'));
  const candSet = new Set(cand.tickers);
  const missing = sp500.tickers.filter(t => !candSet.has(t) && !candSet.has(t.replace('-', '.')));
  const coverage = ((sp500.tickers.length - missing.length) / sp500.tickers.length * 100).toFixed(1);
  if (missing.length === 0) {
    ok(`S&P 500: ${sp500.tickers.length}/${sp500.tickers.length} (100%)`);
  } else if (missing.length < sp500.tickers.length * 0.05) {
    warn(`S&P 500: ${sp500.tickers.length - missing.length}/${sp500.tickers.length} (${coverage}%) — ${missing.length}개 누락: ${missing.slice(0,8).join(', ')}...`);
  } else {
    err(`S&P 500: ${sp500.tickers.length - missing.length}/${sp500.tickers.length} (${coverage}%) — ${missing.length}개 누락 (5% 초과)`);
  }
  const krCount = cand.tickers.filter(t => t.endsWith('.KS') || t.endsWith('.KQ')).length;
  ok(`KR 종목 (KOSPI + KOSDAQ): ${krCount} 종목`);
  // KOSPI 200 + KOSDAQ 150 커버 비교
  try {
    const krIdx = JSON.parse(readFileSync('C:/NoAddsMakingApps/FlowVium/data/kr-major-indexes.json', 'utf8'));
    const expectedKr = [...(krIdx.kospi?.tickers ?? []), ...(krIdx.kosdaq?.tickers ?? [])];
    const missingKr = expectedKr.filter(t => !candSet.has(t));
    const krCov = ((expectedKr.length - missingKr.length) / expectedKr.length * 100).toFixed(1);
    if (missingKr.length === 0) ok(`KOSPI 200 + KOSDAQ 150: ${expectedKr.length}/${expectedKr.length} (100%)`);
    else if (missingKr.length < 10) warn(`KOSPI 200 + KOSDAQ 150: ${expectedKr.length - missingKr.length}/${expectedKr.length} (${krCov}%) — ${missingKr.length}개 누락`);
    else err(`KOSPI 200 + KOSDAQ 150: ${expectedKr.length - missingKr.length}/${expectedKr.length} (${krCov}%) — ${missingKr.length}개 누락`);
  } catch {}
} catch (e) {
  warn(`S&P 500 coverage check 실패: ${String(e).slice(0,80)}`);
}

// ═══════ Probe 4b: 잘못된 값 범위 (NULL 아닌 silent bug — Codex 진단) ═══════
console.log('\n## [4a] invalid value range (0/음수/불가능 범위)\n');
const ranges = [
  { table: 'macro_snapshots', col: 'fg_score',  min: 0, max: 100 },
  { table: 'macro_snapshots', col: 'vix',       min: 5, max: 100 },
  { table: 'macro_snapshots', col: 'cpi',       min: -5, max: 30 },
  { table: 'macro_snapshots', col: 'fed_rate',  min: 0, max: 20 },
  { table: 'macro_snapshots', col: 'yield_10y', min: 0, max: 20 },
  { table: 'fg_archive',      col: 'score',     min: 0, max: 100 },
  { table: 'short_squeeze_archive', col: 'score', min: 0, max: 100 },
  { table: 'short_squeeze_archive', col: 'short_pct', min: 0, max: 100 },
  { table: 'earnings_archive', col: 'op_margin',  min: -100, max: 100 },
  { table: 'earnings_archive', col: 'revenue_yoy', min: -100, max: 1000 },
  { table: 'recommendations', col: 'allocation', min: 0, max: 100 },
];
for (const r of ranges) {
  const invalid = db.prepare(`SELECT COUNT(*) c FROM ${r.table} WHERE ${r.col} IS NOT NULL AND (${r.col} < ? OR ${r.col} > ?)`).get(r.min, r.max).c;
  if (invalid > 0) err(`${r.table}.${r.col}: ${invalid} row 가 [${r.min}, ${r.max}] 범위 밖`);
}

// ═══════ Probe 3b: endpoint HTTP status 분포 (4XX/5XX 무더기 = 라우트 죽어있음) ═══════
// 2026-05-29: DART /api/company-kr 가 처음부터 100% 404 였는데 audit 가 못 잡은 사건 fix.
//   증상 = endpoint_snapshots.http_status 4XX 비율이 모든 호출의 50%+ 또는 응답 본문에 "error" 필드.
//   추가로 body 안의 error JSON 도 본다 (200 OK 인데 {"error": "..."} 인 케이스).
console.log('\n## [3b] endpoint HTTP status (4XX/5XX 비율 ≥50% = 라우트 죽음)\n');

const statusDist = db.prepare(`
  SELECT endpoint, http_status, COUNT(*) c
  FROM endpoint_snapshots
  WHERE captured_at >= datetime('now','-7 days')
  GROUP BY endpoint, http_status
`).all();
const epStatus = new Map(); // endpoint → { ok, err4, err5, total }
for (const r of statusDist) {
  if (!epStatus.has(r.endpoint)) epStatus.set(r.endpoint, { ok: 0, err4: 0, err5: 0, total: 0 });
  const e = epStatus.get(r.endpoint);
  e.total += r.c;
  if (r.http_status >= 200 && r.http_status < 300) e.ok += r.c;
  else if (r.http_status >= 400 && r.http_status < 500) e.err4 += r.c;
  else if (r.http_status >= 500) e.err5 += r.c;
}
for (const [ep, s] of epStatus) {
  if (s.total < 3) continue; // 표본 부족
  const errPct = ((s.err4 + s.err5) / s.total) * 100;
  if (errPct >= 50) {
    err(`${(ep ?? '?').padEnd(40)} 4XX:${s.err4} 5XX:${s.err5} / ${s.total} (${errPct.toFixed(0)}% 실패) — 라우트 죽음 의심`);
  } else if (errPct >= 20) {
    warn(`${(ep ?? '?').padEnd(40)} 4XX:${s.err4} 5XX:${s.err5} / ${s.total} (${errPct.toFixed(0)}% 실패)`);
  }
}

// 200 OK 인데 응답 본문에 error 필드 — silent failure
const errBodies = db.prepare(`
  SELECT endpoint, COUNT(*) c
  FROM endpoint_snapshots
  WHERE captured_at >= datetime('now','-7 days')
    AND http_status = 200
    AND response_json LIKE '%"error"%'
  GROUP BY endpoint
  HAVING c >= 2
`).all();
for (const r of errBodies) {
  err(`${(r.endpoint ?? '?').padEnd(40)} 200 OK 인데 body 에 "error" 필드 ${r.c} 회 (silent failure)`);
}

// ═══════ Probe 3c: portfolio ticker ↔ snapshot 정합성 ═══════
// 2026-05-29: DART /api/company-kr 가 portfolio 에 KR ticker 있어도 0건 snapshot 된 사건 fix.
//   증상 = recent 보고서의 portfolio ticker 가 N 개인데 company-* snapshot 이 N 보다 한참 적음.
console.log('\n## [3c] portfolio ticker ↔ company-* snapshot 정합성\n');

const recentReports = db.prepare(`
  SELECT id, generated_at, full_json
  FROM reports
  WHERE generated_at >= datetime('now','-7 days')
  ORDER BY generated_at DESC
`).all();

let totalExpected = 0, totalSnapshotted = 0, problemReports = 0;
for (const r of recentReports) {
  let portfolioTickers = [];
  try {
    const j = JSON.parse(r.full_json);
    portfolioTickers = (j.portfolio ?? []).map(p => p.ticker).filter(Boolean);
  } catch { continue; }
  if (!portfolioTickers.length) continue;

  const snaps = db.prepare(`
    SELECT endpoint FROM endpoint_snapshots
    WHERE report_id=? AND (endpoint LIKE '/api/company-financials/%' OR endpoint LIKE '/api/company-kr/%')
  `).all(r.id);
  const snappedTickers = new Set();
  for (const s of snaps) {
    const m = s.endpoint.match(/\/(company-financials|company-kr)\/(.+)$/);
    if (m) snappedTickers.add(m[2].toUpperCase());
  }
  const expected = portfolioTickers.length;
  const got = snappedTickers.size;
  totalExpected += expected;
  totalSnapshotted += got;
  if (got < expected) {
    problemReports++;
    if (problemReports <= 3) {
      const missing = portfolioTickers.filter(t => !snappedTickers.has(t.replace(/\.(KS|KQ)$/, '').toUpperCase()) && !snappedTickers.has(t.toUpperCase()));
      console.log(`  report ${r.id}: portfolio ${expected} → snapshot ${got}, 누락 ${missing.length}: ${missing.slice(0,4).join(', ')}`);
    }
  }
}
if (problemReports >= 2) {
  err(`portfolio↔snapshot mismatch: ${problemReports}/${recentReports.length} 보고서, 합산 ${totalSnapshotted}/${totalExpected} ticker (snapshot-endpoints.mjs 의 portfolioTickers 옵션 전달 점검)`);
} else if (totalExpected > 0) {
  ok(`portfolio↔snapshot 정합성: ${totalSnapshotted}/${totalExpected} ticker (${recentReports.length} 보고서)`);
}

// ═══════ Probe 4: 동일 응답 반복 (drift 없음 = stale) ═══════
console.log('\n## [4] 응답 drift (정적 데이터 의심)\n');

const driftCheck = db.prepare(`
  SELECT endpoint, COUNT(DISTINCT response_json) unique_resp, COUNT(*) total
  FROM endpoint_snapshots
  WHERE captured_at >= datetime('now','-7 days')
  GROUP BY endpoint
  HAVING total >= 5
`).all();
for (const r of driftCheck) {
  const driftRatio = (r.unique_resp / r.total) * 100;
  if (driftRatio < 30) {
    warn(`${(r.endpoint ?? '?').padEnd(34)} unique ${r.unique_resp}/${r.total} (${driftRatio.toFixed(0)}%) — 정적 의심`);
  }
}

// ═══════ 종합 ═══════
console.log(`\n═══ 종합 ═══`);
console.log(`silent NULL + 누락 + drift: ${errCount} 결함`);
process.exit(errCount > 0 ? 1 : 0);
