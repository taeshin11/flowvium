#!/usr/bin/env node
/**
 * blog-html.test.mjs — 블로그 글(마크다운)을 Blogger 가 받는 HTML 로 바꿀 때
 *   **내용이 사라지거나 태그가 깨지지 않는가**.
 *
 * 2026-09-18 신설. 외부 마크다운 라이브러리를 넣지 않는 이유: 이 변환기가 다룰 입력은
 *   make-blog-post.mjs 가 내는 것 하나뿐이다. 범용 파서를 끌어오면 그 파서의 버릇까지
 *   같이 들어온다. 대신 **내가 실제로 내보내는 문법만** 다루고, 그 목록을 여기에 고정한다.
 */
import { mdToHtml, stripFrontComment, extractTitle } from './blog-html.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const has = (h, needle, m) => (h.includes(needle) ? ok(m) : bad(`${m} — 없음: ${needle}\n        받은 것: ${h.slice(0, 200)}`));

// [1] 제목 주석과 h1 은 본문에서 빠진다 — 제목은 API 필드로 따로 간다
const src = `<!-- 제목 후보\n1. 가\n2. 나\n-->\n\n# 진짜 제목\n\n첫 문단입니다.`;
extractTitle(src) === '진짜 제목' ? ok('[1] h1 에서 제목을 꺼낸다') : bad(`[1] ${extractTitle(src)}`);
const body1 = mdToHtml(stripFrontComment(src));
!body1.includes('제목 후보') && !body1.includes('<h1') ? ok('[1b] 제목 주석과 h1 은 본문에 안 남는다') : bad(`[1b] ${body1.slice(0, 120)}`);
has(body1, '<p>첫 문단입니다.</p>', '[1c] 문단은 p 로 감싼다');

// [2] 제목 단계
has(mdToHtml('## 큰 제목'), '<h2>큰 제목</h2>', '[2] ## → h2');
has(mdToHtml('### 종목'), '<h3>종목</h3>', '[2b] ### → h3');

// [3] 굵게
has(mdToHtml('오늘 판단은 **관망** 입니다.'), '<b>관망</b>', '[3] ** ** → b');

// [4] 표 — 헤더와 정렬줄을 구분하고 셀을 잃지 않는다
const table = mdToHtml('| 지수 | 종가 |\n| --- | ---: |\n| 코스피 | 6,715.41 |');
has(table, '<table', '[4] 표를 만든다');
has(table, '<th>지수</th>', '[4b] 헤더 셀');
has(table, '<td>6,715.41</td>', '[4c] 값 셀');
!table.includes('---') ? ok('[4d] 정렬줄이 본문에 남지 않는다') : bad('[4d] --- 가 남았다');

// [5] 목록
const list = mdToHtml('- 첫째\n- 둘째');
has(list, '<ul>', '[5] 목록을 만든다');
has(list, '<li>첫째</li>', '[5b] 항목');

// [6] 인용(투자 고지)
has(mdToHtml('> 매매 권유가 아닙니다.'), '<blockquote>', '[6] > → blockquote');

// [7] 링크 — 맨 URL 도 누를 수 있게 만든다
has(mdToHtml('채널: https://www.youtube.com/channel/UC123'), 'href="https://www.youtube.com/channel/UC123"', '[7] 맨 URL 을 a 로 만든다');
const bolded = mdToHtml('👉 **https://flowvium.net**');
has(bolded, 'href="https://flowvium.net"', '[7b] 굵은 URL 도 링크가 된다');
(bolded.match(/<a /g) ?? []).length === 1 ? ok('[7c] 링크를 두 번 감싸지 않는다') : bad(`[7c] a 태그 ${(bolded.match(/<a /g) ?? []).length}개`);

// [8] HTML 특수문자를 깨뜨리지 않는다 — S&P500 의 & 가 살아 있어야 한다
const amp = mdToHtml('| S&P500 | 7,637.76 |');
has(amp, 'S&amp;P500', '[8] & 를 이스케이프한다');
!/<script/i.test(mdToHtml('<script>alert(1)</script>')) ? ok('[8b] 원시 태그를 그대로 넘기지 않는다') : bad('[8b] script 가 살아서 나갔다');

// [9] 구분선과 빈 줄로 문단이 뭉개지지 않는다
const multi = mdToHtml('첫 문단.\n\n둘째 문단.\n\n---\n\n셋째 문단.');
(multi.match(/<p>/g) ?? []).length === 3 ? ok('[9] 문단 3개를 유지한다') : bad(`[9] p 태그 ${(multi.match(/<p>/g) ?? []).length}개`);
has(multi, '<hr', '[9b] --- 는 구분선이 된다');

console.log(fail ? `\n❌ ${fail} 실패` : '\n✅ blog-html 통과');
process.exit(fail ? 1 : 0);
