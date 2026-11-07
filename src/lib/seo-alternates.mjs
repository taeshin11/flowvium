/**
 * seo-alternates.mjs — 언어판 주소(hreflang) 목록. 2026-11-07 신설.
 * 왜: seo.ts 가 16개 언어를 따로 들고 있었다. 사이트 언어는 9/18 부터 en·ko·ja 셋(i18n/routing.ts 가 유일한 출처)인데
 *   모든 페이지가 구글에 13개 없는 언어판(/zh-CN/… 404)을 알리고 있었다. 언어 목록은 받아서만 쓴다.
 * en 은 접두사 없음(localePrefix 'as-needed').
 */
export function alternateLanguages(path, locales, base) {
  const out = { 'x-default': `${base}${path}` };
  for (const loc of locales) out[loc] = loc === 'en' ? `${base}${path}` : `${base}/${loc}${path}`;
  return out;
}
