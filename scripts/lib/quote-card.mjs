/**
 * quote-card.mjs — 헤드라인의 인용 발언을 화면 카드로.
 *
 * 왜 이게 필요한가(2026-08-27): "트럼프 기사면 트럼프가 뭘 하는 사진을 넣어야 하지 않나,
 *   X·페북·인스타에 있는 것도" — 맞는 지적이다. 아카이브의 취임 선서 사진은 **그 기사가 아니다.**
 *
 * 다만 SNS 원본을 긁는 대신 방송사가 실제로 하는 방식을 쓴다: **인용을 다시 그린다.**
 *   화면에 뜨는 건 트윗 스크린샷이 아니라 방송사가 만든 그래픽이다.
 *     · 원본 이미지를 복제하지 않는다 — 짧은 사실 진술의 보도 목적 인용이다.
 *     · 유튜브 재사용 심사에 걸리지 않는다 — 우리가 만든 그래픽이다.
 *     · 그리고 **그 사건이 화면에 직접 뜬다.** 일반 b-roll 보다 뉴스답다.
 *
 * 실측: 12시간 수집분 148건 중 78건에 인용부호나 says/said/told/posted 가 있다.
 */

/** 곧은 따옴표·곡선 따옴표·한국어 따옴표를 모두 본다. */
const OPEN = '"“‘「';
const CLOSE = '"”’」';
// 발언 신호. 이게 앞이나 뒤에 있어야 **작품 제목**과 구분된다 —
//   'star of "The Rocky Horror Picture Show," dies' 의 따옴표는 발언이 아니다.
const SAY = /\b(say|says|said|tells|told|posts|posted|writes|wrote|announce[sd]?|claims?|warns?|adds?|states?)\b|말했|밝혔|전했|덧붙였|강조했|주장했/i;

// 한국어 인용은 **인용격 조사**로 판별하는 편이 낫다(2026-09-03).
//   동사를 나열하면 계속 빠진다 — 실측에서 "예상했다" 하나 때문에 한국은행 발언을 통째로 놓쳤다:
//     한국은행은 2일 "9월 소비자물가 상승률은 …"이라고 예상했다.
//   지적했다·답했다·설명했다·촉구했다·반박했다·내다봤다… 를 언제까지 더할 수는 없다.
//   구조는 하나다: 닫는 따옴표 바로 뒤에 `라고`/`이라고`/`라며`/`고` 가 오고 서술어가 따른다.
//   그 조사를 보면 어떤 서술어가 와도 인용으로 잡힌다.
//   `라` 없이 바로 붙는 형태도 흔하다 — 실측에서 이것 때문에 대량으로 놓쳤다:
//     "내년부터 북미 수주 가속화가 기대된다"며 투자의견 '매수'를…
//     "정부 결정을 존중하되…"라며 / "…"이라고 / "…"고 말했다
//   그래서 (이?라) 를 **선택**으로 두고 고·며·면서를 받는다.
//   `는` 은 넣지 않는다 — "블랙핑크"는 … 처럼 인용이 아닌 주제 조사와 구분되지 않는다.
const KO_QUOTATIVE = /^\s*(이?라)?(고|며|면서)\s*\S/;

/**
 * 발언인가, 작품 제목인가.
 *
 * 실측(2026-08-27, 2,260건 스캔): says 뒤에 영화 제목이 오는 경우가 섞여 나왔다 —
 *   'James Gunn says "Superman: Man of Tomorrow"', 'said "Insidious 6"'.
 * 실제 발언은 문장 중간에서 잘라 인용하므로 **소문자로 시작**한다. 제목은 각 단어가 대문자다.
 * 대문자로 시작해도 6단어 이상이면 주장으로 본다("Nvidia Will Not Distribute Enough…").
 * 한국어·일본어·중국어는 대소문자가 없으니 이 규칙을 적용하지 않는다.
 */
function isSpeech(text) {
  if (/[\u3131-\uD79D\u3040-\u30FF\u4E00-\u9FFF]/.test(text)) return true;
  if (/^[a-z]/.test(text)) return true;
  return text.split(/\s+/).length >= 6;
}

/**
 * 헤드라인 → {text, speaker} 또는 null.
 * @param {string} headline
 * @param {{minWords?:number}} opts
 */
export function extractQuote(headline, opts = {}) {
  // 단어 수 기준은 CJK 에 안 맞는다 — "국민이 먼저다" 는 2단어지만 완결된 발언이다.
  //   단어 수와 글자 수를 **둘 다** 보고, 둘 다 미달일 때만 버린다.
  const { minWords = 2, minChars = 8 } = opts;
  const h = String(headline ?? '');
  if (!h) return null;
  const re = new RegExp(`[${OPEN}]([^${OPEN}${CLOSE}]{4,240})[${CLOSE}]`, 'g');
  let best = null;
  for (const m of h.matchAll(re)) {
    const text = m[1].trim().replace(/[,.;:]$/, '');
    if (text.split(/\s+/).length < minWords && text.length < minChars) continue;   // 토막은 카드가 안 된다
    const before = h.slice(0, m.index);
    const after = h.slice(m.index + m[0].length);
    // 발언 신호가 앞이나 뒤에 있어야 인용이다. 없으면 작품 제목·별명일 확률이 높다.
    //   한국어는 조사(라고·고…)로도 인정한다 — 서술어 목록에 의존하지 않기 위해서다.
    if (!SAY.test(before) && !SAY.test(after) && !KO_QUOTATIVE.test(after)) continue;
    if (!isSpeech(text)) continue;
    if (!best || text.length > best.text.length) {
      // 화자: 발언 신호 **앞**의 구절. 앞에 신호가 없으면(한국어 "…라고 말했다") 그 앞 전부.
      const mSay = before.match(SAY);
      let speaker = (mSay ? before.slice(0, mSay.index) : before).replace(/[,:\s]+$/, '');
      // 통신사 요약은 바이라인으로 시작한다 — "(서울=연합뉴스) 한지훈 기자 = 한국은행은 2일 …".
      //   그걸 화자로 쓰면 카드에 기자 이름이 뜬다. 바이라인은 `= ` 로 끝나므로 그 뒤만 취한다.
      speaker = speaker.replace(/^.*?\)\s*[^=]*=\s*/, '');
      // 앞쪽 기호를 턴다. **\W 를 쓰면 안 된다** — JS 의 \W 는 비ASCII 를 전부 포함해서
      //   한글 화자를 통째로 먹는다(2026-09-03 실측: "(서울=연합뉴스) … 한국은행은 2일" → "2일").
      //   글자·숫자가 아닌 것만 턴다(유니코드 속성, u 플래그).
      speaker = speaker.replace(/^[^\p{L}\p{N}]+/u, '').trim();
      // 날짜·시각 부사구는 화자가 아니다("한국은행은 2일" → "한국은행은").
      speaker = speaker.replace(/\s+\d+[일월시분]\s*$/, '').trim();
      best = { text, speaker: speaker || null };
    }
  }
  return best;
}

/** 여러 헤드라인 중 가장 긴 실제 발언 하나. 길수록 카드에 담을 내용이 있다. */
export function bestQuote(headlines, opts = {}) {
  let best = null;
  for (const h of headlines ?? []) {
    const q = extractQuote(h, opts);
    if (q && (!best || q.text.length > best.text.length)) best = q;
  }
  return best;
}

const esc = (t) => String(t ?? '').replace(/[<>&"]/g, (c) => (
  { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

/**
 * 인용 카드 HTML. 배경 위에 얹는 게 아니라 **그 자체가 배경**이다 —
 * 발언이 주인공인 화면이라 사진과 겹치면 둘 다 죽는다.
 */
export function quoteCardHtml(quote, opts = {}) {
  // rightInset: 우측 앵커 박스가 차지하는 폭. 글이 그 밑으로 흘러 들어가면 잘려 보인다 —
  //   실측(2026-08-28): 앵커를 켠 편에서 인용문 "…for as long as nee|ded" 가 박스에 가렸다.
  const { width = 1920, height = 1080, bandTop = 850, rightInset = 0 } = opts;
  const t = String(quote?.text ?? '');
  // 글자가 많으면 줄인다. 화면에 들어가는 양이 정해져 있다.
  const size = t.length > 150 ? 62 : t.length > 90 ? 76 : 92;
  return `<!doctype html><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${width}px;height:${height}px}
body{background:linear-gradient(150deg,#0a0f1c,#152137 60%,#0a0f1c);
  font-family:-apple-system,'Apple SD Gothic Neo',Helvetica,sans-serif;color:#eef3ff;
  display:flex;flex-direction:column;justify-content:center;position:relative;
  padding:0 ${150 + rightInset}px ${height - bandTop + 40}px 150px}
.mark{font-size:190px;line-height:.6;color:#ff4d5e;font-weight:800;margin-bottom:14px}
.q{font-size:${size}px;font-weight:700;line-height:1.28;letter-spacing:-.015em;
  max-width:${Math.max(600, Math.min(1520, width - 300 - rightInset))}px}
.by{margin-top:40px;font-size:36px;color:#9fb2d4;letter-spacing:.02em}
.by b{color:#dbe6ff;font-weight:700}
</style>
<div class="mark">&ldquo;</div>
<div class="q">${esc(t)}</div>
${quote?.speaker ? `<div class="by">&mdash; <b>${esc(quote.speaker)}</b>${quote?.source ? ` &middot; ${esc(quote.source)}` : ''}</div>` : ''}`;
}
