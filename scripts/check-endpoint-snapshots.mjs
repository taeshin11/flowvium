#!/usr/bin/env node
import Database from 'better-sqlite3';
const db = new Database('D:/Flowvium/data/flowvium.db', { readonly: true });

console.log('═══ endpoint_snapshots 적재 점검 ═══\n');

const total = db.prepare('SELECT COUNT(*) c FROM endpoint_snapshots').get().c;
console.log('총 rows:', total);

// 1) 최근 7일 endpoint 별 적재
const byEp = db.prepare(`
  SELECT endpoint, COUNT(*) c,
    SUM(CASE WHEN ok=1 THEN 1 ELSE 0 END) ok_cnt,
    SUM(CASE WHEN ok=0 THEN 1 ELSE 0 END) fail_cnt,
    MAX(captured_at) last_at,
    AVG(LENGTH(response_json)) avg_size
  FROM endpoint_snapshots
  WHERE captured_at >= datetime('now','-7 days')
  GROUP BY endpoint
  ORDER BY endpoint
`).all();
console.log('\n=== 최근 7일 endpoint별 적재 ===');
console.log('  endpoint                            n    ok  fail  avg_size   last_at');
for (const r of byEp) {
  const status = r.fail_cnt === 0 ? '✅' : r.fail_cnt < r.ok_cnt/3 ? '⚠️' : '❌';
  const kb = ((r.avg_size ?? 0) / 1024).toFixed(1) + 'KB';
  console.log(`  ${status} ${(r.endpoint ?? '?').padEnd(34)} ${String(r.c).padEnd(4)} ${String(r.ok_cnt).padEnd(4)} ${String(r.fail_cnt).padEnd(5)} ${kb.padEnd(10)} ${r.last_at?.slice(0,19)}`);
}

// 2) 보고서별 적재 수 (20개 모두 적재되는지)
const EXPECTED_EP = [
  '/api/fear-greed','/api/capital-flows','/api/macro-indicators','/api/credit-balance',
  '/api/yield-curve','/api/volatility','/api/fedwatch','/api/short-interest',
  '/api/insider-trades','/api/ownership-alerts','/api/nport-holdings','/api/korea-flow?period=4w',
  '/api/news-cascade?locale=ko','/api/market-heatmap?country=US','/api/supply-chain-signals','/api/signals',
  '/api/cot-positions','/api/commodity-curve','/api/market-caps','/api/economic-calendar?country=US',
];

const recentReports = db.prepare(`SELECT id, generated_at FROM reports ORDER BY generated_at DESC LIMIT 7`).all();
console.log('\n=== 최근 7 보고서 적재 완전성 (목표 20/20) ===');
for (const r of recentReports) {
  const caps = db.prepare(`SELECT endpoint FROM endpoint_snapshots WHERE report_id=?`).all(r.id).map(x => x.endpoint);
  const capSet = new Set(caps);
  const missing = EXPECTED_EP.filter(e => !capSet.has(e));
  const okCount = db.prepare(`SELECT COUNT(*) c FROM endpoint_snapshots WHERE report_id=? AND ok=1`).get(r.id).c;
  const status = caps.length >= 20 && missing.length === 0 ? '✅' : caps.length >= 18 ? '⚠️' : '❌';
  let line = `  ${status} ${r.id.padEnd(38)} ${caps.length}/20 (ok=${okCount})`;
  if (missing.length > 0) line += ` 누락: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '...' : ''}`;
  console.log(line);
}

// 3) 실패 endpoint
const fails = db.prepare(`
  SELECT endpoint, http_status, COUNT(*) c
  FROM endpoint_snapshots
  WHERE ok=0 AND captured_at >= datetime('now','-7 days')
  GROUP BY endpoint, http_status
  ORDER BY c DESC LIMIT 10
`).all();
console.log('\n=== 최근 7일 실패 (ok=0) ===');
if (!fails.length) console.log('  (없음 — 모든 적재 ok=1)');
for (const r of fails) console.log(`  ❌ ${r.endpoint?.padEnd(34)} HTTP ${r.http_status} × ${r.c}회`);

// 4) 누락 패턴 — 어떤 endpoint 가 가장 자주 빠지나
const allCaps = db.prepare(`
  SELECT report_id, GROUP_CONCAT(endpoint, '|') eps
  FROM endpoint_snapshots
  WHERE captured_at >= datetime('now','-7 days')
  GROUP BY report_id
`).all();
const missCount = {};
for (const e of EXPECTED_EP) missCount[e] = 0;
for (const r of allCaps) {
  const set = new Set(r.eps.split('|'));
  for (const e of EXPECTED_EP) if (!set.has(e)) missCount[e]++;
}
const sortedMiss = Object.entries(missCount).filter(([, c]) => c > 0).sort((a,b) => b[1] - a[1]);
console.log('\n=== 누락 빈도 (최근 7일 보고서 기준) ===');
if (!sortedMiss.length) console.log('  (모든 보고서 20/20)');
for (const [ep, cnt] of sortedMiss) console.log(`  ⚠️  ${ep.padEnd(36)} ${cnt}회 누락`);

// 5) response_json 크기 — truncated 의심
console.log('\n=== response_json 크기 분포 (최근 3일 평균) ===');
const sizeDist = db.prepare(`
  SELECT endpoint,
    ROUND(AVG(LENGTH(response_json)) / 1024.0, 1) avg_kb,
    ROUND(MAX(LENGTH(response_json)) / 1024.0, 1) max_kb,
    ROUND(MIN(LENGTH(response_json)) / 1024.0, 1) min_kb
  FROM endpoint_snapshots
  WHERE captured_at >= datetime('now','-3 days')
  GROUP BY endpoint
  ORDER BY avg_kb DESC
`).all();
for (const r of sizeDist) {
  const flag = r.min_kb === 0 || r.min_kb < r.avg_kb / 5 ? '⚠️' : '✅';
  console.log(`  ${flag} ${(r.endpoint ?? '?').padEnd(34)} avg ${r.avg_kb}KB (${r.min_kb} ~ ${r.max_kb})`);
}

// 6) source 분포 — 정적 vs 라이브 추세
console.log('\n=== 최근 7일 source 분포 (상위 endpoint) ===');
const srcDist = db.prepare(`
  SELECT endpoint, source, COUNT(*) c
  FROM endpoint_snapshots
  WHERE captured_at >= datetime('now','-7 days')
  GROUP BY endpoint, source
  ORDER BY endpoint, c DESC
`).all();
let currentEp = null;
for (const r of srcDist) {
  if (currentEp !== r.endpoint) {
    console.log(`  ${(r.endpoint ?? '?').padEnd(34)} src 분포:`);
    currentEp = r.endpoint;
  }
  console.log(`    - ${(r.source ?? 'null').padEnd(20)} ${r.c}회`);
}
