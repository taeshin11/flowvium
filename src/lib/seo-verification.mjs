// seo-verification.mjs — 검색엔진 소유 확인 코드 목록(환경변수 한 칸에 쉼표로 여러 개). 2026-11-08.
// 새 코드를 받아도 기존 코드를 빼지 않는다 — 이미 확인된 속성이 풀리지 않게.
export function verificationCodes(raw) {
  return [...new Set(String(raw ?? '').split(/[\s,]+/).filter(Boolean))];
}
