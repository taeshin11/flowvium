/**
 * topic-score.mjs — 어떤 갈래의 주제가 실제로 통했는가.
 *
 * 왜 (2026-09-06 사용자 "조회수 안나오는 주제들은 하지마"):
 *   실측해 보니 **조회수는 주제별로 잘 안 갈린다**(1157~1574회). 쇼츠 노출이 비슷하게 붙는다.
 *   갈리는 것은 **반응률(좋아요/조회)** 이고 25배까지 벌어진다:
 *     용혜인 특혜 논란 1.97% · 나경원 공수처 고발 1.63% · 호르무즈 1.15% · 한화에어로 1.13%
 *     아파트 0.90% · 네팔 대홍수 0.88% · 트럼프 관세 0.78%
 *     전남대 혁신파크 0.53% · 종목 추천 0.52% · 전남대(중복) 0.41% · 0.08%
 *   그래서 "조회수" 를 반응률로 읽는다. 조회수만 보면 아무것도 못 가른다.
 *
 * 키워드 단위로는 판단할 수 없다 — 키워드는 대개 한 번만 쓰인다.
 * 갈래로 묶어 본다. 갈래는 헤드라인의 말로 정하고, **성적은 DB 에서 온다**(짐작이 아니라 측정).
 */

/** 갈래. 위에서부터 먼저 맞는 것을 쓴다 — 겹치면 앞이 이긴다. */
const CATEGORIES = [
  ['정치갈등', /고발|의혹|논란|특혜|사퇴|파면|탄핵|규탄|공방|맞불|반박|폭로|압박|청문회|위증|해명/],
  ['정책·인사', /장관|후보자|개각|임명|지명|국무|내각|법안|입법|시행령|규제|정부\s*발표/],
  ['수출·수주', /수출|수주|계약\s*체결|납품|진출|세계\s*1위|사상\s*최[대고]|신기록/],
  ['외교·안보', /파병|외교|정상회담|한미|한중|한일|북한|미사일|국방|안보|관세/],
  ['사건사고', /사망|실종|붕괴|화재|폭발|전복|홍수|지진|참사|사고|구조|피해/],
  ['부동산·생활', /아파트|전세|월세|주택|분양|집값|물가|생활|의료|교육/],
  ['시장·종목', /코스피|코스닥|증시|지수|환율|유가|종목|주가|투자|배당|ETF/],
  ['지역·기관', /지자체|시청|도청|캠퍼스|산학연|공단|재단|협회|박람회|공모전|축제/],
];

/** @returns {string} 갈래 이름 */
export function categoryOf(headline) {
  const t = String(headline ?? '');
  for (const [name, re] of CATEGORIES) if (re.test(t)) return name;
  return '기타';
}

/**
 * 갈래별 반응률. 표본이 적으면 판단하지 않는다 — 한 편으로 갈래를 재단하면 안 된다.
 *
 * @param {Array<{headline:string, views:number, likes:number}>} rows shortsPerformance() 결과
 * @param {{minSamples?:number}} [opts]
 * @returns {Map<string,{n:number, rate:number, views:number}>}
 */
export function categoryRates(rows, { minSamples = 1 } = {}) {
  const acc = new Map();
  for (const r of rows ?? []) {
    if (!(r.views > 0)) continue;
    const c = categoryOf(r.headline);
    const a = acc.get(c) ?? { n: 0, likes: 0, views: 0 };
    a.n += 1; a.likes += Number(r.likes ?? 0); a.views += Number(r.views ?? 0);
    acc.set(c, a);
  }
  const out = new Map();
  for (const [c, a] of acc) {
    if (a.n < minSamples) continue;
    out.set(c, { n: a.n, rate: a.likes / a.views, views: Math.round(a.views / a.n) });
  }
  return out;
}

/**
 * 이 갈래를 뒤로 미룰 것인가.
 *
 * 전체 평균의 절반에도 못 미치면 약한 갈래로 본다. **버리지는 않는다** —
 * 표본이 얇고, 그날 그 주제뿐일 수도 있다. 순서만 뒤로 민다.
 */
export function weakCategories(rows, { minSamples = 2, floor = 0.5 } = {}) {
  const rates = categoryRates(rows, { minSamples: 1 });
  if (rates.size < 2) return new Set();
  let likes = 0; let views = 0;
  for (const r of rows ?? []) { likes += Number(r.likes ?? 0); views += Number(r.views ?? 0); }
  const avg = views > 0 ? likes / views : 0;
  const weak = new Set();
  for (const [c, v] of rates) {
    if (v.n >= minSamples && avg > 0 && v.rate < avg * floor) weak.add(c);
  }
  return weak;
}
