/**
 * currency-format.mjs — 발간 텍스트의 통화 표기 정규화.
 *
 * 배경(2026-08-20 발간본 눈검증): 같은 줄에서 표기가 갈렸다.
 *   "현재 ₩1397000 → 손절선 ~₩1299210.00 (-7%) / 200MA 위(₩1,224,720), 52주:₩1,022,000-₩1,630,000"
 *   코드가 만든 값(MA·52주)에는 구분자가 있고 LLM 이 쓴 값(현재·손절선)에는 없다.
 *   원화인데 소수점 2자리까지 붙었다 — 원은 소수 단위가 없다.
 *
 *   generate-report-local.mjs 6i 의 정규화는 '값이 5% 이상 어긋날 때만' 돈다.
 *   값이 맞고 표기만 틀리면 통과해 버린다 — 서식 교정이 값 교정에 종속돼 있었다.
 *   여기서는 값을 바꾸지 않고 표기만 맞춘다. 두 관심사를 분리한다.
 *
 * 원칙: 통화 기호가 붙은 숫자만 건드린다. RSI·거래량·연도 같은 맨숫자는 손대지 않는다.
 */

// ₩/$ 뒤의 숫자(구분자·소수 포함). 앞에 기호가 있을 때만 매칭한다.
// 2026-08-20: 종전 [\d,]* 는 뒤따르는 문장부호까지 삼켰다 —
//   "…-₩1,630,000, 진입지지선:" 에서 "₩1,630,000," 이 매칭돼 정상값을 결함으로 봤다.
//   숫자는 반드시 숫자로 끝나야 한다.
const KRW = /₩\s?(\d(?:[\d,]*\d)?(?:\.\d+)?)/g;
const USD = /\$\s?(\d(?:[\d,]*\d)?(?:\.\d+)?)/g;

const toNum = (s) => parseFloat(String(s).replace(/,/g, ''));

/** 원화: 정수 + 천단위 구분자. 달러: 소수 2자리까지 + 천단위 구분자. */
export function normalizeCurrencyText(text) {
  const s = String(text ?? '');
  if (!s) return '';
  return s
    .replace(KRW, (m, num) => {
      const n = toNum(num);
      return Number.isFinite(n) ? `₩${Math.round(n).toLocaleString('en-US')}` : m;
    })
    .replace(USD, (m, num) => {
      const n = toNum(num);
      if (!Number.isFinite(n)) return m;
      // 소수 자리는 원문이 가진 만큼(최대 2)만 — 정수였던 값에 .00 을 붙이지 않는다.
      const decimals = /\.\d+$/.test(num) ? Math.min(2, num.split('.')[1].length) : 0;
      return `$${n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
    });
}

/**
 * 잘못 표기된 통화 값들. 검증/게이트가 '남아 있는지' 확인할 때 쓴다.
 * @returns {string[]} 원문에 있던 잘못된 표기들
 */
export function findBadCurrency(text) {
  const s = String(text ?? '');
  const out = [];
  for (const m of s.matchAll(KRW)) {
    const raw = m[0], num = m[1];
    const n = toNum(num);
    if (!Number.isFinite(n)) continue;
    const want = `₩${Math.round(n).toLocaleString('en-US')}`;
    if (raw.replace(/\s/g, '') !== want) out.push(raw);
  }
  return out;
}
