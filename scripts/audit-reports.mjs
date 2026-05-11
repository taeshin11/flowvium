#!/usr/bin/env node
/**
 * audit-reports.mjs — 기존 보고서에 harness 일괄 적용 + 결함 리포트
 *
 * 사용:
 *   node scripts/audit-reports.mjs                    # reports/ 모든 파일 평가 (read-only)
 *   node scripts/audit-reports.mjs --fix              # 결함 발견 시 파일 자동 교정
 *   node scripts/audit-reports.mjs --fix --upload     # 교정 + Vercel 재업로드
 *   node scripts/audit-reports.mjs --since=2026-05-09 # 날짜 필터
 */
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const REPORTS_DIR = resolve(ROOT, 'reports');
const args = process.argv.slice(2);
const FIX = args.includes('--fix');
const UPLOAD = args.includes('--upload');
const since = args.find(a => a.startsWith('--since='))?.split('=')[1];

// .env.local 파싱 (업로드용 SITE/CRON_SECRET)
function loadEnv() {
  const env = {};
  try {
    const raw = readFileSync(resolve(ROOT, '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch {}
  return env;
}
const env = loadEnv();

const KR_NAMES = {
  '005930.KS': '삼성전자', '000660.KS': 'SK하이닉스', '373220.KS': 'LG에너지솔루션',
  '005380.KS': '현대차', '035420.KS': 'NAVER', '035720.KS': '카카오',
  '207940.KS': '삼성바이오로직스', '051910.KS': 'LG화학',
  '005490.KS': 'POSCO홀딩스', '000270.KS': '기아',
};

// US/global 주요 ticker→name 화이트리스트 (strategy-schema.ts US_NAMES 와 동기)
const US_NAMES = {
  NVDA: 'NVIDIA', AMD: 'AMD', INTC: 'Intel',
  MU: 'Micron Technology', MCHP: 'Microchip Technology',
  TSM: 'TSMC', ASML: 'ASML Holding', AMAT: 'Applied Materials',
  LRCX: 'Lam Research', KLAC: 'KLA Corporation', AVGO: 'Broadcom',
  QCOM: 'Qualcomm', ARM: 'ARM Holdings',
  SMCI: 'Super Micro Computer', SMTC: 'Semtech Corporation', SNPS: 'Synopsys',
  ON: 'onsemi', MRVL: 'Marvell Technology',
  AAPL: 'Apple', MSFT: 'Microsoft', GOOGL: 'Alphabet', GOOG: 'Alphabet',
  AMZN: 'Amazon', META: 'Meta Platforms', TSLA: 'Tesla', NFLX: 'Netflix',
  ORCL: 'Oracle', CRM: 'Salesforce', ADBE: 'Adobe', NOW: 'ServiceNow',
  PLTR: 'Palantir', JPM: 'JPMorgan Chase', GS: 'Goldman Sachs', BLK: 'BlackRock',
  V: 'Visa', MA: 'Mastercard', LMT: 'Lockheed Martin', RTX: 'RTX',
  NOC: 'Northrop Grumman', KTOS: 'Kratos Defense',
  XOM: 'Exxon Mobil', CVX: 'Chevron',
  TDS: 'Telephone and Data Systems', IONQ: 'IonQ',
  SPY: 'SPDR S&P 500 ETF', QQQ: 'Invesco QQQ', DELL: 'Dell Technologies',
};

const ACTION_DOWNGRADE_PATTERNS = [
  /매수\s*자제/, /보유\s*권장/, /신규\s*매수\s*자제/, /고점\s*주의/,
  /과매수/, /기초\s*약화/, /조정\s*가능/, /매수\s*대신\s*보유/,
  /watch\b/i, /avoid\s+new\s+buy/i, /trim\b/i, /reduce\s+position/i,
];

function nativeCurrency(ticker) {
  const t = (ticker ?? '').toUpperCase();
  if (t.endsWith('.KS') || t.endsWith('.KQ')) return '₩';
  if (t.endsWith('.AS') || t.endsWith('.PA') || t.endsWith('.DE')) return '€';
  return '$';
}

function parseFirstPrice(s) {
  if (!s) return null;
  const m = String(s).replace(/[$₩,\s]/g, '').match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

function dedupRationale(s) {
  if (!s || !s.includes(' | ')) return s;
  const parts = s.split(' | ').map(x => x.trim());
  const seen = new Set(); const u = [];
  for (const p of parts) {
    const k = p.toLowerCase().replace(/[^\w가-힣]+/g, '').slice(0, 60);
    if (k && !seen.has(k)) { seen.add(k); u.push(p); }
  }
  return u.join(' | ');
}

function applyHarness(r) {
  const audit = {
    fixes: {
      krNameMismatch: [], rationaleDedup: [], insiderFilingsType: [],
      sectorAllocSum: null, portfolioAllocSum: null,
      buyLowConfidence: [], stopLossDeep: [], targetBullInverted: [],
      stopLossAboveEntry: [], entryFar50MA: [], companyChangeName: [],
      unrealistic52WRange: [], stopRationaleMismatch: [],
      usNameMismatch: [], targetBullUnrealistic: [],
      actionCritiqueMismatch: [], stopRationaleAligned: [], currencyMismatch: [],
    },
    appliedAt: new Date().toISOString(), totalFixes: 0,
  };
  if (!r || !Array.isArray(r.portfolio)) return audit;

  for (const p of r.portfolio) {
    const exp = KR_NAMES[p.ticker?.toUpperCase()];
    if (exp && p.name !== exp) {
      audit.fixes.krNameMismatch.push(`${p.ticker}:"${p.name}"→"${exp}"`);
      p.name = exp;
    }
    if (p.action === 'buy' && p.confidence === 'low') {
      audit.fixes.buyLowConfidence.push(`${p.ticker}:buy+low→watch`);
      p.action = 'watch';
    }
    if (p.rationale) {
      const before = p.rationale;
      p.rationale = dedupRationale(p.rationale);
      if (p.rationale !== before) audit.fixes.rationaleDedup.push(p.ticker);
    }
    const e = parseFirstPrice(p.entryZone);
    const s = parseFirstPrice(p.stopLoss);
    if (e && s && e > 0 && (e - s) / e > 0.20) {
      audit.fixes.stopLossDeep.push(`${p.ticker}:${((e-s)/e*100).toFixed(1)}%`);
    }
    if (e && s && e > 0 && s >= e * 1.05) {
      audit.fixes.stopLossAboveEntry.push(`${p.ticker}:stop=${s}>=entry=${e}`);
    }
    const t = parseFirstPrice(p.target);
    const tb = parseFirstPrice(p.targetBull);
    if (t && tb && tb < t) audit.fixes.targetBullInverted.push(`${p.ticker}:bull=${tb}<base=${t}`);

    const ma50Match = p.rationale?.match(/50MA[^$₩\d]*([$₩])?([\d,]+\.?\d*)/);
    if (ma50Match) {
      const sym = ma50Match[1] ?? '$';
      const ma50 = parseFloat(ma50Match[2].replace(/,/g, ''));
      if (ma50 && e && ma50 > 0) {
        const ratio = e / ma50;
        if (ratio <= 0.5 || ratio >= 2.0) {
          const fmt = sym === '₩'
            ? (n) => `₩${Math.round(n / 100) * 100}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
            : (n) => `$${n.toFixed(2)}`;
          audit.fixes.entryFar50MA.push(`${p.ticker}:entry=${e}→${fmt(ma50*0.97)}-${fmt(ma50)} (was ${ratio.toFixed(2)}x)`);
          p.entryZone = `${fmt(ma50 * 0.97)}-${fmt(ma50)}`;
          p.stopLoss = fmt(ma50 * 0.92);
          p.target = fmt(ma50 * 1.15);
          p.targetBull = fmt(ma50 * 1.30);
          p.action = 'watch';
          p.critiqueNote = (p.critiqueNote ? p.critiqueNote + ' | ' : '') +
            `가격 hallucination 의심 — 50MA(${fmt(ma50)}) 기반 재계산, 진입 전 재검토 필요`;
        }
      }
    }
  }

  // 52주 ratio > 10x → watch 강등 (5x → 10x 완화)
  for (const p of r.portfolio) {
    const m52 = p.rationale?.match(/52주[^$₩\d]*[$₩]?([\d,.]+)\s*-\s*[$₩]?([\d,.]+)/);
    if (!m52) continue;
    const lo = parseFloat(m52[1].replace(/,/g, ''));
    const hi = parseFloat(m52[2].replace(/,/g, ''));
    if (lo <= 0 || !isFinite(hi)) continue;
    const ratio = hi / lo;
    if (ratio < 10) continue;
    audit.fixes.unrealistic52WRange.push(`${p.ticker}:${m52[1]}-${m52[2]} (${ratio.toFixed(1)}x)`);
    p.action = 'watch';
    p.critiqueNote = (p.critiqueNote ? p.critiqueNote + ' | ' : '') +
      `52주 범위 비현실(${ratio.toFixed(1)}x) — split/통화/데이터 오류 의심, 진입 보류`;
  }

  // stopLossRationale mismatch 검출 (자동 교정 X)
  if (Array.isArray(r.stopLossRationale)) {
    for (const sr of r.stopLossRationale) {
      const p = r.portfolio.find(x => x.ticker === sr.ticker);
      if (!p) continue;
      const stopP = parseFirstPrice(p.stopLoss);
      if (!stopP) continue;
      const matches = sr.rationale?.match(/[$₩][\d,.]+/g) || [];
      const vals = matches.map(m => parseFloat(m.replace(/[$₩,]/g, ''))).filter(v => v > 0);
      const inconsistent = vals.find(v => v < stopP * 0.5 || v > stopP * 2);
      if (!inconsistent) continue;
      audit.fixes.stopRationaleMismatch.push(`${sr.ticker}:portfolio=${stopP} vs rationale=${inconsistent} (참고가격)`);
    }
  }

  if (Array.isArray(r.companyChanges)) {
    for (const c of r.companyChanges) {
      const exp = KR_NAMES[c.ticker?.toUpperCase()];
      if (exp && c.name !== exp) {
        audit.fixes.companyChangeName.push(`${c.ticker}:"${c.name}"→"${exp}"`);
        c.name = exp;
      }
    }
  }

  // US ticker → name 화이트리스트
  for (const p of r.portfolio) {
    const exp = US_NAMES[p.ticker?.toUpperCase()];
    if (exp && p.name !== exp) {
      audit.fixes.usNameMismatch.push(`${p.ticker}:portfolio "${p.name}"→"${exp}"`);
      p.name = exp;
    }
  }
  if (Array.isArray(r.companyChanges)) {
    for (const c of r.companyChanges) {
      const exp = US_NAMES[c.ticker?.toUpperCase()];
      if (exp && c.name !== exp) {
        audit.fixes.usNameMismatch.push(`${c.ticker}:companyChanges "${c.name}"→"${exp}"`);
        c.name = exp;
      }
    }
  }

  // targetBull 합리성 — 2x entry 초과 또는 1.6x target 초과 시 축소
  for (const p of r.portfolio) {
    if (!p.targetBull) continue;
    const tb = parseFirstPrice(p.targetBull);
    const t = parseFirstPrice(p.target);
    const e = parseFirstPrice(p.entryZone);
    if (tb == null || t == null || e == null || e <= 0) continue;
    const bullVsEntry = tb / e;
    const bullVsTarget = tb / t;
    if (bullVsEntry <= 2.0 && bullVsTarget <= 1.6) continue;
    const sym = (p.targetBull.match(/^[₩$€]/)?.[0]) ?? '$';
    const newBull = t * 1.2;
    const fmt = sym === '₩'
      ? (n) => `₩${Math.round(n).toLocaleString('en-US')}`
      : (n) => `${sym}${n.toFixed(2)}`;
    audit.fixes.targetBullUnrealistic.push(
      `${p.ticker}:${p.targetBull}→${fmt(newBull)} (${bullVsEntry.toFixed(1)}x entry)`,
    );
    p.targetBull = fmt(newBull);
    p.critiqueNote = (p.critiqueNote ? p.critiqueNote + ' | ' : '') +
      `targetBull ${bullVsEntry.toFixed(1)}x of entry — 자동 축소`;
  }

  // action↔critique/risk 의미 일관성
  for (const p of r.portfolio) {
    if (p.action !== 'buy') continue;
    const notes = `${p.critiqueNote ?? ''} ${p.riskNote ?? ''}`;
    const matched = ACTION_DOWNGRADE_PATTERNS.find(re => re.test(notes));
    if (!matched) continue;
    audit.fixes.actionCritiqueMismatch.push(`${p.ticker}:buy→watch (note 매칭)`);
    p.action = 'watch';
  }

  // stopLossRationale "손절선 ~X" → portfolio.stopLoss 값으로 통일
  if (Array.isArray(r.stopLossRationale)) {
    for (const sr of r.stopLossRationale) {
      const p = r.portfolio.find(x => x.ticker === sr.ticker);
      if (!p) continue;
      const stopP = parseFirstPrice(p.stopLoss);
      if (!stopP) continue;
      const m = sr.rationale?.match(/손절선\s*~\s*([$₩€])?([\d,.]+)/);
      if (!m) continue;
      const rationaleStop = parseFloat(m[2].replace(/,/g, ''));
      if (!isFinite(rationaleStop) || rationaleStop === stopP) continue;
      if (Math.abs(rationaleStop - stopP) / stopP < 0.05) continue;
      const sym = m[1] ?? (p.stopLoss.match(/^[₩$€]/)?.[0] ?? '$');
      sr.rationale = sr.rationale.replace(
        /손절선\s*~\s*[$₩€]?[\d,.]+/,
        `손절선 ~${sym}${stopP}`,
      );
      audit.fixes.stopRationaleAligned.push(`${sr.ticker}:${rationaleStop}→${stopP}`);
    }
  }

  // 통화 일관성 검증 (자동 교정 없음)
  for (const p of r.portfolio) {
    const native = nativeCurrency(p.ticker);
    const fields = [['entry', p.entryZone], ['stop', p.stopLoss], ['target', p.target]];
    const mismatches = [];
    for (const [field, val] of fields) {
      if (!val) continue;
      const sym = val.match(/[₩$€]/)?.[0];
      if (sym && sym !== native) mismatches.push(`${field}=${sym}`);
    }
    if (mismatches.length > 0) {
      audit.fixes.currencyMismatch.push(`${p.ticker} (native ${native}): ${mismatches.join(', ')}`);
    }
  }

  if (Array.isArray(r.insiderSignals)) {
    for (const sig of r.insiderSignals) {
      if (Array.isArray(sig.filings)) {
        const before = JSON.stringify(sig.filings);
        sig.filings = sig.filings[0] ?? 0;
        audit.fixes.insiderFilingsType.push(`${sig.ticker ?? '?'}:array${before}→${sig.filings}`);
      } else if (typeof sig.filings === 'string') {
        const before = sig.filings;
        sig.filings = parseInt(sig.filings, 10) || 0;
        audit.fixes.insiderFilingsType.push(`${sig.ticker ?? '?'}:string"${before}"→${sig.filings}`);
      }
    }
  }

  if (Array.isArray(r.sectorAllocation) && r.sectorAllocation.length > 0) {
    const sum = r.sectorAllocation.reduce((a, x) => a + (x.pct ?? 0), 0);
    if (sum > 0 && Math.abs(sum - 100) > 2) {
      const scale = 100 / sum;
      r.sectorAllocation.forEach(x => { x.pct = Math.round((x.pct ?? 0) * scale); });
      const drift = 100 - r.sectorAllocation.reduce((a, x) => a + x.pct, 0);
      if (drift !== 0) r.sectorAllocation[0].pct += drift;
      audit.fixes.sectorAllocSum = { from: sum, to: 100 };
    }
  }

  const pSum = r.portfolio.reduce((a, x) => a + (x.allocation ?? 0), 0);
  if (pSum > 0 && Math.abs(pSum - 100) > 2) {
    const scale = 100 / pSum;
    r.portfolio.forEach(x => { x.allocation = Math.round((x.allocation ?? 0) * scale); });
    const drift = 100 - r.portfolio.reduce((a, x) => a + x.allocation, 0);
    if (drift !== 0) r.portfolio[0].allocation += drift;
    audit.fixes.portfolioAllocSum = { from: pSum, to: 100 };
  }

  audit.totalFixes = Object.values(audit.fixes).reduce((a, v) => {
    if (Array.isArray(v)) return a + v.length;
    if (v) return a + 1;
    return a;
  }, 0);
  return audit;
}

import { execSync } from 'child_process';
function uploadToVercel(_report, filename) {
  // generate-report-local.mjs 의 --upload=path 메커니즘 재사용
  try {
    execSync(`node scripts/generate-report-local.mjs --upload=reports/${filename}`, {
      stdio: 'pipe', timeout: 60000,
    });
    return true;
  } catch (e) {
    console.warn(`  ⚠️  upload error: ${e.message?.slice(0, 100)}`);
    return false;
  }
}

const files = readdirSync(REPORTS_DIR)
  .filter(f => f.match(/^report-\d{4}-\d{2}-\d{2}-(morning|afternoon|evening)-[a-z]{2}(-[A-Z]{2})?\.json$/))
  .filter(f => !since || f.includes(since) || f > `report-${since}`)
  .sort()
  .reverse();

console.log(`\n=== 보고서 audit (${files.length}개) ${FIX ? '— FIX 모드' : '— READ-ONLY'} ===\n`);

const results = [];
for (const file of files) {
  const path = resolve(REPORTS_DIR, file);
  const r = JSON.parse(readFileSync(path, 'utf8'));
  const audit = applyHarness(r);
  results.push({ file, audit, report: r });

  console.log(`📄 ${file}  source=${r.source}  totalFixes=${audit.totalFixes}`);
  for (const [k, v] of Object.entries(audit.fixes)) {
    if (Array.isArray(v) && v.length) console.log(`    ${k}: ${v.join(', ')}`);
    else if (v && !Array.isArray(v)) console.log(`    ${k}: ${JSON.stringify(v)}`);
  }
  console.log('');
}

const totalFixesAll = results.reduce((a, r) => a + r.audit.totalFixes, 0);
console.log(`=== 합계: ${totalFixesAll} 결함 across ${files.length} files ===\n`);

if (FIX) {
  console.log('=== FIX 모드: 변경된 파일 저장 ===');
  for (const { file, audit, report } of results) {
    if (audit.totalFixes === 0) continue;
    report.harnessAudit = {
      ...(report.harnessAudit ?? {}),
      retroAudit: audit, retroAppliedAt: new Date().toISOString(),
    };
    writeFileSync(resolve(REPORTS_DIR, file), JSON.stringify(report, null, 2), 'utf8');
    console.log(`  ✅ ${file} 저장 (totalFixes=${audit.totalFixes})`);
    if (UPLOAD) {
      const ok = await uploadToVercel(report, file);
      console.log(`  ${ok ? '✅' : '❌'} Vercel 업로드`);
    }
  }
}
