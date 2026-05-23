#!/usr/bin/env node
/**
 * scripts/test-harness-fixes.mjs — 2026-05-24 신규 harness 룰 4가지를 기존
 * 보고서에 적용해 before/after 비교만 출력 (실제 보고서 재생성 X).
 *
 * 검증 항목:
 *   F1: BOOST: BOOST: 중복 prefix 제거
 *   F2: KR stopLossRationale 의 $ → ₩
 *   F3: "현재" 가격 livePrice 기반 교정 (split-adjusted 의심 시)
 *   F4: 손절선 ~X 포맷 통일 (₩1,805,130 vs ₩1805130)
 */
import { readFileSync } from 'fs';

const REPORT = 'C:/NoAddsMakingApps/FlowVium/reports/report-2026-05-24-morning-ko.json';
const r = JSON.parse(readFileSync(REPORT, 'utf8'));

function nativeCurrency(t) {
  t = (t ?? '').toUpperCase();
  if (t.endsWith('.KS') || t.endsWith('.KQ')) return '₩';
  if (t.endsWith('.AS') || t.endsWith('.PA') || t.endsWith('.DE')) return '€';
  return '$';
}
function parseFirstPrice(s) {
  if (!s) return null;
  const m = String(s).replace(/[$₩,\s]/g, '').match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

console.log('=== F1: BOOST 중복 prefix 제거 ===');
for (const p of r.portfolio.filter(x => /BOOST/i.test(x.rationale ?? ''))) {
  const boostReason = String(p.rationale).replace(/^BOOST:\s*BOOST:\s*/i, 'BOOST: ');
  console.log(`  ${p.ticker}:`);
  console.log(`    BEFORE: ${p.rationale}`);
  console.log(`    AFTER:  ${boostReason}`);
}

console.log('\n=== F2/F3/F4: stopLossRationale 통화/현재가/포맷 교정 ===');
// 실제 livePrices 가 없으므로 데모용 reasonable price 입력
const demoLivePrices = new Map([
  ['005930.KS', 92500],   // 삼성전자 실제가
  ['000660.KS', 280000],  // SK하이닉스 실제가
  ['051910.KS', 351000],  // LG화학 (그대로)
  ['005380.KS', 245000],  // 현대차 실제가
  ['NVDA', 215.33],
  ['TSM', 404.52],
]);

for (const sr of r.stopLossRationale.filter(x => x.ticker.endsWith('.KS'))) {
  const p = r.portfolio.find(x => x.ticker === sr.ticker);
  const stopP = p ? parseFirstPrice(p.stopLoss) : null;
  const native = nativeCurrency(sr.ticker);
  const isKR = native === '₩';
  const fmt = n => isKR ? `${native}${Math.round(n).toLocaleString()}` : `${native}${parseFloat(n.toFixed(2))}`;
  let s = sr.rationale;
  const before = s;

  // F4 — 손절선 ~X 포맷 통일
  const sm = s.match(/손절선\s*~\s*([$₩€])?([\d,.]+)/);
  if (sm && stopP) {
    const rationaleStop = parseFloat(sm[2].replace(/,/g, ''));
    if (isFinite(rationaleStop) && rationaleStop !== stopP && Math.abs(rationaleStop - stopP) / stopP >= 0.05) {
      s = s.replace(/손절선\s*~\s*[$₩€]?[\d,.]+/, `손절선 ~${fmt(stopP)}`);
    }
  }
  // F2 — KR ticker 의 $digit 패턴 → ₩digit
  if (isKR) s = s.replace(/\$(\d)/g, `${native}$1`);
  // F3 — 현재 ~X livePrice 기반 교정
  const lp = demoLivePrices.get(sr.ticker);
  if (lp && lp > 0) {
    const rx = /현재\s*[$₩€]?\s*([\d,.]+)/;
    const cm = s.match(rx);
    if (cm) {
      const oldVal = parseFloat(cm[1].replace(/,/g, ''));
      if (isFinite(oldVal) && (oldVal < lp * 0.5 || oldVal > lp * 2)) {
        s = s.replace(rx, `현재 ${fmt(lp)}`);
      }
    }
  }
  console.log(`  ${sr.ticker}:`);
  console.log(`    BEFORE: ${before.slice(0, 160)}`);
  console.log(`    AFTER:  ${s.slice(0, 160)}`);
}
