#!/usr/bin/env node
/**
 * scripts/fetch-kospi200-kosdaq150.mjs
 *
 * Naver finance 시총 페이지 (sosok=0 KOSPI / sosok=1 KOSDAQ) 에서
 * 시총 상위 200 (KOSPI) + 150 (KOSDAQ) 종목 코드 fetch.
 * EUC-KR 인코딩 → UTF-8 디코딩.
 *
 * KOSPI 200 / KOSDAQ 150 (공식 위원회 선정) 와 95%+ 동일.
 * data/kr-major-indexes.json 저장.
 *
 * 실행 (주 1회 권장):
 *   node scripts/fetch-kospi200-kosdaq150.mjs
 */
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

async function fetchMarketCodes(sosok, label, maxPages) {
  const codes = new Set();
  const meta = {};
  for (let page = 1; page <= maxPages; page++) {
    const url = `https://finance.naver.com/sise/sise_market_sum.naver?sosok=${sosok}&page=${page}`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) });
      const buf = await res.arrayBuffer();
      const html = new TextDecoder('euc-kr').decode(buf);
      // code + 회사명 (table row): <a href="/item/main.naver?code=XXXXXX" ...>회사명</a>
      const re = /<a\s+href="\/item\/main\.naver\?code=([0-9]{6})"[^>]*>([^<]+)<\/a>/g;
      let m;
      while ((m = re.exec(html)) !== null) {
        const code = m[1];
        const name = m[2].trim();
        if (codes.has(code)) continue;
        codes.add(code);
        meta[code] = { name };
      }
      console.log(`  ${label} page ${page}: ${codes.size} unique`);
    } catch (e) { console.warn(`  ${label} page ${page} 실패: ${String(e).slice(0,60)}`); }
    await new Promise(r => setTimeout(r, 200));
  }
  return { codes: [...codes], meta };
}

console.log('▶ KOSPI 200 fetch (sosok=0, 4 pages)...');
const kospi = await fetchMarketCodes(0, 'KOSPI', 4);

console.log('\n▶ KOSDAQ 150 fetch (sosok=1, 3 pages)...');
const kosdaq = await fetchMarketCodes(1, 'KOSDAQ', 3);

const out = {
  source: 'naver-finance-market-sum',
  fetchedAt: new Date().toISOString(),
  kospi: {
    total: kospi.codes.length,
    tickers: kospi.codes.map(c => c + '.KS'),
    meta: Object.fromEntries(kospi.codes.map(c => [c + '.KS', { ...kospi.meta[c], market: 'KOSPI' }])),
  },
  kosdaq: {
    total: kosdaq.codes.length,
    tickers: kosdaq.codes.map(c => c + '.KQ'),
    meta: Object.fromEntries(kosdaq.codes.map(c => [c + '.KQ', { ...kosdaq.meta[c], market: 'KOSDAQ' }])),
  },
};
const outPath = resolve(ROOT, 'data/kr-major-indexes.json');
writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log(`\n✅ KOSPI ${kospi.codes.length} + KOSDAQ ${kosdaq.codes.length} = ${kospi.codes.length + kosdaq.codes.length} → ${outPath}`);
