/**
 * ticker.mjs — 티커 형식 판정의 단일 규칙.
 *
 * 왜 생겼나(2026-08-21 DB 감사): 아카이브에 티커가 아닌 값이 저장돼 있었다.
 *   short_squeeze_archive.ticker = '[TICKER]' 2행 — 프롬프트 템플릿 문자열이 그대로 들어갔다
 *   insider_archive.ticker      = 'N/A'       1행
 *   저장 경로(db.mjs)는 `s.ticker ?? ''` 로 무검증이었다.
 *
 *   같은 정규식이 generate-report-local 두 곳(:3816 insider 필터, :8012 grounded 집계)에
 *   복제돼 있었다. 복제된 규칙은 한쪽만 고쳐져 조용히 어긋난다 — 한 곳으로 모은다.
 *
 * 규칙: 첫 글자는 영숫자, 이후 영숫자·점·하이픈, 총 12자 이내.
 *   BRK.B · 005930.KS · RDS-A 를 허용하고 '[TICKER]' · 'N/A' · 회사명을 거부한다.
 */
export const TICKER_RX = /^[A-Z0-9][A-Z0-9.\-]{0,11}$/;

/** @param {unknown} v @returns {boolean} */
export function isTicker(v) {
  if (typeof v !== 'string') return false;
  const t = v.trim().toUpperCase();
  return t.length > 0 && TICKER_RX.test(t);
}
