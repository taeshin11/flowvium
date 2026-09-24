// report-gate.ts — 보고서 회원 잠금 정책을 **한 곳에서** 정한다. (2026-09-24 신설)
//
// 정책 (2026-09-24 사장님 "아침 다시 무료로 풀어"):
//   · 아침(morning) 보고서는 누구나 전부 본다.
//   · 나머지 회차는 비회원에게 아래 필드를 **서버에서** 뺀다.
//   · 회원(또는 내부 호출)은 언제나 전부 본다.
//
// 왜 한 곳인가: 같은 정책을 세 곳이 따로 들고 있었다 —
//   메인 라우트(GATED_FIELDS·gateResponse), 과거 회차 라우트(**잠금 없음**), 페이지(GATED_SESSIONS).
//   그래서 9/18 "다 잠궈" 때 과거 회차 라우트를 놓쳐 전 회차 포트폴리오가 새고 있었고,
//   페이지는 서버가 지운 필드를 그리려다 죽었다. 정책이 바뀔 때마다 세 곳을 다 고쳐야 하면 하나는 빠진다.
//
// (JSDoc /** */ 안의 한국어는 i18n 래칫이 하드코딩 문자열로 센다 — // 주석으로 둔다.)

export const FREE_SESSIONS: readonly string[] = ['morning'];

export const GATED_FIELDS: readonly string[] = [
  'portfolio', 'portfolioByMarket', 'sellRecommendations', 'buyCandidateScoring',
  'shortSqueeze', 'insiderSignals', 'topOpportunity', 'conditionalEntryWatch',
  'fundamentalAnalysis', 'technicalAnalysis', 'macroAnalysis', 'marketNarrative',
  'sectorAllocation', 'riskEvents', 'hedgingSuggestion', 'stopLossRationale',
  'portfolioOutcomes', 'companyChanges', 'supplyChainChanges', 'manipulationWatch',
];

// 회원 응답은 공유 캐시에 올리지 않는다 — 올리면 비회원이 그 캐시를 받는다. 두 라우트가 같은 값을 쓴다.
export const MEMBER_CACHE_CONTROL = 'private, no-store';
export const MEMBER_RESPONSE_HEADERS: Readonly<Record<string, string>> = { 'Cache-Control': MEMBER_CACHE_CONTROL };

export function isFreeSession(session: unknown): boolean {
  return typeof session === 'string' && FREE_SESSIONS.includes(session);
}

// 비회원에게 보낼 모양으로 바꾼다. 회원이거나 무료 회차면 그대로 돌려준다.
//   gated: true 를 붙인다 — 페이지는 이 표시를 **먼저** 믿는다(서버가 뺐다는 사실을 아는 건 서버다).
//   세션을 모르면 잠근다. 모르면서 푸는 쪽 실수가 더 비싸다.
export function gateReport<T extends Record<string, unknown>>(data: T, isMember: boolean): T {
  if (isMember || isFreeSession(data.session)) return data;
  const out: Record<string, unknown> = { ...data };
  let removed = 0;
  for (const f of GATED_FIELDS) if (f in out) { delete out[f]; removed += 1; }
  if (!removed) return data;
  out.gated = true;
  out.gatedFields = removed;
  return out as T;
}
