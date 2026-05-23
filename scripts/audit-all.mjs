#!/usr/bin/env node
/**
 * scripts/audit-all.mjs — 전 endpoint + 보고서 + DB 종합 점검.
 *
 * 사용: node scripts/audit-all.mjs [--base=https://flowvium.net] [--quick]
 *
 * 체크 항목:
 *  1. 20개 endpoint live fetch + source/size/payload 검증
 *  2. 핵심 응답 필드 (stocks/articles/items 등) 0건이면 ERROR
 *  3. 영어 leak 감지 (한국어 페이지에서 영문 본문)
 *  4. 최근 보고서 entry zone 적합도 (실가 대조)
 *  5. SQLite outcome 추세 (NE 비율 등)
 */
import Database from 'better-sqlite3';
import { readFileSync, readdirSync, existsSync } from 'fs';

const args = process.argv.slice(2);
const BASE = (args.find(a => a.startsWith('--base='))?.split('=')[1]) ?? 'https://flowvium.net';
const QUICK = args.includes('--quick');
const DB_PATH = 'C:/NoAddsMakingApps/FlowVium/data/flowvium.db';
const REPORTS_DIR = 'C:/NoAddsMakingApps/FlowVium/reports';

const PAD = (s, n) => String(s ?? '').padEnd(n);
const FMT_OK = '✅', FMT_WARN = '⚠️', FMT_ERR = '❌';

// 각 endpoint 별 의미있는 데이터 추출 + 검증 정의
const ENDPOINTS = [
  { path: '/api/fear-greed', extract: j => ({ n: Object.keys(j.byCountry ?? {}).length, src: j.source ?? '-' }) },
  { path: '/api/capital-flows', extract: j => ({ n: j.assetCount ?? (j.assets ?? []).length, src: j.source ?? '-' }) },
  { path: '/api/macro-indicators', extract: j => ({ n: (j.indicators ?? []).length, src: j.source ?? '-' }) },
  { path: '/api/credit-balance', extract: j => ({ n: (j.countries ?? []).length, src: j.source ?? '-' }) },
  { path: '/api/yield-curve', extract: j => ({ n: j.today ? Object.keys(j.today).length : 0, src: j.source ?? 'fred' }) },
  { path: '/api/volatility', extract: j => ({ n: j.vix != null ? 1 : 0, src: j.source ?? '-' }) },
  { path: '/api/fedwatch', extract: j => ({ n: (j.probabilities ?? j.meetings ?? []).length, src: j.source ?? '-' }) },
  { path: '/api/short-interest', extract: j => ({ n: (j.entries ?? []).length, src: j.source ?? '-' }) },
  { path: '/api/insider-trades', extract: j => ({ n: (j.items ?? j.trades ?? []).length, src: j.source ?? '-' }) },
  { path: '/api/ownership-alerts', extract: j => ({ n: (j.items ?? j.alerts ?? []).length, src: j.source ?? '-' }) },
  { path: '/api/nport-holdings', extract: j => ({ n: j.fundCount ?? (j.funds ?? []).length, src: j.source ?? '-' }) },
  { path: '/api/korea-flow?period=4w', extract: j => ({ n: (j.topForeignBuy ?? []).length + (j.topInstBuy ?? []).length, src: j.source ?? '-' }) },
  { path: '/api/news-cascade?locale=ko', extract: j => ({ n: (j.articles ?? []).length, src: j.source ?? '-' }) },
  { path: '/api/market-heatmap?country=US', extract: j => ({ n: (j.sectors ?? []).reduce((s, x) => s + (x.stocks?.length ?? 0), 0), src: j.source ?? '-' }) },
  { path: '/api/supply-chain-signals', extract: j => { const sigs = j.signals ?? []; const live = sigs.filter(s => ['sec-8k','dart','satellite'].includes(s.source)).length; return { n: sigs.length, src: `${j.source ?? '-'} (live=${live})` }; } },
  { path: '/api/signals', extract: j => ({ n: (j.entries ?? j.signals ?? []).length, src: j.source ?? '-' }) },
  { path: '/api/cot-positions', extract: j => ({ n: (j.entries ?? []).length, src: j.source ?? '-' }) },
  { path: '/api/commodity-curve', extract: j => ({ n: (j.curves ?? j.entries ?? []).length, src: j.source ?? '-' }) },
  { path: '/api/market-caps', extract: j => ({ n: j.capsLive ?? 0, src: `${j.source ?? '-'} (${j.capsLive ?? 0}/${j.capsTotal ?? '?'})` }) },
  { path: '/api/economic-calendar?country=US', extract: j => ({ n: (j.events ?? []).length, src: j.source ?? '-' }) },
];

async function checkEndpoint(ep) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}${ep.path}`, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'audit-all/1.0' }, cache: 'no-store' });
    const ms = Date.now() - t0;
    const text = await res.text();
    if (!res.ok) return { ep: ep.path, status: res.status, ms, icon: FMT_ERR, msg: `HTTP ${res.status}` };
    const j = JSON.parse(text);
    const { n, src } = ep.extract(j);
    const sizeKB = (text.length / 1024).toFixed(0);
    // 데이터 staleness check — updatedAt 24h+ 시 WARN
    const updatedAt = j.updatedAt ?? j.lastUpdated ?? j.dataDate ?? j.timestamp;
    let staleness = null;
    if (updatedAt) {
      const ageMs = Date.now() - new Date(updatedAt).getTime();
      if (isFinite(ageMs) && ageMs > 0) {
        const ageH = ageMs / 3600000;
        if (ageH > 24) staleness = `STALE ${ageH.toFixed(1)}h`;
        else if (ageH > 12) staleness = `aging ${ageH.toFixed(1)}h`;
      }
    }
    let icon = FMT_OK, msg = '';
    if (n === 0) { icon = FMT_ERR; msg = '0 items'; }
    else if (staleness && staleness.startsWith('STALE')) { icon = FMT_ERR; msg = staleness; }
    else if (src === 'error' || src === 'static' || (src && src.startsWith('error'))) { icon = FMT_WARN; msg = `degraded source`; }
    else if (staleness) { icon = FMT_WARN; msg = staleness; }
    return { ep: ep.path, status: 200, ms, icon, n, src: msg ? `${src} [${msg}]` : src, sizeKB, msg };
  } catch (e) {
    return { ep: ep.path, status: 'ERR', ms: Date.now() - t0, icon: FMT_ERR, msg: String(e).slice(0, 60) };
  }
}

// 1. Endpoint 점검 (병렬 5개씩)
async function auditEndpoints() {
  console.log(`\n=== [1/4] Endpoint 라이브 점검 (${BASE}) ===\n`);
  const results = [];
  for (let i = 0; i < ENDPOINTS.length; i += 5) {
    results.push(...await Promise.all(ENDPOINTS.slice(i, i + 5).map(checkEndpoint)));
  }
  console.log(`${PAD('icon', 4)}${PAD('endpoint', 42)}${PAD('status', 7)}${PAD('ms', 7)}${PAD('items', 7)}${PAD('size', 7)}source`);
  console.log('─'.repeat(110));
  let ok = 0, warn = 0, err = 0;
  for (const r of results) {
    if (r.icon === FMT_OK) ok++; else if (r.icon === FMT_WARN) warn++; else err++;
    console.log(`${r.icon}  ${PAD(r.ep, 40)}${PAD(r.status, 7)}${PAD(r.ms + 'ms', 7)}${PAD(r.n ?? '?', 7)}${PAD((r.sizeKB ?? '?') + 'KB', 7)}${r.src ?? r.msg ?? ''}`);
  }
  console.log(`\n  ✅ OK: ${ok} | ⚠️  WARN: ${warn} | ❌ ERR: ${err}`);
  return { ok, warn, err };
}

// 2. 최근 보고서 entry zone 적합도
async function auditLatestReport() {
  console.log(`\n=== [2/4] 최근 보고서 검증 ===\n`);
  if (!existsSync(REPORTS_DIR)) { console.log('  (reports dir 없음)'); return; }
  const files = readdirSync(REPORTS_DIR).filter(f => f.endsWith('-ko.json')).sort().slice(-1);
  if (!files.length) { console.log('  (보고서 없음)'); return; }
  const r = JSON.parse(readFileSync(`${REPORTS_DIR}/${files[0]}`, 'utf8'));
  console.log(`  파일: ${files[0]}`);
  console.log(`  generatedAt: ${r.generatedAt} | totalFixes: ${r.harnessAudit?.totalFixes ?? '?'}`);
  const port = r.portfolio ?? [];
  const undef = port.filter(p => !p.entryZone || p.entryZone === 'undefined').length;
  const hasPlan = port.filter(p => p.entryPlan).length;
  console.log(`  종목: ${port.length} | entryPlan: ${hasPlan} | UNDEF: ${undef}`);

  // 실가 대조 (Yahoo)
  const tickers = port.map(p => p.ticker).filter(Boolean);
  const prices = {};
  for (const t of tickers) {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?interval=1d&range=5d`, { signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'Mozilla/5.0' } });
      const j = await r.json();
      const c = j.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter(v => v != null) ?? [];
      if (c.length) prices[t] = c[c.length - 1];
    } catch { /* skip */ }
  }
  let inZone = 0, near = 0, far = 0;
  for (const p of port) {
    const actual = prices[p.ticker];
    const nums = (p.entryZone ?? '').replace(/[₩$,\s]/g, '').match(/[\d.]+/g)?.map(Number) ?? [];
    if (!actual || !nums.length) continue;
    const hi = Math.max(...nums), lo = Math.min(...nums);
    if (actual >= lo && actual <= hi) inZone++;
    else if (Math.abs((actual - hi) / actual) < 0.05) near++;
    else far++;
  }
  console.log(`  실가 대조: ✅ zone안=${inZone} | ⚠️ 근접=${near} | ❌ 멀리=${far}`);
}

// 3. SQLite outcome 추세
async function auditOutcomes() {
  console.log(`\n=== [3/4] DB outcome 추세 (최근 7일) ===\n`);
  if (!existsSync(DB_PATH)) { console.log('  (DB 없음)'); return; }
  const db = new Database(DB_PATH, { readonly: true });
  const oc = db.prepare(`SELECT outcome, COUNT(*) AS c FROM recommendation_outcomes WHERE evaluated_at >= datetime('now','-7 days') GROUP BY outcome`).all();
  if (!oc.length) { console.log('  (최근 7일 outcome 없음)'); db.close(); return; }
  const total = oc.reduce((s, o) => s + o.c, 0);
  oc.forEach(o => console.log(`  ${PAD(o.outcome, 16)}${o.c} (${(o.c / total * 100).toFixed(1)}%)`));
  // 만성 NE 경고
  const chronic = db.prepare(`SELECT r.ticker, COUNT(*) AS ne FROM recommendation_outcomes o JOIN recommendations r ON r.id = o.recommendation_id WHERE o.outcome='not_entered' AND r.action='buy' GROUP BY r.ticker HAVING ne >= 5 ORDER BY ne DESC`).all();
  if (chronic.length) {
    console.log(`\n  🚨 만성 NE (buy 5회+):`);
    chronic.forEach(c => console.log(`    ${c.ticker}: ${c.ne}회`));
  }
  db.close();
}

// 4. 영어 leak 감지 (한국어 페이지에서 영문)
async function auditEnglishLeak() {
  console.log(`\n=== [4/4] 영어 leak 점검 ===\n`);
  const checks = [
    { name: 'company-news (NVDA, ko)', url: `${BASE}/api/company-news?ticker=NVDA&locale=ko`, field: 'news', titleKey: 'title' },
    { name: 'news-cascade (ko)', url: `${BASE}/api/news-cascade?locale=ko`, field: 'articles', titleKey: 'title' },
  ];
  for (const c of checks) {
    try {
      const r = await fetch(c.url, { signal: AbortSignal.timeout(15000), cache: 'no-store' });
      const j = await r.json();
      const items = j[c.field] ?? [];
      const leaks = items.filter(it => {
        const s = it[c.titleKey] ?? '';
        return /[A-Za-z]{10,}/.test(s) && !/[가-힣]/.test(s);
      });
      const icon = leaks.length === 0 ? FMT_OK : leaks.length < 3 ? FMT_WARN : FMT_ERR;
      console.log(`  ${icon} ${PAD(c.name, 30)} ${items.length}건 중 영어 leak ${leaks.length}건`);
      if (leaks.length) leaks.slice(0, 2).forEach(l => console.log(`     · ${(l[c.titleKey] ?? '').slice(0, 70)}`));
    } catch (e) { console.log(`  ❌ ${c.name} 실패: ${String(e).slice(0, 60)}`); }
  }
}

(async () => {
  const t0 = Date.now();
  console.log(`╔═══════════════════════════════════════════════════════════╗`);
  console.log(`║  FlowVium 종합 점검 — ${new Date().toISOString().slice(0, 19)}              ║`);
  console.log(`╚═══════════════════════════════════════════════════════════╝`);
  const summary = await auditEndpoints();
  if (!QUICK) {
    await auditLatestReport();
    await auditOutcomes();
    await auditEnglishLeak();
  }
  console.log(`\n총 소요: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(summary.err > 0 ? 1 : 0);
})();
