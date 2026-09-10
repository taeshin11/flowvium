/**
 * news-worthiness.mjs — 분석할 뉴스를 최신순 말고 값어치 순으로 고른다.
 *
 * 왜 (2026-09-11): news-cascade 의 선별은 최신순뿐이었다(지역 쿼터 후 recency, 상한 12).
 *   관련도·영향도 점수가 하나도 없어 2분 전 사진기사가 40분 전 ECB 금리 인상을 밀어냈다.
 *
 *   실측 2,307건 중 분석하고도 연결고리를 못 찾은 것이 443건(19%). 그 안을 갈라 보면
 *     거시 핵심어 36 (ECB 금리·국고채·美물가·환율 1500원·엔캐리 쇼크)
 *     기업명 43 · 사진/부고 10 · 나머지 354
 *   버려지는 쪽에 진짜 신호가 섞이고, 뽑히는 쪽에 사진기사가 섞였다.
 *
 * 결정론으로 매긴다 — 선별에 LLM 을 쓰면 느려지고 매번 달라진다.
 *   점수는 "이 기사가 시장과 연결될 가능성" 이지 "중요한 뉴스인가" 가 아니다.
 *   재난·정치처럼 사람에게 중요해도 종목과 안 붙는 것은 여기서 낮게 나온다 — 그게 이 선별의 목적이다.
 */

/** 기사 형식 자체가 분석 대상이 아닌 것. 가장 확실한 신호라 크게 뺀다. */
const NON_ARTICLE = /^\s*\[(포토|사진|영상|인사|부고|날씨|표|그래픽|일정|알림|정정|부음)\]|^\s*\[포토/;

/** 거시 — 단일 종목이 아니라 시장 전체를 움직인다. */
const MACRO = /기준금리|금리\s*(인상|인하|동결)|연준|FOMC|ECB|한은|국고채|물가|CPI|인플레|환율|관세|무역전쟁|유가|국제유가|경기침체|GDP|고용지표|테이퍼|양적완화|엔캐리/;

/** 기업 실적·자본 사건 — 종목에 직접 붙는다. */
const CORP_EVENT = /실적|매출|영업이익|순이익|어닝|가이던스|수주|계약|공급|인수|합병|M&A|증자|자사주|배당|상장|IPO|리콜|파업|셧다운|증설|투자\s*계획/;

/** 규제·소송 — 방향이 분명한 사건. */
const REGULATORY = /제재|과징금|기소|압수수색|조사\s*착수|승인|허가|반독점|관세\s*부과|수출\s*규제/;

/** 큰 한국 기업 이름(상장). 이름만으로도 연결 가능성이 크게 오른다. */
const BIG_KR = /삼성전자|삼성바이오|SK하이닉스|SK이노베이션|현대차|기아|LG에너지|LG전자|LG화학|POSCO|포스코|네이버|카카오|셀트리온|한화|두산|HD현대|삼성SDI|KB금융|신한지주|하나금융/;

/** 미국 티커 표기(대문자 2~5자, 단독). */
const US_TICKER = /(^|[\s([])[A-Z]{2,5}([\s,.):]|$)/;

/** 금액·비율 — 사실이 붙어 있다는 표시. */
const NUMBER = /[0-9][0-9,.]*\s*(억|조|원|달러|%|bp)|\$[0-9]/;

/** 공지·행사·협정처럼 시장과 잘 안 붙는 말. */
const SOFT = /협정|양해각서|MOU|간담회|세미나|공모전|캠페인|기념식|위촉|착공식|출범식|창업학교|주간\s*맞아/;

/**
 * ⚠ 2026-09-11 검증 결과 — **키워드 가점은 작동하지 않는다.**
 *   과거 2,307건에 적용해 연결고리 성공률을 봤더니 점수대별로 평평했다:
 *     0점 81% · 1~2점 81% · 3~4점 82% · 5+점 86%(n=35) — 전체 평균 81%
 *   캐스케이드 품질(기사당 개수·high 강도)도 전 구간 5.2~5.5 로 차이가 없었다.
 *   즉 "거시·실적 키워드가 있으면 더 값어치 있다" 는 가정은 데이터가 지지하지 않는다.
 *
 *   유일하게 갈린 것은 **형식**이다: [포토]·[부고]·[인사] 류 46건은 61% 로 20%p 낮다.
 *   그래서 가점은 남겨 두되 **선별에는 형식 배제만 쓴다**(pickForAnalysis).
 *   가점 부분은 다른 결과지표(추천 채택률·실제 주가 변동)로 다시 검증할 때를 위해 남긴다 —
 *   지우면 다음 사람이 같은 가정을 처음부터 다시 세운다.
 */
export function worthiness(title) {
  const t = String(title ?? '');
  if (!t.trim()) return -10;
  if (NON_ARTICLE.test(t)) return -5;

  let s = 0;
  if (MACRO.test(t)) s += 3;
  if (CORP_EVENT.test(t)) s += 2;
  if (REGULATORY.test(t)) s += 2;
  if (BIG_KR.test(t)) s += 2;
  if (US_TICKER.test(t)) s += 2;
  if (NUMBER.test(t)) s += 1;
  if (SOFT.test(t)) s -= 2;
  return s;
}

/**
 * 지역 쿼터를 지키면서 점수 순으로 고른다.
 *   쿼터를 버리면 점수 높은 US 기사가 전부 먹는다 — 2026-06-05 에 그래서 쿼터를 넣었다.
 *   쿼터 안에서도 점수 순이라, 같은 KR 세 자리에 사진기사 대신 실적기사가 들어간다.
 * @param {{id:string, region:string, title:string, at:number}[]} items
 */
export function pickForAnalysis(items, { cap = 12, quota = { kr: 3, jp: 1, cn: 1 } } = {}) {
  // 검증된 것만 쓴다: 형식상 기사가 아닌 것만 뒤로 보내고, 나머지는 종전대로 최신순.
  //   키워드 가점으로 줄 세우는 것은 데이터가 지지하지 않았다(위 주석).
  const scored = (items ?? []).map((x) => ({ ...x, _s: worthiness(x.title) < 0 ? -1 : 0 }));
  const order = (a, b) => (b._s - a._s) || ((b.at ?? 0) - (a.at ?? 0));

  const picked = [];
  const taken = new Set();
  for (const [region, n] of Object.entries(quota)) {
    for (const x of scored.filter((y) => y.region === region).sort(order).slice(0, n)) {
      if (picked.length >= cap) break;
      picked.push(x); taken.add(x.id);
    }
  }
  for (const x of scored.sort(order)) {
    if (picked.length >= cap) break;
    if (taken.has(x.id)) continue;
    picked.push(x); taken.add(x.id);
  }
  return picked;
}
