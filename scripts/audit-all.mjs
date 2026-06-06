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
  // 2026-05-29: news-cascade 의 translated 상태 명시적 검사 (cached-en + translating:true = 영어 leak)
  { path: '/api/news-cascade?locale=ko', extract: j => {
    const n = (j.articles ?? j.entries ?? []).length;
    let src = j.source ?? '-';
    if (j.translated === false && j.translating === true) src += ' [UNTRANSLATED]';
    if (src === 'cached-en' || src.startsWith('cached-en')) src = `cached-en (영어 노출 중!)`;
    return { n, src };
  } },
  { path: '/api/market-heatmap?country=US', extract: j => ({ n: (j.sectors ?? []).reduce((s, x) => s + (x.stocks?.length ?? 0), 0), src: j.source ?? '-' }) },
  // 2026-05-29: live source 0건 시 명시적 WARN — static 데이터만 표시될 때 사용자에게 stale 인지시킴
  { path: '/api/supply-chain-signals', extract: j => {
    const sigs = j.signals ?? [];
    const live = sigs.filter(s => ['sec-8k','dart'].includes(s.source)).length;
    const liveRatio = sigs.length ? (live / sigs.length * 100).toFixed(0) : 0;
    let src = `${j.source ?? '-'} (live=${live}/${sigs.length}, ${liveRatio}%)`;
    if (live === 0 && sigs.length > 0) src += ' [STALE 정적만]';
    return { n: sigs.length, src };
  } },
  { path: '/api/signals', extract: j => ({ n: Math.max((j.entries ?? []).length, (j.signals ?? []).length), src: j.source ?? '-' }) },
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
    // 유료 API 잠금 상태 (configured:false) — 정상, lock UI 표시
    if (j.configured === false) { icon = '🔒'; msg = 'locked (paid API)'; }
    else if (n === 0) { icon = FMT_ERR; msg = '0 items'; }
    else if (staleness && staleness.startsWith('STALE')) { icon = FMT_ERR; msg = staleness; }
    // 2026-05-29: source 의 명시적 결함 패턴 — 사용자 가시 영향 ERR/WARN
    else if (src.includes('STALE 정적만') || src.includes('영어 노출 중') || src.includes('UNTRANSLATED')) { icon = FMT_ERR; msg = 'content quality fail'; }
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

// 2026-05-29 신규 [5/8]: 보고서 content quality 전수조사 — 사용자 가시 결함 detect
async function auditReportContent() {
  console.log(`\n=== [5/8] 보고서 content quality (사용자 가시 결함) ===\n`);
  if (!existsSync(REPORTS_DIR)) { console.log('  (reports dir 없음)'); return { err: 0 }; }
  const files = readdirSync(REPORTS_DIR).filter(f => f.endsWith('-ko.json')).sort().slice(-1);
  if (!files.length) return { err: 0 };
  const r = JSON.parse(readFileSync(`${REPORTS_DIR}/${files[0]}`, 'utf8'));
  let errs = 0;

  // (a) portfolio 각 종목의 catalysts/fundamentalBasis NULL
  const nullCats = (r.portfolio ?? []).filter(p => !Array.isArray(p.catalysts) || p.catalysts.length === 0).map(p => p.ticker);
  const nullFB = (r.portfolio ?? []).filter(p => !p.fundamentalBasis).map(p => p.ticker);
  console.log(`  catalysts NULL: ${nullCats.length} ${nullCats.length ? `[${FMT_ERR}: ${nullCats.join(',')}]` : FMT_OK}`);
  console.log(`  fundamentalBasis NULL: ${nullFB.length} ${nullFB.length ? `[${FMT_WARN}: ${nullFB.join(',')}]` : FMT_OK}`);
  if (nullCats.length > 0) errs++;

  // (b) 새 필드 (F21/F22) 존재 — 추적 fix 적용 확인
  const hasOutcomes = r.portfolioOutcomes != null;
  const hasQS = typeof r.qualityScore === 'number';
  const supplyHasDate = (r.supplyChainChanges ?? []).filter(s => s.date).length;
  const supplyTotal = (r.supplyChainChanges ?? []).length;
  console.log(`  portfolioOutcomes (F22): ${hasOutcomes ? FMT_OK : `${FMT_ERR} missing`}`);
  console.log(`  qualityScore (F19): ${hasQS ? `${FMT_OK} ${r.qualityScore}` : `${FMT_ERR} missing`}`);
  console.log(`  supplyChain date 매핑 (F21): ${supplyHasDate}/${supplyTotal} ${supplyHasDate === supplyTotal && supplyTotal > 0 ? FMT_OK : (supplyTotal > 0 ? `${FMT_ERR} drop` : '(no data)')}`);
  if (!hasQS) errs++;
  if (!hasOutcomes) errs++;
  if (supplyTotal > 0 && supplyHasDate < supplyTotal) errs++;

  // (c) supplyChainChanges drift — 직전 보고서와 hash 비교 (매번 동일 = stale)
  if (files.length > 0) {
    const prevFiles = readdirSync(REPORTS_DIR).filter(f => f.endsWith('-ko.json')).sort().slice(-3, -1);
    if (prevFiles.length) {
      const prev = JSON.parse(readFileSync(`${REPORTS_DIR}/${prevFiles[prevFiles.length-1]}`, 'utf8'));
      const curHash = JSON.stringify((r.supplyChainChanges ?? []).map(s => s.headline).sort());
      const prevHash = JSON.stringify((prev.supplyChainChanges ?? []).map(s => s.headline).sort());
      if (curHash === prevHash && supplyTotal > 0) {
        console.log(`  ${FMT_WARN} supplyChainChanges 매번 동일 (drift 없음, 정적 의심)`);
      }
    }
  }
  return { err: errs };
}

// 2026-05-29 신규 [6/8]: silent fail logs grep — F19/F22 inject 흔적
async function auditSilentFails() {
  console.log(`\n=== [6/8] silent fail logs grep — LLM inject 흔적 ===\n`);
  const logPath = 'C:/NoAddsMakingApps/FlowVium/logs/report.log';
  if (!existsSync(logPath)) { console.log('  (logs 없음)'); return { err: 0 }; }
  // 최근 2000줄만 검사
  const tail = readFileSync(logPath, 'utf8').split('\n').slice(-2000).join('\n');
  let errs = 0;
  const probes = [
    { label: 'F19 SkillOpt prompt inject', pattern: /\[F19\/SkillOpt\] prompt 에 Quality Feedback inject/ },
    { label: 'F22 Portfolio Feedback inject', pattern: /\[F22\/Portfolio Feedback\] prompt 에 outcome 통계 inject/ },
    { label: 'enforceRotation 작동', pattern: /🔄 rotation:/ },
    { label: '품질 게이트 통과', pattern: /품질 점수: \d+\/100/ },
  ];
  for (const p of probes) {
    const hits = (tail.match(new RegExp(p.pattern, 'g')) || []).length;
    const icon = hits > 0 ? FMT_OK : FMT_ERR;
    console.log(`  ${icon} ${PAD(p.label, 36)} hits=${hits}`);
    if (hits === 0) errs++;
  }
  return { err: errs };
}

// 2026-05-29 신규 [7/8]: 종목 다양성 quantitative metric
async function auditDiversity() {
  console.log(`\n=== [7/8] 종목 다양성 (DB + candidate pool) ===\n`);
  if (!existsSync(DB_PATH)) { console.log('  (DB 없음)'); return { err: 0 }; }
  const db = new Database(DB_PATH, { readonly: true });
  let total = 630;
  try {
    const tickersFile = JSON.parse(readFileSync('C:/NoAddsMakingApps/FlowVium/data/candidate-tickers.json', 'utf8'));
    total = tickersFile.total ?? total;
  } catch { /* default */ }
  const uniqRecent = db.prepare(`SELECT COUNT(DISTINCT ticker) c FROM recommendations WHERE generated_at >= date('now','-7 days')`).get().c;
  const uniqTotal = db.prepare(`SELECT COUNT(DISTINCT ticker) c FROM recommendations`).get().c;
  db.close();
  const coverageRecent = ((uniqRecent / total) * 100).toFixed(1);
  const coverageTotal = ((uniqTotal / total) * 100).toFixed(1);
  console.log(`  최근 7일 unique: ${uniqRecent} (${coverageRecent}% of ${total})`);
  console.log(`  전체 누적 unique: ${uniqTotal} (${coverageTotal}% of ${total})`);
  let icon = FMT_OK;
  if (uniqRecent < 20) icon = FMT_WARN;
  if (uniqRecent < 15) icon = FMT_ERR;
  console.log(`  ${icon} 7일 다양성 ${uniqRecent < 15 ? '심각 (15 미만)' : uniqRecent < 20 ? '낮음 (20 미만)' : '정상'}`);
  return { err: uniqRecent < 15 ? 1 : 0 };
}

(async () => {
  const t0 = Date.now();
  console.log(`╔═══════════════════════════════════════════════════════════╗`);
  console.log(`║  FlowVium 종합 점검 — ${new Date().toISOString().slice(0, 19)}              ║`);
  console.log(`╚═══════════════════════════════════════════════════════════╝`);
  const summary = await auditEndpoints();
  let extraErr = 0;
  if (!QUICK) {
    await auditLatestReport();
    await auditOutcomes();
    await auditEnglishLeak();
    extraErr += (await auditReportContent()).err;
    extraErr += (await auditSilentFails()).err;
    extraErr += (await auditDiversity()).err;
  }
  console.log(`\n총 소요: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`최종: endpoint=${summary.err} content/silent/diversity=${extraErr}`);
  process.exit((summary.err + extraErr) > 0 ? 1 : 0);
})();
