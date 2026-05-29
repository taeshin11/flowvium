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
// 2026-05-29: hardcoded 29개 → companies-kr.ts 의 242개 (KOSPI 132 + KOSDAQ 108) 활용.
// stockCode 6자리 + market (KOSPI→.KS / KOSDAQ→.KQ) 자동 매핑. sector 도 메타에 반영.
const KR_TICKERS = {};
const KR_META = {};
try {
  const krFile = readFileSync(resolve(DATA_DIR, 'companies-kr.ts'), 'utf8');
  const krEntries = [...krFile.matchAll(
    /stockCode:\s*"(\d{6})"[^}]*?name:\s*"([^"]+)"[^}]*?market:\s*"(KOSPI|KOSDAQ)"[^}]*?sector:\s*"([^"]+)"/g
  )];
  for (const [, code, name, market, sector] of krEntries) {
    const ticker = code + (market === 'KOSPI' ? '.KS' : '.KQ');
    KR_TICKERS[ticker] = name;
    KR_META[ticker] = { name, sector, cap: 'kr', market: market.toLowerCase() };
  }
  console.log(`[KR] companies-kr.ts 에서 ${krEntries.length}개 로드 (KOSPI ${Object.values(KR_META).filter(m=>m.market==='kospi').length} + KOSDAQ ${Object.values(KR_META).filter(m=>m.market==='kosdaq').length})`);
} catch (e) {
  console.warn('[KR] companies-kr.ts 로드 실패, hardcoded fallback:', e.message);
  Object.assign(KR_TICKERS, {
    '005930.KS':'삼성전자','000660.KS':'SK하이닉스','373220.KS':'LG에너지솔루션',
    '005380.KS':'현대차','035420.KS':'NAVER','035720.KS':'카카오',
  });
}

// 2026-05-29: KOSPI 200 + KOSDAQ 150 자동 보장 — kr-major-indexes.json
// (fetch-kospi200-kosdaq150.mjs 산출물, Naver finance 시총 상위 기반).
try {
  const krIdx = JSON.parse(readFileSync(resolve(ROOT, 'data/kr-major-indexes.json'), 'utf8'));
  let added = 0;
  for (const t of [...(krIdx.kospi?.tickers ?? []), ...(krIdx.kosdaq?.tickers ?? [])]) {
    if (KR_TICKERS[t]) continue;
    const meta = krIdx.kospi?.meta?.[t] ?? krIdx.kosdaq?.meta?.[t] ?? {};
    KR_TICKERS[t] = meta.name ?? t;
    KR_META[t] = {
      name: meta.name ?? t,
      sector: 'KR',
      cap: 'kr',
      market: meta.market?.toLowerCase() ?? (t.endsWith('.KQ') ? 'kosdaq' : 'kospi'),
    };
    added++;
  }
  console.log(`[KR-IDX] kr-major-indexes (KOSPI ${krIdx.kospi?.total} + KOSDAQ ${krIdx.kosdaq?.total}) → ${added}개 추가`);
} catch (e) {
  console.warn('[KR-IDX] kr-major-indexes.json 로드 실패: ' + e.message);
}

// 2026-05-29: S&P 500 자동 보장 — sp500-tickers.json (fetch-sp500-list.mjs 산출물).
// candidate 에 없는 S&P 500 종목 자동 추가 (large 대역 + sp500=true 메타).
const SP500_ADDED = {};
try {
  const sp500 = JSON.parse(readFileSync(resolve(ROOT, 'data/sp500-tickers.json'), 'utf8'));
  const existing = new Set([
    ...grouped.titan, ...grouped.mega, ...grouped.large, ...grouped.mid,
  ]);
  let added = 0;
  for (const t of sp500.tickers) {
    if (existing.has(t)) continue;
    // candidate 의 dot 형식 (BRK.B) 도 동일 매칭
    if (existing.has(t.replace('-', '.'))) continue;
    grouped.large.push(t);
    SP500_ADDED[t] = {
      name: sp500.meta?.[t]?.name ?? t,
      sector: sp500.meta?.[t]?.sector ?? 'Unknown',
      cap: 'large',
      sp500: true,
    };
    added++;
  }
  console.log(`[SP500] ${sp500.tickers.length} 종목 중 ${added}개 누락 → large 대역 자동 추가`);
} catch (e) {
  console.warn('[SP500] sp500-tickers.json 로드 실패 (수동 fetch 권장): ' + e.message);
}

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
    ...Object.entries(KR_TICKERS).map(([t, name]) => [t, KR_META[t] ?? { name, sector: 'KR', cap: 'kr' }]),
    ...Object.entries(SP500_ADDED),
  ]),
  krNames: KR_TICKERS,
};

const outPath = resolve(ROOT, 'data/candidate-tickers.json');
writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');

console.log(`✅ ${candidate.length} candidates → ${outPath}`);
console.log(`  titan: ${out.byBand.titan} | mega: ${out.byBand.mega} | large: ${out.byBand.large} | ETF: ${out.byBand.etf} | KR: ${out.byBand.kr}`);
