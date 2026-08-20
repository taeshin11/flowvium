#!/usr/bin/env node
/**
 * news-feeds.test.mjs — 피드 목록 단일 소스 + RSS 파싱.
 *
 * 배경(2026-08-20 실측): 뉴스 수집이 보고서 생성에만 붙어 있었다.
 *   news_archive 1,364건 기준 발행→수집 지연 중앙값 125분 · p90 287분.
 *   수집 시각 분포가 보고서 세션(05:30·10:30·14:30·20:00·22:30)에 정확히 몰려 있어
 *   p90 이 세션 간격(≈4.8h)과 일치했다 — 병목은 소스도 트위터도 아니라 '주기'였다.
 *   피드 목록은 news-cascade route 안에만 있었으므로, 독립 폴러가 쓰려면 밖으로 빼야 한다.
 *   두 곳에 복사해 두면 한쪽만 고쳐 조용히 어긋난다(이번 세션에서 반복해 본 실패 유형).
 */
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

let F;
try { F = await import('./news-feeds.mjs'); }
catch (e) { console.log(`  FAIL  모듈 없음: ${e.message}`); process.exit(1); }

const feeds = F.loadFeeds();
Array.isArray(feeds) && feeds.length >= 10 ? ok(`피드 ${feeds.length}개 로드`) : bad(`피드 로드 이상: ${feeds?.length}`);
feeds.every(f => f.url && f.source && f.region) ? ok('필수 필드 완비') : bad('url/source/region 누락 피드 있음');
const tf = feeds.find(f => f.titleFilter);
tf && tf.titleFilter instanceof RegExp ? ok(`titleFilter 정규식 복원 (${tf.source})`) : bad('titleFilter 가 RegExp 로 안 옴');
F.FINANCIAL_SIGNAL instanceof RegExp && F.FINANCIAL_SIGNAL.test('Fed rate decision')
  ? ok('FINANCIAL_SIGNAL 동작') : bad('FINANCIAL_SIGNAL 이상');

// ── RSS 파싱 (네트워크 없이) ──
const RSS = `<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>Fed holds rates steady</title><link>https://ex.com/a</link>
  <pubDate>Wed, 20 Aug 2026 09:00:00 +0900</pubDate><guid>ex-a</guid>
  <description>The Federal Reserve kept rates unchanged.</description></item>
<item><title>Local sports team wins</title><link>https://ex.com/b</link>
  <pubDate>Wed, 20 Aug 2026 09:05:00 +0900</pubDate><guid>ex-b</guid></item>
<item><title>S&amp;P 500 hits record</title><link>https://ex.com/c</link>
  <pubDate>Wed, 20 Aug 2026 09:10:00 +0900</pubDate></item>
</channel></rss>`;

const items = F.parseFeed(RSS);
items.length === 3 ? ok(`item 3건 파싱 (표본 ${items.length})`) : bad(`파싱 ${items.length}건 (3 기대)`);
items[0].title === 'Fed holds rates steady' ? ok('제목 추출') : bad(`제목: ${items[0]?.title}`);
items[0].guid === 'ex-a' ? ok('guid 추출') : bad(`guid: ${items[0]?.guid}`);
Number.isFinite(items[0].pubMs) ? ok('pubDate 파싱') : bad('pubDate 파싱 실패');
// guid 없으면 link 로 대체 — 없으면 매 폴링마다 중복 적재된다
items[2].guid === 'https://ex.com/c' ? ok('guid 없으면 link 대체') : bad(`대체 실패: ${items[2]?.guid}`);
// 엔티티 디코드 (S&amp;P → S&P) — 이번 세션에서 고친 것과 같은 부류
items[2].title === 'S&P 500 hits record' ? ok('엔티티 디코드') : bad(`엔티티 잔존: ${items[2]?.title}`);

// requireFinancial 필터
const kept = items.filter(i => F.passesFilter(i, { requireFinancial: true }));
kept.length === 2 && !kept.some(i => /sports/.test(i.title))
  ? ok('requireFinancial: 비금융 기사 제외') : bad(`필터 결과 ${kept.length}건: ${kept.map(i=>i.title)}`);
// titleFilter
const krItems = [{ title: '코스피 사상 최고', guid:'1' }, { title: '연예인 결혼 소식', guid:'2' }];
krItems.filter(i => F.passesFilter(i, { titleFilter: /코스피|증시/ })).length === 1
  ? ok('titleFilter 적용') : bad('titleFilter 미적용');
// 깨진 XML 은 예외가 아니라 빈 배열 — 피드 하나가 죽어도 폴링 전체가 멈추면 안 된다
Array.isArray(F.parseFeed('<html>not rss</html>')) && F.parseFeed('<html>not rss</html>').length === 0
  ? ok('깨진 피드 → 빈 배열 (전체 중단 없음)') : bad('깨진 피드에서 예외/오동작');

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
