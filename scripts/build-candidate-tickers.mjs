#!/usr/bin/env node
/**
 * scripts/build-candidate-tickers.mjs
 * src/data/companies-batch*.ts + companies.ts 에서 titan + mega + large 종목 추출.
 * → data/candidate-tickers.json 생성. generate-report-local.mjs 가 로드.
 *
 * 실행: node scripts/build-candidate-tickers.mjs
 * Cron: 주 1회 권장 (S&P 500 구성 변경 반영)
 */
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DATA_DIR = resolve(ROOT, 'src/data');

const seen = new Set();
const grouped = { titan: [], mega: [], large: [], mid: [], small: [] };
const fields = {}; // ticker -> { name, sector, market }

const files = readdirSync(DATA_DIR).filter(f => f.startsWith('companies-batch') || f === 'companies.ts' || f === 'heatmap-stocks.ts');
for (const f of files) {
  const c = readFileSync(resolve(DATA_DIR, f), 'utf8');
  // Position-based pairing: find each ticker, then nearest marketCap within 2000 chars after
  const tickerRe = /ticker:\s*['"]([A-Z0-9.\-]{1,8})['"]/g;
  let m;
  while ((m = tickerRe.exec(c)) !== null) {
    const ticker = m[1];
    if (seen.has(ticker)) continue;
    // Look ahead up to 3000 chars for marketCap
    const window = c.slice(m.index, m.index + 3000);
    // String 형태 (companies-batch): marketCap:'mega'
    const capStrMatch = window.match(/marketCap:\s*['"](\w+)['"]/);
    // 숫자 형태 (heatmap-stocks): marketCap: 3200 → $3.2T = titan
    const capNumMatch = !capStrMatch && window.match(/marketCap:\s*(\d+)/);
    const nameMatch = window.match(/name:\s*['"]([^'"]+)['"]/);
    const sectorMatch = window.match(/sector:\s*['"]([^'"]+)['"]/);
    let cap;
    if (capStrMatch) cap = capStrMatch[1];
    else if (capNumMatch) {
      const billion = parseInt(capNumMatch[1]);
      cap = billion >= 1000 ? 'titan' : billion >= 200 ? 'mega' : billion >= 10 ? 'large' : 'mid';
    } else cap = 'large'; // 폴백
    if (!grouped[cap]) continue;
    seen.add(ticker);
    grouped[cap].push(ticker);
    fields[ticker] = {
      name: nameMatch?.[1] ?? ticker,
      sector: sectorMatch?.[1] ?? 'Unknown',
      cap,
    };
  }
}

// ETF + KR (hardcoded — not in companies-batch files)
const ETF_TICKERS = [
  'SPY','QQQ','VOO','VTI','IWM','DIA',
  'XLK','XLE','XLF','XLV','XLI','XLY','XLP','XLU','XLB','XLRE',
  'EWY','EWJ','FXI','VGK','INDA','EWT','EWZ','EWA','MCHI','EZA',
  'GLD','SLV','TLT','SHY','USO','UNG','DBA','BITO','VXX',
];
const KR_TICKERS = {
  '005930.KS':'삼성전자','000660.KS':'SK하이닉스','373220.KS':'LG에너지솔루션',
  '005380.KS':'현대차','035420.KS':'NAVER','035720.KS':'카카오',
  '207940.KS':'삼성바이오로직스','051910.KS':'LG화학','005490.KS':'POSCO홀딩스','000270.KS':'기아',
  '003550.KS':'LG','068270.KS':'셀트리온','105560.KS':'KB금융','028260.KS':'삼성물산',
  '012450.KS':'한화에어로스페이스','009150.KS':'삼성전기','032830.KS':'삼성생명',
  '015760.KS':'한국전력','006400.KS':'삼성SDI','017670.KS':'SK텔레콤',
  '055550.KS':'신한지주','086790.KS':'하나금융지주','316140.KS':'우리금융지주',
  '030200.KS':'KT','009540.KS':'HD한국조선해양','010130.KS':'고려아연',
  '034730.KS':'SK','096770.KS':'SK이노베이션','000810.KS':'삼성화재',
};

// 추천 가능 풀 = titan + mega + large + mid + ETF + KR
// (small 34개는 유동성 약함 — 제외)
// mid 포함 = small-cap premium factor (Fama-French SMB) 활용
const candidate = [
  ...grouped.titan,
  ...grouped.mega,
  ...grouped.large,
  ...grouped.mid,
  ...ETF_TICKERS,
  ...Object.keys(KR_TICKERS),
];

const out = {
  generatedAt: new Date().toISOString(),
  total: candidate.length,
  byBand: {
    titan: grouped.titan.length,
    mega: grouped.mega.length,
    large: grouped.large.length,
    mid: grouped.mid.length,
    etf: ETF_TICKERS.length,
    kr: Object.keys(KR_TICKERS).length,
  },
  tickers: candidate,
  // ticker → meta (sector, cap, name)
  meta: Object.fromEntries([
    ...Object.entries(fields),
    ...ETF_TICKERS.map(t => [t, { name: t, sector: 'ETF', cap: 'etf' }]),
    ...Object.entries(KR_TICKERS).map(([t, name]) => [t, { name, sector: 'KR', cap: 'kr' }]),
  ]),
  krNames: KR_TICKERS,
};

const outPath = resolve(ROOT, 'data/candidate-tickers.json');
writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');

console.log(`✅ ${candidate.length} candidates → ${outPath}`);
console.log(`  titan: ${out.byBand.titan} | mega: ${out.byBand.mega} | large: ${out.byBand.large} | ETF: ${out.byBand.etf} | KR: ${out.byBand.kr}`);
