#!/usr/bin/env node
// Quick verification of a report JSON. Usage: node scripts/verify-report.mjs <path>
import fs from 'node:fs';
const file = process.argv[2] || 'reports/report-2026-05-29-afternoon-ko.json';
const r = JSON.parse(fs.readFileSync(file, 'utf8'));

console.log(`\n═══ ${file} ═══`);
console.log('## meta');
console.log(' stance:', r.stance, '| thesis:', (r.thesis||'').slice(0,80));
console.log(' source:', r.source, '| session:', r.session, '| locale:', r.locale);
console.log(' schemaVersion:', r.schemaVersion, '| sessionFocus:', r.sessionFocus);
console.log(' trackRecord:', r.trackRecord ? 'YES' : 'MISSING');
if (r.trackRecord) {
  const tr = r.trackRecord;
  console.log('   avgPnl:', tr.avgPnlPct, '| hit:', tr.hitRate, '| spyAlpha:', tr.spyAlphaPct);
  console.log('   top3:', tr.top3?.map(t=>t.ticker).join(','), '| bottom3:', tr.bottom3?.map(t=>t.ticker).join(','));
}

console.log('\n## portfolio[0] 필드 검사');
// 2026-05-30: UI 는 `allocation` 만 참조. `weight` 는 schema 에 없는 필드라 검사 제외.
const required = ['ticker','name','sector','allocation','rationale','entryZone','target','stopLoss','action','confidence'];
const p0 = r.portfolio?.[0] || {};
console.log(' fields:', Object.keys(p0).join(', '));
for (const f of required) {
  const v = p0[f];
  const status = v === undefined ? '❌ undefined' : v === null ? '⚠️ null' : v === '' ? '⚠️ empty' : '✅ ' + String(v).slice(0,50);
  console.log('  ', f.padEnd(12), status);
}

console.log('\n## portfolio 17건 필드 누락 통계');
const missing = { rationale:0, entryZone:0, target:0, stopLoss:0, allocation:0, action:0, confidence:0 };
const total = (r.portfolio||[]).length;
for (const p of (r.portfolio||[])) {
  for (const k of Object.keys(missing)) {
    if (p[k] == null || p[k] === '' || p[k] === undefined) missing[k]++;
  }
}
for (const [k,v] of Object.entries(missing)) {
  const status = v === 0 ? '✅' : v < total/2 ? '⚠️ ' : '❌';
  console.log('  ', status, k.padEnd(12), v+'/'+total);
}

console.log('\n## sellRecommendations');
const allSells = [...(r.sellRecommendations?.us||[]), ...(r.sellRecommendations?.kr||[])];
const s0 = allSells[0] || {};
console.log(' fields:', Object.keys(s0).join(', '));
const ruleDist = new Map();
for (const s of allSells) ruleDist.set(s.ruleId, (ruleDist.get(s.ruleId)||0)+1);
console.log(' rule 분포:', [...ruleDist.entries()].sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+'='+v).join(', '));
for (const s of allSells.slice(0,3)) {
  console.log('  ', s.ticker, '|', (s.reason||'').slice(0,60));
  console.log('     sellLadder[0]:', JSON.stringify(s.sellLadder?.[0])?.slice(0,80));
}

console.log('\n## buyCandidateScoring');
const bc = r.buyCandidateScoring;
console.log(' method:', bc?.method, '| ruleCount:', bc?.ruleCount, '| top:', bc?.top30?.length);
const catCount = new Map();
for (const c of (bc?.top30||[])) {
  for (const rid of (c.reasons||[])) {
    const cat = rid.split('_')[0];
    catCount.set(cat, (catCount.get(cat)||0)+1);
  }
}
console.log(' 매칭 카테고리:', [...catCount.entries()].sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+'='+v).join(' '));

console.log('\n## sections');
console.log(' macroAnalysis:', (r.macroAnalysis||'').length, 'c');
console.log(' technicalAnalysis:', (r.technicalAnalysis||'').length, 'c');
console.log(' fundamentalAnalysis:', (r.fundamentalAnalysis||'').length, 'c');
console.log(' regionStances:', (r.regionStances||[]).length);
console.log(' sectorAllocation:', (r.sectorAllocation||[]).length);
console.log(' supplyChainChanges:', (r.supplyChainChanges||[]).length);
console.log(' companyChanges:', (r.companyChanges||[]).length);
console.log(' shortSqueeze:', (r.shortSqueeze||[]).length);
console.log(' insiderSignals:', (r.insiderSignals||[]).length);
// kpis 필드는 schema 에 없음 (UI 는 다른 source 참조) — 검사 제외

// 2026-05-30: sector-keyword mismatch + 52주 환각 detect (사용자 "하이닉스 건설 수요" 사건 이후 신설)
console.log('\n## 컨텐츠 fact-check (sector mismatch + 52주 환각)');
// sector → 금지 키워드 (한글) 매핑. 예: 반도체/IT 회사에 "건설/유틸리티" 등 다른 sector 키워드 등장 시 mismatch.
const SECTOR_FORBID = {
  technology:        ['건설', '석유', '광물', '유틸리티', '소비재', '제약', '의류', '식품'],
  semiconductor:     ['건설', '석유', '광물', '유틸리티', '소비재', '제약', '의류', '식품'],
  'it services':     ['건설', '석유', '광물', '유틸리티', '제약', '의류', '식품'],
  'metals & mining': ['반도체', 'AI', '클라우드', '소프트웨어', '제약', '의류'],
  'metals/mining':   ['반도체', 'AI', '클라우드', '소프트웨어', '제약'],
  industrials:       ['반도체', 'AI', '클라우드', '제약'],
  energy:            ['반도체', 'AI', '소프트웨어', '제약', '의류'],
  financials:        ['반도체', 'AI', '제약', '의류'],
  'consumer discretionary': ['반도체', '석유'],
  'communication':   ['건설', '석유', '광물'],
  utilities:         ['반도체', 'AI', '소프트웨어'],
};
let mmCount = 0;
for (const p of (r.portfolio||[])) {
  const sec = (p.sector||'').toLowerCase();
  const forbid = SECTOR_FORBID[sec];
  if (!forbid) continue;
  const text = [p.rationale, p.entryRationale, p.targetRationale, p.fundamentalBasis, p.riskNote, ...(p.catalysts||[])].filter(Boolean).join(' | ');
  for (const kw of forbid) {
    if (text.includes(kw)) {
      console.log(`  ❌ ${p.ticker} (${p.sector}) — 금지 키워드 "${kw}" 등장: "${text.slice(0, 100)}..."`);
      mmCount++; break;
    }
  }
}
if (mmCount === 0) console.log('  ✅ sector-keyword mismatch 0');

// 52주 범위 환각 detect — rationale 안의 '52주:$X-$Y' 또는 '52주:₩X-₩Y' 패턴
console.log('\n## 52주 범위 환각 (high/low ratio > 3x = 액면분할/단위 mismatch 의심)');
let weekBad = 0;
for (const p of (r.portfolio||[])) {
  const m = (p.rationale||'').match(/52주\s*:\s*[₩$]?([\d,.]+)\s*-\s*[₩$]?([\d,.]+)/);
  if (!m) continue;
  const lo = parseFloat(m[1].replace(/,/g, ''));
  const hi = parseFloat(m[2].replace(/,/g, ''));
  if (!isFinite(lo) || !isFinite(hi) || lo <= 0) continue;
  const ratio = hi / lo;
  if (ratio > 3) {
    console.log(`  ❌ ${p.ticker} 52주 ${lo}-${hi} (${ratio.toFixed(1)}x) — Yahoo OHLCV 환각 의심`);
    weekBad++;
  }
}
if (weekBad === 0) console.log('  ✅ 52주 범위 3x 초과 0');

// 50MA vs 200MA gap — 보통 ±30% 안. 그 이상이면 데이터 환각.
console.log('\n## 50MA vs 200MA gap (>50% = 데이터 환각 의심)');
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
    console.log(`  ❌ ${p.ticker} 50MA=${v50} vs 200MA=${v200} (gap ${gap.toFixed(0)}%)`);
    maBad++;
  }
}
if (maBad === 0) console.log('  ✅ 50MA-200MA gap 50% 초과 0');
