/**
 * translation-drift.mjs — "다른 로케일은 번역했는데 이 로케일만 영문" 인 키를 찾는다.
 *
 * 왜 필요한가(2026-08-21): /ko/report 의 내러티브 라벨이 WHY / WATCH / STORY 였다.
 *   16개 로케일 중 11개가 번역했고(fr POURQUOI · ru ПОЧЕМУ · th ทำไม) ko·ja·zh 만 영문이었다.
 *   화면을 훑는 영문 누출 검사기는 이걸 못 잡는다 — 티커·약어를 거르려고 ^[A-Z]{2,6}$ 를 제외하기 때문이다.
 *
 *   판단을 사람이 하지 않아도 되게, 카탈로그끼리 비교한다:
 *   *다른 로케일이 번역한 키를 이 로케일만 영문으로 두었나*.
 *   CEO·ROE·FAQ 처럼 모두가 영문으로 둔 키는 보편 용어라 자동으로 빠진다 — 목록을 손으로 안 적는다.
 *
 * 한계(실측): 유럽어는 동족어 때문에 오탐이 많다.
 *   es 'Sector' · fr 'Date' · fr 'Impact' 는 그 언어에서도 같은 철자다(de 374 · fr 369 건 검출).
 *   CJK 는 동족어가 없어 신호가 확실하다(ko 18 · ja 94 · zh 92).
 *   그래서 siblingDrift 로 '같은 문자권 형제가 번역했는가' 를 따로 본다 — 가장 확실한 신호다.
 */

/** 번역 대상이 될 수 있는 값인가 (숫자·기호만인 값 제외) */
function translatable(v) {
  return typeof v === 'string' && v.trim().length >= 2 && /[A-Za-z]{2}/.test(v);
}

/**
 * @param {Record<string, Record<string,string>>} catalogs  로케일 → (키 → 값). 'en' 필수.
 * @param {string} locale  검사 대상 로케일
 * @returns {Array<{key:string, en:string, translatedBy:string[]}>}
 */
export function translationDrift(catalogs, locale) {
  if (!catalogs || typeof catalogs !== 'object') return [];
  const en = catalogs.en;
  const target = catalogs[locale];
  if (!en || !target) return [];
  const others = Object.keys(catalogs).filter((l) => l !== 'en' && l !== locale);
  const out = [];
  for (const [k, v] of Object.entries(en)) {
    if (!translatable(v)) continue;
    if (target[k] !== v) continue;                       // 이미 번역됨
    const translatedBy = others.filter((l) => k in catalogs[l] && catalogs[l][k] !== v);
    if (translatedBy.length === 0) continue;             // 아무도 번역 안 함 → 보편 용어
    out.push({ key: k, en: v, translatedBy });
  }
  return out;
}

/**
 * 같은 문자권 '형제' 로케일이 번역한 키만. 동족어 오탐이 없어 신호가 가장 확실하다.
 * @param {string[]} siblings  예: ko 에 대해 ['ja','zh-CN','zh-TW']
 * @returns {Array<{key:string, en:string, siblings:Record<string,string>}>}
 */
export function siblingDrift(catalogs, locale, siblings) {
  if (!Array.isArray(siblings) || siblings.length === 0) return [];
  const sibs = siblings.filter((s) => catalogs?.[s]);
  return translationDrift(catalogs, locale)
    .map((d) => {
      const translated = {};
      for (const s of sibs) if (catalogs[s][d.key] !== undefined && catalogs[s][d.key] !== d.en) translated[s] = catalogs[s][d.key];
      return { key: d.key, en: d.en, siblings: translated };
    })
    .filter((d) => Object.keys(d.siblings).length > 0);
}
