#!/usr/bin/env node
/**
 * scripts/fetch-sp500-list.mjs
 *
 * Wikipedia 의 S&P 500 list 페이지에서 ticker 전체 추출 → data/sp500-tickers.json 저장.
 * build-candidate-tickers.mjs 가 이 list 사용해 누락 ticker 자동 추가.
 *
 * 실행 (주 1회 권장):
 *   node scripts/fetch-sp500-list.mjs
 */
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const URL_WIKI = 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies';

console.log(`▶ fetch ${URL_WIKI} ...`);
const res = await fetch(URL_WIKI, {
  headers: { 'User-Agent': 'Mozilla/5.0 FlowViumBot/1.0' },
  signal: AbortSignal.timeout(15000),
});
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const html = await res.text();

// Wikipedia 의 첫 번째 table (constituents) 의 row 마다 ticker
// <td><a ...>NVDA</a></td><td><a ...>NVIDIA</a></td>... <td>Information Technology</td>
// Wikipedia 의 ticker 컬럼은 nasdaq.com 또는 nyse.com 외부 링크.
const rowRe = /<tr>([\s\S]*?)<\/tr>/g;
const symRe = /<td[^>]*>\s*<a[^>]+(?:nasdaq\.com|nyse\.com)[^>]+>([A-Z][A-Z0-9.\-]{0,5})<\/a>\s*<\/td>/i;
const nameRe = /<td[^>]*>\s*<a[^>]+wiki[^>]+>([^<]+)<\/a>\s*<\/td>/i;
const sectorRe = /<td[^>]*>([^<]+(?:Technology|Health Care|Financials|Consumer|Industrials|Energy|Materials|Utilities|Real Estate|Communication)[^<]*)<\/td>/i;

const tickers = [];
const meta = {};
let m;
while ((m = rowRe.exec(html)) !== null) {
  const row = m[1];
  const sm = symRe.exec(row);
  if (!sm) continue;
  const symbol = sm[1].trim().replace(/\./g, '-'); // BRK.B → BRK-B (Yahoo 형식)
  // 회사명 (ticker 다음 a 태그)
  const afterSym = row.slice(sm.index + sm[0].length);
  const nm = nameRe.exec(afterSym);
  const name = nm ? nm[1].trim() : symbol;
  const sm2 = sectorRe.exec(afterSym);
  const sector = sm2 ? sm2[1].trim() : 'Unknown';
  tickers.push(symbol);
  meta[symbol] = { name, sector };
}

if (tickers.length < 400) {
  console.error(`❌ 추출 부족: ${tickers.length} (S&P 500 < 400). Wikipedia 구조 변경 의심`);
  process.exit(1);
}

const out = {
  source: 'wikipedia-sp500',
  fetchedAt: new Date().toISOString(),
  total: tickers.length,
  tickers,
  meta,
};
const outPath = resolve(ROOT, 'data/sp500-tickers.json');
writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log(`✅ ${tickers.length} tickers → ${outPath}`);
console.log(`  샘플 10: ${tickers.slice(0, 10).join(', ')}`);
