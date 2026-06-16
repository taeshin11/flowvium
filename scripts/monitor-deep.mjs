#!/usr/bin/env node
// scripts/monitor-deep.mjs
// 무거운 모니터 1회 — A=전체페이지 렌더감사 + B=정확도probe(공식소스 대조) → DB append-only 적재.
//   (2026-06-16 사용자 "a,b 다 해야지. 데이터 db저장은? 전향적연구가능?".)
//   기존 모니터는 liveness(살아있나)만 봤고 logs/*.json 덮어쓰기라 이력 휘발 → 시간축 결함/정확도
//   drift 를 못 봤다. 이 잡이 매 사이클 관측을 monitor_runs/render_audit_log/accuracy_probe_log 에
//   타임스탬프와 함께 누적 → 전향적(forward-looking) 코호트 연구 가능. session-spotcheck 가 6h throttle 로
//   detached spawn 한다(무거워서 매 사이클 X). 출력 1줄 + logs/monitor-deep-status.json.
// 사용: node scripts/monitor-deep.mjs [--base=https://flowvium.net]
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveMonitorObservation, getLatestMonitorRun, openDb } from './lib/db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=').slice(1).join('=') : d; };
const BASE = arg('base', 'https://flowvium.net').replace(/\/$/, '');
const runId = new Date().toISOString();
const t0 = Date.now();
const alerts = [];
const info = [];

// .env.local 로드 (pm2/plain node 는 자동 로드 안 함 — MEMBER_EMAIL 게이트 해제용)
try {
  const envPath = resolve(ROOT, '.env.local');
  if (existsSync(envPath)) for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* non-fatal */ }

// ── A: 렌더 전수감사 — audit-pages --tabs (14페이지 + URL/클릭 탭) → logs/page-audit.json 파싱 ──────
let renderFlags = [];
let authState = 'anon';
let pagesAudited = 0;
try {
  const r = spawnSync(process.execPath, [`${__dirname}/visual/audit-pages.mjs`, '--tabs', `--base=${BASE}`],
    { encoding: 'utf8', timeout: 300000, env: process.env });
  if (r.error) throw r.error;
  const pa = JSON.parse(readFileSync(`${ROOT}/logs/page-audit.json`, 'utf8'));
  authState = pa.authState || 'anon';
  pagesAudited = pa.pages.length;
  for (const p of pa.pages) for (const f of (p.flags || [])) {
    renderFlags.push({ page: p.path, tab: f.tabs ? f.tabs.join(',') : null, detector: f.detector, severity: f.sev, count: f.count, sample: f.samples?.[0]?.snip || '' });
  }
  const high = renderFlags.filter((f) => f.severity === 'high').length;
  info.push(`A렌더 ${pagesAudited}p/${renderFlags.length}flag(high ${high},auth=${authState})`);
  if (high) alerts.push(`렌더 high ${high}: ${[...new Set(renderFlags.filter((f) => f.severity === 'high').map((f) => f.detector))].join(',')}`);
} catch (e) { alerts.push(`A렌더 실패:${String(e?.message || e).slice(0, 50)}`); }

// ── B: 정확도 probe — 우리 발행값 vs 공식 소스(독립 fetch). delta 누적이 핵심(전향적). ──────────────
const probes = [];
const num = (v) => (v == null || v === '' ? null : (Number.isFinite(+v) ? +v : null)); // null→null (기존 +null=0 버그 fix)
const BROWSER = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36', Accept: 'application/json' };
async function jget(url, headers) { const r = await fetch(url, { headers, signal: AbortSignal.timeout(12000) }); if (!r.ok) throw new Error('http' + r.status); return r.json(); }
function pushProbe(metric, our, source, sourceName, tol) {
  // source 결측 = 외부 불가(na). our 결측인데 source 있음 = 우리 데이터 누락(error — 발행본 결함, 알림 대상).
  if (source == null) { probes.push({ metric, our, source, sourceName, delta: null, tolerance: tol, verdict: 'na', detail: 'source 결측' }); return; }
  if (our == null) { probes.push({ metric, our, source, sourceName, delta: null, tolerance: tol, verdict: 'error', detail: `our 결측 (src=${source})` }); return; }
  const delta = our - source;
  const verdict = Math.abs(delta) <= tol ? 'ok' : (Math.abs(delta) <= tol * 2 ? 'degraded' : 'error');
  probes.push({ metric, our, source, sourceName, delta, tolerance: tol, verdict, detail: `our=${our} src=${source} d=${delta.toFixed(2)}` });
}
// 우리 최신 macro snapshot (DB) + 라이브 F&G
let macro = {};
try { macro = openDb().prepare('SELECT vix,yield_10y,spy_close FROM macro_snapshots ORDER BY id DESC LIMIT 1').get() || {}; } catch {}
let ourFg = null;
try { const j = await jget(`${BASE}/api/fear-greed`); ourFg = num(j.byCountry?.find((c) => c.id === 'us')?.score); } catch {}
// 1) F&G US vs CNN 공식
try { const j = await jget('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', { ...BROWSER, Referer: 'https://www.cnn.com/' }); pushProbe('fg.us', ourFg, Math.round(num(j.fear_and_greed?.score)), 'CNN', 3); } catch { pushProbe('fg.us', ourFg, null, 'CNN', 3); }
// 2) 10Y 금리 vs Yahoo ^TNX (FRED CSV 봇차단 → Yahoo 사용)
try { const j = await jget('https://query1.finance.yahoo.com/v8/finance/chart/%5ETNX', BROWSER); pushProbe('yield.10y', num(macro.yield_10y), num(j.chart.result[0].meta.regularMarketPrice), 'Yahoo:^TNX', 0.15); } catch { pushProbe('yield.10y', num(macro.yield_10y), null, 'Yahoo:^TNX', 0.15); }
// 3) VIX vs Yahoo ^VIX
try { const j = await jget('https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX', BROWSER); pushProbe('vix', num(macro.vix), num(j.chart.result[0].meta.regularMarketPrice), 'Yahoo:^VIX', 1.5); } catch { pushProbe('vix', num(macro.vix), null, 'Yahoo:^VIX', 1.5); }
// 4) SPY vs Yahoo SPY (장중 이동분 있어 tol 넓게 — delta 추세 누적이 목적)
try { const j = await jget('https://query1.finance.yahoo.com/v8/finance/chart/SPY', BROWSER); const our = num(macro.spy_close); pushProbe('spy', our, num(j.chart.result[0].meta.regularMarketPrice), 'Yahoo:SPY', our ? our * 0.02 : 10); } catch { pushProbe('spy', num(macro.spy_close), null, 'Yahoo:SPY', 10); }

const probesError = probes.filter((p) => p.verdict === 'error').length;
info.push(`B정확도 ${probes.length}probe(err ${probesError}): ${probes.map((p) => `${p.metric}${p.verdict === 'ok' ? '✓' : p.verdict === 'na' ? '∅' : '⚠' + (p.delta != null ? p.delta.toFixed(1) : '')}`).join(' ')}`);
if (probesError) alerts.push(`정확도 error ${probesError}: ${probes.filter((p) => p.verdict === 'error').map((p) => `${p.metric}(d=${p.delta?.toFixed(1)})`).join(',')}`);

// ── DB 적재 (전향적 연구 누적) ──
try { saveMonitorObservation({ runId, base: BASE, authState, renderFlags, probes, durationMs: Date.now() - t0, ok: alerts.length === 0 }); info.push('DB적재✓'); }
catch (e) { alerts.push(`DB적재 실패:${String(e?.message).slice(0, 50)}`); }

// 상태파일 (session-spotcheck 가 surface)
const status = {
  ts: runId, base: BASE, authState, pagesAudited,
  renderFlags: renderFlags.length, highFlags: renderFlags.filter((f) => f.severity === 'high').length,
  highDetectors: [...new Set(renderFlags.filter((f) => f.severity === 'high').map((f) => f.detector))],
  probes: probes.map((p) => ({ metric: p.metric, verdict: p.verdict, delta: p.delta })), probesError,
  durationMs: Date.now() - t0, verdict: alerts.length ? 'alert' : 'ok',
};
try { writeFileSync(`${ROOT}/logs/monitor-deep-status.json`, JSON.stringify(status, null, 2)); } catch {}

const line = alerts.length
  ? `MONITOR-DEEP ALERT: ${alerts.join(' | ')}  [${info.join(' / ')}]  (${((Date.now() - t0) / 1000).toFixed(0)}s)`
  : `MONITOR-DEEP OK  ${info.join(' / ')}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`;
console.log(line);
process.exitCode = alerts.length ? 1 : 0;
setTimeout(() => process.exit(process.exitCode), 2000).unref();
