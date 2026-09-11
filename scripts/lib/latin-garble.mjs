/**
 * latin-garble.mjs — 한글에 섞인 라틴 조각 중 **깨진 것만** 골라낸다.
 *
 * 왜 (2026-09-12): verify-report 가 "Humped regime에서" 를 garble 로 찍어 push 를 막았다.
 *   regime 은 변동성 곡선 형태를 가리키는 금융 용어다 — 정상 영문에 조사가 붙었을 뿐이다.
 *   실제 garble 은 "레지gio" · "컨ti(gio" · "스que이즈" 처럼 한글 단어 한가운데서 라틴이 튀어나온 것이다.
 *
 * 가르는 기준은 **라틴 앞** 이다:
 *   공백이나 문장 시작 뒤 → 독립된 영어 단어(뒤에 조사가 붙을 수 있다) → 정상
 *   한글 바로 뒤          → 단어가 깨진 것 → garble
 *
 * 오탐은 그냥 소음이 아니다 — push 를 막고, 사람을 멀쩡한 문장을 고치러 보낸다.
 */

/** 단위·약어는 한글에 바로 붙어도 정상이다(10bp, 매출yoy). */
const UNIT_OK = /^(bp|ma|pe|ev|roe|roa|eps|yoy|qoq|etf|it|ai|us|kr|gpu|cpu|hbm|cpi|ppi|gdp|fx|oas|ig|hy)$/i;

/**
 * 깨진 라틴 조각들. 없으면 빈 배열.
 * 한글 **바로 뒤**에 붙은 라틴만 본다 — 공백 뒤 라틴은 영어 단어라 건드리지 않는다.
 */
export function latinGarbleFragments(text) {
  const s = String(text ?? '');
  if (!s) return [];
  const out = new Set();
  // ① 한글 + 라틴 (한글이 앞에 붙어 있다 = 단어 중간이 깨졌다)
  for (const m of s.match(/[가-힣][a-z]{2,6}/g) ?? []) {
    const lat = m.replace(/[가-힣]/g, '');
    if (!UNIT_OK.test(lat)) out.add(lat);
  }
  // ② 라틴 + 한글 인데 **앞이 한글인 경우만** — 공백/시작 뒤면 영어 단어 + 조사라 정상이다.
  for (const m of s.match(/[가-힣][a-z]{2,6}[가-힣]/g) ?? []) {
    const lat = m.replace(/[가-힣]/g, '');
    if (!UNIT_OK.test(lat)) out.add(lat);
  }
  return [...out];
}
