/**
 * sec-name-clean.mjs — SEC 법인명(전부 대문자) → 표시용 회사명. 그리고 두 권위의 교차검증.
 *
 * 왜 필요한가(2026-08-22): build-company-names.mjs 의 titleCase 가
 *     s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
 *   였다. SEC 원본이 "EOG RESOURCES INC" 라 통째로 소문자화되며 약어가 죽었고
 *   `Eog Resources Inc` 가 발간본 6건에 나갔다. 접미 주(州)코드 제거도 `/\/\w+$/` 라
 *   "AMPHENOL CORP /DE/"(끝이 `/`)를 못 잡아 16건이 `Corp /De/` 로 남아 있었다.
 *
 * 왜 Yahoo 로 통째 교체하지 않나: 실측에서 875개를 Yahoo longName 과 대조해 보니
 *   이름이 통째로 다른 9건 중 PARA 는 **Yahoo 쪽이 틀렸다**(티커 재배정으로
 *   "Banzai International, Inc." 를 준다). 한쪽을 맹신하면 다른 오류가 들어온다.
 *   → 두 출처가 같은 회사를 가리킬 때만 Yahoo 표기를 쓰고, 어긋나면 법인등록부(SEC)를
 *     남기고 conflict 로 올린다. 조용히 고르지 않는다.
 */

/** 회사명 관례상 소문자로 두는 연결어. 첫 단어면 대문자로 둔다. */
const LOWER = new Set(['of', 'and', 'the', 'for', 'de', 'von', 'van']);
/** 소문자 title-case 결과가 아니라 통째 대문자로 두는 법인격 약어. */
const UPPER = { LLC: 'LLC', PLC: 'PLC', LP: 'LP', NV: 'NV', SA: 'SA', AG: 'AG', ETF: 'ETF', ETN: 'ETN', REIT: 'REIT' };

/**
 * @param {string} raw   SEC company_tickers 의 title (보통 전부 대문자)
 * @param {string} [ticker] 있으면 티커와 같은 단어는 대문자로 보존한다(EOG, KKR, CSX …)
 */
export function secTitleCase(raw, ticker = '') {
  let s = String(raw ?? '').trim();
  if (!s) return '';
  // 주(州)/국가 코드 접미: "CORP /DE/", "INC / MA", "GROUP INC/RI", "/CAN/"
  s = s.replace(/\s*\/\s*[A-Za-z]{2,3}\s*\/?\s*$/, '').trim();
  const tk = String(ticker ?? '').toUpperCase();
  const words = s.split(/\s+/);
  return words.map((w, i) => {
    const core = w.replace(/[^A-Za-z&]/g, '');
    if (!core) return w;
    if (UPPER[core.toUpperCase()]) return w.replace(core, UPPER[core.toUpperCase()]);
    // 티커와 같은 단어 → 약어로 보고 대문자 유지 (EOG RESOURCES / KKR & CO)
    if (tk && core.toUpperCase() === tk) return w.toUpperCase();
    if (i > 0 && LOWER.has(core.toLowerCase())) return w.toLowerCase();
    return w.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
  }).join(' ');
}

/** 비교용 정규화 — 구두점·법인격 접미를 걷어낸 의미 토큰만 남긴다. */
const STOP = new Set(['inc', 'corp', 'corporation', 'ltd', 'limited', 'plc', 'llc', 'lp', 'co', 'company',
                      'companies', 'group', 'holdings', 'holding', 'the', 'incorporated', 'sa', 'nv', 'ag']);
function meaningTokens(s) {
  // 아포스트로피·마침표는 **지운다**(공백으로 바꾸지 않는다). "Moody's" 를 공백으로 쪼개면
  //   {moody} 가 되어 SEC 의 {moodys} 와 안 겹치고, 같은 회사가 충돌로 잡힌다(실측 MCO).
  return new Set(String(s ?? '').toLowerCase().replace(/['\u2019.]/g, '').replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/).filter(w => w.length > 1 && !STOP.has(w)));
}

/**
 * 두 회사명이 같은 회사를 가리키는가. 의미 토큰이 하나라도 겹치면 같다고 본다.
 *
 * 2026-08-22: 하네스가 `"Visa"→"Visa Inc."` 같은 **정상 축약형**까지 모델 결함으로 적어 왔다
 *   (harness_usNameMismatch 최근 7일 32건 중 대부분). 표시명을 권위값으로 통일하는 것은 옳지만,
 *   축약형을 쓴 걸 환각으로 기록하면 결함 추세가 노이즈로 덮인다.
 *   같은 판정이 cascade-asset.mjs 안에도 비공개로 있었다 — 두 벌이면 갈리므로 여기로 모은다.
 */
export function sameCompany(a, b) {
  if (!a || !b) return true;               // 비교할 게 없으면 다르다고 단정하지 않는다
  const A = meaningTokens(a), B = meaningTokens(b);
  if (!A.size || !B.size) return true;
  for (const w of B) if (A.has(w)) return true;
  for (const w of A) if (B.has(w)) return true;
  return false;
}

/**
 * 두 권위를 대조해 표시명을 고른다.
 * @param {{sec?:string, yahoo?:string, ticker?:string, isFund?:boolean}} o
 * @returns {{name:string, source:'yahoo'|'sec', conflict:boolean}}
 */
export function pickDisplayName({ sec, yahoo, ticker = '', isFund = false } = {}) {
  const secClean = secTitleCase(sec ?? '', ticker);
  const y = String(yahoo ?? '').trim();
  if (!y) return { name: secClean, source: 'sec', conflict: false };
  if (!secClean) return { name: y, source: 'yahoo', conflict: false };
  // ETF/ETN/펀드는 SEC 에 **발행사**로 등록된다(VXX→"Barclays Bank PLC", BULZ→"Bank of Montreal").
  //   상품명과 발행사명이 다른 건 오류가 아니라 범주 차이다 — 충돌로 세면 안 된다.
  //   표시명은 상품명이어야 하므로 Yahoo 를 쓴다.
  if (isFund) return { name: y, source: 'yahoo', conflict: false };
  const A = meaningTokens(secClean), B = meaningTokens(y);
  // 의미 토큰이 하나라도 겹치면 같은 회사로 본다 → 표기가 나은 Yahoo 채택.
  const same = [...A].some(w => B.has(w)) || [...B].some(w => A.has(w));
  if (same) return { name: y, source: 'yahoo', conflict: false };
  // 겹치는 게 없다 = 둘 중 하나가 틀렸다. 법인등록부를 남기고 사람이 보게 올린다.
  return { name: secClean, source: 'sec', conflict: true };
}
