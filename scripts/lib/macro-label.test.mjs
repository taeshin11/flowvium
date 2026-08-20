#!/usr/bin/env node
/**
 * macro-label.test.mjs — 거시지표 카드 라벨의 로케일 처리.
 *
 * 배경(2026-08-20 홈 눈검증): 한국어 화면에 "hawkish (prev 224K/wk)" 가 영문으로 나왔다.
 *   추적하니 src/app/api/latest-updates/route.ts 에 뒤집힌 폴백이 두 군데 있었다:
 *       `${ind.name ?? ind.nameKo}`              (223행)
 *       `${ind.rateImpact ?? ind.rateImpactKo}`  (224행)
 *   ?? 는 앞이 null/undefined 일 때만 넘어가는데 영문 필드는 항상 값이 있다.
 *   즉 한국어 필드가 이미 API 에 있는데도 영원히 쓰이지 않았다.
 *   "(prev …)" · "↑beat" · "↓miss" 도 하드코딩 영문이었다.
 *
 *   rateImpact 는 자유 문장이 아니라 닫힌 enum(hawkish/dovish/neutral)이다.
 *   enum 을 LLM 런타임 번역에 태우는 건 애초에 틀렸다 — 매핑으로 처리해야 값이 흔들리지 않는다.
 *   (실측: 4B 는 "hawkish"를 "호각적"으로 오역했고, 한국어라서 게이트도 통과했다.)
 */
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

let M;
try { M = await import('./macro-label.mjs'); }
catch (e) { console.log(`  FAIL  모듈 없음: ${e.message}`); process.exit(1); }

const ind = { name: 'Initial Claims', nameKo: '신규 실업수당 청구', actual: 222, previous: 224,
              unit: 'K/wk', surprise: 'beat', rateImpact: 'hawkish', rateImpactKo: '매파적' };

// [1] 한국어 — 이미 있는 Ko 필드를 써야 한다
const ko = M.buildMacroLabels(ind, 'ko');
ko.headline.includes('신규 실업수당 청구') ? ok(`ko headline: ${ko.headline}`) : bad(`ko headline 영문: ${ko.headline}`);
ko.sub.includes('매파적') ? ok(`ko sub: ${ko.sub}`) : bad(`ko sub 영문: ${ko.sub}`);
!/hawkish/i.test(ko.sub) ? ok('ko 에 영문 enum 잔존 없음') : bad('hawkish 가 그대로 남음');
!/\bprev\b/.test(ko.sub) ? ok('ko 에 "prev" 하드코딩 없음') : bad(`"prev" 잔존: ${ko.sub}`);
!/beat|miss/.test(ko.headline) ? ok('ko 에 beat/miss 영문 없음') : bad(`beat/miss 잔존: ${ko.headline}`);
ko.sub.includes('224') && ko.sub.includes('K/wk') ? ok('수치·단위 보존') : bad(`수치 손실: ${ko.sub}`);

// [2] 영어 — 종전 동작 유지 (회귀 금지)
const en = M.buildMacroLabels(ind, 'en');
en.headline.includes('Initial Claims') ? ok('en headline 유지') : bad(`en headline: ${en.headline}`);
/hawkish/.test(en.sub) && /prev/.test(en.sub) ? ok(`en sub 유지: ${en.sub}`) : bad(`en sub: ${en.sub}`);

// [3] enum 은 매핑이지 번역이 아니다 — 알려진 값 전부 대응
for (const v of ['hawkish', 'dovish', 'neutral']) {
  const r = M.buildMacroLabels({ ...ind, rateImpact: v, rateImpactKo: null }, 'ko');
  !new RegExp(v, 'i').test(r.sub) ? ok(`enum ${v} → 한국어 매핑 (Ko 필드 없어도)`) : bad(`enum ${v} 영문 잔존: ${r.sub}`);
}
// 모르는 enum 은 창작하지 말고 원값 유지 — 조용히 틀린 한국어를 만들지 않는다
const unk = M.buildMacroLabels({ ...ind, rateImpact: 'sideways', rateImpactKo: null }, 'ko');
unk.sub.includes('sideways') ? ok('미지 enum 은 원값 유지 (창작 금지)') : bad(`미지 값을 창작함: ${unk.sub}`);

// [3b] *Ko 필드라고 항상 한국어인 건 아니다 — 실측: macro-indicators 의 rateImpactKo 13종이
//      전부 영문이었다("hawkish (tightening pressure)"). 필드명을 믿고 그대로 쓰면 영문이 그대로 나간다.
const lying = M.buildMacroLabels({ ...ind, rateImpactKo: 'hawkish (tightening pressure)' }, 'ko');
!/hawkish/i.test(lying.sub) ? ok(`거짓 Ko 필드 무시하고 매핑 사용: ${lying.sub}`) : bad(`영문 Ko 필드를 그대로 씀: ${lying.sub}`);
const realKo = M.buildMacroLabels({ ...ind, rateImpactKo: '매파적 (긴축 압력)' }, 'ko');
realKo.sub.includes('긴축 압력') ? ok('진짜 한국어 Ko 필드는 존중 (설명 보존)') : bad(`한국어 Ko 필드를 버림: ${realKo.sub}`);
// 한국어 + 영문 약어 혼용은 정상 (예: "매파적 (FOMC 대기)")
const mixed = M.buildMacroLabels({ ...ind, rateImpactKo: '중립 (FOMC 대기)' }, 'ko');
mixed.sub.includes('FOMC') ? ok('한국어+약어 혼용 허용') : bad(`약어까지 버림: ${mixed.sub}`);

// [4] 결측 안전
const noPrev = M.buildMacroLabels({ ...ind, previous: null }, 'ko');
!/\(/.test(noPrev.sub) ? ok('previous 결측 시 괄호 블록 생략') : bad(`빈 괄호: ${noPrev.sub}`);
M.buildMacroLabels({}, 'ko') ? ok('빈 입력에서 죽지 않음') : bad('빈 입력 오류');

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
