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
  // 2026-08-20 2차 — sub 조립에 쓰이는 낱말. 1차는 badge/source 만 고쳤고
  //   sub 40건 중 33건이 영문으로 남아 있었다(라이브 /api/latest-updates?locale=ko 실측).
  'Current rate': '현재 금리', 'held': '보유', 'Cascade': '연쇄',
  'Top Gainer': '상승 상위', 'Top Loser': '하락 상위',
  // FOMC 문맥의 결정 — 일반 동사가 아니라 정책 용어다.
  'Hold': '동결', 'Cut': '인하', 'Hike': '인상',
  // 경제 캘린더 영향도
  'High Impact': '영향 큼', 'Medium Impact': '영향 보통', 'Low Impact': '영향 작음',
  // 경제 캘린더 카테고리 (src/data/econ-calendar.ts 실측 도메인 8종).
  //   CPI·PCE·GDP·PMI·PPI 는 지표 약어라 PROPER 로 둔다.
  'Jobs': '고용', 'Retail': '소매판매',
  // 기관 시그널의 섹터 — API 응답에서 실제로 관측된 7종만 넣는다. 없는 값을 미리 짐작하지 않는다.
  'technology': '기술', 'finance': '금융', 'consumer': '소비재', 'telecom': '통신',
  'pharma': '제약', 'software': '소프트웨어', 'semiconductors': '반도체',
};

/** 번역하지 않는 고유명(기관·지수·데이터 제공처 이름). */
const PROPER = new Set([
  'CNN Fear & Greed', 'CNN Official F&G Index', 'CME FedWatch', 'Alpha Vantage',
  'Nasdaq', 'FlowVium composite', 'Reuters/CNBC', 'Fear & Greed',
  // 2026-08-20: 회의체·지수 약어는 번역 대상이 아니다.
  'FOMC', 'F&G', 'NFP', 'CPI', 'PCE', 'GDP', 'ETF', 'SEC EDGAR', 'S&P', 'PMI', 'PPI',
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

/**
 * 상대 일자 표기. 'In 3d' 는 한국어 어순으로 치환이 안 된다 — 라벨이 아니라 포맷이다.
 * 실측(2026-08-20 홈): "In 43d — September Jobs Report (NFP)" 가 ko 화면에 그대로 떴다.
 */
export function relativeDayLabel(days: number, locale = 'en'): string {
  const n = Number(days);
  if (!Number.isFinite(n)) return '';
  if (langOf(locale) !== 'ko') return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `In ${n}d`;
  return n === 0 ? '오늘' : n === 1 ? '내일' : `${n}일 후`;
}
