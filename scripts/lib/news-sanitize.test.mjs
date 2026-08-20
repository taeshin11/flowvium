#!/usr/bin/env node
/**
 * news-sanitize.test.mjs — 뉴스 제목/요약 정제 검증.
 *
 * 배준(2026-08-20 눈검증 실측, https://flowvium.net/ko/report):
 *   ① HTML 엔티티가 화면에 원문 그대로 노출
 *      "The chip-stock rally hits a speed bump &#x2014; but these analysts see reason to be hopeful"
 *      "&quot;삼성전자, 美 국채금리 상승보다 AI 투자회수 가능성 주목해야&quot;-KB"
 *      원인: news-cascade/route.ts:453 이 RSS <title> 을 정규식으로 뽑고 .trim() 만 한다.
 *   ② 제목이 요약에 그대로 복제 — 모든 뉴스가 같은 문장 두 번
 *      원인: route.ts:617 keywordFallbackCascade 가 summary: title 을 반환.
 *      AI 요약이 garbage 로 판정되면(:772) 제목을 요약으로 쓴다 → 화면에 중복.
 *
 * 엔티티 표는 손으로 만들지 않는다(CLAUDE.md: 하드코딩 화이트리스트 금지).
 * 권위 소스(HTML5 엔티티 표)를 쓰고, 숫자 엔티티는 정의상 완전하다.
 */
const S = await import('./news-sanitize.mjs').catch(() => null);
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };
if (!S?.decodeEntities) { bad('decodeEntities 미구현 — RSS 엔티티가 화면까지 그대로 간다'); console.log('\n결과: 실패 1건'); process.exit(1); }

// ① 실제 노출된 문자열 그대로 재현
S.decodeEntities('speed bump &#x2014; but') === 'speed bump — but'
  ? ok('16진 숫자 엔티티 &#x2014; → —') : bad(`&#x2014; 실패: ${S.decodeEntities('speed bump &#x2014; but')}`);
S.decodeEntities('&quot;삼성전자&quot;-KB') === '"삼성전자"-KB'
  ? ok('&quot; → "') : bad(`&quot; 실패: ${S.decodeEntities('&quot;삼성전자&quot;-KB')}`);
S.decodeEntities('A &amp; B &lt;tag&gt;') === 'A & B <tag>'
  ? ok('&amp; &lt; &gt; 처리') : bad('기본 XML 엔티티 실패');
// 권위 표를 써야만 통과하는 항목 (손으로 만든 부분 매핑이면 빠지기 쉬움)
S.decodeEntities('&mdash;&nbsp;&hellip;&rsquo;') === '— …’'
  ? ok('HTML5 명명 엔티티(&mdash; &nbsp; &hellip; &rsquo;) 처리 — 권위 표 사용') : bad(`명명 엔티티 누락: ${JSON.stringify(S.decodeEntities('&mdash;&nbsp;&hellip;&rsquo;'))}`);
S.decodeEntities('&#8212;&#39;') === "—'" ? ok('10진 숫자 엔티티') : bad('10진 실패');
S.decodeEntities(null) === '' ? ok('null → 빈 문자열') : bad('null 처리 실패');

// ② 요약이 제목과 같으면 중복으로 판정해 비운다
S.dedupeSummary('오픈AI IPO', '오픈AI IPO') === null
  ? ok('요약=제목 → null (화면 중복 제거)') : bad('제목 복제를 그대로 통과');
S.dedupeSummary('오픈AI IPO', '오픈AI가 내년 상장을 검토한다') !== null
  ? ok('다른 요약은 유지') : bad('정상 요약을 지움');
S.dedupeSummary('A &quot;B&quot;', 'A "B"') === null
  ? ok('엔티티 차이만 있는 중복도 잡음') : bad('엔티티 차이 중복 미탐지');

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
