/**
 * company-seo.mjs — 종목 페이지 검색 제목에 쓸 이름·코드, 사이트맵에 넣을 종목. 2026-11-07 신설.
 * 왜(실측): 한국어 삼성전자 페이지 제목이 "Samsung Electronics (005930.KS) - 공급망 탐색기", 카카오는 "035720.KS" 였고,
 *   사이트맵 종목 616개 중 한국 종목은 3개(풀 465개 중)였다. 한국 사람은 "삼성전자 주가"로 찾는다.
 * 이름 출처: 종목 풀(data/candidate-tickers.json meta.name — CLAUDE.md 의 권위 소스) → 없으면 DART 기업코드표 → 큐레이션.
 * 파일 읽기는 부르는 쪽(서버)이 한다 — 여기는 계산만(테스트가 실제 데이터를 안 건드리게).
 */
const isKr = (t) => /\.K[SQ]$/.test(t);
const real = (name, t) => (name && String(name).toUpperCase() !== t ? String(name) : null);

export function companyName(ticker, locale, { pool, dart, curated }) {
  const t = String(ticker).toUpperCase();
  const cur = real(curated?.find((c) => c.ticker.toUpperCase() === t)?.name, t);
  const fromPool = real(pool?.meta?.[t]?.name, t);
  const fromDart = isKr(t) ? real(dart?.[t.slice(0, 6)]?.corpName, t) : null;
  if (isKr(t) && locale === 'ko') return (fromPool && /[가-힣]/.test(fromPool) ? fromPool : null) ?? fromDart ?? cur ?? fromPool;
  return cur ?? fromPool ?? fromDart;
}

export function companyCode(ticker) {
  const t = String(ticker).toUpperCase();
  return isKr(t) ? t.slice(0, 6) : t;
}

/** 사이트맵 종목: 큐레이션 전부 + 풀의 한국 종목 중 이름을 아는 것. 이름도 모르는 빈 페이지는 넣지 않는다. */
export function sitemapTickers({ pool, dart, curated }) {
  const out = new Set((curated ?? []).map((c) => c.ticker.toUpperCase()));
  for (const t of pool?.tickers ?? []) {
    const T = String(t).toUpperCase();
    if (isKr(T) && companyName(T, 'ko', { pool, dart, curated })) out.add(T);
  }
  return [...out];
}
