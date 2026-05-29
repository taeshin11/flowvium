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
const required = ['ticker','name','sector','weight','rationale','entryZone','target','stopLoss','action','confidence'];
const p0 = r.portfolio?.[0] || {};
console.log(' fields:', Object.keys(p0).join(', '));
for (const f of required) {
  const v = p0[f];
  const status = v === undefined ? '❌ undefined' : v === null ? '⚠️ null' : v === '' ? '⚠️ empty' : '✅ ' + String(v).slice(0,50);
  console.log('  ', f.padEnd(12), status);
}

console.log('\n## portfolio 17건 필드 누락 통계');
const missing = { rationale:0, entryZone:0, target:0, stopLoss:0, weight:0, action:0, confidence:0 };
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
console.log(' kpis:', r.kpis ? Object.keys(r.kpis).join(',') : 'MISSING');
