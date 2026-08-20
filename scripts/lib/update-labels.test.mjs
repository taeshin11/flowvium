#!/usr/bin/env node
/**
 * update-labels.test.mjs — 홈 '최신 업데이트' 카드의 라벨 로케일 처리.
 *
 * 배경(2026-08-20 UI 눈검증): 한국어 홈에 영문 18건이 남아 있었고, 컴포넌트가 아니라
 *   src/app/api/latest-updates/route.ts 가 만들어 내보내는 라벨이었다:
 *     badge: 'Capital Flow' · 'Holdings' · 'Institutional' · 'Sentiment' · 'FedWatch' · 'Macro' · 'News Gap'
 *     레벨/심리: 'Bullish' · 'Bearish' · 'Extreme Fear' · 'Greed' · 'Accumulating' · 'Full Exit' · 'Gainer' …
 *   닫힌 집합이므로 LLM 런타임 번역 대상이 아니다 — 매핑으로 처리해야 값이 흔들리지 않는다
 *   (실측: 4B 가 "hawkish"를 "호각적"으로 오역했고 한국어라 게이트도 통과했다).
 *
 *   고유명(CNN Fear & Greed · CME FedWatch · Alpha Vantage · Nasdaq)은 번역 대상이 아니다.
 */
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

let L;
try { L = await import('./update-labels.mjs'); }
catch (e) { console.log(`  FAIL  모듈 없음: ${e.message}`); process.exit(1); }

// [1] 번역돼야 하는 것
const MUST = {
  'Capital Flow': '자금 흐름', 'Holdings': '보유 현황', 'Institutional': '기관',
  'Sentiment': '투자심리', 'Macro': '거시', 'News Gap': '뉴스 갭',
  'Bullish': '강세', 'Bearish': '약세', 'Neutral': '중립',
  'Extreme Fear': '극단적 공포', 'Extreme Greed': '극단적 탐욕', 'Fear': '공포', 'Greed': '탐욕',
  'Accumulating': '매집', 'Reducing': '축소', 'New Position': '신규 편입', 'Full Exit': '전량 청산',
  'Gainer': '상승', 'Loser': '하락', 'Economic Calendar': '경제 캘린더',
  'Today': '오늘', 'Tomorrow': '내일', 'News': '뉴스',
};
for (const [en, ko] of Object.entries(MUST)) {
  const got = L.localizeLabel(en, 'ko');
  got === ko ? ok(`${en} → ${got}`) : bad(`${en} → ${JSON.stringify(got)} (기대 ${ko})`);
}

// [2] 고유명은 그대로
for (const p of ['CNN Fear & Greed', 'CME FedWatch', 'Alpha Vantage', 'Nasdaq', 'CNN Official F&G Index', 'FlowVium composite', 'Reuters/CNBC']) {
  L.localizeLabel(p, 'ko') === p ? ok(`고유명 유지: ${p}`) : bad(`고유명을 번역함: ${p} → ${L.localizeLabel(p, 'ko')}`);
}

// [3] 영어 로케일은 원문 그대로 (회귀 금지)
L.localizeLabel('Bullish', 'en') === 'Bullish' ? ok('en 은 원문 유지') : bad('en 이 바뀜');
// [4] 모르는 라벨은 창작하지 않고 원값 — 조용히 틀린 한국어를 만들지 않는다
L.localizeLabel('Zephyr Index', 'ko') === 'Zephyr Index' ? ok('미지 라벨은 원값 유지') : bad('미지 라벨을 창작함');
// [5] 빈/이상 입력
L.localizeLabel('', 'ko') === '' && L.localizeLabel(null, 'ko') === '' ? ok('빈 입력 안전') : bad('빈 입력 처리 이상');

// [6] 라우트가 내보내는 라벨 중 미분류가 남으면 드러나야 한다 — 침묵 금지
const un = L.unmappedLabels();
un.length === 0 ? ok('라우트 라벨 전수 분류 완료') : bad(`미분류 ${un.length}종: ${un.join(', ')}`);

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
