/**
 * update-labels.ts (scripts/lib/update-labels.mjs 의 웹 미러 — 둘을 함께 고칠 것)
 *   unmappedLabels() 는 소스 파일을 읽으므로 웹 미러에는 두지 않는다(런타임 파일 접근 회피).
 *
 * update-labels.ts — 홈 '최신 업데이트' 카드 라벨의 로케일 매핑.
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
/** 번역 대상 (닫힌 집합). 새 라벨이 라우트에 생기면 unmappedLabels() 가 드러낸다. */
const KO: Record<string, string> = {
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
  'Nasdaq', 'FlowVium composite', 'Reuters/CNBC', 'Fear & Greed',
]);

const langOf = (locale?: string) => String(locale ?? 'en').split('-')[0];

/** 라벨을 로케일에 맞게. 미지 라벨·고유명·영어 로케일은 원값. */
export function localizeLabel(label: string | null | undefined, locale = 'en'): string {
  const s = String(label ?? '');
  if (!s) return '';
  if (langOf(locale) !== 'ko') return s;
  if (PROPER.has(s)) return s;
  // 대소문자가 흔들려도 같은 라벨이다 — 실측: API 가 'accumulating'(소문자)로 내보내
  // 'Accumulating' 만 있던 매핑을 비껴갔다.
  if (KO[s]) return KO[s];
  const lower = s.toLowerCase();
  for (const k of Object.keys(KO)) if (k.toLowerCase() === lower) return KO[k];
  return s;
}
