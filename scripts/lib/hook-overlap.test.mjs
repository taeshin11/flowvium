// hook-overlap.test.mjs — 첫 화면 훅이 제목을 되풀이하나(10/28 세 심판 모두 지적: "훅이 제목을 그대로 되풀이해 더하는 게 없다").
//   Mac mini2(사장님 썸네일 기준): 첫 화면 훅은 제목이 말하지 않는 것을 더해야 한다. node scripts/lib/hook-overlap.test.mjs
import assert from 'node:assert/strict';
import { hookOverlap, repeatsTitle } from './hook-overlap.mjs';
import { headlineSubject, namesSubject } from './hook-overlap.mjs';

// [1] 실제로 떨어진 훅들(10/28 첫 화면 점수 5.5~6.5)
assert.ok(repeatsTitle('PER 낮으면 싼 주식일까', 'PER 낮으면 싼 주식? 꼭 그렇지 않은 이유'));
assert.ok(repeatsTitle('금리 내리면 왜 주가가 뛸까', '금리를 내리면 주가가 오르는 이유'));
assert.ok(repeatsTitle('추미애 제안 지방세제 구조개편', "추미애가 제안한 지방세제 개편을 국회에서 논의하기로 한 이유"));
// [2] 제목에 없는 것을 더한 훅은 통과
assert.ok(!repeatsTitle('싸 보여도 함정일 수 있다', 'PER 낮으면 싼 주식? 꼭 그렇지 않은 이유'));
assert.ok(!repeatsTitle('예금 이자가 줄면 생기는 일', '금리를 내리면 주가가 오르는 이유'));
assert.ok(!repeatsTitle('피자를 더 잘게 잘랐을 뿐', '액면분할 하면 주가가 싸지는 걸까'));
// [3] 한 낱말 겹침(주제어 하나)은 괜찮다 — 주제는 같아야 한다
assert.ok(!repeatsTitle('공포 뒤에 숨은 함정', '공포탐욕지수, 공포일 때 사면 될까'));
// [4] 비율은 0~1, 빈 글은 0
assert.equal(hookOverlap('', '제목'), 0);
assert.ok(hookOverlap('PER 낮으면 싼 주식일까', 'PER 낮으면 싼 주식?') > 0.6);
// [5] 첫 대사(10/28 Mac mini2: 첫 자막=첫 대사도 제목을 되풀이하면 안 된다) — 제목 낱말의 절반 이상을 다시 말하면 되풀이
import('./hook-overlap.mjs').then(({ restatesTitle }) => {
  assert.ok(restatesTitle('PER이 낮으면 무조건 싼 주식일까요?', 'PER 낮으면 싼 주식? 꼭 그렇지 않은 이유'), '영문+조사 한 덩어리(PER이)도 PER 로 센다');
  assert.ok(restatesTitle('중앙은행이 금리를 내리면 왜 주가가 오를까요?', '금리를 내리면 주가가 오르는 이유'));
  assert.ok(!restatesTitle('이익에 비해 주가가 싸 보이는 회사, 다 같은 할인은 아닙니다.', 'PER 낮으면 싼 주식? 꼭 그렇지 않은 이유'));
  assert.ok(!restatesTitle('예금 이자가 줄어들면, 그 돈은 어디로 갈까요?', '금리를 내리면 주가가 오르는 이유'));
});
// [6] 심판이 낸 훅은 화면 뉴스에서 나와야 한다(10/28 20:57 "타지 철길 위 참변" — 성평등장관 편에 다른 뉴스 훅이 올랐다)
import('./hook-overlap.mjs').then(({ sharesStory }) => {
  const minister = '성평등장관 "폭력 피해자 끝까지 보호…경찰과 공동대응" 원민경 성평등가족부 장관은 28일 "폭력 피해자를 끝까지 보호하겠다"라고 말했다.';
  assert.ok(!sharesStory('타지 철길 위 참변', minister), '다른 뉴스 훅');
  assert.ok(!sharesStory('비극 부른 사고의 전말', minister), '다른 뉴스 훅');
  assert.ok(sharesStory('피해자 끝까지 보호', minister));
  assert.ok(sharesStory('골프 의혹 제기 후폭풍', '김여사 골프 의혹 제기한 주진우가 결국 고발당한 이유'), '뉴스 낱말 하나에 새 말을 붙이는 건 된다');
  assert.ok(!sharesStory('', minister));
  // [9] 11/02 벤치마크(경제 쇼츠 상위 10편 첫 화면): 위쪽 큰 글이 늘 주어(회사·인물·자산)로 시작한다 — "삼전, 영업익 107조".
  //   우리는 "16년 / 만의 최악 부진" 처럼 누구 얘기인지 빠졌다. 자문 agy·Claude 둘 다 1~2순위(2/3). 첫 훅은 헤드라인의 주어를 담는다.
  assert.equal(headlineSubject('현대차, 16년 만에 최악의 부진…GV80 하이브리드'), '현대차');
  assert.equal(headlineSubject("'김건희 로저비비에' 1심서 김기현 무죄·부인 벌금 500만원"), '김건희');
  assert.equal(headlineSubject('[속보] 한미일 외교장관 "北 완전한 비핵화"'), '한미일');
  assert.equal(headlineSubject("국민의힘이 1년 만에 대규모 장외집회"), '국민의힘', '붙은 조사(이·가·은·는)는 뗀다');
  assert.equal(headlineSubject('SK하이닉스 대박 실적...100조원대 주주환원 온다'), 'SK하이닉스');
  assert.equal(headlineSubject('野 "올공 투표지 전체 증거보전해야"'), null, '한 글자 약칭은 주어로 못 쓴다 — 판정 안 함');
  assert.ok(!namesSubject('16년 만의 최악 부진', '현대차, 16년 만에 최악의 부진'), '실제 우리 상위 2위 첫 화면 — 누구 얘기인지 없다');
  assert.ok(namesSubject('현대차 16년 만의 부진', '현대차, 16년 만에 최악의 부진'));
  assert.ok(namesSubject('SK하닉 영업익 83조', 'SK하이닉스 대박 실적...100조원대 주주환원 온다'), '줄임말도 같은 주어');
  assert.ok(namesSubject('발사대 향한 누리호', '누리호, 역대 최다 15기 싣고 우주로'));
  assert.ok(namesSubject('투표지 전부 보전?', '野 "올공 투표지 전체 증거보전해야"'), '주어를 못 뽑으면 막지 않는다');
  console.log('hook-overlap.test: ✅ 전부 통과');
});
