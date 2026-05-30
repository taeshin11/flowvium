#!/usr/bin/env node
// Quick verification of a report JSON. Usage: node scripts/verify-report.mjs <path>
//
// 2026-05-30 Karpathy closed loop: 결함을 defects 배열로 모아 caller 가 DB 적재 가능.
// CLI 호환 유지 (console.log) + verifyReport(file, opts) 함수 export.
import fs from 'node:fs';

// CANDIDATE_TICKERS meta lookup (LLM sector 환각 cross-reference 용)
let CANDIDATE_META = {};
try {
  const data = JSON.parse(fs.readFileSync('data/candidate-tickers.json', 'utf8'));
  CANDIDATE_META = data.meta ?? {};
} catch { /* skip */ }

// sector → 금지 키워드 (한글). semiconductors/it 회사에 "건설", financials 에 "반도체" 등.
const SECTOR_FORBID = {
  technology:               ['건설', '석유', '광물', '유틸리티', '소비재', '제약', '의류', '식품'],
  semiconductor:            ['건설', '석유', '광물', '유틸리티', '소비재', '제약', '의류', '식품'],
  semiconductors:           ['건설', '석유', '광물', '유틸리티', '소비재', '제약', '의류', '식품'],
  'it services':            ['건설', '석유', '광물', '유틸리티', '제약', '의류', '식품'],
  'metals & mining':        ['반도체', 'AI', '클라우드', '소프트웨어', '제약', '의류'],
  'metals/mining':          ['반도체', 'AI', '클라우드', '소프트웨어', '제약'],
  industrials:              ['반도체', 'AI', '클라우드', '제약'],
  energy:                   ['반도체', 'AI', '소프트웨어', '제약', '의류'],
  financials:               ['반도체', 'AI', '제약', '의류'],
  'consumer discretionary': ['반도체', '석유'],
  'consumer-discretionary': ['반도체', '석유'],
  automotive:               ['반도체', 'AI', '클라우드', '제약'],
  communication:            ['건설', '석유', '광물'],
  utilities:                ['반도체', 'AI', '소프트웨어'],
};

export function verifyReport(file, { silent = false } = {}) {
  const log = silent ? () => {} : console.log;
  const r = JSON.parse(fs.readFileSync(file, 'utf8'));
  const defects = [];

  log(`\n═══ ${file} ═══`);
  log('## meta');
  log(' source:', r.source, '| session:', r.session, '| locale:', r.locale);
  log(' schemaVersion:', r.schemaVersion);

  log('\n## portfolio[0] 필드 검사');
  const required = ['ticker','name','sector','allocation','rationale','entryZone','target','stopLoss','action','confidence'];
  const p0 = r.portfolio?.[0] || {};
  log(' fields:', Object.keys(p0).join(', '));
  for (const f of required) {
    const v = p0[f];
    const status = v === undefined ? '❌ undefined' : v === null ? '⚠️ null' : v === '' ? '⚠️ empty' : '✅ ' + String(v).slice(0,50);
    log('  ', f.padEnd(12), status);
  }

  log('\n## portfolio 필드 누락 통계');
  const missing = { rationale:0, entryZone:0, target:0, stopLoss:0, allocation:0, action:0, confidence:0 };
  const total = (r.portfolio||[]).length;
  for (const p of (r.portfolio||[])) {
    for (const k of Object.keys(missing)) {
      if (p[k] == null || p[k] === '' || p[k] === undefined) missing[k]++;
    }
  }
  for (const [k,v] of Object.entries(missing)) {
    const status = v === 0 ? '✅' : v < total/2 ? '⚠️ ' : '❌';
    log('  ', status, k.padEnd(12), v+'/'+total);
  }

  log('\n## sellRecommendations');
  const allSells = [...(r.sellRecommendations?.us||[]), ...(r.sellRecommendations?.kr||[])];
  const s0 = allSells[0] || {};
  log(' fields:', Object.keys(s0).join(', '));
  const ruleDist = new Map();
  for (const s of allSells) ruleDist.set(s.ruleId, (ruleDist.get(s.ruleId)||0)+1);
  log(' rule 분포:', [...ruleDist.entries()].sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+'='+v).join(', '));

  log('\n## buyCandidateScoring');
  const bc = r.buyCandidateScoring;
  log(' method:', bc?.method, '| top:', bc?.top30?.length);

  log('\n## sections');
  log(' macroAnalysis:', (r.macroAnalysis||'').length, 'c');
  log(' sectorAllocation:', (r.sectorAllocation||[]).length);

  // 1. sector ↔ meta consistency (LLM 환각 vs candidate-tickers meta)
  log('\n## sector ↔ meta 일치 (LLM 환각 detect)');
  let secFix = 0;
  for (const p of (r.portfolio||[])) {
    const meta = CANDIDATE_META[p.ticker];
    if (!meta?.sector || meta.sector === 'Unknown') continue;
    if (p.sector && p.sector !== meta.sector) {
      log(`  ❌ ${p.ticker} sector="${p.sector}" → 정답 "${meta.sector}"`);
      defects.push({
        ticker: p.ticker, defect_type: 'sector_mismatch',
        llm_value: p.sector, correct_value: meta.sector, severity: 'high',
      });
      secFix++;
    }
  }
  if (secFix === 0) log('  ✅ sector meta consistent');

  // 2. sector-keyword mismatch (rationale 안 forbidden 키워드)
  log('\n## sector-keyword mismatch (rationale 안 forbidden)');
  let mmCount = 0;
  for (const p of (r.portfolio||[])) {
    const sec = (p.sector||'').toLowerCase();
    const forbid = SECTOR_FORBID[sec];
    if (!forbid) continue;
    const text = [p.rationale, p.entryRationale, p.targetRationale, p.fundamentalBasis, p.riskNote, ...(p.catalysts||[])].filter(Boolean).join(' | ');
    for (const kw of forbid) {
      if (text.includes(kw)) {
        log(`  ❌ ${p.ticker} (${p.sector}) — 금지 키워드 "${kw}": "${text.slice(0, 80)}..."`);
        defects.push({
          ticker: p.ticker, defect_type: 'sector_keyword_mismatch',
          llm_value: `"${kw}" in rationale`, correct_value: p.sector, severity: 'high',
          details: { sample: text.slice(0, 200) },
        });
        mmCount++; break;
      }
    }
  }
  if (mmCount === 0) log('  ✅ sector-keyword mismatch 0');

  // 3. 52주 범위 환각 (high/low > 3x)
  log('\n## 52주 범위 환각 (>3x)');
  let weekBad = 0;
  for (const p of (r.portfolio||[])) {
    const m = (p.rationale||'').match(/52주\s*:\s*[₩$]?([\d,.]+)\s*-\s*[₩$]?([\d,.]+)/);
    if (!m) continue;
    const lo = parseFloat(m[1].replace(/,/g, ''));
    const hi = parseFloat(m[2].replace(/,/g, ''));
    if (!isFinite(lo) || !isFinite(hi) || lo <= 0) continue;
    const ratio = hi / lo;
    if (ratio > 3) {
      log(`  ❌ ${p.ticker} 52주 ${lo}-${hi} (${ratio.toFixed(1)}x)`);
      defects.push({
        ticker: p.ticker, defect_type: '52w_halluc',
        llm_value: `52주 ${lo}-${hi} (${ratio.toFixed(1)}x)`,
        correct_value: '1년 ratio < 3x', severity: 'medium',
      });
      weekBad++;
    }
  }
  if (weekBad === 0) log('  ✅ 52주 3x 초과 0');

  // 4. 50MA-200MA gap (>50%)
  log('\n## 50MA-200MA gap (>50%)');
  let maBad = 0;
  for (const p of (r.portfolio||[])) {
    const m50 = (p.rationale||'').match(/50MA[^₩$\d]*[₩$]?([\d,.]+)/);
    const m200 = (p.rationale||'').match(/200MA[^₩$\d]*[₩$]?([\d,.]+)/);
    if (!m50 || !m200) continue;
    const v50 = parseFloat(m50[1].replace(/,/g, ''));
    const v200 = parseFloat(m200[1].replace(/,/g, ''));
    if (!isFinite(v50) || !isFinite(v200) || v200 <= 0) continue;
    const gap = Math.abs(v50 / v200 - 1) * 100;
    if (gap > 50) {
      log(`  ❌ ${p.ticker} 50MA=${v50} vs 200MA=${v200} (gap ${gap.toFixed(0)}%)`);
      defects.push({
        ticker: p.ticker, defect_type: 'ma_halluc',
        llm_value: `50MA=${v50} 200MA=${v200} gap=${gap.toFixed(0)}%`,
        correct_value: '50MA/200MA gap < 50%', severity: 'medium',
      });
      maBad++;
    }
  }
  if (maBad === 0) log('  ✅ MA gap 50% 초과 0');

  log(`\n## 종합 — 결함 ${defects.length}건`);
  return { defects, total: (r.portfolio||[]).length };
}

// CLI usage
const isCLI = import.meta.url === `file://${process.argv[1]?.replaceAll('\\','/')}`;
if (isCLI) {
  const file = process.argv[2] || 'reports/report-2026-05-30-morning-ko.json';
  verifyReport(file);
}
