/**
 * company-name-plausible.mjs — 티커 메타의 name 이 '회사명'인지 판정.
 *
 * 배경(2026-08-20): 티커→한국어명(권위)과 티커→영문명을 조인해 확정 번역 사전을 채우려 했는데
 *   영문명 소스의 품질이 고르지 않았다. 실측:
 *     sp500 meta  GOOGL → "Mountain View, California"        (소재지)
 *     candidate   LOGI  → "PC Peripherals (Mice, Keyboards)"  (사업부문 설명)
 *   그대로 넣으면 "Mountain View, California → 구글" 이 사전에 확정으로 박힌다.
 *   사전은 TTL 이 없어서 한 번 잘못 들어가면 계속 잘못 나간다 — 넣기 전에 거른다.
 *
 *   회사 접미사(Inc./Corp./Ltd.)에는 쉼표가 정상적으로 들어가므로 쉼표만으로 거르면 안 된다.
 */

// 미국 주(州) — "City, California" 형태의 소재지를 회사명으로 오인하지 않기 위해.
const US_STATES = new RegExp(
  ',\\s*(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|'
  + 'Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|'
  + 'Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|'
  + 'Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|'
  + 'Virginia|Washington|West Virginia|Wisconsin|Wyoming|[A-Z]{2})\\s*$');

// 회사 접미사 — 쉼표가 있어도 정상인 형태.
const CORP_SUFFIX = /,\s*(Inc\.?|Corp\.?|Corporation|Ltd\.?|LLC|LP|PLC|Co\.?|Holdings?|Group|N\.?V\.?|S\.?A\.?|AG|SE)\s*$/i;

/**
 * @param {string} name
 * @returns {boolean} 회사명으로 볼 만한가
 */
export function isPlausibleCompanyName(name) {
  const s = String(name ?? '').trim();
  if (!/[A-Za-z]/.test(s)) return false;
  // 2글자는 대개 잡음이지만 숫자가 섞이면 실제 사명이다("3M"). 순수 2글자만 거른다.
  if (s.length < 3 && !/\d/.test(s)) return false;
  if (s.length < 2) return false;

  // [1] 괄호 안에 예시를 나열하는 형태는 사업부문 설명이다 — "PC Peripherals (Mice, Keyboards)"
  //     다만 "(The)" 는 설명이 아니라 표기 관습이다("Coca-Cola Company (The)") — 예외로 둔다.
  const withoutThe = s.replace(/\s*\(The\)\s*$/i, '');
  if (/\(.+\)/.test(withoutThe)) return false;

  // [2] 소재지 — 접미사가 회사형이면 회사명, 아니면 주소로 본다.
  if (US_STATES.test(withoutThe) && !CORP_SUFFIX.test(withoutThe)) return false;

  return true;
}
