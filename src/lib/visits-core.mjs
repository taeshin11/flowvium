/**
 * visits-core.mjs — flowvium.net 방문자 측정의 판정 규칙(순수 함수). 2026-09-25 신설.
 *
 * 사장님 "flowvium.net 방문자 측정되나?" → 안 됐다. Vercel Analytics 는 자가호스팅 전환(2026-06-02)
 *   뒤 꺼져 있었고(layout.tsx), 다른 측정은 없었다. 그래서 **우리 서버에서** 센다:
 *   쿠키 없음 · 외부 전송 없음 · IP 저장 없음. 방문자 ID 는 날마다 바뀌는 소금으로 해시한다 —
 *   하루 순방문자는 셀 수 있고, 같은 사람을 날 넘어 추적하지는 못한다.
 * 저장·라우트는 src/lib/visits.ts · src/app/api/pv/route.ts. 판정은 scripts/lib/visits-core.test.mjs 가 고정한다.
 */
import { createHash } from 'crypto';

/** 봇·자동화·빈 UA. 우리 모니터(playwright)는 비콘 쪽에서 navigator.webdriver 로 한 번 더 거른다. */
const BOT = /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python|node-fetch|axios|go-http|java\/|okhttp|scrapy|httpclient|phantom|selenium|puppeteer|playwright/i;
export function isBot(ua) {
  const s = String(ua ?? '').trim();
  return !s || BOT.test(s);
}

/** 하루짜리 방문자 ID(16자). IP 는 해시 안에만 들어가고 저장되지 않는다. */
export function visitorId(ip, ua, daySalt) {
  return createHash('sha256').update(`${daySalt}|${ip ?? ''}|${ua ?? ''}`).digest('hex').slice(0, 16);
}

/** 유입처 호스트. www./m. 을 떼고, 우리 사이트면 '(내부)', 없거나 깨졌으면 '(직접)'. */
export function refHost(referrer, ownHost = 'flowvium.net') {
  let h;
  try { h = new URL(String(referrer ?? '')).hostname.toLowerCase(); } catch { return '(직접)'; }
  if (!h) return '(직접)';
  h = h.replace(/^(www|m)\./, '');
  const own = String(ownHost).replace(/^www\./, '');
  return h === own || h.endsWith(`.${own}`) ? '(내부)' : h;
}

/** 경로만(쿼리·해시 제거 — 개인정보가 섞일 수 있다), 200자까지. */
export function normPath(p) {
  const s = String(p ?? '').split(/[?#]/)[0] || '/';
  return s.slice(0, 200);
}
