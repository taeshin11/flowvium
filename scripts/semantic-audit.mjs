#!/usr/bin/env node
/**
 * 의미적 결함 검사 (자동 검출 어려운 LLM hallucination 패턴)
 */
import { readFileSync, readdirSync } from 'fs';

const fp = s => {
  if (!s) return null;
  const m = String(s).replace(/[$₩,\s]/g, '').match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
};

const TICKER_SELF = {
  '000660.KS': ['SK Hynix', 'SK하이닉스'],
  '005930.KS': ['Samsung Electronics', '삼성전자'],
};

const since = process.argv[2] || '2026-05-09';
const files = readdirSync('reports')
  .filter(f => f.match(/^report-\d{4}-\d{2}-\d{2}-(morning|afternoon|evening)-ko\.json$/))
  .filter(f => f.includes(since) || f > `report-${since}`)
  .sort()
  .reverse();

for (const file of files) {
  const r = JSON.parse(readFileSync(`reports/${file}`, 'utf8'));
  console.log(`\n=== ${file} ===`);
  console.log(`source=${r.source} stance=${r.stance} qualityScore=${r.qualityScore ?? 'n/a'}`);
  console.log(`thesis: ${r.thesis?.slice(0, 90)}`);
  console.log(`macroAnalysis: ${r.macroAnalysis?.slice(0, 90)}`);
  console.log(`fundamentalAnalysis: ${r.fundamentalAnalysis?.slice(0, 90)}`);
  const allocSum = r.portfolio.reduce((a, p) => a + p.allocation, 0);
  const sectorSum = r.sectorAllocation.reduce((a, x) => a + x.pct, 0);
  console.log(`portfolio: ${r.portfolio.length} items, allocSum=${allocSum}, sectorSum=${sectorSum}`);

  const issues = [];

  // 1. 52주 ratio 비현실
  for (const p of r.portfolio) {
    const m52 = p.rationale?.match(/52주[^$₩\d]*[$₩]?([\d,.]+)\s*-\s*[$₩]?([\d,.]+)/);
    if (m52) {
      const lo = parseFloat(m52[1].replace(/,/g, ''));
      const hi = parseFloat(m52[2].replace(/,/g, ''));
      if (lo > 0 && hi / lo > 5) {
        issues.push(`${p.ticker} 52주 범위 비현실: ${m52[1]}-${m52[2]} (${(hi/lo).toFixed(1)}x)`);
      }
    }
  }

  // 2. stopLossRationale vs portfolio.stopLoss 일관성
  for (const sr of r.stopLossRationale || []) {
    const p = r.portfolio.find(x => x.ticker === sr.ticker);
    if (!p) continue;
    const stopP = fp(p.stopLoss);
    if (!stopP) continue;
    const matches = sr.rationale?.match(/[$₩][\d,.]+/g) || [];
    for (const m of matches) {
      const v = parseFloat(m.replace(/[$₩,]/g, ''));
      if (v > 0 && Math.abs(v - stopP) / stopP > 0.5 && v < stopP * 0.5) {
        issues.push(`${sr.ticker} stopLoss 불일치: portfolio=${stopP} vs rationale=${v}`);
        break;
      }
    }
  }

  // 3. catalysts 자기 자신 회사 언급
  for (const p of r.portfolio) {
    const refs = TICKER_SELF[p.ticker] || [];
    for (const cat of p.catalysts || []) {
      for (const ref of refs) {
        if (cat.includes(ref) && /contract|deal|M&A|partnership|계약/i.test(cat)) {
          issues.push(`${p.ticker} 자기-계약 hallucination: "${cat.slice(0, 60)}"`);
        }
      }
    }
  }

  // 4. fundamentalAnalysis 무관 언급
  const fa = r.fundamentalAnalysis || '';
  if (fa.includes('배터리') && !r.portfolio.some(p => /배터리|LG에너지|Tesla|TSLA|RIVN/.test(p.rationale || ''))) {
    issues.push('fundamentalAnalysis 배터리 언급 — portfolio 와 무관');
  }

  // 5. portfolio.stopLoss 가 entry 보다 비싸면 검출 (이미 harness 에 있지만 retro 검증)
  for (const p of r.portfolio) {
    const e = fp(p.entryZone);
    const s = fp(p.stopLoss);
    if (e && s && s >= e * 1.05) issues.push(`${p.ticker} stop≥entry: stop=${s} entry=${e}`);
  }

  // 6. targetBull < target
  for (const p of r.portfolio) {
    const t = fp(p.target);
    const tb = fp(p.targetBull);
    if (t && tb && tb < t) issues.push(`${p.ticker} bull<base: bull=${tb} base=${t}`);
  }

  // 7. companyChanges 빈 또는 네거티브 sentiment 비율 너무 높음
  if (r.companyChanges) {
    const neg = r.companyChanges.filter(c => c.sentiment === 'negative').length;
    const total = r.companyChanges.length;
    if (total > 0 && neg / total > 0.5) {
      issues.push(`companyChanges 부정 비율 높음: ${neg}/${total}`);
    }
  }

  if (issues.length) {
    console.log(`🔴 의미적 결함 ${issues.length}건:`);
    for (const i of issues) console.log(`  - ${i}`);
  } else {
    console.log('✅ 의미적 결함 없음');
  }
}
