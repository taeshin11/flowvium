// company-seo.test.mjs — 종목 페이지 검색 제목·사이트맵. node scripts/lib/company-seo.test.mjs
// 왜(11/07 실측): 한국어 삼성전자 페이지 제목이 "Samsung Electronics (005930.KS) - 공급망 탐색기", 카카오는 "035720.KS".
//   사이트맵 종목 616개 중 한국 종목 3개(465개 중). 한국 사람은 "삼성전자 주가"로 찾는다.
import assert from 'node:assert/strict';
import { companyName, companyCode, sitemapTickers } from '../../src/lib/company-seo.mjs';

const pool = { tickers: ['005930.KS', '035720.KS', '999999.KQ', '123456.KQ', 'NVDA'], meta: {
  '005930.KS': { name: '삼성전자' }, '035720.KS': { name: '카카오' }, '999999.KQ': { name: '999999.KQ' }, '123456.KQ': {}, NVDA: { name: 'NVIDIA Corporation' } } };
const dart = { '999999': { corpName: '가나다' } };
const curated = [{ ticker: '005930.KS', name: 'Samsung Electronics' }, { ticker: 'NVDA', name: 'NVIDIA Corporation' }, { ticker: 'AAPL', name: 'Apple Inc.' }];

// [1] 한국 종목은 한국어 이름(종목 풀 → 없으면 DART), 한국어·영어·일본어 화면 모두에서 한국 이름이 먼저 — ko 만 한국어
assert.equal(companyName('005930.KS', 'ko', { pool, dart, curated }), '삼성전자');
assert.equal(companyName('005930.ks', 'ko', { pool, dart, curated }), '삼성전자', '주소 대소문자 무관');
assert.equal(companyName('999999.KQ', 'ko', { pool, dart, curated }), '가나다', '풀 이름이 티커 그대로면 DART');
assert.equal(companyName('005930.KS', 'en', { pool, dart, curated }), 'Samsung Electronics', '영어 화면은 큐레이션 영어 이름');
// [2] 이름을 모르면 null — 제목에 티커를 두 번 쓰지 않게
assert.equal(companyName('123456.KQ', 'ko', { pool, dart, curated }), null);
// [3] 미국 종목은 영어 이름 그대로
assert.equal(companyName('NVDA', 'ko', { pool, dart, curated }), 'NVIDIA Corporation');
// [4] 표시 코드: 한국은 6자리, 미국은 티커
assert.equal(companyCode('005930.KS'), '005930');
assert.equal(companyCode('nvda'), 'NVDA');
// [5] 사이트맵: 큐레이션 전부 + 풀의 한국 종목(이름 아는 것만), 중복 없이
const sm = sitemapTickers({ pool, dart, curated });
assert.deepEqual([...sm].sort(), ['005930.KS', '035720.KS', '999999.KQ', 'AAPL', 'NVDA'].sort());
console.log('company-seo.test: 5/5 통과');
