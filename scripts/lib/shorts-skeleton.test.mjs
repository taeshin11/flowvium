#!/usr/bin/env node
/**
 * shorts-skeleton.test.mjs — 쇼츠 대본 '뼈대'와 첫 3초·저장 요소·구독 권유. (2026-11-18 신설)
 *
 * 사장님 11/18 14:3x(Mac mini2 경유, 전 채널 5원칙):
 *   1) 첫 3초 자막 15자 이내, 결론·위기·반전 중 하나로 바로 연다.
 *   2) 대본은 같은 분야 50만+ 영상의 뼈대(구성 순서·길이·전환 시점)로 짠다. 내용·문장·장면 복제 금지. 출처 URL 을 작업 파일에.
 *   3) 첫 3초에 컷 2~3번 이상, 자막은 한 줄씩 짧게.
 *   4) '저장할 이유' — 다시 볼 숫자·체크리스트·단계.
 *   AI 감지 방지: 틀 3~4개를 돌려 쓰고 같은 틀을 연속 3편 넘게 쓰지 않는다.
 * 11/17 3-AI 교차검증(consult-1117) 채택안과 합쳤다:
 *   A 첫 훅 = 시청자 쪽 말 → 사장님 1)이 더 구체적이라 '결론·위기·반전' 으로 바꿔 씀(질문형은 안 씀).
 *   B 1~3초 핵심 숫자 카드 → 3)의 컷 하나로(shorts-layout openingCuts).
 *   C 구독 권유를 고정 문장 대신 편마다 그 사안의 후속 약속으로 → subCtaLine.
 * 뼈대 출처(11/18 Data API · 자동 자막 시점 실측, 최근 120일 경제·증시 쇼츠 50만+ 11편 중 구성이 다른 넷):
 *   flip   Kvvrc6nzbdc 증시각도기TV 704,361회 65초 "금리가 낮으면 경기가 살아날까?" 0~13 통념 뒤집기+반대 사실 · 13~25 진짜 이유 · 25~45 큰 그림 숫자 · 45~64 결론
 *   crisis adnS05irnDw 증시각도기TV 726,438회 86초 "코스피 하방 어디까지" 0~20 위기+짧은 답·무너진 것 · 20~45 최악/버팀 시나리오 숫자 · 45~55 지금 할 일 · 55~86 근본 원인
 *   vs     g1sZdE5hmRA 한국경제TV 773,254회 44초 "삼성전자 VS 하이닉스" 0~10 결론 먼저+주장 · 10~28 양쪽 숫자 비교 · 28~40 핵심 · 40~44 한 줄
 *   twist  zOt7Z_v8AXE 슈카월드 508,788회 71초 "적금 깨고 주식 사도 되나요?" 0~14 놀라운 사실+숫자 · 14~33 내 일로 바꾼 질문 · 33~55 답·반전 · 55~71 처음으로 돌아가 정리
 */
import { SKELETONS, pickSkeleton, skeletonRule, firstCaptionOk, saveItemOk, subCtaLine } from './shorts-skeleton.mjs';

let fail = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => { console.log(`  ❌ ${m}`); fail++; };

// [1] 뼈대 3~4개, 모두 50만+ 출처 URL, 첫 문장 갈래는 결론·위기·반전 중 하나, 장면 넷의 비중 합 1
{
  const okAll = SKELETONS.length >= 3 && SKELETONS.length <= 4 && SKELETONS.every((s) =>
    /^https:\/\/www\.youtube\.com\/shorts\/[\w-]{11}$/.test(s.src) && s.srcViews >= 500000
    && ['결론', '위기', '반전'].includes(s.open) && s.beats.length === 4
    && Math.abs(s.beats.reduce((n, b) => n + b.share, 0) - 1) < 0.011);
  okAll ? ok(`[1] 뼈대 ${SKELETONS.length}개 — 출처 50만+ · 첫 문장 결론/위기/반전 · 장면 4`) : bad('[1] 뼈대 정의');
  new Set(SKELETONS.map((s) => s.id)).size === SKELETONS.length ? ok('[1b] id 가 서로 다르다') : bad('[1b] id 중복');
}

// [2] 같은 틀 연속 금지 — 직전과 다르다(사장님 기준 '연속 3편 초과 금지' 보다 엄격). 시드가 달라지면 고루 돈다.
{
  let prev = null, same = 0; const seen = new Map();
  for (let n = 0; n < 400; n++) {
    const s = pickSkeleton(n, prev ? [prev] : []);
    if (s.id === prev) same++;
    seen.set(s.id, (seen.get(s.id) ?? 0) + 1); prev = s.id;
  }
  same === 0 ? ok('[2] 400편 내내 직전과 같은 뼈대 0') : bad(`[2] 직전과 같은 뼈대 ${same}번`);
  const min = Math.min(...SKELETONS.map((s) => seen.get(s.id) ?? 0));
  min >= 60 ? ok(`[2b] 넷 다 고루 쓰인다(최소 ${min}/400)`) : bad(`[2b] 치우침 ${JSON.stringify([...seen])}`);
  pickSkeleton(7, ['nope']).id ? ok('[2c] 모르는 이력이 와도 고른다') : bad('[2c]');
}

// [3] 프롬프트 규칙: 장면별 역할과 글자 수(합 ≈ 예산), 첫 문장 갈래·15자, 저장 요소, 복제 금지. 출처 URL·채널 이름은 넣지 않는다(내용을 끌고 오지 않게).
{
  const sk = SKELETONS[0];
  const r = skeletonRule(sk, 200);
  const nums = [...r.matchAll(/(\d+)자 안팎/g)].map((m) => Number(m[1]));
  const sum = nums.reduce((a, b) => a + b, 0);
  (nums.length === 4 && Math.abs(sum - 200) <= 8) ? ok(`[3] 장면 4개 글자 수 합 ${sum}(예산 200)`) : bad(`[3] 글자 수 ${JSON.stringify(nums)}`);
  (r.includes(sk.open) && /15자/.test(r)) ? ok('[3b] 첫 문장 갈래·15자 규칙이 들어 있다') : bad('[3b]');
  (/저장/.test(r) && /숫자/.test(r)) ? ok('[3c] 마지막 장면 저장 요소 규칙') : bad('[3c]');
  (!r.includes(sk.src) && !/youtube|슈카|각도기|한국경제/.test(r)) ? ok('[3d] 출처 URL·채널 이름은 프롬프트에 없다(복제 방지)') : bad('[3d] 출처가 프롬프트에 샜다');
  /베끼|복제|그대로 쓰지/.test(r) ? ok('[3e] 내용·문장 복제 금지 문구') : bad('[3e]');
  // 짧은 장면도 저장 요소를 담을 만큼은 준다 — 바닥 15%
  const vs = SKELETONS.find((s) => s.id === 'vs');
  const vn = [...skeletonRule(vs, 200).matchAll(/(\d+)자 안팎/g)].map((m) => Number(m[1]));
  Math.min(...vn) >= 28 ? ok(`[3f] 가장 짧은 장면도 ${Math.min(...vn)}자(바닥 15%)`) : bad(`[3f] ${JSON.stringify(vn)}`);
}

// [4] 첫 3초 자막 15자 이내(띄어쓰기 빼고)
firstCaptionOk('코스피 5000 붕괴') && !firstCaptionOk('국민의힘 윤리위원회가 한동훈 전 대표의 징계를') ? ok('[4] 첫 자막 15자 판정') : bad('[4]');

// [5] 저장 요소 — 다시 볼 숫자가 둘 이상
(saveItemOk('기억할 숫자는 703억달러, 그리고 202%입니다.') && !saveItemOk('앞으로가 주목됩니다.') && !saveItemOk('수출이 202% 늘었습니다.'))
  ? ok('[5] 저장 요소 = 숫자 둘 이상') : bad('[5]');
// [5b] 날짜·차례는 '다시 볼 숫자' 가 아니다 — 11/18 15:10 발행분(bUeDZRSsBh8)이 "기억할 숫자는 17일과 55명" 으로 통과했다
(!saveItemOk('기억할 숫자는 17일과 55명입니다.') && !saveItemOk('2026년 11월 3차 회의') && saveItemOk('기억할 숫자는 55명과 3조 원입니다.'))
  ? ok('[5b] 날짜·차례 숫자는 세지 않는다') : bad('[5b] 날짜를 저장 숫자로 셌다');

// [6] 구독 권유: 편마다 그 사안 이름이 들어가고, 링크·주소 없음, 연속 두 편이 같은 문장이 아니다
{
  const a = subCtaLine('ICT 수출', 1), b = subCtaLine('ICT 수출', 2);
  (a.includes('ICT 수출') && !/https?:|\.net|\.com|링크/.test(a) && a !== b && /구독/.test(a))
    ? ok(`[6] 구독 권유 "${a}" / "${b}"`) : bad(`[6] ${a} / ${b}`);
  subCtaLine('', 3).length > 5 && !/undefined|null/.test(subCtaLine(null, 3)) ? ok('[6b] 사안 이름이 없어도 문장이 된다') : bad('[6b]');
}

console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
