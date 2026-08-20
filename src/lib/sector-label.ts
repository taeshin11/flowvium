/**
 * sector-label.ts — 보고서 JSON 의 섹터 문자열을 로케일 라벨로.
 *
 * 배경(2026-08-21 눈검증): /ko/report '섹터별 배분 전략'·'ETF 전략' 블록에
 *   Financials · Energy · Healthcare · Technology · Consumer Staples · Consumer Defensive · industrials
 *   가 영문 그대로 떴다. 확정 누출 7건(= 같은 값의 한국어가 messages 에 이미 있다).
 *
 *   이 값들은 UI 라벨이 아니라 LLM 이 생성한 보고서 JSON 의 내용이다
 *   (sectorAllocation[].sector · portfolio[].sector · buySellReconciliation.candidates[].sector).
 *   생성 프롬프트로 한국어를 강제하는 방식은 값이 흔들려서(대소문자·표기 변형) 못 믿는다 —
 *   실제로 같은 보고서 안에 'industrials'(소문자)와 'Consumer Defensive'(제목대소문자)가 섞여 있다.
 *   그래서 표시 시점에 정규화한다.
 *
 *   왜 이 블라인드가 오래 갔나: 페이지 감사를 익명으로 돌렸는데 보고서 본문이 회원 전용이라
 *   감사가 티저(2,958자)만 보고 있었다. 회원으로 돌리자 같은 페이지가 7건을 뱉었다.
 */

/** 표기 변형을 흡수해 카탈로그 키 형태로. 'Consumer Defensive' → 'consumer-defensive' */
export function sectorSlug(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_/]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * 분류 체계가 달라 이름만 다른 같은 섹터. 확실한 것만 둔다 — 애매하면 넣지 않고 원값을 남긴다.
 *   GICS 'Consumer Staples' == Morningstar 'Consumer Defensive' (이 저장소 카탈로그는 후자)
 *   'Health Care'(GICS 는 두 단어) == 'Healthcare'
 * 'Information Technology' 는 카탈로그에 technology 와 it-software 가 둘 다 있어 어느 쪽인지
 * 단정할 수 없다 — 넣지 않는다. 모르는 건 원값으로 두는 편이 조용히 틀리는 것보다 낫다.
 */
const ALIAS: Record<string, string> = {
  'consumer-staples': 'consumer-defensive',
  'health-care': 'healthcare',
};

/**
 * @param raw     보고서 JSON 의 섹터 문자열
 * @param known   카탈로그가 아는 id 집합 (data/sectors.ts 의 id)
 * @param t       explore 네임스페이스 번역 함수 — t(`sectors.${id}`)
 * @returns 로케일 라벨. 카탈로그에 없으면 원값(빈 문자열이면 빈 문자열).
 */
export function localizeSector(
  raw: string,
  known: ReadonlySet<string>,
  t: (key: string) => string,
): string {
  const s = String(raw ?? '');
  if (!s.trim()) return s;
  const slug = sectorSlug(s);
  const id = ALIAS[slug] ?? slug;
  return known.has(id) ? t(`sectors.${id}`) : s;
}
