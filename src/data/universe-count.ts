// 모니터링 유니버스 종목 수 — candidate-tickers.json 의 total 과 동기화.
// 2026-06-03: 사이트가 allCompanies(정적 프로필 ~637)를 "기업 수"로 표시 → 실제 모니터링 풀(1210)
//   과소표시 문제 fix. 이 상수를 "모니터링 종목 수" 라벨에 사용.
// ⚠️ candidate-tickers.json 의 total 이 바뀌면 이 값도 갱신 — audit-coverage 가 drift 감지.
export const UNIVERSE_COUNT = 1210;
