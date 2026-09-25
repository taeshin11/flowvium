/**
 * kr-latin.mjs — 대문자 영문 약어를 **소리 나는 대로 한글로**. TTS 에 먹이기 전에 쓴다. (2026-09-25 신설)
 *
 * 왜 (시청자 댓글 "G20을 <지이영>으로 발음하는 AI가 너무 싫어"):
 *   되들어 보니(Melo → whisper small) G20 만이 아니었다.
 *     OECD → "띠" · GDP → "뿐" · IMF → "네" · SK하이닉스 → "피하이닉스" · LG전자 → "외전자"
 *     KOSPI → 알아들을 수 없음 · G20 → "지이영"(숫자를 한 자씩)
 *   한글 글자 이름으로 주면 제대로 읽었다: 오이씨디 → OECD · 지디피 → GDP · 아이엠에프 → IMF.
 *   글자와 숫자 사이엔 **쉼표**(짧은 쉼)를 둔다 — 문장 안에서 "지이십" 은 "지의식", "지 이십" 은 "치 20" 으로
 *   뭉개졌고 "지, 이십" 이 G20 으로 들렸다.
 *   kr-number.speakNumbers 가 G20 을 "이름이라 건드리지 않는다" 며 넘긴 자리가 바로 이것이었다.
 *
 * 건드리는 것: 대문자가 들어 있고 **소문자·점이 없는** 영숫자 덩어리(OECD, G20, F-35, 5G, SK).
 * 건드리지 않는 것: 소문자가 섞인 영단어(Tesla, iPhone) · 주소(flowvium.net) — 글자로 읽으면 더 틀린다.
 *
 * 소리용이다. 자막에는 원문(G20)이 그대로 나간다(tts-korean 의 display).
 */

/** 영문 글자의 한국어 이름. 표준 외래어 표기의 알파벳 이름을 따른다. */
export const LETTER = {
  A: '에이', B: '비', C: '씨', D: '디', E: '이', F: '에프', G: '지', H: '에이치', I: '아이',
  J: '제이', K: '케이', L: '엘', M: '엠', N: '엔', O: '오', P: '피', Q: '큐', R: '알', S: '에스',
  T: '티', U: '유', V: '브이', W: '더블유', X: '엑스', Y: '와이', Z: '제트',
};

/**
 * **낱말처럼** 읽는 약어. 글자로 풀면 틀린다(APEC → "에이피이씨" 는 되들음에서 "AP시" 가 됐다).
 * 한국 뉴스에서 실제로 그렇게 읽는 것만 둔다 — 모르는 약어는 글자로 읽는 것이 안전하다.
 */
const AS_WORD = {
  NATO: '나토', KOSPI: '코스피', KOSDAQ: '코스닥', NASDAQ: '나스닥', OPEC: '오펙', APEC: '에이펙',
  ASEAN: '아세안', NASA: '나사', UNESCO: '유네스코', UNICEF: '유니세프', FIFA: '피파', BRICS: '브릭스',
  // 2026-09-25 AI·반도체 업계 낱말(테크이슈 세션 실측: NVIDIA → "엔브이아이디아이에이", DRAM → "디알에이엠").
  NVIDIA: '엔비디아', DRAM: '디램', NAND: '낸드', CUDA: '쿠다', ARM: '암',
};

/** 약어 뒤에 붙어도 띄우지 않는 조사. 이 밖의 한글이 붙으면 이름의 일부다(SK하이닉스 → "에스케이 하이닉스"). */
const PARTICLE = /^(?:이|가|은|는|을|를|의|에|도|만|와|과|로|으로|에서|에게|까지|부터|처럼|보다|이다|이라|라고|이나|나|랑|이랑)(?![가-힣])/;

/** 영숫자 덩어리 하나를 소리로. 대문자가 없거나 소문자·점이 있으면 null(건드리지 않음). */
function readToken(tok, overrides = {}) {
  if (!/[A-Z]/.test(tok) || /[a-z.]/.test(tok)) return null;
  if (overrides[tok] != null) return overrides[tok];
  if (AS_WORD[tok]) return AS_WORD[tok];
  // 글자 묶음과 숫자 묶음을 나눠 띄운다. 하이픈은 쉼 — 공백으로(F-35 → 에프 35).
  const parts = tok.split('-').filter(Boolean).flatMap((p) => p.match(/[A-Z]+|\d+/g) ?? []);
  // 글자 → 숫자로 넘어가는 자리는 쉼표(짧은 쉼)로. 띄움만으로는 문장 안에서 뭉개졌다(2026-09-25 되들음:
  //   "지 이십" → "치 20" · "지, 이십" → G20 · "에프, 삼십오" → F-35). 숫자 → 글자(5G)는 한 낱말처럼 읽는다.
  const read = parts.map((p) => (/^\d/.test(p) ? p : AS_WORD[p] ?? [...p].map((c) => LETTER[c] ?? c).join('')));
  return read.reduce((acc, r, i) => (i === 0 ? r : acc + (/^\d/.test(parts[i]) && !/^\d/.test(parts[i - 1]) ? ', ' : ' ') + r), '');
}

/**
 * 문장 안의 대문자 약어를 한글 읽기로. 숫자는 남겨 둔다 — 뒤이어 speakNumbers 가 읽는다.
 * @param {string} text
 * @returns {string}
 */
export function speakLatin(text, { overrides = {} } = {}) {
  return String(text ?? '').replace(/[A-Za-z0-9][A-Za-z0-9.\-]*/g, (tok, at, whole) => {
    const read = readToken(tok.replace(/[.\-]+$/, ''), overrides);
    if (read == null) return tok;
    const tail = tok.slice(tok.replace(/[.\-]+$/, '').length);
    // 바로 뒤에 한글이 붙으면: 조사면 붙여 두고, 이름의 일부면 띄운다(SK하이닉스 · LG전자).
    const next = whole.slice(at + tok.length);
    const gap = /^[가-힣]/.test(next) && !PARTICLE.test(next) ? ' ' : '';
    return read + tail + gap;
  });
}

/** 소리를 판정할 약어인가(speakLatin 이 손대는 것과 같은 기준). */
export function isLatinTerm(tok) {
  return /[A-Z]/.test(tok) && !/[a-z.]/.test(tok);
}

/**
 * 약어 하나를 **다른 표기**로. 되들음에서 기본 읽기가 안 들렸을 때 ear-check 가 차례로 시도한다.
 *   dot    — 글자 뒤에 마침표 쉼("지. 20")   · spaced — 글자마다 띄움("지 디 피")
 *   commas — 글자마다 쉼표("지, 디, 피")
 */
export function spellTerm(term, style) {
  const parts = String(term).split('-').filter(Boolean).flatMap((p) => p.match(/[A-Z]+|\d+/g) ?? []);
  const inner = style === 'spaced' ? ' ' : style === 'commas' ? ', ' : '';
  const join = style === 'dot' ? '. ' : style === 'commas' ? ', ' : ' ';
  return parts.map((p) => (/^\d/.test(p) ? p : [...p].map((c) => LETTER[c] ?? c).join(inner))).join(join);
}
