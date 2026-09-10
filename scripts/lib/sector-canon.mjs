/**
 * sector-canon.mjs — 섹터 이름을 한 어휘로 모은다.
 *
 * 왜 (2026-09-10): 직전 회차 섹터 스탠스를 매수 후보 점수에 넘겼는데 **14개 중 1개만 일치**했다.
 *   보고서(LLM 산출)는 GICS 계열을 쓰고 — Financials · Health Care · Technology —
 *   종목 메타는 야후 계열에 슬러그·한글이 섞여 있다 — Financial Services · Healthcare ·
 *   it-software · 전기제품 (실측 46종). 이름이 안 맞으면 Map 조회가 전부 빗나가고,
 *   "스탠스를 넘겼다" 고 적어둔 채 룰은 여전히 한 번도 안 켜진다.
 *
 * 표는 **실제 DB 에 있는 값**에서 뽑았다(보고서 9종 · 후보 46종). 추측으로 늘리지 않는다.
 *
 * 원칙: 애매하면 매핑하지 않는다. 틀린 섹터 스탠스로 종목을 고르는 것은
 *   스탠스가 없는 것보다 나쁘다 — Battery/ev-battery 는 회사에 따라 산업재·IT·경기소비재로
 *   갈리므로 남겨 둔다. ETF·KR·Other·Unknown 은 애초에 섹터가 아니다.
 */

/** 정규 이름(GICS 11) → 이 섹터로 모을 표기들. 소문자·기호 제거 후 비교한다. */
const GROUPS = {
  'energy': ['energy'],
  'materials': ['materials', 'basic materials', 'chemicals', 'metals mining'],
  'industrials': [
    'industrials', 'industrial', 'professional services', 'transportation',
    'electrical equipment', 'defense', 'wholesale', '전기제품',
  ],
  'consumer discretionary': ['consumer discretionary', 'consumer cyclical', 'automotive'],
  'consumer staples': ['consumer staples', 'consumer defensive'],
  'health care': ['health care', 'healthcare', 'health care technology', 'pharma biotech'],
  'financials': ['financials', 'financial services', 'banking'],
  'information technology': [
    'information technology', 'technology', 'it services', 'it software',
    'semiconductors', 'ai cloud',
  ],
  'communication services': ['communication services'],
  'utilities': ['utilities', 'electric utilities', 'independent power producers energy traders'],
  'real estate': ['real estate'],
};

/** 섹터가 아닌 값 — 조용히 다른 데 붙이지 않는다. */
const NOT_A_SECTOR = new Set(['etf', 'kr', 'other', 'unknown', 'battery', 'ev battery']);

const LOOKUP = (() => {
  const m = new Map();
  for (const [canon, aliases] of Object.entries(GROUPS)) {
    m.set(canon, canon);
    for (const a of aliases) m.set(a, canon);
  }
  return m;
})();

/** 비교용 정규화 — 대소문자·구분자·HTML 이스케이프(&amp; 가 DB 에 그대로 있다)를 없앤다. */
function normalize(s) {
  return String(s ?? '')
    .replace(/&amp;/gi, ' ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** 정규 섹터 이름. 모르거나 섹터가 아니면 null. */
export function canonSector(raw) {
  const n = normalize(raw);
  if (!n || NOT_A_SECTOR.has(n)) return null;
  return LOOKUP.get(n) ?? null;
}
