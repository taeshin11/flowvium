/**
 * macro-cache-key.ts — /api/macro-indicators Redis 키(KST 날짜별)를 한 곳에서. 2026-10-16.
 * 왜: 라우트 결과 형식을 고쳐도(발표일=FRED 공개일·직전값 라이브·ISM 정적 제외) 키 사본 8곳이 각자 v13 을 읽어
 *   하루 동안 옛 값이 나갔다(fedwatch 와 같은 일). 버전은 여기서만 올린다.
 */
export function macroCacheKey(kstDate: string): string {
  return `flowvium:macro-indicators:v14:${kstDate}`;
}
