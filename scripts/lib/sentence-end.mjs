/**
 * sentence-end.mjs — "이 마침표가 문장 끝인가" 를 판정하는 **단 하나의** 규칙.
 *
 * 왜 한 곳으로 모으나 (2026-09-02):
 *   같은 판정이 두 곳에 따로 있었고, 둘 다 틀린 데다 **틀린 방식이 서로 달랐다.**
 *     subtitle.mjs   SENT_END        — 토큰이 마침표로 끝나면 큐를 닫았다
 *                                      → 화면에 "The U.S." · "Dr." 만 뜨는 조각 자막
 *     script-budget  splitSentences  — 마침표를 만나면 그 자리에서 문장을 끊었다
 *                                      → "a dividend of 0." / "50 Canadian dollars" 로 쪼개지고
 *                                        예산 절삭이 뒤를 버려 숫자가 잘린 채 방송됐다
 *   두 파일 모두 주석에는 "소수점·약어를 오인하지 않는다" 고 적혀 있었다. **둘 다 그 검사가
 *   코드에 없었다.** 방어를 주장하는 주석이 있으면 아무도 다시 안 본다 — 그게 이 결함이
 *   오래 산 이유다. 규칙을 두 곳에 두면 또 어긋나므로 여기 하나만 둔다.
 *
 *   발견 경로: 업로드된 영상(youtu.be/ZqfPqLFtaJQ)에서 프레임을 뽑아 눈으로 봤다.
 *   원문 헤드라인은 "Tourmaline Oil declares CAD 0.50 dividend" 였다.
 */

/** 종결부호 + 닫는 따옴표·괄호까지. 이 뒤에 글자가 더 있으면 문장 끝이 아니다. */
export const CLOSERS = '["\'’”)\\]]?';

/**
 * 머리글자 약어(U.S., U.K., A.I., B.C.) — 한 글자 + 마침표가 두 번 이상.
 * 목록이 아니라 **형태**로 판정하므로 새 약어가 나와도 자동으로 걸린다.
 */
export const INITIALISM = /^(?:[A-Za-z]\.){2,}$/;

/**
 * 형태만으로 못 거르는 약어. 목록은 최소로 둔다 —
 * 영어 철자법상 "Inc." 와 문장 끝 "Inc." 는 형태가 같아서 문맥 없이는 원리적으로 구분되지 않는다.
 * 그래서 아래 판정에서 이 목록은 **마지막 순서**다. 구조 신호로 먼저 거른 뒤 남는 것만 받는다.
 */
export const ABBREV = new Set([
  'inc.', 'corp.', 'ltd.', 'co.', 'llc.', 'plc.', 'ltda.',
  'mr.', 'mrs.', 'ms.', 'dr.', 'prof.', 'sr.', 'jr.', 'st.',
  'vs.', 'etc.', 'est.', 'no.', 'approx.', 'fig.', 'al.',
  'jan.', 'feb.', 'mar.', 'apr.', 'jun.', 'jul.', 'aug.', 'sep.', 'sept.', 'oct.', 'nov.', 'dec.',
]);

const PUNCT = /[.!?。！？]/;
const ENDS_WITH_PUNCT = new RegExp(`${PUNCT.source}${CLOSERS}$`);

/**
 * 이 토큰에서 문장이 끝나는가.
 *
 * 판정 순서 — 구조 신호를 목록보다 먼저 본다:
 *   ① 종결부호로 안 끝나면 문장 끝이 아니다
 *   ② 숫자.숫자 꼴이면 소수다 ("0.50" · "9.1") — 토큰이 숫자로 끝나므로 ①에서 이미 걸러지지만,
 *      "0.50." 처럼 문장 끝에 온 소수도 있으므로 명시한다
 *   ③ 머리글자 약어면 아니다 (형태 판정)
 *   ④ 다음 단어가 소문자로 시작하면 문장이 이어진다 — 목록 없이 쓰는 가장 넓은 신호.
 *      "Inc. reported" · "Dr. said" 를 전부 덮는다
 *   ⑤ 그래도 남는 것(뒤가 대문자인 "Dr. Powell" · "St. Louis")만 목록으로 받는다
 *
 * 알려진 한계: "Shares fell in the U.S. Markets rallied" 처럼 약어가 **실제로** 문장 끝인
 *   경우는 붙여 버린다. 의미 없이는 "U.S. Markets"(복합어)와 "U.S. | Markets"(경계)를 가를 수
 *   없다. 붙은 쪽은 읽히지만 쪼갠 쪽은 화면이 고장나 보이므로 안전한 쪽을 기본으로 둔다.
 *
 * @param {string} token 지금 토큰(공백으로 끊은 한 낱말)
 * @param {string} [next] 다음 토큰. 없으면 문장 끝으로 본다.
 */
export function isSentenceEnd(token, next) {
  const t = String(token ?? '');
  if (!ENDS_WITH_PUNCT.test(t)) return false;                       // ①
  if (/^\d+[.,]\d/.test(t)) return false;                            // ②
  if (INITIALISM.test(t)) return false;                              // ③
  if (next && /^[a-zß-ɏ]/.test(String(next))) return false; // ④
  if (ABBREV.has(t.toLowerCase())) return false;                     // ⑤
  return true;
}

/**
 * 문장 단위로 나눈다. 종결부호는 앞 문장에 남는다.
 *
 * 글자 하나씩 훑으며 마침표에서 끊던 종전 방식은 "0.50" 을 반토막 냈다.
 * 낱말 단위로 보고 isSentenceEnd 로 판정한다 — 그래야 뒤 낱말을 볼 수 있다.
 *
 * @param {string} text
 * @returns {string[]} 문장 배열. 빈 입력이면 빈 배열(예외 아님).
 */
export function splitIntoSentences(text) {
  const t = String(text ?? '').trim();
  if (!t) return [];
  const words = t.split(/\s+/);
  const out = [];
  let buf = [];
  for (let i = 0; i < words.length; i++) {
    buf.push(words[i]);
    if (isSentenceEnd(words[i], words[i + 1])) { out.push(buf.join(' ')); buf = []; }
  }
  if (buf.length) out.push(buf.join(' '));
  return out;
}
