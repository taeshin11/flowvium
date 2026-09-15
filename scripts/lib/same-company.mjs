/**
 * same-company.mjs — 티커가 달라도 같은 회사인가. (2026-09-15 신설)
 *
 * 왜 (사용자 "이거 왜 두개냐? 맞는거임?" · 실측):
 *   2026-09-15 morning·noon 두 회차가 **GOOGL 25% + GOOG 18% 를 따로 추천**했다.
 *   둘은 알파벳 A주와 C주다. 한 회사에 43% 를 넣은 것이고, 보는 사람에게는
 *   "AI/클라우드" 와 "반도체" 라는 다른 종목으로 보인다.
 *
 *   막았어야 할 자리가 둘 다 티커 문자열만 봤다:
 *     · 재충원(refill)  `!have.has(c.ticker)` — GOOGL 이 있어도 GOOG 는 통과
 *     · 최종 중복검사    대문자·점 제거 정규화 — GOOGL ≠ GOOG 라 안 걸림
 *       (그 검사의 주석은 "NVDA + NVIDIA" 를 잡는다고 적혀 있다. 이름 표기 차이는 잡지만
 *        **복수 종류주(dual-class)** 는 애초에 대상이 아니었다.)
 *
 * 짝 목록을 손으로 적지 않는다 — 곧 낡고, 새 종목이 상장되면 또 빠진다.
 *   **회사 이름으로 판단한다.** data/company-names.json 이 GOOG·GOOGL 을 모두
 *   "Alphabet Inc." 로 적고 있다. 이름이 없으면 판정하지 않는다(모르면 막지 않는다 —
 *   멀쩡한 종목을 잃는 쪽이 더 나쁘다).
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

let _names = null;
function nameMap() {
  if (_names) return _names;
  try {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const j = JSON.parse(readFileSync(resolve(root, 'data/company-names.json'), 'utf8'));
    _names = j?.map ?? j ?? {};
  } catch { _names = {}; }
  return _names;
}

/**
 * 비교용 회사 이름. 종류주 표기와 법인격 접미사를 떼어 같은 회사를 같은 값으로 만든다.
 *   "Fox Corporation (Class A)" 와 "Fox Corporation (Class B)" → "fox corporation"
 */
export function companyKey(ticker, names = nameMap()) {
  const raw = names[String(ticker ?? '').toUpperCase()];
  if (!raw || typeof raw !== 'string') return null;
  return raw
    .toLowerCase()
    .replace(/\(\s*class\s+[a-z]\s*\)/g, ' ')          // (Class A)
    .replace(/\bclass\s+[a-z]\b/g, ' ')                // Class A
    .replace(/[,.]/g, ' ')
    .replace(/\b(inc|corp|corporation|co|ltd|limited|plc|holdings|group|company)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || null;
}

/** 두 티커가 같은 회사인가. 한쪽이라도 이름을 모르면 false — 모르면 막지 않는다. */
export function sameCompany(a, b, names = nameMap()) {
  if (!a || !b) return false;
  if (String(a).toUpperCase() === String(b).toUpperCase()) return true;
  const ka = companyKey(a, names); const kb = companyKey(b, names);
  return !!ka && !!kb && ka === kb;
}

/** 이미 담긴 종목들과 같은 회사인가. 재충원·중복검사가 같은 판단을 쓰게 한다. */
export function alreadyHeld(ticker, held, names = nameMap()) {
  return (held ?? []).some((h) => sameCompany(ticker, h, names));
}
