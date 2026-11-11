// blog-site-links.test.mjs — 블로그 글 끝에 그날 마감 기록·종목 페이지 링크. node --test scripts/lib/blog-site-links.test.mjs
// 왜(11/11 성장 점검 E, ChatGPT 권고·agy 동의): 블로그 → 사이트 유입이 7일 1건, 글은 /ko/report 한 곳만 가리켰다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blogSiteLinks } from './blog-site-links.mjs';

const known = { '005930.KS': '삼성전자', '000660.KS': 'SK하이닉스' };
const nameOf = (t) => known[t] ?? null;

test('글 날짜 이전(같은 날 포함) 가장 최근 마감 기록 하나', () => {
  const l = blogSiteLinks({ postDate: '2026-11-12', closeDates: ['2026-11-13', '2026-11-11', '2026-11-10'], picks: [], nameOf });
  assert.deepEqual(l, [{ label: '11월 11일 한국 증시 마감 정리', path: '/ko/market-close/2026-11-11' }]);
});

test('한국 종목 중 페이지가 있는 것만, 순서대로', () => {
  const l = blogSiteLinks({ postDate: '2026-11-12', closeDates: [], picks: [{ ticker: '000660.KS' }, { ticker: 'NVDA' }, { ticker: '123456.KQ' }, { ticker: '005930.KS' }], nameOf });
  assert.deepEqual(l.map((x) => x.path), ['/ko/company/000660.KS', '/ko/company/005930.KS']);
  assert.equal(l[0].label, 'SK하이닉스 종목 페이지');
});

test('아무것도 없으면 빈 목록 — 빈 제목을 쓰지 않는다', () => {
  assert.deepEqual(blogSiteLinks({ postDate: '2026-11-12', closeDates: ['2026-11-13'], picks: [], nameOf }), []);
});
