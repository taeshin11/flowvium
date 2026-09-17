#!/usr/bin/env node
/**
 * naver-news.test.mjs — 한국 종목 뉴스가 살아 있는 출처를 쓰는가.
 *
 * 2026-09-17: /api/company-news 의 한국 경로가 finance.naver.com/item/news_news.naver 를
 *   긁고 있었는데 그 페이지가 HTTP 410 Gone 이었다. 캐시 없는 한국 종목은 전부 뉴스가 비었고,
 *   캐시된 몇 종목만 나와 겉으로는 멀쩡해 보였다. 네이버 증권 모바일 JSON 으로 바꿨다.
 */
import { readFileSync } from 'fs';
import { ROOT } from './project-root.mjs';

let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const skip = (m) => console.log(`  SKIP  ${m}`);

const src = readFileSync(`${ROOT}/src/app/api/company-news/route.ts`, 'utf8');
!/item\/news_news\.naver/.test(src.replace(/\/\/.*$/gm, ''))
  ? ok('없어진 HTML 페이지(news_news.naver)를 코드에서 부르지 않는다')
  : bad('410 난 news_news.naver 를 아직 부른다');
/m\.stock\.naver\.com\/api\/news\/stock\//.test(src)
  ? ok('네이버 증권 모바일 JSON 을 쓴다') : bad('JSON 출처가 없다');
!/pubDate:\s*new Date\(\)\.toISOString\(\),\s*\/\/ Naver/.test(src)
  ? ok('기사 시각을 지어내지 않는다(종전엔 "지금 시각")') : bad('pubDate 를 아직 지금 시각으로 채운다');

// 출처 형식이 그대로인가 — 네트워크가 없으면 건너뛴다(형식이 바뀌면 여기서 먼저 안다)
try {
  const r = await fetch('https://m.stock.naver.com/api/news/stock/005930?pageSize=3&page=1',
    { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
  const d = await r.json();
  const x = d?.[0]?.items?.[0];
  (r.ok && Array.isArray(d) && x && x.title && /^\d{12}$/.test(x.datetime ?? '') && (x.mobileNewsUrl || x.articleId))
    ? ok(`출처 형식 그대로 — ${x.officeName} · ${x.datetime}`)
    : bad(`출처 형식이 바뀌었다: HTTP ${r.status} ${JSON.stringify(x ?? d).slice(0, 80)}`);
} catch (e) { skip(`네트워크 없음 — 출처 형식 확인 건너뜀 (${String(e.message).slice(0, 40)})`); }

console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
