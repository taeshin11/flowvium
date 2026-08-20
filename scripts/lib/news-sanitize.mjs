/**
 * news-sanitize.mjs — 뉴스 제목/요약 정제.
 *
 * ① 엔티티 디코딩. RSS/Atom 은 XML 이라 &amp; &lt; &gt; &quot; &apos; 와 숫자 엔티티가 정상이고,
 *    실제 피드에는 &mdash; &nbsp; 같은 HTML5 명명 엔티티도 섞여 온다.
 *    news-cascade/route.ts:453 이 <title> 을 정규식으로 뽑고 .trim() 만 해서 그대로 화면까지 갔다.
 *    (실측: "speed bump &#x2014; but", "&quot;삼성전자…&quot;-KB")
 *    엔티티 표를 손으로 만들지 않는다 — CLAUDE.md 의 '하드코딩 화이트리스트 금지' 규칙에 따라
 *    권위 소스(entities 패키지의 HTML5 표)를 쓴다.
 *
 * ② 요약이 제목과 같으면 비운다. route.ts:617 keywordFallbackCascade 가 summary: title 을
 *    돌려주므로, AI 요약이 garbage 판정(:772)되면 화면에 같은 문장이 두 번 뜬다.
 *    비교는 디코딩·공백정규화 후에 한다 — 엔티티 차이만 있는 중복도 잡아야 한다.
 */
import { decodeHTML } from 'entities';

export function decodeEntities(s) {
  if (s == null) return '';
  const str = String(s);
  if (!str.includes('&')) return str;
  // 이중 인코딩(&amp;quot;)도 있으므로 변화가 없을 때까지 최대 2회.
  let out = decodeHTML(str);
  if (out.includes('&')) { const again = decodeHTML(out); if (again !== out) out = again; }
  return out;
}

const norm = (s) => decodeEntities(s).replace(/\s+/g, ' ').trim().toLowerCase();

/** 요약이 제목과 사실상 같으면 null. 다르면 원래 요약(문자열)을 그대로 돌려준다. */
export function dedupeSummary(title, summary) {
  if (summary == null || String(summary).trim() === '') return null;
  return norm(title) === norm(summary) ? null : summary;
}

/** 제목·요약을 한 번에 정제. 소비처가 이 한 지점만 부르면 된다. */
export function sanitizeArticle({ title, summary }) {
  const t = decodeEntities(title).replace(/\s+/g, ' ').trim();
  const rawS = decodeEntities(summary).replace(/\s+/g, ' ').trim();
  return { title: t, summary: dedupeSummary(t, rawS) };
}
