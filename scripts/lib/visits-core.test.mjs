#!/usr/bin/env node
/**
 * visits-core.test.mjs — flowvium.net 방문자 측정의 판정 규칙. 2026-09-25 신설.
 *
 * 사장님 "flowvium.net 방문자 측정되나?" → 안 됐다. Vercel Analytics 는 자가호스팅(2026-06-02~)에서
 *   꺼져 있었고 다른 측정은 없었다. 쿠키 없이, 밖으로 보내지 않고, 우리 DB 에 센다.
 * 여기서 못박는 것: 봇·우리 자동화는 안 센다 · 방문자 ID 는 **날마다 바뀐다**(하루 순방문만, 날 넘어 추적 안 함)
 *   · IP 는 저장하지 않는다 · 유입처는 호스트만.
 */
import { isBot, visitorId, refHost, normPath } from '../../src/lib/visits-core.mjs';

let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
// [1] 봇·자동화는 안 센다
{
  const bots = ['Googlebot/2.1', 'Mozilla/5.0 (compatible; bingbot/2.0)', 'facebookexternalhit/1.1', 'curl/8.4', 'python-requests/2.31',
    'Mozilla/5.0 HeadlessChrome/140.0', 'Lighthouse', 'node-fetch/1.0', ''];
  const miss = bots.filter((u) => !isBot(u));
  (!miss.length && !isBot(CHROME)) ? ok(`[1] 봇 ${bots.length}종 거름 · 일반 크롬은 센다`) : bad(`[1] 못 거른 것: ${JSON.stringify(miss)}`);
}
// [2] 방문자 ID — 같은 날 같은 사람은 같고, 날이 바뀌면 다르고, IP 가 그대로 안 남는다
{
  const a = visitorId('203.0.113.7', CHROME, 'salt-0925');
  const b = visitorId('203.0.113.7', CHROME, 'salt-0925');
  const c = visitorId('203.0.113.7', CHROME, 'salt-0926');
  const d = visitorId('203.0.113.8', CHROME, 'salt-0925');
  (a === b && a !== c && a !== d && !a.includes('203') && a.length === 16)
    ? ok('[2] 같은 날 같음 · 다음 날 다름 · 사람마다 다름 · IP 흔적 없음') : bad(`[2] ${a} ${b} ${c} ${d}`);
}
// [3] 유입처는 호스트만 — 우리 사이트 안 이동은 '내부', 없으면 '직접'
{
  const cases = [
    ['https://www.youtube.com/shorts/abc?x=1', 'youtube.com'],
    ['https://m.search.naver.com/search.naver?query=코스피', 'search.naver.com'],
    ['https://flowvium.net/ko/report', '(내부)'],
    ['', '(직접)'],
    ['not a url', '(직접)'],
  ];
  const wrong = cases.filter(([r, want]) => refHost(r, 'flowvium.net') !== want);
  !wrong.length ? ok('[3] 유입처 5종') : bad(`[3] ${JSON.stringify(wrong.map(([r]) => [r, refHost(r, 'flowvium.net')]))}`);
}
// [4] 경로 — 쿼리·해시 떼고 길이 제한. 쿼리에 개인정보가 섞일 수 있다
{
  (normPath('/ko/company/005930.KS?utm_source=yt#top') === '/ko/company/005930.KS' && normPath('x'.repeat(500)).length <= 200 && normPath('') === '/')
    ? ok('[4] 쿼리·해시 제거 · 200자 제한') : bad(`[4] ${normPath('/ko/company/005930.KS?utm_source=yt#top')}`);
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
