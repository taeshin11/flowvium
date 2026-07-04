#!/usr/bin/env node
/**
 * snapshot-etf-so.mjs — ETF shares outstanding 일일 스냅샷 (2026-07-04 이연 이행)
 *
 * 목적: ETF 는 창설/상환으로 SO 가 변하므로 ΔSO×가격 = *실측* 자금유입/유출 추정(가격 proxy 아님).
 * ICI(주간·시장 전체 지연) 대비 ETF별·일별 해상도. US 마감 직후(05:15 KST=20:15 UTC) MAINT 로 적재,
 * 소비는 generate-report-local 의 buildFlowNarrativeEvidence(etf_so claim, |1w flow| 임계 이상일 때만).
 *
 * 소스: Yahoo v7 quote + crumb (stock-supply/ishares-holdings 와 동일 검증 패턴). 실패 시 exit 1.
 */
import { saveEtfSoSnapshots } from './lib/db.mjs';

// 자산군 대표 + GICS 섹터 전체 22종 (2026-07-04 사용자 "섹터간에도" — 섹터 실측 창설/상환 커버):
//   미국주식(SPY/QQQ/IWM), 채권(TLT/HYG/LQD), 금(GLD), EM/중국/한국/일본(EEM/FXI/EWY/EWJ),
//   GICS 11섹터(XLK기술/XLF금융/XLE에너지/XLV헬스케어/XLI산업재/XLY경기소비/XLP필수소비/XLU유틸/XLB소재/XLRE리츠/XLC커뮤니케이션)
const BASKET = ['SPY', 'QQQ', 'IWM', 'TLT', 'HYG', 'LQD', 'GLD', 'EEM', 'FXI', 'EWY', 'EWJ',
  'XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLY', 'XLP', 'XLU', 'XLB', 'XLRE', 'XLC'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

async function main() {
  const cr = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
  const cookie = (cr.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  const crumb = await (await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': UA, Cookie: cookie }, signal: AbortSignal.timeout(10000) })).text();
  if (!crumb || crumb.includes('<')) throw new Error('crumb 획득 실패');
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${BASKET.join(',')}&fields=sharesOutstanding,regularMarketPrice&crumb=${encodeURIComponent(crumb)}`;
  const j = await (await fetch(url, { headers: { 'User-Agent': UA, Cookie: cookie }, signal: AbortSignal.timeout(15000) })).json();
  const results = j?.quoteResponse?.result ?? [];
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); // KST
  const rows = results
    .filter((q) => Number.isFinite(q.sharesOutstanding) && q.sharesOutstanding > 0)
    .map((q) => ({ ticker: q.symbol, date: today, sharesOut: q.sharesOutstanding, price: q.regularMarketPrice }));
  if (rows.length < BASKET.length * 0.6) throw new Error(`SO 수신 부족 ${rows.length}/${BASKET.length} — 소스 이상`);
  const n = saveEtfSoSnapshots(rows);
  console.log(`✅ etf_so_snapshots ${n}/${BASKET.length} 적재 (${today}) — ${rows.slice(0, 3).map((r) => `${r.ticker} ${(r.sharesOut / 1e6).toFixed(1)}M`).join(', ')} ...`);
}

main().catch((e) => { console.error('[FATAL]', e?.stack ?? e?.message ?? e); process.exit(1); });
