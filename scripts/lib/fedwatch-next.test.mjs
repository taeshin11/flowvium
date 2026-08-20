#!/usr/bin/env node
/**
 * fedwatch-next.test.mjs — 홈 '최신 업데이트'의 FOMC 카드가 *차기* 회의를 쓰는지 검증.
 *
 * 배경(2026-08-20 UI 눈검증): 오늘이 8월 20일인데 홈에 "FOMC Apr 29 — Hold 97% / Cut 3%" 가 떴다.
 *   Apr 29 는 넉 달 전에 끝난 회의다. 표기 문제가 아니라 내용이 틀렸다.
 *
 *   원인: latest-updates/route.ts 의 getFedWatchItem 이
 *       const next = data.meetings[0];
 *   로 배열 첫 원소를 쓴다. meetings 는 연초부터의 전체 일정이라 [0] 은 과거다.
 *
 *   그런데 fedwatch API 는 이미 nextMeeting 을 내려준다. 심지어 그 파일 316행 주석이
 *     "nextMeeting = 아직 안 열린 *차기* FOMC (meetings[0] 은 Apr 29 등 과거일 수 있음 — 소비처가 …)"
 *   라고 이 실수를 정확히 경고하고 있었다. 경고는 주석에만 있었고 코드로 강제되지 않았다.
 *   (실측 nextMeeting = 2026-09-17 Sep 17 · probHold 93 · probCut25 0)
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const src = readFileSync(resolve(ROOT, 'src/app/api/latest-updates/route.ts'), 'utf8');
// 주석은 검사에서 뺀다 — 이 결함을 설명하는 주석에 'meetings[0]' 이 들어가면서
// 코드가 아니라 산문을 잡아 오탐이 났다(실제로 한 번 겪음).
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
const _i = src.indexOf('async function getFedWatchItem');
const fn  = stripComments(src.slice(_i, _i + 2600));

// ① 배열 첫 원소를 차기 회의로 쓰지 않는다 — 이번 결함의 정확한 재현 방지.
/data\.meetings\[0\]|meetings\[0\]/.test(fn)
  ? bad('meetings[0] 을 차기 회의로 사용 (과거 회의가 노출됨)')
  : ok('meetings[0] 을 차기 회의로 쓰지 않는다');

// ② API 가 이미 계산해 주는 nextMeeting 을 쓴다.
/\bnextMeeting\b/.test(fn)
  ? ok('nextMeeting 을 사용한다')
  : bad('nextMeeting 미사용 — fedwatch API 가 내려주는 권위 값을 무시');

// ③ nextMeeting 이 없는 응답(구버전 캐시)에도 날짜로 거른다 — 폴백이 다시 [0] 이면 의미가 없다.
/\.find\(\s*\(?m\)?\s*=>\s*m\.date\s*>=/.test(fn)
  ? ok('nextMeeting 부재 시 날짜 기준 폴백 존재')
  : bad('날짜 기준 폴백 없음 — 구버전 캐시에서 과거 회의로 되돌아감');

// ④ FedData 타입이 nextMeeting 을 담아야 한다(타입에 없으면 컴파일에서 막힌다).
/interface FedData[^}]*nextMeeting/s.test(src)
  ? ok('FedData 에 nextMeeting 선언')
  : bad('FedData 에 nextMeeting 선언 없음');

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
