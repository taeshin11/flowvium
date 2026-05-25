#!/usr/bin/env node
/**
 * scripts/test-harness-fixes.mjs — 2026-05-24 신규 harness 룰을 기존
 * 보고서에 적용해 before/after 비교만 출력 (실제 보고서 재생성 X).
 *
 * 검증 항목:
 *   F1: BOOST: BOOST: 중복 prefix 제거
 *   F2: KR stopLossRationale 의 $ → ₩
 *   F3: "현재" 가격 livePrice 기반 교정 (split-adjusted 의심 시)
 *   F4: 손절선 ~X 포맷 통일 (₩1,805,130 vs ₩1805130)
 *   F5: 미래 분기 + 매출 절대값 hallucination strip (NVDA Q1 FY2027 $81.6B)
 *   F6: macroAnalysis 연준금리 FRED 강제 치환
 */
import { readFileSync } from 'fs';

const REPORT = 'C:/NoAddsMakingApps/FlowVium/reports/report-2026-05-26-morning-ko.json';
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

console.log('\n=== F5: 미래 분기 + 매출 절대값 hallucination strip (2026-05-25 강화) ===');
const FUTURE_QUARTER_RX = /Q[1-4]\s*FY\s*202[7-9]/i;
const REVENUE_ABS_RX = /\$\d+\.?\d*\s*B|\d+\s*억\s*달러/i;
const MEGA_CAP = {
  NVDA: 50, MSFT: 80, AAPL: 140, AMZN: 180, GOOGL: 105, META: 55, TSLA: 35,
  ORCL: 18, AVGO: 18, CRM: 12, ADBE: 7, NFLX: 12,
  TSM: 30, TSMC: 30, ASML: 10, AMAT: 8, LRCX: 6, KLAC: 4, MU: 10, INTC: 18,
  '005930.KS': 70, '000660.KS': 22, '005380.KS': 35, '051910.KS': 15,
  '005490.KS': 25,
};
const extractRevenueB = (text) => {
  const m1 = text.match(/\$(\d+\.?\d*)\s*B/i);
  if (m1) return parseFloat(m1[1]);
  const m2 = text.match(/(\d+(?:\.\d+)?)\s*억\s*(?:달러|달성)/i);
  if (m2) return parseFloat(m2[1]) / 10;
  const m3 = text.match(/(?:매출|revenue)\s*(\d+(?:\.\d+)?)\s*억/i);
  if (m3) return parseFloat(m3[1]) / 10;
  return null;
};
for (const p of r.portfolio) {
  if (!Array.isArray(p.catalysts)) continue;
  const removed = p.catalysts.filter(c => {
    if (typeof c !== 'string') return false;
    if (FUTURE_QUARTER_RX.test(c) && REVENUE_ABS_RX.test(c)) return true;
    const cap = MEGA_CAP[p.ticker?.toUpperCase()];
    if (cap) {
      const rev = extractRevenueB(c);
      if (rev != null && rev > cap) return true;
    }
    return false;
  });
  if (removed.length > 0) {
    console.log(`  ${p.ticker}: ${removed.length}건 strip`);
    for (const c of removed) console.log(`    - "${c}"`);
  }
}
console.log('\n=== F5b: companyChanges.keyChange + revenueYoY field-swap ===');
for (const c of r.companyChanges ?? []) {
  if (typeof c.keyChange === 'string' && FUTURE_QUARTER_RX.test(c.keyChange) && REVENUE_ABS_RX.test(c.keyChange)) {
    console.log(`  ${c.ticker} 미래 분기 strip:`);
    console.log(`    BEFORE: ${c.keyChange}`);
    const cleaned = c.keyChange
      .replace(/Q[1-4]\s*FY\s*202[7-9][^,;]*(?:\$\d+\.?\d*\s*B|\d+\s*억\s*달러)[^,;]*/gi, '')
      .replace(/[,;\s]+,/g, ',')
      .replace(/^[,;\s]+|[,;\s]+$/g, '');
    console.log(`    AFTER:  ${cleaned || '(empty)'}`);
  }
  const cap = MEGA_CAP[c.ticker?.toUpperCase()];
  if (cap && typeof c.revenueYoY === 'number' && c.revenueYoY > cap * 0.5) {
    console.log(`  ${c.ticker} revenueYoY=${c.revenueYoY} (cap=${cap}B 의 ${(c.revenueYoY/cap*100).toFixed(0)}%) — field swap → null`);
  } else if (typeof c.revenueYoY === 'number' && c.revenueYoY > 100) {
    console.log(`  ${c.ticker} revenueYoY=${c.revenueYoY}% → null (> 100%)`);
  }
}

console.log('\n=== F7: fundamentalAnalysis vs catalysts self-consistency ===');
{
  let fa = r.fundamentalAnalysis;
  console.log(`  BEFORE: "${fa}"`);
  const YOY_PATTERNS = [
    /(?:Revenue|매출)\s*\+?(\d+\.?\d*)\s*%/i,
    /\+?(\d+\.?\d*)\s*%\s*(?:YoY|증가|상승)/i,
    /revenue\s*growth\s*\+?(\d+\.?\d*)\s*%/i,
    /전년\s*대비\s*(\d+\.?\d*)\s*%/i,
  ];
  const extractYoY = (text) => {
    if (!text) return null;
    for (const rx of YOY_PATTERNS) {
      const m = text.match(rx);
      if (m) return parseFloat(m[1]);
    }
    return null;
  };
  for (const p of r.portfolio ?? []) {
    const t = p.ticker;
    if (!t) continue;
    const catText = (Array.isArray(p.catalysts) ? p.catalysts : []).join(' | ');
    const fbText = p.fundamentalBasis ?? '';
    const cc = (r.companyChanges ?? []).find(c => c.ticker === t);
    const ccText = cc?.keyChange ?? '';
    const ccRevYoY = (typeof cc?.revenueYoY === 'number') ? cc.revenueYoY : null;
    const catYoY = ccRevYoY ?? extractYoY(ccText) ?? extractYoY(fbText) ?? extractYoY(catText);
    if (catYoY == null) continue;
    const tickerEscaped = t.replace(/[.]/g, '\\.');
    const rx = new RegExp(`(${tickerEscaped}[^,;.|]*?)(\\d+\\.?\\d*)(\\s*%\\s*(?:증가|초과|상승|상회|growth|YoY))`, 'gi');
    fa = fa.replace(rx, (match, prefix, val, suffix) => {
      const v = parseFloat(val);
      if (!isFinite(v) || Math.abs(v - catYoY) < 5) return match;
      console.log(`    ${t}: ${val}% → ${catYoY}% (sources: ccRevYoY=${ccRevYoY}, ccText="${ccText.slice(0,40)}", fb="${fbText.slice(0,40)}")`);
      return `${prefix}${catYoY}${suffix}`;
    });
  }
  console.log(`  AFTER:  "${fa}"`);
}

console.log('\n=== F8: fundamentalAnalysis 매출 절대값 strip ===');
{
  let fa = r.fundamentalAnalysis;
  console.log(`  BEFORE: "${fa}"`);
  for (const ticker of Object.keys(MEGA_CAP)) {
    const cap = MEGA_CAP[ticker];
    const tickerEscaped = ticker.replace(/[.]/g, '\\.');
    const rx = new RegExp(`(${tickerEscaped}[^,;.|]*?(?:매출|revenue)\\s*)(\\$\\d+\\.?\\d*\\s*B|\\d+\\s*억(?:\\s*(?:달러|달성))?)([^,;.|]*)`, 'gi');
    fa = fa.replace(rx, (match, prefix, val, suffix) => {
      const rev = extractRevenueB(val);
      if (rev == null) return match;
      if (rev < cap * 0.5 || rev > cap * 2) {
        console.log(`    ${ticker}: 매출 ${rev}B (cap ${cap}B 범위 밖) strip`);
        return `${prefix.replace(/\s*(?:매출|revenue)\s*$/i, '')}${suffix}`;
      }
      return match;
    });
  }
  console.log(`  AFTER:  "${fa}"`);
}

console.log('\n=== F10: Cross-ticker 매출 swap 검출 (영어 + 한국어 + 괄호 % 패턴) ===');
{
  const extractRevPct = (text) => {
    let m = text.match(/(?:Revenue|매출)\s*\+?(\d+\.?\d*)\s*%/i);
    if (m) return parseFloat(m[1]);
    m = text.match(/(?:매출|revenue)[^,;|]*\(\s*\+?(\d+\.?\d*)\s*%\s*\)/i);
    if (m) return parseFloat(m[1]);
    return null;
  };
  const revByPercent = new Map();
  for (const p of r.portfolio ?? []) {
    if (typeof p.fundamentalBasis !== 'string') continue;
    const pct = extractRevPct(p.fundamentalBasis);
    if (pct == null || !isFinite(pct) || pct < 5) continue;
    if (!revByPercent.has(pct)) revByPercent.set(pct, []);
    revByPercent.get(pct).push(p.ticker);
  }
  for (const [pct, tickers] of revByPercent) {
    if (tickers.length < 2) {
      console.log(`  no swap: ${pct}% in ${tickers.length} ticker (${tickers.join(', ')})`);
    } else {
      console.log(`  ⚠️ swap 의심: ${pct}% 가 ${tickers.length}종목 공유: ${tickers.join(', ')}`);
    }
  }
}

console.log('\n=== F11: companyChanges relevance filter (보수적) ===');
{
  // 실제 코드와 동일 로직 — relevant ticker = portfolio + insider + short + supplyChain + 화이트리스트
  const known = new Set([
    'NVDA','TSM','ASML','MSFT','AAPL','META','GOOGL','AMZN','TSLA','AMD','MU','AVGO','ARM','AMAT','LRCX','KLAC',
    'JPM','GS','BAC','V','UNH','XOM','CVX','LMT','RTX','NOC','SPY','QQQ','IWM','GLD','TLT','CRWV','SNOW',
    'NET','DDOG','MDB','ZS','CRWD','PANW','FTNT','PLTR','TOYO','TSMC',
    '005930.KS','000660.KS','005380.KS','051910.KS','005490.KS','035420.KS','035720.KS',
  ]);
  for (const p of r.portfolio ?? []) if (p.ticker) known.add(p.ticker.toUpperCase());
  for (const s of r.insiderSignals ?? []) if (s.ticker) known.add(s.ticker.toUpperCase());
  for (const s of r.shortSqueeze ?? []) if (s.ticker) known.add(s.ticker.toUpperCase());
  for (const s of r.supplyChainChanges ?? []) if (s.ticker) known.add(s.ticker.toUpperCase());
  for (const c of r.companyChanges ?? []) {
    const t = c.ticker?.toUpperCase();
    if (t && !known.has(t)) {
      console.log(`  removed (no relevance): ${c.ticker} (${c.name ?? '?'})`);
    }
  }
}

console.log('\n=== F6: macroAnalysis 연준금리 FRED 강제 치환 ===');
console.log(`  현재 macroAnalysis: "${r.macroAnalysis}"`);
const fedActual = 4.375; // 데모 — 실제 FRED 값은 매번 동적
const rx = /(연준금리|Fed(?:eral)?\s*(?:Funds\s*)?Rate|연방준비)\s*[:은]?\s*(\d+\.?\d*)\s*%/gi;
const replaced = r.macroAnalysis.replace(rx, (match, label, val) => {
  const v = parseFloat(val);
  if (!isFinite(v) || Math.abs(v - fedActual) < 0.5) return match;
  return `${label} ${fedActual}%`;
});
console.log(`  치환 후 (demo FRED=${fedActual}%): "${replaced}"`);
