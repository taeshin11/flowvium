/**
 * credit-cache-key.ts — /api/credit-balance Redis 키(UTC 날짜별)를 한 곳에서. 2026-10-16(키 사본 5곳 — macro·fedwatch 와 같은 일).
 * v4: 고점·리스크 문장을 시계열에서 계산하도록 바뀐 응답(사이트 눈검증).
 */
export function creditCacheKey(utcDate: string = new Date().toISOString().slice(0, 10)): string {
  return `flowvium:credit-balance:v4:${utcDate}`;
}
