/**
 * topic-mix.mjs — 쇼츠 주제 배분(11/02 주제·흐름 점검, 자문 셋 합의). 규칙·근거는 topic-mix.test.mjs 머리말.
 */
// 돈과 이어진 낱말 — 정치 기사라도 이게 있으면 시청자 지갑과 이어진다(세법·예산·연금·부동산·관세·환율·시장).
const MONEY = ['세수', '세법', '세제', '세금', '과세', '감세', '증세', '예산', '재원', '재정', '기금', '연금', '부동산', '집값', '주택', '대출', '금리',
  '환율', '관세', '수출', '수입', '무역', '증시', '코스피', '주가', '주식', '투자', '물가', '임금', '최저임금', '전기요금', '가스요금', '보조금', '지원금',
  '반도체', '기업', '경제', '성장률', '일자리', '고용', '달러', '원화', '배당', '상속', '증여'];
export function isMoneyLinked(headline) {
  const h = String(headline ?? '');
  return MONEY.some((w) => h.includes(w));
}
/** 국내정치 중 돈과 안 이어진 공방을 뒤로 민다(안정 정렬, 지우지 않는다). */
export function demoteSquabble(head) {
  const squabble = (c) => c.__topic === '국내정치' && !isMoneyLinked((c.headlines ?? [])[0] ?? c.keyword);
  return [...head].map((c, i) => ({ c, i, s: squabble(c) ? 1 : 0 })).sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.c);
}
/** data/season-terms.json 중 오늘(KST) 기간 안의 낱말. */
export function activeSeasonTerms(list, now = Date.now()) {
  const d = new Date(now + 9 * 3600e3).toISOString().slice(0, 10);
  return (list ?? []).filter((x) => x?.term && x.from <= d && d <= x.to).map((x) => x.term);
}
