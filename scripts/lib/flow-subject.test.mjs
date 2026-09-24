#!/usr/bin/env node
/**
 * flow-subject.test.mjs — 주체별 실측 방향을 알면, 맞는 문장을 모순이라 하지 않는다. 2026-09-24 신설.
 *
 * 오늘의 오탐(noon 캐치업, verify-report):
 *   입력(regionStances.korea): "외국인 순매도에도 불구하고 …"
 *   실측(kr_smart_flow):       "KR 주요 종목 기관 순매수 5640억원(1d)"
 *   서술: "한국 증시는 기관의 풍부한 매수세를 바탕으로 뚜렷한 상승장을 이끌어내고 있습니다."
 * 서술은 **맞다.** 외국인은 팔고 기관은 샀다. 그런데 검출기는 "순매도" 와 "매수세" 만 보고 걸었다.
 *
 * 2026-09-10 설계는 같은 문장이 "외국인 순매도" 를 **인정할 때만** 다른 주체의 매수를 봐줬다 —
 *   "느슨해지는 쪽 실수가 더 나쁘다" 는 이유로. 그 원칙은 그대로 둔다.
 *   달라진 건 근거다: 이번엔 추측이 아니라 **그 주체의 실측**이 있다. 실측과 맞는 주장은 모순이 아니다.
 */
import { sentenceContradicts, contradictingSentence, measuredSubjectDirs } from './flow-contradiction.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

const TODAY = '요컨대 금리 부담에 눌린 미국과 달리 한국 증시는 기관의 풍부한 매수세를 바탕으로 뚜렷한 상승장을 이끌어내고 있습니다.';

// [1] 오늘의 오탐 — 기관 순매수가 실측이면 "기관 매수세" 는 모순이 아니다
sentenceContradicts(TODAY, 'sell', { 기관: 'buy' }) === false
  ? ok('[1] 기관 순매수 실측 + "기관 매수세" → 모순 아님') : bad('[1] 맞는 문장을 모순이라 했다');

// [2] ★ 실측이 없으면 종전처럼 잡는다 — 근거 없이 느슨해지지 않는다(09-10 원칙)
sentenceContradicts(TODAY, 'sell') === true
  ? ok('[2] 주체 실측이 없으면 종전대로 잡는다') : bad('[2] 근거 없이 풀어 줬다');

// [3] ★ 외국인 주장은 기관 실측으로 봐주지 않는다 — 주체가 다르다
sentenceContradicts('외국인 매수세가 강하게 유입되며 지수를 끌어올렸다.', 'sell', { 기관: 'buy' }) === true
  ? ok('[3] 외국인 매수 주장은 여전히 잡는다') : bad('[3] 외국인 주장을 기관 실측으로 봐줬다');

// [4] 기관 실측이 **반대**면 잡는다 — 기관도 팔았는데 기관 매수라 쓰면 틀린 것이다
sentenceContradicts(TODAY, 'sell', { 기관: 'sell' }) === true
  ? ok('[4] 기관 실측이 순매도면 "기관 매수세" 는 모순') : bad('[4] 반대 실측인데 풀어 줬다');

// [5] 보고서에서 주체별 방향을 읽는다 — 실제 noon 발간본 모양 그대로
{
  const r = {
    regionStances: { korea: { thesis: '외국인 순매도에도 불구하고 환율 효과와 테마 상승세가 겹쳐 …' } },
    flowNarrativeEvidence: { allClaims: [{ id: 'kr_smart_flow', text: 'KR 주요 종목 기관 순매수 5640억원(1d, 수급 상위 종목 합계)' }] },
  };
  const d = measuredSubjectDirs(r);
  d.기관 === 'buy' && d.외국인 === 'sell'
    ? ok(`[5] 주체별 실측: ${JSON.stringify(d)}`) : bad(`[5] ${JSON.stringify(d)}`);
}

// [6] 문장 찾기도 같은 판정을 쓴다 — 검출기와 교정기가 갈라지지 않게
contradictingSentence(TODAY, 'sell', { 기관: 'buy' }) === null
  ? ok('[6] contradictingSentence 도 같은 판정') : bad('[6] 문장 찾기가 따로 논다');

console.log(fail ? `\n  ❌ ${fail}건 실패` : '\n  ✅ 전부 통과');
process.exit(fail ? 1 : 0);
