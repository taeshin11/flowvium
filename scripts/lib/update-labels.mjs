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

const langOf = (locale) => String(locale ?? 'en').split('-')[0];

/** 라벨을 로케일에 맞게. 미지 라벨·고유명·영어 로케일은 원값. */
export function localizeLabel(label, locale = 'en') {
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
 * 라우트가 내보내는 영문 라벨 중 여기서 분류되지 않은 것.
 * 비어 있지 않으면 새 라벨이 조용히 영문으로 나가는 중이다 —
 * 이 저장소의 check-gate-registration 과 같은 '침묵 금지' 규율.
 */
/**
 * 템플릿 리터럴 안의 미번역 영문을 드러낸다.
 *
 * unmappedLabels() 는 작은따옴표로 감싼 대문자 라벨만 훑는다. 그래서 2026-08-20 1차 수정 때
 *   sub: `Current rate ${data.currentRateMid}%`
 *   sub: `${o.pctOfShares}% held ($${o.valueM}M) · ${o.quarter}`
 *   sub: `${side === 'gain' ? '📈 Top Gainer' : '📉 Top Loser'} · …`
 * 같은 6곳이 가드를 그대로 통과했고, 홈 한국어 화면에 영문이 남았다.
 * (badge/source 만 고치고 sub 를 못 본 이유가 이것이다 — 가드가 못 보면 나도 못 본다.)
 *
 * ${...} 안은 값이라 제외하고, 남은 영문 낱말만 본다. KO/PROPER 에 있으면 이미 처리된 것이다.
 * 단위·통화 기호처럼 번역 대상이 아닌 것은 UNIT 에 둔다 — 목록을 늘리는 게 아니라 성격이 다르다.
 */
const UNIT = new Set(['W', 'M', 'B', 'K', 'Q', 'D', 'Y', 'bp', 'bps', 'pt', 'pts', 'vs', 'x']);
// 중첩 템플릿(백틱 안의 백틱) 때문에 값 자리를 완전히는 못 걷어낸다. 남는 JS 식별자는 여기서 거른다.
// 정규식으로 템플릿을 완전 파싱하려던 시도는 백틱 깊이 계산이 파일 전체를 삼켜 실패했다 —
// 완전 파서를 쓰느니 범위를 좁히고 한계를 적어 두는 편이 낫다(놓치는 쪽은 unmappedLabels 가 일부 덮는다).
const JS_NOISE = new Set(['null', 'undefined', 'true', 'false', 'ret']);

/**
 * 템플릿 리터럴 안의 미번역 영문을 드러낸다.
 *
 * unmappedLabels() 는 작은따옴표로 감싼 대문자 라벨만 훑는다. 그래서 2026-08-20 1차 수정 때
 *   sub: `Current rate ${data.currentRateMid}%`
 *   sub: `${o.pctOfShares}% held ($${o.valueM}M) · ${o.quarter}`
 *   headline: `FOMC ${next.label} — Hold ${holdProb}% / Cut ${cutProb}%`
 * 같은 곳이 가드를 그대로 통과했고 한국어 홈에 영문이 남았다.
 * badge/source 만 고치고 sub 를 못 본 이유가 이것이다 — 가드가 못 보면 나도 못 본다.
 *
 * 한계: 백틱이 중첩된 표현식(`${x ? `…` : '…'}`)은 바깥 리터럴이 첫 안쪽 백틱에서 끊긴다.
 *       그 경우 뒷부분을 못 본다. 넓히려다 파서를 만들게 돼 여기서 멈췄다 — 아는 만큼만 적는다.
 */
/**
 * 상대 일자 표기. 'In 3d' 는 한국어 어순으로 치환이 안 된다 — 라벨이 아니라 포맷이다.
 * 실측(2026-08-20 홈): "In 43d — September Jobs Report (NFP)" 가 ko 화면에 그대로 떴다.
 */
export function relativeDayLabel(days, locale = 'en') {
  const n = Number(days);
  if (!Number.isFinite(n)) return '';
  if (langOf(locale) !== 'ko') return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `In ${n}d`;
  return n === 0 ? '오늘' : n === 1 ? '내일' : `${n}일 후`;
}

/** 이미 처리된 것(단위·JS 노이즈·고유명·매핑됨)인지. 대소문자는 무시한다. */
function mapped(t) {
  if (!t) return true;
  if (UNIT.has(t) || JS_NOISE.has(t) || PROPER.has(t)) return true;
  if (KO[t]) return true;
  const lower = t.toLowerCase();
  if (Object.keys(KO).some((k) => k.toLowerCase() === lower)) return true;
  return [...PROPER].some((k) => k.toLowerCase() === lower);
}

export function unmappedTemplateText(fields = ['sub', 'headline']) {
  let src = '';
  try { src = readFileSync(resolve(ROOT, 'src/app/api/latest-updates/route.ts'), 'utf8'); } catch { return []; }
  const out = new Set();
  for (const field of fields) {
    for (const m of src.matchAll(new RegExp(field + ':\\s*`([^`]*)`', 'g'))) {
      const body = m[1].replace(/\$\{[^{}]*\}/g, ' ');   // 값 자리는 비운다 (중첩 없는 경우)
      // 낱말이 아니라 *구* 단위로 본다 — 'Current rate' 는 구로 매핑돼 있는데
      // 대문자 연속만 이어붙이면 'Current' / 'rate' 로 갈라져 영원히 미분류로 남는다.
      for (const w of body.matchAll(/[A-Za-z][A-Za-z&/']{1,}(?:\s+[A-Za-z][A-Za-z&/']+)*/g)) {
        const phrase = w[0].trim();
        if (!phrase || mapped(phrase)) continue;
        // 구 전체가 매핑돼 있지 않으면 낱말 단위로 쪼개 *실제로 안 잡힌 것만* 보고한다.
        const words = phrase.split(/\s+/).filter((t) => t && !mapped(t));
        for (const t of words) out.add(t);
      }
    }
  }
  return [...out];
}

export function unmappedLabels() {
  let src = '';
  try { src = readFileSync(resolve(ROOT, 'src/app/api/latest-updates/route.ts'), 'utf8'); } catch { return []; }
  const found = new Set();
  for (const m of src.matchAll(/'([A-Z][A-Za-z &/]{2,26})'/g)) found.add(m[1]);
  return [...found].filter((s) => !(s in KO) && !PROPER.has(s));
}
