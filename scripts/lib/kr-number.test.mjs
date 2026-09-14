#!/usr/bin/env node
/**
 * kr-number.test.mjs — 숫자를 소리용 한글로 바꾸는 규칙.
 *
 * 배경(2026-09-14 사용자 "숏폼보니까 숫자읽을때 이상하게 읽네"):
 *   MeloTTS 한국어 g2p 가 여러 자리 숫자를 못 읽는다. 실측 되들음 —
 *     6800억 → "6% 영억" · 12조 → "1위조" · 270.1% → "2체려 1%" · 2026년 → "2016년"
 *   마지막 것이 제일 나쁘다. 오독이 아니라 **값이 바뀐 것**이다.
 *
 * 고친 뒤 같은 문장을 다시 들어 보니 9개 중 8개가 정확했다(whisper small 기준).
 *   처음엔 whisper base 로 재서 3/7 로 나왔는데, base 가 약해서 생긴 유령이 섞여 있었다 —
 *   판정 도구가 약하면 멀쩡한 것도 결함으로 보인다. 약한 자로 재고 결론 내리지 않는다.
 *
 * 여기서는 **변환 규칙만** 못박는다(순수 함수라 빠르다). 소리 확인은 위 실측으로 갈음한다.
 */
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const { speakNumbers, readInteger } = await import('./kr-number.mjs');

const eq = (label, got, want) => (got === want ? ok(`${label}: ${want}`) : bad(`${label}: ${got} (기대 ${want})`));

// [1] 자릿수
eq('0', readInteger(0), '영');
eq('10', readInteger(10), '십');           // 일십이 아니다
eq('1167', readInteger(1167), '천백륙십칠');
eq('6800', readInteger(6800), '육천팔백');
eq('20260', readInteger(20260), '이만이백륙십');

// [2] 받침 뒤의 육은 륙으로 — 소리 때문이다(실측: 이십육→"20View", 이십륙→"26")
readInteger(26) === '이십륙' && readInteger(16) === '십륙' && readInteger(6) === '육'
  ? ok('받침 뒤 육 → 륙, 첫머리 육은 그대로')
  : bad(`육/륙 처리: 26=${readInteger(26)} 16=${readInteger(16)} 6=${readInteger(6)}`);

// [3] 문장 안에서
eq('큰 단위', speakNumbers('6800억 원 규모'), '육천팔백억 원 규모');
eq('조 단위', speakNumbers('12조 원을'), '십이조 원을');
eq('복합', speakNumbers('4억 3520만 유로'), '사억 삼천오백이십만 유로');
eq('소수·퍼센트', speakNumbers('270.1% 늘었다'), '이백칠십 점 일 퍼센트 늘었다');
eq('쉼표', speakNumbers('1,167건 적발'), '천백륙십칠 건 적발');
eq('연도', speakNumbers('2026년 9월'), '이천이십륙 년 구 월');

// [4] 수에 붙은 단위는 띄우고, 수의 일부인 단위는 붙인다
speakNumbers('천무 18문과') === '천무 십팔 문과'
  ? ok('세는 단위는 띄운다 (붙이면 [천무시팔문] 으로 뭉갠다)')
  : bad(`단위 띄우기: ${speakNumbers('천무 18문과')}`);
!/십이 조|육천팔백 억|이십 만/.test(speakNumbers('12조 6800억 3520만'))
  ? ok('수의 일부인 단위는 붙여 둔다 (띄우면 따로 읽는다)')
  : bad(`수 단위를 띄웠다: ${speakNumbers('12조 6800억 3520만')}`);

// [5] 숫자가 아닌 것은 건드리지 않는다
[['K2 전차', 'K2 전차'], ['flowvium.net', 'flowvium.net'], ['G7 정상회의', 'G7 정상회의']]
  .every(([i, o]) => speakNumbers(i) === o)
  ? ok('영문에 붙은 숫자·도메인은 그대로 (이름이지 수가 아니다)')
  : bad(`이름을 건드린다: ${['K2 전차', 'flowvium.net', 'G7 정상회의'].map(speakNumbers).join(' | ')}`);

// [6] 이미 있던 글자의 띄어쓰기를 흔들지 않는다 — 한 번 그래서 '천무'가 '천 무'로 쪼개졌다
speakNumbers('천무 미사일과 한화에어로스페이스') === '천무 미사일과 한화에어로스페이스'
  ? ok('숫자가 없으면 문장을 그대로 둔다')
  : bad(`숫자 없는 문장을 바꿨다: ${speakNumbers('천무 미사일과 한화에어로스페이스')}`);

console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
