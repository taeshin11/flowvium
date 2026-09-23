/**
 * translation-shape.mjs — 돌아온 것이 **번역 모양인가.** (2026-09-23 신설)
 *
 * 왜: 번역 시드를 agy 사슬로 옮긴 직후 사전에 이것이 들어갔다 —
 *     tyChg3m → "tyChg3m"은 번역 가능한 단어나 문장이 아닌 임의의 영숫자 문자열로 보입니다.
 *               번역할 수 있는 텍스트를 제공해 주세요.
 *   번역 대신 **번역에 대한 설명**이다. 기존 관문은 전부 통과했다 — 한국어이고,
 *   음차 중단도 없고, 한자도 없다. 내용이 다르다는 것을 아무도 안 봤다.
 *
 * 문구 목록으로 막지 않는다 — 다음엔 다른 말로 온다. **모양**을 본다:
 *   · 번역문은 원문보다 몇 배씩 길어지지 않는다. 설명은 길어진다.
 *     실측 — "Short squeeze candidate"(23) → "숏 스퀴즈 후보"(8)
 *             "industrial conglomerate"(23) → "산업 복합 기업"(9)
 *             "tyChg3m"(7) → 61자 (8.7배)
 *   · 번역문은 원문을 **따옴표로 인용하지 않는다.** 설명은 인용한다("tyChg3m"은 …).
 *
 * 짧은 원문에는 여유를 둔다 — 약어는 원래 늘어난다(ROE → 자기자본이익률, 3자 → 7자).
 *   그래서 비율만 보지 않고 절대 하한(MIN_ALLOWED)을 함께 둔다.
 */

/**
 * 허용 길이 = BASE + 원문길이 × SLOPE.
 *
 * 배수만 쓰면 긴 원문에서 샌다 — 실측: 62자 영문에 설명을 덧붙인 120자 답이 3배(186) 안에 들어왔다.
 *   한국어 번역은 영문 원문보다 대개 **짧다.** 그래서 기울기를 1.2 로 두고,
 *   짧은 원문에는 절대 여유(BASE)를 준다 — 약어는 늘어난다(ROE 3자 → 자기자본이익률 7자).
 * 실측 대조: Short squeeze candidate(23)→8 · industrial conglomerate(23)→9 ·
 *            연준 문장(62)→24  |  걸러야 할 것: tyChg3m(7)→61 · 연준+설명(62)→120
 */
const BASE = 24;
const SLOPE = 1.2;

/**
 * @param {string} src  원문
 * @param {unknown} out 돌아온 것
 * @returns {boolean} 번역으로 받아도 되는가
 */
export function looksLikeTranslation(src, out) {
  const s = String(src ?? '').trim();
  const t = String(out ?? '').trim();
  if (!t) return false;
  if (t.length > BASE + s.length * SLOPE) return false;
  // 원문을 따옴표로 되뇌면 설명이다. 원문 자체에 따옴표가 있으면 이 판정을 쓰지 않는다.
  if (s && !/["“”']/.test(s)) {
    const quoted = new RegExp(`["“']\\s*${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*["”']`, 'i');
    if (quoted.test(t)) return false;
  }
  return true;
}
