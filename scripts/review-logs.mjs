/**
 * review-logs.mjs — 로컬 보고서 품질 일괄 검토 도구
 *
 * 사용법:
 *   node scripts/review-logs.mjs                  # reports/ 최신 5개 검토
 *   node scripts/review-logs.mjs --all             # reports/ 전체 검토
 *   node scripts/review-logs.mjs --n=10            # 최신 N개 검토
 *   node scripts/review-logs.mjs --file=path.json  # 특정 파일 검토
 *   node scripts/review-logs.mjs --redis           # Redis 최신 보고서 검토 (stale key)
 *   node scripts/review-logs.mjs --locale=ko       # 특정 locale 필터
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT   = resolve(__dir, '..');
const REPORTS_DIR = resolve(ROOT, 'reports');

// ── .env.local 파싱 ─────────────────────────────────────────────────────────────
function loadEnv() {
  const env = {};
  try {
    const raw = readFileSync(resolve(ROOT, '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* optional */ }
  return env;
}
const env = loadEnv();

// ── 인수 파싱 ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const showAll    = args.includes('--all');
const useRedis   = args.includes('--redis');
const nArg       = parseInt(args.find(a => a.startsWith('--n='))?.split('=')[1] ?? '5', 10);
const fileArg    = args.find(a => a.startsWith('--file='))?.split('=')[1];
const localeArg  = args.find(a => a.startsWith('--locale='))?.split('=')[1];

// ── isGarbage (동일 로직) ────────────────────────────────────────────────────────
const CJK_LOCALES = new Set(['ko', 'ja', 'zh-CN', 'zh-TW', 'zh']);
const GARBAGE_MIN_LEN = { thesis: 25, macroAnalysis: 30, technicalAnalysis: 15 };
function garbageMinLen(base, locale) {
  return CJK_LOCALES.has(locale) ? Math.ceil(base * 0.45) : base;
}
function isGarbage(text, minLen = 15) {
  if (!text || text.trim().length === 0) return false;
  const t = text.trim();
  if (t.length < minLen) return true;
  if (/^[^\n+]+(\+[^\n+]+){2,}$/.test(t)) return true;
  if (t.length < 80 && /^[^\n+]{3,}\+[^\n+]{3,}$/.test(t) && !/\d+%|\d+\.\d+|\$\d/.test(t)) return true;
  if (/^[^\n/|→]+([/|→][^\n/|→]+){2,}$/.test(t) && t.length < 80) return true;
  const tokens = t.split(/[\s,+|/·→]+/).filter(w => w.length > 1);
  if (tokens.length >= 4) {
    const freq = new Map();
    for (const tok of tokens) freq.set(tok.toLowerCase(), (freq.get(tok.toLowerCase()) ?? 0) + 1);
    const maxFreq = Math.max(...Array.from(freq.values()));
    if (maxFreq / tokens.length > 0.55) return true;
  }
  return false;
}

// ── qualityCheck ─────────────────────────────────────────────────────────────────
function qualityCheck(report) {
  const locale = report.locale ?? 'ko';
  const issues   = [];
  const warnings = [];

  if (isGarbage(report.thesis, garbageMinLen(GARBAGE_MIN_LEN.thesis, locale)))
    issues.push(`thesis GARBAGE: "${(report.thesis ?? '').slice(0, 60)}"`);
  if (isGarbage(report.macroAnalysis, garbageMinLen(GARBAGE_MIN_LEN.macroAnalysis, locale)))
    issues.push(`macroAnalysis GARBAGE: "${(report.macroAnalysis ?? '').slice(0, 60)}"`);
  if (isGarbage(report.technicalAnalysis, garbageMinLen(GARBAGE_MIN_LEN.technicalAnalysis, locale)))
    issues.push(`technicalAnalysis GARBAGE`);
  if (!report.portfolio?.length) issues.push('portfolio EMPTY');
  if (!report.marketNarrative)   issues.push('marketNarrative MISSING');
  if (!report.regionStances || Object.keys(report.regionStances).length === 0) issues.push('regionStances MISSING');
  if (!report.shortSqueeze?.length) issues.push('shortSqueeze MISSING');

  // Ticker duplicate check
  if (Array.isArray(report.portfolio)) {
    const seen = new Map();
    for (const p of report.portfolio) {
      const norm = (p.ticker ?? '').toUpperCase().replace(/[\s.]/g, '');
      if (seen.has(norm)) issues.push(`ticker DUPLICATE: "${p.ticker}" ≡ "${seen.get(norm)}"`);
      else seen.set(norm, p.ticker);
    }
  }

  const portLen = report.portfolio?.length ?? 0;
  if (portLen > 0 && portLen < 5) warnings.push(`portfolio COUNT LOW: ${portLen}/5`);

  // Cross-ticker catalyst duplication
  if (Array.isArray(report.portfolio)) {
    const catalystKeys = new Map();
    for (const p of report.portfolio) {
      for (const c of (p.catalysts ?? [])) {
        if (!c || typeof c !== 'string') continue;
        const key = c.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60);
        if (catalystKeys.has(key)) warnings.push(`catalyst DUPLICATE: "${c.slice(0, 50)}" (${p.ticker}≡${catalystKeys.get(key)})`);
        else catalystKeys.set(key, p.ticker);
      }
    }
  }

  let score = 0;
  if ((report.thesis?.length ?? 0) >= garbageMinLen(GARBAGE_MIN_LEN.thesis, locale))               score += 15;
  if ((report.macroAnalysis?.length ?? 0) >= garbageMinLen(GARBAGE_MIN_LEN.macroAnalysis, locale))  score += 15;
  if ((report.technicalAnalysis?.length ?? 0) >= garbageMinLen(GARBAGE_MIN_LEN.technicalAnalysis, locale)) score += 10;
  if ((report.fundamentalAnalysis?.length ?? 0) >= 15)  score += 10;
  if (portLen >= 5)       score += 15;
  else if (portLen >= 2)  score += 8;
  if ((report.riskEvents?.length ?? 0) >= 1)            score += 5;
  if (Object.keys(report.regionStances ?? {}).length >= 2) score += 5;
  if ((report.shortSqueeze?.length ?? 0) >= 1)          score += 5;
  if ((report.insiderSignals?.length ?? 0) >= 1)        score += 3;
  if ((report.stopLossRationale?.length ?? 0) >= 1)     score += 5;
  if (report.marketNarrative?.why || report.marketNarrative?.story) score += 5;
  if ((report.companyChanges?.length ?? 0) >= 1)        score += 7;
  return { ok: issues.length === 0, issues, warnings, score };
}

// ── 보고서 출력 ────────────────────────────────────────────────────────────────────
function printReport(report, label) {
  const { ok, issues, warnings, score } = qualityCheck(report);
  const grade = score >= 80 ? '🟢' : score >= 55 ? '🟡' : '🔴';
  const ts = report.generatedAt ? new Date(report.generatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : 'N/A';
  const tickers = (report.portfolio ?? []).map(p => `${p.ticker}(${p.action?.[0]??'?'})`).join(' ');
  const hotThemes = Array.isArray(report.marketNarrative?.hotThemes)
    ? report.marketNarrative.hotThemes.join(', ') : report.marketNarrative?.hotThemes ?? '-';

  console.log(`\n${'─'.repeat(72)}`);
  console.log(`${grade} [${label}]  score=${score}/100  ${ok ? '✅ PASS' : '❌ FAIL'}  locale=${report.locale ?? '?'}  session=${report.session ?? '?'}`);
  console.log(`   생성: ${ts}  source: ${report.source ?? '?'}`);
  console.log(`   thesis(${(report.thesis ?? '').length}c): "${(report.thesis ?? '').slice(0, 80)}"`);
  console.log(`   macro(${(report.macroAnalysis ?? '').length}c) tech(${(report.technicalAnalysis ?? '').length}c) fundamental(${(report.fundamentalAnalysis ?? '').length}c)`);
  console.log(`   portfolio(${report.portfolio?.length ?? 0}): ${tickers}`);
  console.log(`   hotThemes: ${hotThemes}`);
  console.log(`   narrative.why: "${(report.marketNarrative?.why ?? '').slice(0, 80)}"`);
  console.log(`   regionStances: ${Object.keys(report.regionStances ?? {}).join(', ')}`);
  console.log(`   shortSqueeze: ${report.shortSqueeze?.length ?? 0}건  insiderSignals: ${report.insiderSignals?.length ?? 0}건`);
  console.log(`   companyChanges: ${report.companyChanges?.length ?? 0}건  riskEvents: ${report.riskEvents?.length ?? 0}건`);
  if (warnings.length) {
    console.log('   ⚠️  경고:');
    for (const w of warnings) console.log(`      ${w}`);
  }
  if (issues.length) {
    console.log('   ❌ 오류:');
    for (const i of issues) console.log(`      ${i}`);
  }
}

// ── Redis에서 보고서 가져오기 ─────────────────────────────────────────────────────
async function fetchFromRedis(locale) {
  const url   = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) { console.error('Upstash env not set'); return null; }
  try {
    const kstDate = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    for (const session of ['evening', 'afternoon', 'morning']) {
      const key = `flowvium:investment-strategy:v8:${kstDate}:${session}:${locale}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(['GET', key]),
      });
      const d = await res.json();
      if (d.result) {
        try {
          const report = typeof d.result === 'string' ? JSON.parse(d.result) : d.result;
          return { report, key };
        } catch { /* skip */ }
      }
    }
    return null;
  } catch (e) { console.error('Redis fetch failed:', e.message); return null; }
}

// ── メイン ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== FlowVium 보고서 품질 검토 ===');

  if (useRedis) {
    const locales = localeArg ? [localeArg] : ['ko', 'en', 'ja', 'zh-CN', 'zh-TW'];
    console.log(`\nRedis 최신 보고서 검토 (${locales.join(', ')})...`);
    let found = 0;
    for (const loc of locales) {
      const result = await fetchFromRedis(loc);
      if (result) {
        printReport(result.report, `Redis:${result.key}`);
        found++;
      } else {
        console.log(`  [${loc}] Redis 키 없음`);
      }
    }
    console.log(`\n검토 완료: ${found}/${locales.length} 보고서`);
    return;
  }

  if (fileArg) {
    const path = resolve(process.cwd(), fileArg);
    if (!existsSync(path)) { console.error('파일 없음:', path); process.exit(1); }
    const report = JSON.parse(readFileSync(path, 'utf8'));
    printReport(report, basename(path));
    return;
  }

  if (!existsSync(REPORTS_DIR)) {
    console.error('reports/ 디렉토리 없음. 먼저 보고서를 생성하세요.');
    process.exit(1);
  }

  let files = readdirSync(REPORTS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => ({ f, mtime: statSync(resolve(REPORTS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  if (localeArg) files = files.filter(({ f }) => f.includes(`-${localeArg}.json`) || f.includes(`-${localeArg}-`));
  if (!showAll) files = files.slice(0, nArg);

  if (!files.length) { console.log('검토할 보고서 파일 없음'); return; }

  console.log(`\n${files.length}개 파일 검토 (최신순):`);
  let pass = 0, fail = 0;
  for (const { f } of files) {
    try {
      const report = JSON.parse(readFileSync(resolve(REPORTS_DIR, f), 'utf8'));
      const { ok } = qualityCheck(report);
      printReport(report, f);
      ok ? pass++ : fail++;
    } catch (e) {
      console.log(`\n[${f}] 파싱 실패: ${e.message}`);
      fail++;
    }
  }

  console.log(`\n${'═'.repeat(72)}`);
  console.log(`총 ${files.length}개: ✅ ${pass}개 통과, ❌ ${fail}개 실패`);
}

main().catch(e => { console.error(e); process.exit(1); });
