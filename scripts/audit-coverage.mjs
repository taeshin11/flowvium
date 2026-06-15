#!/usr/bin/env node
/**
 * scripts/audit-coverage.mjs
 *
 * "?덉뼱????寃? vs "?ㅼ젣 ?곸옱" 鍮꾧탳 ??silent NULL + endpoint 誘몄뒪留ㅼ튂 +
 * archive ?꾨씫 ?먮룞 detect. audit-all ???쒕㈃ ?먭? 蹂댁셿.
 *
 * 留ㅼ＜ ?먮뒗 留?fix push ???ㅽ뻾 沅뚯옣.
 */
import Database from 'better-sqlite3';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
const ROOT = 'C:/Flowvium';
const db = new Database(`${ROOT}/data/flowvium.db`, { readonly: true });

let errCount = 0;
const ERR = '??, WARN = '?좑툘 ', OK = '??;
function err(msg) { console.log(`${ERR} ${msg}`); errCount++; }
function warn(msg) { console.log(`${WARN} ${msg}`); }
function ok(msg) { console.log(`${OK} ${msg}`); }

console.log('?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??);
console.log('  Coverage Audit ??"?덉뼱????寃? vs "?ㅼ젣 ?곸옱"');
console.log('?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??n');

// ?먥븧?먥븧?먥븧??Probe 1: 紐⑤뱺 ?뚯씠釉붿쓽 column NULL 鍮꾩쑉 ?먥븧?먥븧?먥븧??
console.log('## [1] silent NULL audit (column ?덈뒗????긽 NULL)\n');

// 2026-06-05: 援ъ“??NULL(?곗씠?곌? 蹂몃옒 N/A) ?몄? ??踰꾧렇媛 ?꾨땶 NULL ????濡?over-flag ?섏? ?딆쓬.
//   媛???ぉ? audit ?쇰줈 寃利앸맂 "??NULL ?멸?" ??寃곕줎(利앷굅 ?숇컲). earnings_archive ???ㅻ쾭洹몃씪 fix(1fa371d),
//   ?꾨옒??援ъ“?곸씠??[L2] 泥섎읆 ?뺤쭅?섍쾶 acknowledged 泥섎━??verification ?뺥솗???뺣낫(?ъ슜??"沅뚭퀬 留먭퀬 怨좎퀜").
const STRUCTURAL_NULLS = {
  'news_archive.pub_date': 'company-change ?됱? 湲곗궗 ?꾨떂?믩궇吏?N/A (news-cascade ?됱? pub_date 100%)',
  'news_archive.link': 'company-change ?됱? 湲곗궗 留곹겕 ?놁쓬 (news-cascade ?됱? link 100%)',
  'asset_flow_archive.return_1d': 'capital-flows 媛 1w/4w/13w ?쒓났, 1d 誘몄젣怨??뚯뒪 遺??',
  'hallucination_history.details_json': 'defect_type 蹂?details ?좊Т ?곸씠(?쇰? defect 蹂몃Ц ?놁쓬)',
  'earnings_archive.pe_ratio': 'earnings ?뚯뒪(estimate)媛 PE 誘몄젣怨???PE ??company page ?먯꽌 price/EPS ?쇱씠釉??곗텧(21/579留??뚯뒪 ?숇컲). ?꾩뭅?대툕 誘몄??μ씠 ?뺤긽',
  // 2026-06-05 諛곗꽑 ?꾨즺(???댁긽 援ъ“???꾨떂 ??STRUCTURAL ?먯꽌 ?쒖쇅):
  //   - recommendation_outcomes.quality_score: computeOutcomeQuality(alpha 湲곕컲) saveOutcome/closeOutcome 諛곗꽑 + ??궗 backfill(98%)
  //   - short_squeeze_archive.rationale: score+timing+risk ?⑹꽦 諛곗꽑 + ??궗 backfill(100%)
};

const tables = db.prepare(`
  SELECT name FROM sqlite_master
  WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%' AND name NOT LIKE '%_data' AND name NOT LIKE '%_idx' AND name NOT LIKE '%_docsize' AND name NOT LIKE '%_config' AND name NOT LIKE '%_content'
`).all().map(r => r.name);

const skippedSmall = [];
const ackStructural = [];
for (const t of tables) {
  const total = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
  if (total < 10) { skippedSmall.push(`${t}(${total})`); continue; } // ?곸? ?곗씠??skip ???ш컖吏? 媛?쒗솕
  const cols = db.prepare(`PRAGMA table_info(${t})`).all();
  const lowCovCols = [];
  for (const c of cols) {
    if (['id', 'created_at'].includes(c.name)) continue;
    if (c.notnull) continue; // NOT NULL constraint
    const nullCnt = db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE ${c.name} IS NULL`).get().c;
    const nullPct = (nullCnt / total) * 100;
    if (nullPct >= 80) {
      const key = `${t}.${c.name}`;
      if (STRUCTURAL_NULLS[key]) ackStructural.push(`${key}(${nullPct.toFixed(0)}%) ??${STRUCTURAL_NULLS[key]}`);
      else lowCovCols.push(`${c.name}(${nullPct.toFixed(0)}%null)`);
    }
  }
  if (lowCovCols.length > 0) {
    err(`${t}: ${lowCovCols.length} col NULL ??0% (誘몄씤吏) ??${lowCovCols.slice(0, 5).join(', ')}`);
  } else {
    ok(`${t}: ${total} rows / 紐⑤뱺 column coverage ?뺤긽`);
  }
}

if (skippedSmall.length) console.log(`  ?뱄툘  NULL audit skip (??10, ?ш컖吏? 媛?쒗솕): ${skippedSmall.join(', ')}`);
if (ackStructural.length) {
  console.log(`  ?뱄툘  援ъ“??NULL ${ackStructural.length}媛?(寃利앸맖쨌acknowledged, 踰꾧렇 ?꾨떂):`);
  for (const s of ackStructural) console.log(`     - ${s}`);
}

// ?먥븧?먥븧?먥븧??Probe 2: endpoint ?곸옱 vs ?명뀛由ъ쟾????expected ?먥븧?먥븧?먥븧??
console.log('\n## [2] endpoint ?곸옱 vs intelligence/signals ?섏씠吏 ?섏〈 鍮꾧탳\n');

// app pages 媛 ?몄텧?섎뒗 endpoint (manifest)
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
// /api/X?param ??/api/X 濡?normalize
const capNormSet = new Set(captured.map(e => e.split('?')[0]).concat(captured));

for (const [page, eps] of Object.entries(EXPECTED_PAGE_ENDPOINTS)) {
  const missing = eps.filter(e => !capNormSet.has(e) && !capSet.has(e));
  if (missing.length === 0) {
    ok(`/${page} page: ${eps.length}/${eps.length} endpoint ?곸옱 以?);
  } else {
    warn(`/${page} page: ${eps.length - missing.length}/${eps.length} ???꾨씫: ${missing.join(', ')}`);
  }
}

// ?먥븧?먥븧?먥븧??Probe 3: domain archive ?곸옱 鍮꾧탳 (蹂닿퀬?쒕쭏???곸옱?섏뼱????寃? ?먥븧?먥븧?먥븧??
console.log('\n## [3] domain archive ?곸옱??(留?蹂닿퀬?쒕쭏???덉뼱????\n');

const totalReports = db.prepare(`SELECT COUNT(*) c FROM reports WHERE generated_at >= datetime('now','-7 days')`).get().c;
const archiveTables = [
  { name: 'recommendations',         expected: totalReports * 6,  perReport: '6-8 醫낅ぉ' },
  { name: 'endpoint_snapshots',      expected: totalReports * 24, perReport: '24 endpoint' },
  { name: 'news_archive',            expected: totalReports * 5,  perReport: '5+ ?댁뒪' },
  { name: 'macro_snapshots',         expected: totalReports,      perReport: '1 ?쒖젏 ?뺤텞' },
  { name: 'short_squeeze_archive',   expected: totalReports * 3,  perReport: '3 醫낅ぉ' },
  { name: 'earnings_archive',        expected: totalReports * 3,  perReport: '3 ?뚯궗' },
  { name: 'insider_archive',         expected: totalReports * 2,  perReport: '2 ?좏샇' },
  { name: 'fg_archive',              expected: totalReports * 10, perReport: '10 援??' },
  { name: 'asset_flow_archive',      expected: totalReports * 15, perReport: '15 ?먯궛' },
];

for (const at of archiveTables) {
  // ?뚯씠釉붾퀎 timestamp column ?먮룞 ?좏깮
  const cols = db.prepare(`PRAGMA table_info(${at.name})`).all().map(c => c.name);
  const ts = cols.includes('captured_at') ? 'captured_at'
    : cols.includes('generated_at') ? 'generated_at'
    : cols.includes('evaluated_at') ? 'evaluated_at'
    : null;
  if (!ts) { warn(`${at.name}: timestamp column ?놁쓬`); continue; }
  const actual = db.prepare(`SELECT COUNT(*) c FROM ${at.name} WHERE ${ts} >= datetime('now','-7 days')`).get().c;
  const ratio = at.expected > 0 ? (actual / at.expected) * 100 : 0;
  // 2026-06-05: recency-aware ??7??鍮꾩쑉????븘??理쒓렐 2???곸옱?⑥씠 ?뺤긽?대㈃ "怨쇨굅 媛??뚮났"(?먭??몄뒪??
  //   ?꾪솚 以?fg_archive 05-29~06-02 以묐떒 ?ш굔). ?뚮났?덈뒗??7???덈룄?곌? 怨쇨굅 媛?쓣 ?뚭퀬媛 false ??諛⑹?.
  const actual2 = db.prepare(`SELECT COUNT(*) c FROM ${at.name} WHERE ${ts} >= datetime('now','-2 days')`).get().c;
  const expected2 = at.expected * 2 / 7;
  const recovered = expected2 > 0 && (actual2 / expected2) >= 0.6;
  if (ratio >= 80) {
    ok(`${at.name.padEnd(28)} ${actual}/${at.expected} (${ratio.toFixed(0)}%) ??${at.perReport}`);
  } else if (ratio >= 30) {
    warn(`${at.name.padEnd(28)} ${actual}/${at.expected} (${ratio.toFixed(0)}%) ??遺遺??곸옱`);
  } else if (recovered) {
    warn(`${at.name.padEnd(28)} 7??${ratio.toFixed(0)}% but 理쒓렐2??${actual2}/${expected2.toFixed(0)} ?뺤긽 ??怨쇨굅 媛??뚮났(aging out)`);
  } else {
    err(`${at.name.padEnd(28)} ${actual}/${at.expected} (${ratio.toFixed(0)}%) ???곸옱 嫄곗쓽 ????);
  }
}

// ?먥븧?먥븧?먥븧??Probe 3b: S&P 500 / KOSPI 而ㅻ쾭 ?먥븧?먥븧?먥븧??
console.log('\n## [3a] S&P 500 / KOSPI / KOSDAQ candidate 而ㅻ쾭 ===\n');
try {
  const sp500 = JSON.parse(readFileSync('C:/Flowvium/data/sp500-tickers.json', 'utf8'));
  const cand = JSON.parse(readFileSync('C:/Flowvium/data/candidate-tickers.json', 'utf8'));
  const candSet = new Set(cand.tickers);
  const missing = sp500.tickers.filter(t => !candSet.has(t) && !candSet.has(t.replace('-', '.')));
  const coverage = ((sp500.tickers.length - missing.length) / sp500.tickers.length * 100).toFixed(1);
  if (missing.length === 0) {
    ok(`S&P 500: ${sp500.tickers.length}/${sp500.tickers.length} (100%)`);
  } else if (missing.length < sp500.tickers.length * 0.05) {
    warn(`S&P 500: ${sp500.tickers.length - missing.length}/${sp500.tickers.length} (${coverage}%) ??${missing.length}媛??꾨씫: ${missing.slice(0,8).join(', ')}...`);
  } else {
    err(`S&P 500: ${sp500.tickers.length - missing.length}/${sp500.tickers.length} (${coverage}%) ??${missing.length}媛??꾨씫 (5% 珥덇낵)`);
  }
  const krCount = cand.tickers.filter(t => t.endsWith('.KS') || t.endsWith('.KQ')).length;
  ok(`KR 醫낅ぉ (KOSPI + KOSDAQ): ${krCount} 醫낅ぉ`);
  // KOSPI 200 + KOSDAQ 150 而ㅻ쾭 鍮꾧탳
  try {
    const krIdx = JSON.parse(readFileSync('C:/Flowvium/data/kr-major-indexes.json', 'utf8'));
    const expectedKr = [...(krIdx.kospi?.tickers ?? []), ...(krIdx.kosdaq?.tickers ?? [])];
    const missingKr = expectedKr.filter(t => !candSet.has(t));
    const krCov = ((expectedKr.length - missingKr.length) / expectedKr.length * 100).toFixed(1);
    if (missingKr.length === 0) ok(`KOSPI 200 + KOSDAQ 150: ${expectedKr.length}/${expectedKr.length} (100%)`);
    else if (missingKr.length < 10) warn(`KOSPI 200 + KOSDAQ 150: ${expectedKr.length - missingKr.length}/${expectedKr.length} (${krCov}%) ??${missingKr.length}媛??꾨씫`);
    else err(`KOSPI 200 + KOSDAQ 150: ${expectedKr.length - missingKr.length}/${expectedKr.length} (${krCov}%) ??${missingKr.length}媛??꾨씫`);
  } catch {}
} catch (e) {
  warn(`S&P 500 coverage check ?ㅽ뙣: ${String(e).slice(0,80)}`);
}

// ?먥븧?먥븧?먥븧??Probe 4b: ?섎せ??媛?踰붿쐞 (NULL ?꾨땶 silent bug ??Codex 吏꾨떒) ?먥븧?먥븧?먥븧??
console.log('\n## [4a] invalid value range (0/?뚯닔/遺덇???踰붿쐞)\n');
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
  if (invalid > 0) err(`${r.table}.${r.col}: ${invalid} row 媛 [${r.min}, ${r.max}] 踰붿쐞 諛?);
}

// ?먥븧?먥븧?먥븧??Probe 3b: endpoint HTTP status 遺꾪룷 (4XX/5XX 臾대뜑湲?= ?쇱슦??二쎌뼱?덉쓬) ?먥븧?먥븧?먥븧??
// 2026-05-29: DART /api/company-kr 媛 泥섏쓬遺??100% 404 ??붾뜲 audit 媛 紐??≪? ?ш굔 fix.
//   利앹긽 = endpoint_snapshots.http_status 4XX 鍮꾩쑉??紐⑤뱺 ?몄텧??50%+ ?먮뒗 ?묐떟 蹂몃Ц??"error" ?꾨뱶.
//   異붽?濡?body ?덉쓽 error JSON ??蹂몃떎 (200 OK ?몃뜲 {"error": "..."} ??耳?댁뒪).
console.log('\n## [3b] endpoint HTTP status (4XX/5XX 鍮꾩쑉 ??0% = ?쇱슦??二쎌쓬)\n');

const statusDist = db.prepare(`
  SELECT endpoint, http_status, COUNT(*) c
  FROM endpoint_snapshots
  WHERE captured_at >= datetime('now','-7 days')
  GROUP BY endpoint, http_status
`).all();
const epStatus = new Map(); // endpoint ??{ ok, err4, err5, total }
for (const r of statusDist) {
  if (!epStatus.has(r.endpoint)) epStatus.set(r.endpoint, { ok: 0, err4: 0, err5: 0, total: 0 });
  const e = epStatus.get(r.endpoint);
  e.total += r.c;
  if (r.http_status >= 200 && r.http_status < 300) e.ok += r.c;
  else if (r.http_status >= 400 && r.http_status < 500) e.err4 += r.c;
  else if (r.http_status >= 500) e.err5 += r.c;
}
// 2026-06-05: recency-aware ?먯젙 ??7???덈룄?곕뒗 "?대? 怨좎튇 ?쇱슦????怨쇨굅 ?ㅽ뙣瑜??꾩옱 嫄닿컯怨?
//   萸됰슧洹몃젮 false ??瑜??덉쓬(BRK.B 05-30 fix ?꾩뿉??05-29~31 ?ㅽ뙣媛 ?덈룄?곗뿉 ?⑥븘 57% ?ㅽ뙣濡??쒖떆).
//   ??媛??理쒓렐 ?ㅻ깄?룹씠 *?ъ쟾?? ?ㅽ뙣???뚮쭔 "二쎌쓬" ?쇰줈 err; 理쒓렐 ok 硫??뚮났以?warn)?쇰줈 媛뺣벑.
const latestStatus = db.prepare(`
  SELECT s.endpoint, s.http_status, s.ok, s.response_json
  FROM endpoint_snapshots s
  JOIN (SELECT endpoint, MAX(captured_at) mx FROM endpoint_snapshots WHERE captured_at >= datetime('now','-7 days') GROUP BY endpoint) l
    ON s.endpoint = l.endpoint AND s.captured_at = l.mx
`).all();
const latestOk = new Map(); // endpoint ??{ httpOk, bodyOk }
const _isTopLevelErr = (rj) => { // ?쇱슦???덈꺼 ?먮윭留?<60?? ??per-item nested error ?쒖쇅
  if (typeof rj !== 'string') return false;
  const idx = rj.search(/"error":\s*["{]/);
  return idx >= 0 && idx < 60;
};
for (const r of latestStatus) {
  const httpOk = r.http_status >= 200 && r.http_status < 300;
  const bodyOk = !_isTopLevelErr(r.response_json);
  latestOk.set(r.endpoint, { httpOk, bodyOk });
}
for (const [ep, s] of epStatus) {
  if (s.total < 3) continue; // ?쒕낯 遺議?
  const errPct = ((s.err4 + s.err5) / s.total) * 100;
  const recovered = latestOk.get(ep)?.httpOk === true; // 理쒓렐 ?ㅻ깄??ok = ?뚮났
  if (errPct >= 50 && !recovered) {
    err(`${(ep ?? '?').padEnd(40)} 4XX:${s.err4} 5XX:${s.err5} / ${s.total} (${errPct.toFixed(0)}% ?ㅽ뙣) ???쇱슦??二쎌쓬 ?섏떖`);
  } else if (errPct >= 50 && recovered) {
    warn(`${(ep ?? '?').padEnd(40)} 7??${errPct.toFixed(0)}% ?ㅽ뙣??쇰굹 理쒓렐 ?ㅻ깄??ok ???뚮났(怨쇨굅 ?ㅽ뙣 aging out)`);
  } else if (errPct >= 20) {
    warn(`${(ep ?? '?').padEnd(40)} 4XX:${s.err4} 5XX:${s.err5} / ${s.total} (${errPct.toFixed(0)}% ?ㅽ뙣)`);
  }
}

// 200 OK ?몃뜲 ?묐떟 蹂몃Ц??error ?꾨뱶 ??silent failure
// 2026-05-30: "error":" ?⑦꽩?쇰줈 媛뺥솕 ??"errorPolicy", "warning" 媛숈? false positive 李⑤떒.
// 2026-06-05: (1) top-level error 留?媛먯? ??satellite 泥섎읆 per-signal `"error":"no_sar_data"`(idx 202,
//   諛곗뿴 ????怨듭옣 ?곗씠??誘몄닔?????쇱슦??silent failure ?꾨떂. ?쇱슦???먮윭???묐떟 ?욌?遺?<60??????
//   (2) recency-aware ??理쒓렐 ?ㅻ깄?룹씠 ?뺤긽?대㈃ ?뚮났(warn).
const errCandidates = db.prepare(`
  SELECT endpoint, response_json
  FROM endpoint_snapshots
  WHERE captured_at >= datetime('now','-7 days')
    AND http_status = 200
    AND (response_json LIKE '%"error":"%' OR response_json LIKE '%"error":{%')
`).all();
const topLevelErrCount = new Map(); // endpoint ??top-level error ?잛닔
for (const r of errCandidates) {
  if (_isTopLevelErr(r.response_json)) topLevelErrCount.set(r.endpoint, (topLevelErrCount.get(r.endpoint) ?? 0) + 1);
}
for (const [ep, c] of topLevelErrCount) {
  if (c < 2) continue;
  const recovered = latestOk.get(ep)?.bodyOk === true; // 理쒓렐 ?ㅻ깄??body ?뺤긽 = ?뚮났
  if (recovered) {
    warn(`${(ep ?? '?').padEnd(40)} 怨쇨굅 top-level "error" ${c}?뚯??쇰굹 理쒓렐 ?ㅻ깄???뺤긽 ???뚮났`);
  } else {
    err(`${(ep ?? '?').padEnd(40)} 200 OK ?몃뜲 top-level "error" ${c} ??(silent failure)`);
  }
}

// ?먥븧?먥븧?먥븧??Probe 3c: portfolio ticker ??snapshot ?뺥빀???먥븧?먥븧?먥븧??
// 2026-05-29: DART /api/company-kr 媛 portfolio ??KR ticker ?덉뼱??0嫄?snapshot ???ш굔 fix.
//   利앹긽 = recent 蹂닿퀬?쒖쓽 portfolio ticker 媛 N 媛쒖씤??company-* snapshot ??N 蹂대떎 ?쒖갭 ?곸쓬.
console.log('\n## [3c] portfolio ticker ??company-* snapshot ?뺥빀??n');

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
      console.log(`  report ${r.id}: portfolio ${expected} ??snapshot ${got}, ?꾨씫 ${missing.length}: ${missing.slice(0,4).join(', ')}`);
    }
  }
}
if (problemReports >= 2) {
  err(`portfolio?봲napshot mismatch: ${problemReports}/${recentReports.length} 蹂닿퀬?? ?⑹궛 ${totalSnapshotted}/${totalExpected} ticker (snapshot-endpoints.mjs ??portfolioTickers ?듭뀡 ?꾨떖 ?먭?)`);
} else if (totalExpected > 0) {
  ok(`portfolio?봲napshot ?뺥빀?? ${totalSnapshotted}/${totalExpected} ticker (${recentReports.length} 蹂닿퀬??`);
}

// ?먥븧?먥븧?먥븧??Probe 5: buy/sell rule 移댄뀒怨좊━ ?移??먥븧?먥븧?먥븧??
// 2026-05-29 ?ш굔 ??sell rule ??"媛寃?湲곗닠/湲곕낯/援щ（/嫄곗떆/誘몄떆/?뚯쟾" 7媛?移댄뀒怨좊━瑜?媛議뚮뒗??
// buy rule ? ad-hoc 異붽?濡??쒖そ?먮쭔 ?덈뒗 移댄뀒怨좊━ ?몄텧. ?쒖そ?먮쭔 ?덈뒗 移댄뀒怨좊━??silent gap.
console.log('\n## [5] buy/sell rule 移댄뀒怨좊━ ?移?(Karpathy pathway 臾닿껐??\n');
try {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const buy = JSON.parse(fs.readFileSync(path.resolve('data/buy-rules-tuned.json'), 'utf8'));
  const sell = JSON.parse(fs.readFileSync(path.resolve('data/sell-rules-tuned.json'), 'utf8'));
  const buyCats = new Map();
  const sellCats = new Map();
  for (const r of (buy.rules ?? [])) buyCats.set(r.category ?? '?', (buyCats.get(r.category ?? '?') ?? 0) + 1);
  for (const r of (sell.rules ?? [])) sellCats.set(r.category ?? '?', (sellCats.get(r.category ?? '?') ?? 0) + 1);
  // selflearn ? buy ?꾩슜 (boost/ban-list) ??sell ??援녹씠 ?놁뼱????
  const expected = ['price', 'technical', 'fundamental', 'guru', 'macro', 'micro', 'rotation'];
  const missingBuy = expected.filter(c => !buyCats.has(c));
  const missingSell = expected.filter(c => !sellCats.has(c));
  if (missingBuy.length) err(`buy rules ??移댄뀒怨좊━ ?꾨씫: ${missingBuy.join(', ')}`);
  else ok(`buy rules ??7媛?移댄뀒怨좊━ 紐⑤몢 cover (珥?${buy.rules.length}媛?猷?`);
  if (missingSell.length) err(`sell rules ??移댄뀒怨좊━ ?꾨씫: ${missingSell.join(', ')}`);
  else ok(`sell rules ??7媛?移댄뀒怨좊━ 紐⑤몢 cover (珥?${sell.rules.length}媛?猷?`);
  // category ?꾨뱶 ?먯껜媛 鍮꾩뼱?덈뒗 猷??됱텧 (silent omission)
  const buyNoCat = (buy.rules ?? []).filter(r => !r.category).map(r => r.id);
  const sellNoCat = (sell.rules ?? []).filter(r => !r.category).map(r => r.id);
  if (buyNoCat.length) err(`buy rules ??category ?꾨뱶 鍮?猷?${buyNoCat.length}嫄? ${buyNoCat.slice(0, 3).join(', ')}`);
  if (sellNoCat.length) err(`sell rules ??category ?꾨뱶 鍮?猷?${sellNoCat.length}嫄? ${sellNoCat.slice(0, 3).join(', ')}`);
} catch (e) {
  warn(`buy/sell rule 移댄뀒怨좊━ ?먭? ?ㅽ뙣: ${e.message}`);
}

// ?먥븧?먥븧?먥븧??Probe 5b: buy?봲ell 紐⑥닚 (媛숈? 醫낅ぉ 留ㅼ닔+??붾찘??留ㅻ룄 諛섎났 = whipsaw) ?먥븧?먥븧?먥븧??
// 2026-06-05: 湲곗븘(000270) "?ㅼ쟾 ?щ씪 ????붾씪" ?ш굔 ??留ㅼ닔 ??ъ씠 op margin ?낇솕 醫낅ぉ??怨꾩냽
//   picks ?섎뒗??留ㅻ룄?붿쭊? fund_margin_decline ?쇰줈 ?붾씪 ?? 諛쒓컙吏곸쟾 ?뺥빀 寃뚯씠?몃줈 留ㅼ닔 ?쒖쇅?섏?留?
//   ?뚭? 媛먯?瑜??꾪빐 理쒓렐 7????媛숈? ticker 媛 buy + (fundamental)sell ?????섏삩 醫낅ぉ??flag.
console.log('\n## [5b] buy?봲ell 紐⑥닚 (?숈씪 醫낅ぉ 留ㅼ닔/留ㅻ룄 諛섎났 whipsaw)\n');
try {
  const conflicts = db.prepare(`
    SELECT r.ticker,
           COUNT(DISTINCT r.generated_at) buys,
           COUNT(DISTINCT s.generated_at) sells
    FROM recommendations r
    JOIN sell_recommendations s ON r.ticker = s.ticker
    WHERE r.generated_at >= datetime('now','-7 days')
      AND s.generated_at >= datetime('now','-7 days')
      AND (s.sell_type LIKE '%margin%' OR s.sell_type LIKE '%fund%' OR s.rationale LIKE '%?낇솕%')
    GROUP BY r.ticker
    HAVING buys >= 1 AND sells >= 1
  `).all();
  if (conflicts.length === 0) {
    ok('buy?봲ell 紐⑥닚 ?놁쓬 (??붾찘??留ㅻ룄 醫낅ぉ??留ㅼ닔???щ벑??????');
  } else {
    for (const c of conflicts) {
      // 2026-06-06: recency-aware ???뺥빀 寃뚯씠?몃뒗 *?좉퇋* 留ㅼ닔瑜?留됱쓬(?섏떆媛???. ?곕씪??理쒓렐 留ㅼ닔(<18h)媛
      //   ?덉쓣 ?뚮쭔 "寃뚯씠???고쉶"(??. 18h+ 怨쇨굅 留ㅼ닔??寃뚯씠???꾩엯 ???붿〈?대씪 aging out(warn). ?ㅻⅨ ?꾨줈釉?
      //   recency ?⑦꽩怨??쇨?(scattered-invariant 援먰썕).
      // 2026-06-06: ???timestamp ??ISO 'YYYY-MM-DDT...'(T), datetime('now')??怨듬갚援щ텇 ??媛숈? ??臾몄옄?대퉬援?
      //   ??'T'(84)>' '(32)濡??쒓컙 ?ㅼ쭛?? strftime ISO-T 濡??묒そ ?듭씪(format-mismatch 踰꾧렇 fix).
      const recentBuy = db.prepare(`SELECT MAX(generated_at) lb FROM recommendations WHERE ticker=? AND substr(generated_at,1,19) >= strftime('%Y-%m-%dT%H:%M:%S','now','-18 hours')`).get(c.ticker).lb;
      if (recentBuy) {
        // 2026-06-12: ?쒖꽌 ?몄? ??"?고쉶"??留ㅼ닔媛 *湲곗〈* ??붾찘??sell ?좏샇瑜?臾댁떆?섍퀬 ?섏삩 寃쎌슦留?
        //   (sell ??留ㅼ닔蹂대떎 癒쇱? 議댁옱). sell ??留ㅼ닔 ?댄썑 ?깆옣??嫄??좉퇋 ?뺣낫 ?꾩갑(whipsaw 紐⑤땲?곕쭅
        //   ??? warn)?댁? 寃뚯씠??寃고븿???꾨떂. ?ㅼ륫: FTV/MOH ????sell-after-buy ?몃뜲 ???ㅽ깘.
        const priorSell = db.prepare(`SELECT MAX(generated_at) ls FROM sell_recommendations WHERE ticker=? AND (sell_type LIKE '%margin%' OR sell_type LIKE '%fund%' OR rationale LIKE '%?낇솕%') AND generated_at < ?`).get(c.ticker, recentBuy).ls;
        if (priorSell) {
          err(`${c.ticker}: buy(${recentBuy.slice(5, 16)})媛 湲곗〈 ??붾찘?퇿ell(${priorSell.slice(5, 16)}) 臾댁떆 ???뺥빀 寃뚯씠???고쉶`);
        } else {
          warn(`${c.ticker}: buy(${recentBuy.slice(5, 16)}) ????붾찘?퇿ell ?깆옣 ??whipsaw 異붿쟻 (寃뚯씠??寃고븿 ?꾨떂, ?좉퇋 ?뺣낫)`);
        }
      } else {
        warn(`${c.ticker}: buy${c.buys}+sell${c.sells} but 理쒓렐 留ㅼ닔 18h+ ????寃뚯씠???꾩엯??怨쇨굅遺?aging out`);
      }
    }
  }
} catch (e) {
  warn(`buy?봲ell 紐⑥닚 ?먭? ?ㅽ뙣: ${e.message}`);
}

// ?먥븧?먥븧?먥븧??Probe 6: buy_candidates ?곸옱 (Karpathy source ???좏깮 12 ???꾨낫 蹂댁〈) ?먥븧?먥븧?먥븧??
console.log('\n## [6] buy_candidates ?곸옱 ???좏깮 ???꾨낫 蹂댁〈 (Karpathy ?숈뒿 source)\n');
try {
  const bcRows = db.prepare(`SELECT COUNT(*) c, COUNT(DISTINCT report_id) r FROM buy_candidates WHERE generated_at >= datetime('now','-14 days')`).get();
  if (bcRows.c === 0) {
    warn(`buy_candidates 14?쇨컙 0嫄???saveBuyCandidates 誘몄뿰寃??섏떖`);
  } else {
    const perReport = bcRows.c / Math.max(bcRows.r, 1);
    if (perReport < 10) err(`buy_candidates avg ${perReport.toFixed(1)}/report ??top30 ?곸옱 湲곕? (?怨듦툒 ?섏떖)`);
    else ok(`buy_candidates ${bcRows.c}嫄?/ ${bcRows.r} reports (avg ${perReport.toFixed(0)}/report)`);
    // matched_rules JSON 寃利???category ?꾨뱶 ?꾨씫 silent omission
    const sample = db.prepare(`SELECT matched_rules FROM buy_candidates WHERE matched_rules IS NOT NULL ORDER BY generated_at DESC LIMIT 1`).get();
    if (sample) {
      try {
        const arr = JSON.parse(sample.matched_rules);
        const noCat = arr.filter(r => !r.category).length;
        if (noCat > 0) err(`buy_candidates.matched_rules ??category ?꾨뱶 ?꾨씫 ${noCat}/${arr.length}嫄?(sample)`);
        else ok(`buy_candidates.matched_rules ??category ?꾨뱶 紐⑤몢 梨꾩썙吏?(sample ${arr.length}嫄?`);
      } catch { warn(`buy_candidates.matched_rules JSON parse ?ㅽ뙣`); }
    }
  }
} catch (e) {
  warn(`buy_candidates ?먭? ?ㅽ뙣: ${e.message}`);
}

// ?먥븧?먥븧?먥븧??Probe 7: portfolio entryZone vs price_at_gen gap ?먥븧?먥븧?먥븧??
// 2026-05-29 NVDA $288 ?섍컖 ?ш굔 ??LLM entryZone ???꾩옱媛 +34% ??붾뜲???듦낵?댁꽌 NE ?뺤젙.
// 理쒓렐 5蹂닿퀬??portfolio 媛?ticker ??entryZone-price_at_gen gap 遺꾪룷 ??짹10% 珥덇낵 鍮꾩쑉 ?뚮엺.
console.log('\n## [7] portfolio entryZone vs price_at_gen gap (NE ?섍컖 李⑤떒)\n');
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
    // 2026-05-30: 짹10% ??짹5% 媛뺥솕 (minor NE ?꾪뿕??catch)
    if (gap > 5) {
      bad++;
      if (badSamples.length < 5) badSamples.push(`${r.ticker}(${r.report_id.slice(0,10)}: ${gap.toFixed(0)}%)`);
    }
  }
  const pct = total ? (bad / total * 100).toFixed(1) : '?';
  if (bad === 0 && total > 0) ok(`entryZone gap ??${total} 醫낅ぉ 紐⑤몢 짹5% ?대궡 (NE ?꾪뿕 0)`);
  else if (bad / Math.max(total, 1) < 0.10) warn(`entryZone gap ??${bad}/${total} (${pct}%) 媛 짹5% 珥덇낵: ${badSamples.join(', ')}`);
  else err(`entryZone gap ??${bad}/${total} (${pct}%) 媛 짹5% 珥덇낵 (NE ?꾪뿕 ?묒궛): ${badSamples.join(', ')}`);
} catch (e) {
  warn(`entryZone gap ?먭? ?ㅽ뙣: ${e.message}`);
}

// ?먥븧?먥븧?먥븧??Probe 8: invalid KR ticker (candidate-tickers ? ??ticker ?곸옱) ?먥븧?먥븧?먥븧??
// 2026-05-29 056100~130.KS ?섍컖 ?ш굔 ??LLM 媛 議댁옱?섏? ?딅뒗 6?먮━ 肄붾뱶 留뚮뱾?대깂.
// candidate-tickers.json ????녿뒗 KR 6?먮━ ticker 媛 recommendations ???ㅼ뼱媛硫???
console.log('\n## [8] invalid KR ticker (LLM ?섍컖 6?먮━ 肄붾뱶 李⑤떒)\n');
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
  if (bad.length === 0) ok(`KR ticker ??理쒓렐 30??紐⑤몢 candidate-tickers ? ??(?섍컖 0)`);
  else err(`KR ticker ?섍컖 ${bad.length}嫄??곸옱 ??${bad.slice(0, 8).join(', ')}`);
} catch (e) {
  warn(`KR ticker ?먭? ?ㅽ뙣: ${e.message}`);
}

// ?먥븧?먥븧?먥븧??Probe 10: company API 源딆씠 (1,210 醫낅ぉ ?섏씠吏 sample) ?먥븧?먥븧?먥븧??
// 2026-05-31 ?ъ슜??吏?? "Routing??臾몄젣媛 ?꾨땲??洹??대????몃??댁슜?ㅼ씠 1210醫낅ぉ ???뺥솗???ㅼ뼱媛?덉뼱?"
// audit-company-pages.mjs ? ?숈씪 寃利?(sample ?묒? ?ъ씠利? ??留?audit 留덈떎 ?뚭? detect.
console.log('\n## [10] company API 源딆씠 (sample 12 ticker 횞 4 API)\n');
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
  // 2026-05-31: /company index page 404 ?ш굔 ??routing ???먮룞 detect.
  try {
    const idxRes = await fetch(`${base}/ko/company`, { signal: AbortSignal.timeout(10000), redirect: 'manual' });
    if (idxRes.status === 404) err(`/company index page ??404 (page.tsx ?놁쓬)`);
    else if (idxRes.status >= 200 && idxRes.status < 400) ok(`/company index page ??HTTP ${idxRes.status}`);
    else warn(`/company index page ??HTTP ${idxRes.status}`);
  } catch (e) { warn(`/company routing ?먭? ?ㅽ뙣: ${e.message}`); }
  // 2026-05-31: 11 endpoint 횞 sample ???ъ슜??媛???섏씠吏 ?곗씠??紐⑤몢 寃利?
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
    if (counts.error >= total / 2) err(`${name.padEnd(22)} ok ${counts.ok}/${total} (${okPct}%) error ${counts.error} ?ㅼ닔`);
    else if (counts.ok >= total * 0.7) ok(`${name.padEnd(22)} ok ${counts.ok}/${total} (${okPct}%)`);
    else warn(`${name.padEnd(22)} ok ${counts.ok}/${total} (${okPct}%) ??遺遺?寃고븿`);
  }
} catch (e) {
  warn(`company API 源딆씠 ?먭? ?ㅽ뙣: ${e.message}`);
}

// ?먥븧?먥븧?먥븧??Probe 9: Karpathy ?숈뒿 ?④낵 (?섍컖 ?щ컻 媛먯냼 異붿꽭) ?먥븧?먥븧?먥븧??
// 2026-05-30 closed loop ?명봽????F26 anti-pattern inject 媛 ?묐룞?섎뒗吏 寃利?
// 媛숈? (ticker, defect_type) ??detect ?잛닔媛 理쒓렐 cycle 留덈떎 媛먯냼?섎㈃ ?숈뒿 ?④낵 ?덉쓬.
console.log('\n## [9] Karpathy ?숈뒿 ?④낵 (anti-pattern inject ???щ컻 媛먯냼)\n');
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
    ok(`hallucination_history ??理쒓렐 7??寃고븿 0嫄?(verify-loop 誘몄옉???먮뒗 ?대┛)`);
  } else {
    ok(`hallucination_history ??7??${week.c}嫄?/ 24h ${today.c}嫄?(closed loop ?묐룞 以?`);
    for (const r of byType) {
      console.log(`   ${r.defect_type.padEnd(28)} ${r.c}嫄?/ avg_injected ${r.avg_injected.toFixed(1)}`);
    }
    // ?숈뒿 ?④낵: 媛숈? (ticker,type) ??detect 媛 inject ??以꾩뼱?쒕뒗吏
    // 2026-05-31: severity escalate ??3???좑툘 / 5????critical (data source 寃고븿 ?섏떖, 肄붾뱶 fix ?꾩슂)
    const repeat = db.prepare(`
      SELECT ticker, defect_type, COUNT(*) repeat_count
      FROM hallucination_history
      WHERE detected_at >= datetime('now','-7 days') AND ticker IS NOT NULL
      GROUP BY ticker, defect_type HAVING repeat_count >= 3 ORDER BY repeat_count DESC LIMIT 10
    `).all();
    const critical = repeat.filter(r => r.repeat_count >= 5);
    const moderate = repeat.filter(r => r.repeat_count >= 3 && r.repeat_count < 5);
    if (critical.length > 0) {
      err(`諛섎났 ?섍컖 ????(${critical.length}嫄? ??anti-pattern ?숈뒿 ?ㅽ뙣, 肄붾뱶 fix ?꾩닔: ${critical.map(r => `${r.ticker}/${r.defect_type}=${r.repeat_count}`).join(', ')}`);
    }
    if (moderate.length > 0) {
      warn(`諛섎났 ?섍컖 3-4??(${moderate.length}嫄? ??異붿꽭 愿李? ${moderate.map(r => `${r.ticker}/${r.defect_type}=${r.repeat_count}`).join(', ')}`);
    }
    if (critical.length === 0 && moderate.length === 0) {
      ok(`諛섎났 ?섍컖 ????0嫄???F26 anti-pattern inject ?숈뒿 ?④낵 ??);
    }
  }
} catch (e) {
  warn(`hallucination_history ?먭? ?ㅽ뙣: ${e.message}`);
}

// ?먥븧?먥븧?먥븧??Probe 4: ?숈씪 ?묐떟 諛섎났 (drift ?놁쓬 = stale) ?먥븧?먥븧?먥븧??
console.log('\n## [4] ?묐떟 drift (?뺤쟻 ?곗씠???섏떖)\n');

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
    warn(`${(r.endpoint ?? '?').padEnd(34)} unique ${r.unique_resp}/${r.total} (${driftRatio.toFixed(0)}%) ???뺤쟻 ?섏떖`);
  }
}

// ?먥븧?먥븧?먥븧??Probe 11: alias / meta ?뺥빀??(candidate ? ??meta ??TICKER_ALIASES) ?먥븧?먥븧?먥븧??
console.log('\n## [11] alias / meta ?뺥빀??(? ??meta ??TICKER_ALIASES)\n');
try {
  const ct = JSON.parse(readFileSync(`${ROOT}/data/candidate-tickers.json`, 'utf8'));
  const pool = new Set(ct.tickers ?? []);
  const meta = ct.meta ?? {};
  // 1. ? ticker 以?meta ?놁쓬 (?섏씠吏/蹂닿퀬?쒓? name/sector 紐?李얠쓬 ???섍컖 ?꾪뿕)
  const poolNoMeta = [...pool].filter(t => !meta[t]);
  // 2. TICKER_ALIASES ?寃잛씠 ????덈굹 (?놁쑝硫?alias ?뺢퇋????媛寃??ㅻ깄???ㅽ뙣)
  const gen = readFileSync(`${ROOT}/scripts/generate-report-local.mjs`, 'utf8');
  const blk = gen.match(/TICKER_ALIASES = new Map\(\[([\s\S]*?)\]\)/)?.[1] ?? '';
  const aliasTargets = [...blk.matchAll(/'[^']+',\s*'([^']+)'/g)].map(m => m[1]);
  const badAlias = aliasTargets.filter(t => !pool.has(t));
  // 3. meta ??以?? ??(stale ????먯꽌 鍮좎쭊 醫낅ぉ ?붿〈, 臾댄빐?섎굹 異붿쟻)
  const metaStale = Object.keys(meta).filter(k => !pool.has(k));
  if (poolNoMeta.length) err(`? ${poolNoMeta.length} ticker 媛 meta ?놁쓬 ??${poolNoMeta.slice(0, 6).join(', ')}`);
  else ok(`? ${pool.size} ticker ?꾨? meta 蹂댁쑀`);
  if (badAlias.length) err(`TICKER_ALIASES ?寃?${badAlias.length} 媛쒓? ? ????${badAlias.join(', ')}`);
  else ok(`TICKER_ALIASES ?寃?${aliasTargets.length} 媛??꾨? ? ??);
  if (metaStale.length > 60) warn(`meta stale ??${metaStale.length} 媛?(? ????build-candidate-tickers ?ъ깮??沅뚯옣)`);
  else ok(`meta stale ${metaStale.length} 媛?(?뺤긽 踰붿쐞)`);
} catch (e) { warn(`alias ?뺥빀???먭? ?ㅽ뙣: ${e.message}`); }

// ?먥븧?먥븧?먥븧??Probe 12: endpoint manifest ?먮룞 異붿텧 (page ?섏〈??drift) ?먥븧?먥븧?먥븧??
console.log('\n## [12] endpoint manifest drift (src 肄붾뱶 ?먮룞 異붿텧 vs ?섎뱶肄붾뵫 manifest/snapshot)\n');
try {
  // src ?몃━?먯꽌 肄붾뱶媛 ?ㅼ젣 李몄“?섎뒗 /api/ endpoint ?먮룞 ?섏쭛
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
  // 肄붾뱶媛 李몄“?섏?留??섎뱶肄붾뵫 manifest ???놁쓬 ??manifest stale (?먮룞 異붿텧??catch)
  const inCodeNotManifest = [...refEndpoints].filter(e => !manifestEps.has(e));
  // manifest ???덉?留?肄붾뱶 ?대뵒?먮룄 ?놁쓬 ??manifest 媛 二쎌? endpoint 媛由ы궡
  const inManifestNotCode = [...manifestEps].filter(e => !refEndpoints.has(e));
  console.log(`  肄붾뱶 李몄“ endpoint: ${refEndpoints.size} 媛?/ ?섎뱶肄붾뵫 manifest: ${manifestEps.size} 媛?);
  if (inManifestNotCode.length) warn(`manifest ?먮쭔 ?덇퀬 肄붾뱶???놁쓬 (${inManifestNotCode.length}): ${inManifestNotCode.join(', ')}`);
  // manifest 媛 異붿쟻?섎뒗 ?듭떖 endpoint 以?肄붾뱶 李몄“?섎뒗??理쒓렐 3??snapshot ?녿뒗 寃?
  //   2026-06-12: prefix 留ㅼ묶 ??per-ticker ?곸옱(/api/company-kr/005930)??base(/api/company-kr) 而ㅻ쾭濡??몄젙.
  const capCovers = (e) => capNormSet.has(e) || [...capNormSet].some(c => c.startsWith(`${e}/`) || c.startsWith(`${e}?`));
  const refNotCaptured = [...refEndpoints].filter(e => manifestEps.has(e) && !capCovers(e));
  if (refNotCaptured.length) warn(`manifest ?듭떖 endpoint 肄붾뱶 李몄“?섎굹 3??snapshot ?놁쓬 (${refNotCaptured.length}): ${refNotCaptured.slice(0, 8).join(', ')}`);

  // 2026-06-12: inCodeNotManifest 媛 怨꾩궛留??섍퀬 ??踰덈룄 蹂닿퀬 ???섎뜕 寃고븿 fix (?ш컖吏? ?먯?湲곗쓽
  //   ?ш컖吏? ??23媛?誘몄텛?곸씤??"?뺥빀 ?? 異쒕젰). ? 寃利앹씠 而ㅻ쾭?섎뒗 寃껋쓣 鍮쇨퀬 吏꾩쭨 誘몄빱踰꾨쭔 ?쒖텧:
  //   - audit-company-pages 媛 1,210횞9 濡?而ㅻ쾭?섎뒗 9醫?
  //   - endpoint_snapshots 理쒓렐 3???곸옱遺?(Probe [3b] 媛 status/error 寃??
  const COVERED_BY_COMPANY_PAGES = new Set(['/api/company-financials', '/api/company-kr', '/api/company-news',
    '/api/company-recs', '/api/stock-price', '/api/market-caps', '/api/price-history', '/api/analyst-target', '/api/iv']);
  // check-data-quality 媛 湲곕뒫 probe 濡?而ㅻ쾭 ([E] translate ?쒓?異쒕젰, [B] news-cascade locale)
  const COVERED_BY_DQ = new Set(['/api/translate', '/api/news-cascade']);
  // ?섎룄??誘몄빱踰?(?ъ쑀 紐낆떆 ??silent 湲덉?): POST ?꾩슜 + ?몄텧鍮꾩슜/?곹샇?묒슜?깆씠??二쇨린 probe 遺?곹빀
  const KNOWN_UNCOVERED = {
    '/api/ai': 'POST ?꾩슜 + LLM ?좏겙 鍮꾩슜',
    '/api/paper-trading': 'POST ?곹샇?묒슜(紐⑥쓽?ъ옄 二쇰Ц)',
    '/api/institutional-refresh': '媛깆떊 ?몃━嫄?遺?섑슚怨? ??二쇨린 probe 遺?곹빀',
  };
  // ?쒗뵆由?臾몄옄???꾪떚?⑺듃 ?쒖쇅: `/api/admin/${x}` 瑜섎뒗 ?⑥씪?멸렇癒쇳듃 regex 媛 '/api/admin' ?쇰줈 罹≪쿂?섎굹
  //   route.ts ?녿뒗 遺紐??붾젆?좊━ = ??endpoint ?꾨떂 (admin/* ? x-admin-secret ?꾩슂 ??愿由ъ옄 ?꾩슜 誘몄빱踰??섎룄)
  const isParentPrefix = (e) => {
    const seg = e.replace('/api/', '');
    return existsSync(`${ROOT}/src/app/api/${seg}`) && !existsSync(`${ROOT}/src/app/api/${seg}/route.ts`);
  };
  const trulyUncovered = inCodeNotManifest.filter(e =>
    !capCovers(e) && !COVERED_BY_COMPANY_PAGES.has(e) && !COVERED_BY_DQ.has(e) && !KNOWN_UNCOVERED[e] && !isParentPrefix(e));
  if (trulyUncovered.length) {
    // ?뚮씪誘명꽣 ?놁씠 GET 媛?ν븳 寃껋? 利됱꽍 body 寃?? 400/404/405 = ?뚮씪誘명꽣?꾩슂/POST?꾩슜(?댁븘?덉쓬 ??info),
    //   5xx ?먮뒗 200+鍮늒ody 留?寃고븿 ?섏떖.
    const results = [];
    for (const ep of trulyUncovered) {
      try {
        const res = await fetch(`http://localhost:${process.env.PORT || 3000}${ep}`, { signal: AbortSignal.timeout(10000) });
        const body = await res.text();
        const emptyish = body.length < 30 || /"error"\s*:/.test(body.slice(0, 200));
        const needsArgs = [400, 404, 405].includes(res.status);
        results.push(`${ep}=${res.status}${needsArgs ? '(args?꾩슂)' : emptyish ? '(鍮늒ody)' : ''}`);
        if (res.status >= 500 || (res.status === 200 && emptyish)) warn(`誘몄텛??endpoint 寃고븿 ?섏떖: ${ep} ??${res.status}, body ${body.slice(0, 80)}`);
      } catch { results.push(`${ep}=unreachable`); }
    }
    warn(`肄붾뱶 李몄“?섎굹 ?대뼡 寃利앸룄 誘몄빱踰?(${trulyUncovered.length}) ??利됱꽍 probe: ${results.join(', ')}`);
    console.log(`    ???곴뎄 而ㅻ쾭: snapshot-endpoints TRACKED_ENDPOINTS ??(args ?ы븿) 異붽?`);
  }
  if (!inManifestNotCode.length && !refNotCaptured.length && !trulyUncovered.length) ok(`manifest ??肄붾뱶 ??snapshot ?뺥빀 (肄붾뱶 ${refEndpoints.size} endpoint ?꾨? 寃利?而ㅻ쾭, ?섎룄??誘몄빱踰?${Object.keys(KNOWN_UNCOVERED).length}嫄??ъ쑀紐낆떆)`);
} catch (e) { warn(`manifest drift ?먭? ?ㅽ뙣: ${e.message}`); }

// ?먥븧?먥븧?먥븧??醫낇빀 ?먥븧?먥븧?먥븧??
console.log(`\n?먥븧??醫낇빀 ?먥븧??);
console.log(`silent NULL + ?꾨씫 + drift: ${errCount} 寃고븿`);
process.exit(errCount > 0 ? 1 : 0);
