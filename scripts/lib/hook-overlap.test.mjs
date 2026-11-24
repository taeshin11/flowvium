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
import('./hook-overlap.mjs').then(async ({ sharesStory }) => {
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
  // 11/02 14:10 실제 회차: 헤드라인 첫 낱말이 꾸밈말(국빈방한)이라 주어를 잘못 뽑아 "에르도안 가자지구 제안" 을 주어 없음으로 두 번 다시 썼다.
  //   이슈 키워드(이 회차가 모은 이야기의 주인공)가 헤드라인에 있으면 그게 주어다.
  assert.ok(namesSubject('에르도안 가자지구 제안', '[일문일답] 국빈방한 에르도안 "가자지구 재건에 韓과 공동사업 가능"', '에르도안'), '이슈 키워드가 주어');
  assert.ok(!namesSubject('가자지구 재건 공동사업', '[일문일답] 국빈방한 에르도안 "가자지구 재건에 韓과 공동사업 가능"', '에르도안'), '주인공 없는 훅은 여전히 다시 쓴다');
  assert.ok(!namesSubject('16년 만의 최악 부진', '현대차, 16년 만에 최악의 부진', '연합뉴스'), '헤드라인에 없는 키워드는 무시하고 첫 낱말로');
  assert.ok(namesSubject('투표지 전부 보전?', '野 "올공 투표지 전체 증거보전해야"'), '주어를 못 뽑으면 막지 않는다');
  // [10] 11/21 실측(11/19~20 16편): '첫 훅에 주어 없음' 9편 중 6편이 잣대 탓이었다 — 모델은 알 수 없는 기준으로 떨어졌다.
  //   ① 이슈 키워드가 숫자·분량("1조달러"·"120억달러"·"90만개")이어도 주어로 썼다 → 숫자 든 키워드는 주어가 아니다.
  //   ② 키워드가 화제어("금융상품"·"부정행위")면 헤드라인 첫 낱말(진짜 주어)을 안 봤다 → 둘 중 하나만 담으면 된다.
  //   ③ 신문 한자 약칭(李대통령·韓총리·美 상무부·美 "…")에서 주어를 못 뽑았다.
  assert.equal(headlineSubject('李대통령 "수능 부정행위 철저히 차단…적발된 불법행위 무관용"'), '대통령', '붙은 한자 약칭은 뒤 낱말');
  assert.equal(headlineSubject('[속보] 韓총리 "수능 와이파이·블루투스 신호 분석해 의심사례 수사"'), '총리');
  assert.equal(headlineSubject('美 상무부, 中 AI칩 수출 90만개 승인…中 군사 지원 기업도 포함'), '상무부', '띄어 쓴 나라 약칭 뒤 기관');
  assert.equal(headlineSubject('美 "이란, 핵심인프라 사이버 공격…최근 전산장애와는 무관"'), '미국', '약칭 뒤가 따옴표면 그 나라');
  assert.equal(headlineSubject('靑, 한한령 해빙 기대감에 "진전 있다…공연도 가능성 열려"'), '청와대');
  assert.ok(namesSubject('대한민국 수출 1조 달성', "수출 60% 늘었다…반도체 3배·8개 품목 신기록 쓴 '1조달러'", '1조달러'), '숫자 키워드는 주어가 아니다');
  assert.ok(namesSubject('K푸드+ 수출 역대최대', "K푸드+ 수출 120억달러↑ '역대 최대'…라면·포도가 성장 견인", '120억달러'));
  assert.ok(namesSubject('미래에셋 근거까지 제시', "미래에셋증권, 아마존웹서비스 AI 기반 '금융상품 지식 검색' 운영", '금융상품'), '키워드든 첫 낱말이든 하나면 된다');
  assert.ok(namesSubject('미 상무부 제재선 균열', '美 상무부, 中 AI칩 수출 90만개 승인…中 군사 지원 기업도 포함', '90만개'));
  assert.ok(namesSubject('미국 전산장애 배후', '美 "이란, 핵심인프라 사이버 공격…최근 전산장애와는 무관"', '사이버'));
  // 진짜로 누구 얘기인지 빠진 훅은 여전히 다시 쓴다
  assert.ok(!namesSubject('엔터 관련주 강세', '靑, 한한령 해빙 기대감에 "진전 있다…공연도 가능성 열려"', '한한령'));
  assert.ok(!namesSubject('계엄 표결방해 무죄', '국힘, 추경호 1심 무죄에 "이제 내란몰이 끝나 …특검고발 검토"(종합2보)', '추경호'));
  // [11] 생성 쪽: 모델에게 이번 회차 주어와 피할 제목 낱말을 구체적으로 준다(잣대와 같은 함수) — 그 계획대로 쓴 훅은 두 검사를 다 통과한다.
  const { firstHookPlan } = await import('./hook-overlap.mjs');
  const H = 'KB증권, 지역관광 AI 펀드에 20억원 출자';
  const plan = firstHookPlan(H, 'kb증권');
  assert.deepEqual(plan.subjects, ['KB증권']);
  assert.ok(plan.avoid.includes('출자') && plan.avoid.includes('펀드') && !plan.avoid.includes('KB증권'), JSON.stringify(plan));
  assert.ok(repeatsTitle('KB증권 20억원 출자', H), '실제 11/20 첫 훅 — 제목 되풀이');
  assert.ok(!repeatsTitle('KB증권 관광 살리기 베팅', H) && namesSubject('KB증권 관광 살리기 베팅', H, 'kb증권'), '주어 + 제목에 없는 말');
  const p2 = firstHookPlan("수출 60% 늘었다…반도체 3배·8개 품목 신기록 쓴 '1조달러'", '1조달러');
  assert.deepEqual(p2.subjects, ['수출'], '숫자 키워드는 주어 후보에서 뺀다');
  assert.deepEqual(firstHookPlan('野 "올공 투표지 전체 증거보전해야"', '').subjects, [], '주어를 못 뽑으면 빈 목록(규칙을 안 붙인다)');
  // [12] 2026-11-24 리포트2(3곳 합의): 첫 훅의 나머지는 시청자 돈·생활에 닿는 영향 — 기사에 있을 때만.
  //   대본 프롬프트 두 갈래(브리핑·한 뉴스)가 같은 규칙을 쓰는지 본다. 한쪽만 바꾸면 다른 쪽 편은 그대로 나간다.
  const { STAKE_HOOK_RULE } = await import('./hook-overlap.mjs');
  assert.ok(typeof STAKE_HOOK_RULE === 'string' && /기사에/.test(STAKE_HOOK_RULE) && /지어내/.test(STAKE_HOOK_RULE), '규칙 문구: 기사 근거·지어내기 금지');
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../video/make-shorts.mjs', import.meta.url), 'utf8');
  const hookLines = src.split('\n').filter((l) => /^- hook: 화면/.test(l));
  assert.equal(hookLines.length, 2, '훅 규칙 줄은 두 갈래');
  assert.ok(hookLines.every((l) => l.includes('${STAKE_RULE}')), '두 갈래 모두 STAKE_RULE');
  console.log('hook-overlap.test: ✅ 전부 통과');
});
