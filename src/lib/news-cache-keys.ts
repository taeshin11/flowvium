/**
 * news-cache-keys.ts (scripts/lib/news-cache-keys.mjs 의 웹 미러 — 둘을 함께 고칠 것)
 *
 * news-cache-keys.ts — 뉴스 캐시 Redis 키의 단일 소스.
 *
 * 배경(2026-08-20 실측): 한국어 홈에 영문 뉴스 헤드라인이 나왔다. Redis 에는 한국어 번역본이
 *   멀쩡히 있었다 — flowvium:news-cascade:v2:translated:ko:2026-08-20 → "코스피 매수 사이드카 발동…"
 *   그런데 읽는 쪽(latest-updates/route.ts:288)이 v1 을 보고 있었다. 항상 미스 →
 *   영어 리스트 캐시로 폴백 → 한국어 페이지에 영문.
 *
 *   news-cascade 가 v1→v2 로 올린 건 fd893795(5월)인데 latest-updates 가 안 따라왔다.
 *   키 문자열을 양쪽에 각각 적어두면 한쪽만 고쳐도 신호가 없다 — 캐시 미스는 조용하기 때문이다.
 *   버전을 올릴 일이 또 있을 테니, 그때 한 곳만 고치면 되도록 여기로 모은다.
 */

const today = () => new Date().toISOString().slice(0, 10);

/** 영문 기사 리스트 (locale 무관). */
export function listKey(day: string = today()): string {
  return `flowvium:news-cascade:v1:list:${day}`;
}

/**
 * locale 별 번역 캐시.
 * v2 (2026-05-12): cascade.reason + timeframe 도 번역에 포함 — v1 캐시 무효화.
 */
export function translatedKey(locale: string, day: string = today()): string {
  return `flowvium:news-cascade:v2:translated:${locale}:${day}`;
}

/**
 * stale 번역 폴백 (2026-08-20 신설).
 * translatedKey 는 TTL 6h + 날짜 포함이라 하루에도 여러 번 비고, 그때 한국어 사용자에게 영문이 나갔다.
 * 한국어 독자에게는 '조금 지난 한국어'가 '방금 만든 영어'보다 낫다.
 * 날짜를 넣지 않는다 — 자정에 끊기면 폴백이 성립하지 않는다.
 */
export function staleTranslatedKey(locale: string): string {
  return `flowvium:news-cascade:v2:translated:stale:${locale}`;
}

/** 생성 중 락. */
export const LOCK_KEY = 'flowvium:news-cascade:v1:generating';
