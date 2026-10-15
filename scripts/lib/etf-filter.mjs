/**
 * etf-filter.mjs — 종목 추천 풀에서 ETF·현금성 ETF 를 가르는 규칙. generate-report-local.mjs 에서 그대로 옮겼다(2026-10-15).
 * 엔진 장부의 대조군(engine-ledger-record)이 엔진과 **같은 규칙**으로 유니버스를 거르도록 한 곳에 둔다.
 */
// 2026-06-13: 현금성/금리 ETF 제외 (사용자 "KODEX CD금리액티브가 전기차 관련주?" — deadCross fix 가
//   평탄MA 금리ETF 를 언블록해 포트폴리오 유입 + LLM 이 "전기차 수요" 등 환각 근거 부착). MMF/CD/KOFR/
//   통안/단기금융 = 주차용 현금성 — 매수 추천 프레임 부적합(레버리지/인버스와 동일 취지). 이름패턴 +
//   초저변동(52주 레인지<5% = 현금성) 2중 감지.
export function isCashLikeEtf(name, hi52, lo52) {
  const n = String(name ?? '');
  if (/금리|KOFR|\bCD\b|MMF|머니\s*마켓|머니마켓|통안|단기\s*금융|초단기|현금성|단기통안|파킹|양도성예금/i.test(n)) return true;
  if (hi52 > 0 && lo52 > 0 && (hi52 / lo52 - 1) < 0.05) return true; // 52주 레인지 <5% = 현금성(금리ETF)
  return false;
}

// 2026-06-14: 일반 ETF 식별 — 사용자 "ETF는 ETF 섹션에서 다뤄, 매수추천(종목 포트폴리오)에선 빼.
//   US/KR 나눠서". 종목 풀(KOSPI/KOSDAQ·미국주식)에 ETF(TIGER 미국배당·KODEX 200·미국지수추종 등)가
//   섞여 환각근거 붙던 문제. US=cap'etf', KR=브랜드명(meta cap 은 'kr' 이라 이름으로). ETF 는 etfStrategy
//   섹션이 별도 담당. (과거 '일반ETF 추천허용' 지시를 사용자가 명시 변경 — [[feedback_etf-recommendation-ok]])
const KR_ETF_BRAND = /^(TIGER|KODEX|KBSTAR|ARIRANG|ACE|SOL|KINDEX|HANARO|PLUS|RISE|KOSEF|TIMEFOLIO|KCGI|마이티|히어로즈|마이다스|파워|FOCUS|포커스|WON|TREX|BNK|에셋플러스|마이다스)\b/i;
export function isEtf(ticker, meta) {
  if (/etf/i.test(meta?.cap ?? '')) return true;            // US ETF (cap 밴드)
  const n = String(meta?.name ?? '');
  if (KR_ETF_BRAND.test(n)) return true;                    // KR ETF 브랜드 prefix
  if (/레버리지|인버스|\bETF\b|미국\s*(S&P|S\&P|나스닥|다우|배당)|채권|국채|회사채/i.test(n)) return true;
  return false;
}
