#!/usr/bin/env node
/**
 * dart-parse.test.mjs — DART corpCode XML 파싱.
 *
 * 배경(2026-08-20): data/dart-corp-codes.json 에 &amp; 가 섞여 UI 에 "S&amp;T중공업" 으로 노출됐다.
 *   그때 나는 *데이터 파일*을 디코드해서 고쳤다 — 생산자는 그대로였다. 즉 증상 처치였고,
 *   fetch-dart-corp-codes 를 한 번만 다시 돌리면 그대로 되살아나는 상태였다.
 *   (그 잡은 별개 결함으로 537시간 멈춰 있어 재발이 안 드러났을 뿐이다.)
 *   생산 지점에서 디코드하도록 파서를 분리해 테스트로 고정한다.
 */
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

let P;
try { P = await import('./dart-parse.mjs'); }
catch (e) { console.log(`  FAIL  모듈 없음: ${e.message}`); process.exit(1); }

const xml = `<result>
<list><corp_code>00126380</corp_code><corp_name>삼성전자</corp_name><stock_code>005930</stock_code></list>
<list><corp_code>00164742</corp_code><corp_name>S&amp;T중공업</corp_name><stock_code>003570</stock_code></list>
<list><corp_code>00999999</corp_code><corp_name>&lt;주&gt;테스트&#38;컴퍼니</corp_name><stock_code>123456</stock_code></list>
<list><corp_code>00111111</corp_code><corp_name>비상장기업</corp_name><stock_code> </stock_code></list>
<list><corp_code>00222222</corp_code><corp_name>짧은코드</corp_name><stock_code>12345</stock_code></list>
</result>`;

const r = P.parseCorpXml(xml);
r.listed === 3 ? ok(`상장사 3건만 채택 (전체 ${r.total})`) : bad(`상장사 ${r.listed}건 (3 이어야)`);
r.map['005930']?.corpName === '삼성전자' ? ok('평문 이름 보존') : bad(`평문 깨짐: ${r.map['005930']?.corpName}`);
r.map['003570']?.corpName === 'S&T중공업'
  ? ok('명명 엔티티 디코드: S&amp;T중공업 → S&T중공업') : bad(`&amp; 미디코드: ${r.map['003570']?.corpName}`);
r.map['123456']?.corpName === '<주>테스트&컴퍼니'
  ? ok('꺾쇠·수치 엔티티 디코드: &lt;/&gt;/&#38;') : bad(`엔티티 잔존: ${r.map['123456']?.corpName}`);
!r.map['12345'] && !r.map[' '] ? ok('6자리 아닌 stock_code 제외') : bad('비상장/비정상 코드가 들어감');

// 이중 디코딩 금지 — "&amp;amp;" 는 "&amp;" 가 되어야지 "&" 가 되면 안 된다(원문 손실)
const x2 = `<result><list><corp_code>1</corp_code><corp_name>A&amp;amp;B</corp_name><stock_code>999999</stock_code></list></result>`;
P.parseCorpXml(x2).map['999999'].corpName === 'A&amp;B'
  ? ok('이중 디코딩 안 함 (&amp;amp; → &amp;)') : bad(`이중 디코딩됨: ${P.parseCorpXml(x2).map['999999'].corpName}`);

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
