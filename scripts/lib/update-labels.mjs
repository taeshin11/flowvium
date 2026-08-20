/**
 * update-labels.mjs — 홈 '최신 업데이트' 카드 라벨의 로케일 매핑.
 *
 * 배경(2026-08-20 UI 눈검증): 한국어 홈에 영문 18건이 남아 있었는데, 컴포넌트가 아니라
 *   src/app/api/latest-updates/route.ts 가 만들어 내보내는 라벨이었다
 *   (badge: 'Capital Flow'·'Holdings'·'Institutional' / 레벨: 'Bullish'·'Extreme Fear' …).
 *
 *   닫힌 집합이므로 LLM 런타임 번역 대상이 아니다 — 매핑으로 처리해야 값이 흔들리지 않는다.
 *   (실측: 4B 가 "hawkish"를 "호각적"으로 오역했고, 한국어라서 게이트도 통과했다.)
 *   고유명(CNN Fear & Greed · CME FedWatch · Alpha Vantage · Nasdaq)은 번역 대상이 아니다.
 *   모르는 라벨은 창작하지 않고 원값을 남긴다 — 조용히 틀린 한국어를 만들지 않는다.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './project-root.mjs';

/** 번역 대상 (닫힌 집합). 새 라벨이 라우트에 생기면 unmappedLabels() 가 드러낸다. */
const KO = {
  // badge
  'Capital Flow': '자금 흐름', 'Capital Flows': '자금 흐름', 'Holdings': '보유 현황',
  'Institutional': '기관', 'Sentiment': '투자심리', 'Macro': '거시',
  'News Gap': '뉴스 갭', 'News': '뉴스', 'FedWatch': '금리 전망',
  // 방향·심리
  'Bullish': '강세', 'Bearish': '약세', 'Neutral': '중립',
  'Extreme Fear': '극단적 공포', 'Extreme Greed': '극단적 탐욕', 'Fear': '공포', 'Greed': '탐욕',
  // 기관 포지션 변화
  'Accumulating': '매집', 'Reducing': '축소', 'New Position': '신규 편입', 'Full Exit': '전량 청산',
  // 기타
  'Gainer': '상승', 'Loser': '하락', 'Economic Calendar': '경제 캘린더',
  'Today': '오늘', 'Tomorrow': '내일', 'All day': '종일', 'Fed': '연준',
};

/** 번역하지 않는 고유명(기관·지수·데이터 제공처 이름). */
const PROPER = new Set([
  'CNN Fear & Greed', 'CNN Official F&G Index', 'CME FedWatch', 'Alpha Vantage',
  'Nasdaq', 'FlowVium composite', 'Reuters/CNBC',
]);

const langOf = (locale) => String(locale ?? 'en').split('-')[0];

/** 라벨을 로케일에 맞게. 미지 라벨·고유명·영어 로케일은 원값. */
export function localizeLabel(label, locale = 'en') {
  const s = String(label ?? '');
  if (!s) return '';
  if (langOf(locale) !== 'ko') return s;
  if (PROPER.has(s)) return s;
  return KO[s] ?? s;
}

/**
 * 라우트가 내보내는 영문 라벨 중 여기서 분류되지 않은 것.
 * 비어 있지 않으면 새 라벨이 조용히 영문으로 나가는 중이다 —
 * 이 저장소의 check-gate-registration 과 같은 '침묵 금지' 규율.
 */
export function unmappedLabels() {
  let src = '';
  try { src = readFileSync(resolve(ROOT, 'src/app/api/latest-updates/route.ts'), 'utf8'); } catch { return []; }
  const found = new Set();
  for (const m of src.matchAll(/'([A-Z][A-Za-z &/]{2,26})'/g)) found.add(m[1]);
  return [...found].filter((s) => !(s in KO) && !PROPER.has(s));
}
