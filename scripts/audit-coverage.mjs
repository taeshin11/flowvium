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
import { readFileSync, readdirSync, statSync } from 'fs';
const ROOT = 'C:/NoAddsMakingApps/FlowVium';
const db = new Database(`${ROOT}/data/flowvium.db`, { readonly: true });

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

// 2026-06-05: 구조적 NULL(데이터가 본래 N/A) 인지 — 버그가 아닌 NULL 을 ❌ 로 over-flag 하지 않음.
//   각 항목은 audit 으로 검증된 "왜 NULL 인가" 의 결론(증거 동반). earnings_archive 는 실버그라 fix(1fa371d),
//   아래는 구조적이라 [L2] 처럼 정직하게 acknowledged 처리해 verification 정확도 확보(사용자 "권고 말고 고쳐").
const STRUCTURAL_NULLS = {
  'news_archive.pub_date': 'company-change 행은 기사 아님→날짜 N/A (news-cascade 행은 pub_date 100%)',
  'news_archive.link': 'company-change 행은 기사 링크 없음 (news-cascade 행은 link 100%)',
  'asset_flow_archive.return_1d': 'capital-flows 가 1w/4w/13w 제공, 1d 미제공(소스 부재)',
  'hallucination_history.details_json': 'defect_type 별 details 유무 상이(일부 defect 본문 없음)',
  'short_squeeze_archive.rationale': 'LLM squeeze 후보에 rationale 필드 없음(score/timing/risk 만)',
  'recommendation_outcomes.quality_score': '백테스트 품질 scoring 미배선(분석용 옵션 컬럼)',
};

const tables = db.prepare(`
  SELECT name FROM sqlite_master
  WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%' AND name NOT LIKE '%_data' AND name NOT LIKE '%_idx' AND name NOT LIKE '%_docsize' AND name NOT LIKE '%_config' AND name NOT LIKE '%_content'
`).all().map(r => r.name);

const skippedSmall = [];
const ackStructural = [];
for (const t of tables) {
  const total = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
  if (total < 10) { skippedSmall.push(`${t}(${total})`); continue; } // 적은 데이터 skip — 사각지대 가시화
  const cols = db.prepare(`PRAGMA table_info(${t})`).all();
  const lowCovCols = [];
  for (const c of cols) {
    if (['id', 'created_at'].includes(c.name)) continue;
    if (c.notnull) continue; // NOT NULL constraint
    const nullCnt = db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE ${c.name} IS NULL`).get().c;
    const nullPct = (nullCnt / total) * 100;
    if (nullPct >= 80) {
      const key = `${t}.${c.name}`;
      if (STRUCTURAL_NULLS[key]) ackStructural.push(`${key}(${nullPct.toFixed(0)}%) — ${STRUCTURAL_NULLS[key]}`);
      else lowCovCols.push(`${c.name}(${nullPct.toFixed(0)}%null)`);
    }
  }
  if (lowCovCols.length > 0) {
    err(`${t}: ${lowCovCols.length} col NULL ≥80% (미인지) — ${lowCovCols.slice(0, 5).join(', ')}`);
  } else {
    ok(`${t}: ${total} rows / 모든 column coverage 정상`);
  }
}

if (skippedSmall.length) console.log(`  ℹ️  NULL audit skip (행<10, 사각지대 가시화): ${skippedSmall.join(', ')}`);
if (ackStructural.length) {
  console.log(`  ℹ️  구조적 NULL ${ackStructural.length}개 (검증됨·acknowledged, 버그 아님):`);
  for (const s of ackStructural) console.log(`     - ${s}`);
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
// 2026-05-30: "error":" 패턴으로 강화 — "errorPolicy", "warning" 같은 false positive 차단.
const errBodies = db.prepare(`
  SELECT endpoint, COUNT(*) c
  FROM endpoint_snapshots
  WHERE captured_at >= datetime('now','-7 days')
    AND http_status = 200
    AND (response_json LIKE '%"error":"%' OR response_json LIKE '%"error":{%')
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

// ═══════ Probe 5: buy/sell rule 카테고리 대칭 ═══════
// 2026-05-29 사건 — sell rule 에 "가격/기술/기본/구루/거시/미시/회전" 7개 카테고리를 가졌는데
// buy rule 은 ad-hoc 추가로 한쪽에만 있는 카테고리 노출. 한쪽에만 있는 카테고리는 silent gap.
console.log('\n## [5] buy/sell rule 카테고리 대칭 (Karpathy pathway 무결성)\n');
try {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const buy = JSON.parse(fs.readFileSync(path.resolve('data/buy-rules-tuned.json'), 'utf8'));
  const sell = JSON.parse(fs.readFileSync(path.resolve('data/sell-rules-tuned.json'), 'utf8'));
  const buyCats = new Map();
  const sellCats = new Map();
  for (const r of (buy.rules ?? [])) buyCats.set(r.category ?? '?', (buyCats.get(r.category ?? '?') ?? 0) + 1);
  for (const r of (sell.rules ?? [])) sellCats.set(r.category ?? '?', (sellCats.get(r.category ?? '?') ?? 0) + 1);
  // selflearn 은 buy 전용 (boost/ban-list) — sell 에 굳이 없어도 됨
  const expected = ['price', 'technical', 'fundamental', 'guru', 'macro', 'micro', 'rotation'];
  const missingBuy = expected.filter(c => !buyCats.has(c));
  const missingSell = expected.filter(c => !sellCats.has(c));
  if (missingBuy.length) err(`buy rules — 카테고리 누락: ${missingBuy.join(', ')}`);
  else ok(`buy rules — 7개 카테고리 모두 cover (총 ${buy.rules.length}개 룰)`);
  if (missingSell.length) err(`sell rules — 카테고리 누락: ${missingSell.join(', ')}`);
  else ok(`sell rules — 7개 카테고리 모두 cover (총 ${sell.rules.length}개 룰)`);
  // category 필드 자체가 비어있는 룰 색출 (silent omission)
  const buyNoCat = (buy.rules ?? []).filter(r => !r.category).map(r => r.id);
  const sellNoCat = (sell.rules ?? []).filter(r => !r.category).map(r => r.id);
  if (buyNoCat.length) err(`buy rules — category 필드 빈 룰 ${buyNoCat.length}건: ${buyNoCat.slice(0, 3).join(', ')}`);
  if (sellNoCat.length) err(`sell rules — category 필드 빈 룰 ${sellNoCat.length}건: ${sellNoCat.slice(0, 3).join(', ')}`);
} catch (e) {
  warn(`buy/sell rule 카테고리 점검 실패: ${e.message}`);
}

// ═══════ Probe 6: buy_candidates 적재 (Karpathy source — 선택 12 외 후보 보존) ═══════
console.log('\n## [6] buy_candidates 적재 — 선택 외 후보 보존 (Karpathy 학습 source)\n');
try {
  const bcRows = db.prepare(`SELECT COUNT(*) c, COUNT(DISTINCT report_id) r FROM buy_candidates WHERE generated_at >= datetime('now','-14 days')`).get();
  if (bcRows.c === 0) {
    warn(`buy_candidates 14일간 0건 — saveBuyCandidates 미연결 의심`);
  } else {
    const perReport = bcRows.c / Math.max(bcRows.r, 1);
    if (perReport < 10) err(`buy_candidates avg ${perReport.toFixed(1)}/report — top30 적재 기대 (저공급 의심)`);
    else ok(`buy_candidates ${bcRows.c}건 / ${bcRows.r} reports (avg ${perReport.toFixed(0)}/report)`);
    // matched_rules JSON 검증 — category 필드 누락 silent omission
    const sample = db.prepare(`SELECT matched_rules FROM buy_candidates WHERE matched_rules IS NOT NULL ORDER BY generated_at DESC LIMIT 1`).get();
    if (sample) {
      try {
        const arr = JSON.parse(sample.matched_rules);
        const noCat = arr.filter(r => !r.category).length;
        if (noCat > 0) err(`buy_candidates.matched_rules — category 필드 누락 ${noCat}/${arr.length}건 (sample)`);
        else ok(`buy_candidates.matched_rules — category 필드 모두 채워짐 (sample ${arr.length}건)`);
      } catch { warn(`buy_candidates.matched_rules JSON parse 실패`); }
    }
  }
} catch (e) {
  warn(`buy_candidates 점검 실패: ${e.message}`);
}

// ═══════ Probe 7: portfolio entryZone vs price_at_gen gap ═══════
// 2026-05-29 NVDA $288 환각 사건 — LLM entryZone 이 현재가 +34% 였는데도 통과해서 NE 확정.
// 최근 5보고서 portfolio 각 ticker 의 entryZone-price_at_gen gap 분포 → ±10% 초과 비율 알람.
console.log('\n## [7] portfolio entryZone vs price_at_gen gap (NE 환각 차단)\n');
try {
  const rows = db.prepare(`
    SELECT report_id, ticker, price_at_gen, entry_low, entry_high
    FROM recommendations
    WHERE generated_at >= datetime('now','-7 days')
      AND price_at_gen IS NOT NULL
      AND entry_low IS NOT NULL AND entry_high IS NOT NULL
  `).all();
  let bad = 0, total = 0;
  const badSamples = [];
  for (const r of rows) {
    if (!isFinite(r.entry_low) || !isFinite(r.entry_high) || !isFinite(r.price_at_gen) || r.price_at_gen <= 0) continue;
    total++;
    const mid = (r.entry_low + r.entry_high) / 2;
    const gap = Math.abs(mid / r.price_at_gen - 1) * 100;
    // 2026-05-30: ±10% → ±5% 강화 (minor NE 위험도 catch)
    if (gap > 5) {
      bad++;
      if (badSamples.length < 5) badSamples.push(`${r.ticker}(${r.report_id.slice(0,10)}: ${gap.toFixed(0)}%)`);
    }
  }
  const pct = total ? (bad / total * 100).toFixed(1) : '?';
  if (bad === 0 && total > 0) ok(`entryZone gap — ${total} 종목 모두 ±5% 이내 (NE 위험 0)`);
  else if (bad / Math.max(total, 1) < 0.10) warn(`entryZone gap — ${bad}/${total} (${pct}%) 가 ±5% 초과: ${badSamples.join(', ')}`);
  else err(`entryZone gap — ${bad}/${total} (${pct}%) 가 ±5% 초과 (NE 위험 양산): ${badSamples.join(', ')}`);
} catch (e) {
  warn(`entryZone gap 점검 실패: ${e.message}`);
}

// ═══════ Probe 8: invalid KR ticker (candidate-tickers 풀 외 ticker 적재) ═══════
// 2026-05-29 056100~130.KS 환각 사건 — LLM 가 존재하지 않는 6자리 코드 만들어냄.
// candidate-tickers.json 풀에 없는 KR 6자리 ticker 가 recommendations 에 들어가면 ❌.
console.log('\n## [8] invalid KR ticker (LLM 환각 6자리 코드 차단)\n');
try {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const pool = JSON.parse(fs.readFileSync(path.resolve('data/candidate-tickers.json'), 'utf8'));
  const krSet = new Set();
  for (const t of (pool.tickers ?? [])) {
    const m = String(t).match(/^(\d{6})\.(KS|KQ)$/);
    if (m) { krSet.add(`${m[1]}.KS`); krSet.add(`${m[1]}.KQ`); }
  }
  const rows = db.prepare(`
    SELECT DISTINCT ticker FROM recommendations
    WHERE generated_at >= datetime('now','-30 days') AND ticker LIKE '%.K%'
  `).all();
  const bad = [];
  for (const r of rows) {
    if (!krSet.has(r.ticker)) bad.push(r.ticker);
  }
  if (bad.length === 0) ok(`KR ticker — 최근 30일 모두 candidate-tickers 풀 안 (환각 0)`);
  else err(`KR ticker 환각 ${bad.length}건 적재 — ${bad.slice(0, 8).join(', ')}`);
} catch (e) {
  warn(`KR ticker 점검 실패: ${e.message}`);
}

// ═══════ Probe 10: company API 깊이 (1,210 종목 페이지 sample) ═══════
// 2026-05-31 사용자 지적: "Routing이 문제가 아니라 그 내부에 세부내용들이 1210종목 다 정확히 들어가있어?"
// audit-company-pages.mjs 와 동일 검증 (sample 작은 사이즈) — 매 audit 마다 회귀 detect.
console.log('\n## [10] company API 깊이 (sample 12 ticker × 4 API)\n');
try {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const pool = JSON.parse(fs.readFileSync(path.resolve('data/candidate-tickers.json'), 'utf8'));
  const us = pool.tickers.filter(t => !t.endsWith('.KS') && !t.endsWith('.KQ'));
  const kr = pool.tickers.filter(t => t.endsWith('.KS') || t.endsWith('.KQ'));
  const usSample = us.sort(() => Math.random() - 0.5).slice(0, 6);
  const krSample = kr.sort(() => Math.random() - 0.5).slice(0, 6);
  const base = 'https://flowvium.net';

  async function probe(url, validator) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000), cache: 'no-store' });
      if (!res.ok) return { kind: 'error' };
      const body = await res.json().catch(() => null);
      if (body?.error) return { kind: 'error' };
      return validator(body) ? { kind: 'ok' } : { kind: 'empty' };
    } catch { return { kind: 'error' }; }
  }
  // 2026-05-31: /company index page 404 사건 — routing 도 자동 detect.
  try {
    const idxRes = await fetch(`${base}/ko/company`, { signal: AbortSignal.timeout(10000), redirect: 'manual' });
    if (idxRes.status === 404) err(`/company index page — 404 (page.tsx 없음)`);
    else if (idxRes.status >= 200 && idxRes.status < 400) ok(`/company index page — HTTP ${idxRes.status}`);
    else warn(`/company index page — HTTP ${idxRes.status}`);
  } catch (e) { warn(`/company routing 점검 실패: ${e.message}`); }
  // 2026-05-31: 11 endpoint × sample → 사용자 가시 페이지 데이터 모두 검증.
  const results = {};
  for (const [name, sample, val] of [
    ['company-financials', usSample, b => b?.revenueUSD > 0],
    ['company-kr', krSample, b => b?.annuals?.length > 0],
    ['company-news', [...usSample, ...krSample], b => b?.news?.length > 0],
    ['company-recs', [...usSample, ...krSample], b => b?.recs?.length > 0],
    ['stock-price', [...usSample, ...krSample], b => typeof b?.price === 'number' && b.price > 0],
    ['market-caps', [...usSample, ...krSample], b => b?.bands && Object.values(b.bands).some(v => v)],
    ['price-history', [...usSample, ...krSample], b => b?.points?.length > 0 || b?.history?.length > 0],
    ['analyst-target', usSample, b => typeof b?.targetMean === 'number' || typeof b?.targetMedian === 'number'],
    ['iv', usSample, b => typeof b?.iv === 'number' || b?.atmIv30d],
  ]) {
    const counts = { ok: 0, empty: 0, error: 0 };
    for (const t of sample) {
      const apiT = name === 'company-kr' ? t.replace(/\.(KS|KQ)$/, '') : t;
      const isQuery = ['company-news', 'market-caps', 'price-history'].includes(name);
      const url = isQuery ? `${base}/api/${name}?ticker=${encodeURIComponent(apiT)}` : `${base}/api/${name}/${apiT}`;
      const r = await probe(url, val);
      counts[r.kind]++;
    }
    results[name] = counts;
    const total = sample.length;
    const okPct = (counts.ok / total * 100).toFixed(0);
    if (counts.error >= total / 2) err(`${name.padEnd(22)} ok ${counts.ok}/${total} (${okPct}%) error ${counts.error} 다수`);
    else if (counts.ok >= total * 0.7) ok(`${name.padEnd(22)} ok ${counts.ok}/${total} (${okPct}%)`);
    else warn(`${name.padEnd(22)} ok ${counts.ok}/${total} (${okPct}%) — 부분 결함`);
  }
} catch (e) {
  warn(`company API 깊이 점검 실패: ${e.message}`);
}

// ═══════ Probe 9: Karpathy 학습 효과 (환각 재발 감소 추세) ═══════
// 2026-05-30 closed loop 인프라 — F26 anti-pattern inject 가 작동하는지 검증.
// 같은 (ticker, defect_type) 의 detect 횟수가 최근 cycle 마다 감소하면 학습 효과 있음.
console.log('\n## [9] Karpathy 학습 효과 (anti-pattern inject 후 재발 감소)\n');
try {
  const week = db.prepare(`SELECT COUNT(*) c FROM hallucination_history WHERE detected_at >= datetime('now','-7 days')`).get();
  const today = db.prepare(`SELECT COUNT(*) c FROM hallucination_history WHERE detected_at >= datetime('now','-1 days')`).get();
  const byType = db.prepare(`
    SELECT defect_type, COUNT(*) c, AVG(injected_count) avg_injected
    FROM hallucination_history
    WHERE detected_at >= datetime('now','-7 days')
    GROUP BY defect_type ORDER BY c DESC
  `).all();
  if (week.c === 0) {
    ok(`hallucination_history — 최근 7일 결함 0건 (verify-loop 미작동 또는 클린)`);
  } else {
    ok(`hallucination_history — 7일 ${week.c}건 / 24h ${today.c}건 (closed loop 작동 중)`);
    for (const r of byType) {
      console.log(`   ${r.defect_type.padEnd(28)} ${r.c}건 / avg_injected ${r.avg_injected.toFixed(1)}`);
    }
    // 학습 효과: 같은 (ticker,type) 의 detect 가 inject 후 줄어드는지
    // 2026-05-31: severity escalate — 3회 ⚠️ / 5회 ❌ critical (data source 결함 의심, 코드 fix 필요)
    const repeat = db.prepare(`
      SELECT ticker, defect_type, COUNT(*) repeat_count
      FROM hallucination_history
      WHERE detected_at >= datetime('now','-7 days') AND ticker IS NOT NULL
      GROUP BY ticker, defect_type HAVING repeat_count >= 3 ORDER BY repeat_count DESC LIMIT 10
    `).all();
    const critical = repeat.filter(r => r.repeat_count >= 5);
    const moderate = repeat.filter(r => r.repeat_count >= 3 && r.repeat_count < 5);
    if (critical.length > 0) {
      err(`반복 환각 ≥5회 (${critical.length}건) — anti-pattern 학습 실패, 코드 fix 필수: ${critical.map(r => `${r.ticker}/${r.defect_type}=${r.repeat_count}`).join(', ')}`);
    }
    if (moderate.length > 0) {
      warn(`반복 환각 3-4회 (${moderate.length}건) — 추세 관찰: ${moderate.map(r => `${r.ticker}/${r.defect_type}=${r.repeat_count}`).join(', ')}`);
    }
    if (critical.length === 0 && moderate.length === 0) {
      ok(`반복 환각 ≥3회 0건 — F26 anti-pattern inject 학습 효과 ✓`);
    }
  }
} catch (e) {
  warn(`hallucination_history 점검 실패: ${e.message}`);
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

// ═══════ Probe 11: alias / meta 정합성 (candidate 풀 ↔ meta ↔ TICKER_ALIASES) ═══════
console.log('\n## [11] alias / meta 정합성 (풀 ↔ meta ↔ TICKER_ALIASES)\n');
try {
  const ct = JSON.parse(readFileSync(`${ROOT}/data/candidate-tickers.json`, 'utf8'));
  const pool = new Set(ct.tickers ?? []);
  const meta = ct.meta ?? {};
  // 1. 풀 ticker 중 meta 없음 (페이지/보고서가 name/sector 못 찾음 — 환각 위험)
  const poolNoMeta = [...pool].filter(t => !meta[t]);
  // 2. TICKER_ALIASES 타겟이 풀에 있나 (없으면 alias 정규화 후 가격/스냅샷 실패)
  const gen = readFileSync(`${ROOT}/scripts/generate-report-local.mjs`, 'utf8');
  const blk = gen.match(/TICKER_ALIASES = new Map\(\[([\s\S]*?)\]\)/)?.[1] ?? '';
  const aliasTargets = [...blk.matchAll(/'[^']+',\s*'([^']+)'/g)].map(m => m[1]);
  const badAlias = aliasTargets.filter(t => !pool.has(t));
  // 3. meta 키 중 풀 외 (stale — 풀에서 빠진 종목 잔존, 무해하나 추적)
  const metaStale = Object.keys(meta).filter(k => !pool.has(k));
  if (poolNoMeta.length) err(`풀 ${poolNoMeta.length} ticker 가 meta 없음 — ${poolNoMeta.slice(0, 6).join(', ')}`);
  else ok(`풀 ${pool.size} ticker 전부 meta 보유`);
  if (badAlias.length) err(`TICKER_ALIASES 타겟 ${badAlias.length} 개가 풀 외 — ${badAlias.join(', ')}`);
  else ok(`TICKER_ALIASES 타겟 ${aliasTargets.length} 개 전부 풀 내`);
  if (metaStale.length > 60) warn(`meta stale 키 ${metaStale.length} 개 (풀 외 — build-candidate-tickers 재생성 권장)`);
  else ok(`meta stale ${metaStale.length} 개 (정상 범위)`);
} catch (e) { warn(`alias 정합성 점검 실패: ${e.message}`); }

// ═══════ Probe 12: endpoint manifest 자동 추출 (page 의존성 drift) ═══════
console.log('\n## [12] endpoint manifest drift (src 코드 자동 추출 vs 하드코딩 manifest/snapshot)\n');
try {
  // src 트리에서 코드가 실제 참조하는 /api/ endpoint 자동 수집
  const walk = (dir, acc) => {
    for (const f of readdirSync(dir)) {
      if (f === 'node_modules' || f === '.next') continue;
      const p = `${dir}/${f}`;
      const st = statSync(p);
      if (st.isDirectory()) walk(p, acc);
      else if (/\.(ts|tsx)$/.test(f)) acc.push(p);
    }
    return acc;
  };
  const refEndpoints = new Set();
  for (const file of walk(`${ROOT}/src`, [])) {
    const txt = readFileSync(file, 'utf8');
    for (const m of txt.matchAll(/['"`]\/api\/([a-z0-9-]+)/gi)) refEndpoints.add(`/api/${m[1].toLowerCase()}`);
  }
  const manifestEps = new Set(Object.values(EXPECTED_PAGE_ENDPOINTS).flat());
  // 코드가 참조하지만 하드코딩 manifest 에 없음 → manifest stale (자동 추출이 catch)
  const inCodeNotManifest = [...refEndpoints].filter(e => !manifestEps.has(e));
  // manifest 에 있지만 코드 어디에도 없음 → manifest 가 죽은 endpoint 가리킴
  const inManifestNotCode = [...manifestEps].filter(e => !refEndpoints.has(e));
  console.log(`  코드 참조 endpoint: ${refEndpoints.size} 개 / 하드코딩 manifest: ${manifestEps.size} 개`);
  if (inManifestNotCode.length) warn(`manifest 에만 있고 코드에 없음 (${inManifestNotCode.length}): ${inManifestNotCode.join(', ')}`);
  // manifest 가 추적하는 핵심 endpoint 중 코드 참조되는데 최근 3일 snapshot 없는 것
  const refNotCaptured = [...refEndpoints].filter(e => manifestEps.has(e) && !capNormSet.has(e));
  if (refNotCaptured.length) warn(`manifest 핵심 endpoint 코드 참조하나 3일 snapshot 없음 (${refNotCaptured.length}): ${refNotCaptured.slice(0, 8).join(', ')}`);
  if (!inManifestNotCode.length && !refNotCaptured.length) ok(`manifest ↔ 코드 ↔ snapshot 정합 (코드 ${refEndpoints.size} endpoint 추적)`);
} catch (e) { warn(`manifest drift 점검 실패: ${e.message}`); }

// ═══════ 종합 ═══════
console.log(`\n═══ 종합 ═══`);
console.log(`silent NULL + 누락 + drift: ${errCount} 결함`);
process.exit(errCount > 0 ? 1 : 0);
