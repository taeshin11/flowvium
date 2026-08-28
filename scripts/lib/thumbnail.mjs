import { wrapLines } from './subtitle.mjs';

/**
 * thumbnail.mjs — 썸네일 문구와 화면.
 *
 * 썸네일 클릭률이 조회수의 첫 관문이다. 거기 들어가는 건 문장이 아니라 **덩어리 몇 개**다 —
 *   헤드라인을 그대로 넣으면 작아서 아무도 못 읽는다.
 * 살릴 것: 고유명사(누구/어디), 숫자(몇 개/얼마). 버릴 것: 관사·전치사·동사 수식.
 */

const DROP = new Set([
  'the', 'a', 'an', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'from', 'by', 'as',
  'is', 'are', 'was', 'were', 'be', 'been', 'and', 'or', 'but', 'that', 'this', 'it',
  'into', 'amid', 'over', 'after', 'before', 'says', 'said', 'told', 'new',
  // 소유격·대명사·조동사. 창 안에 남으면 "air its one thousandth" 처럼 읽힌다(2026-08-28).
  'its', 'his', 'her', 'their', 'our', 'your', 'my', 'they', 'he', 'she', 'we',
  'has', 'have', 'had', 'will', 'would', 'could', 'should', 'may', 'might',
  'than', 'then', 'when', 'while', 'about', 'against', 'between', 'during',
  'under', 'above', 'out', 'off', 'up', 'down', 'more', 'most', 'all', 'so',
]);

const CJK = /[ㄱ-힝぀-ヿ一-鿿]/;

/**
 * 헤드라인 → 썸네일 문구.
 * @param {string} headline
 * @param {{maxWords?:number, maxCharsCjk?:number}} opts
 */
export function thumbText(headline, opts = {}) {
  const { maxWords = 4, maxCharsCjk = 14 } = opts;
  const raw = String(headline ?? '').trim();
  if (!raw) return '';

  // 인용부호 안은 발언이라 썸네일 문구로 쓰기엔 길다. 바깥 문장에서 뽑는다.
  // 곡선 아포스트로피(’)는 인용부호가 아니라 소유격이다. 인용부호로 취급하면
  //   "Fed’s Cook says Trump’s claims" 에서 가운데가 통째로 지워진다(2026-08-28 실측).
  const outside = raw.replace(/["“”][^"“”]*["“”]/g, ' ');
  const base = outside.trim() || raw;

  if (CJK.test(base)) {
    // 한국어는 조사가 붙어 단어 단위 필터가 잘 안 듣는다. 앞에서부터 어절로 자른다.
    const words = base.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
    let out = '';
    for (const w of words) {
      if (out && (out.length + 1 + w.length) > maxCharsCjk) break;
      out = out ? `${out} ${w}` : w;
    }
    return out.slice(0, maxCharsCjk);
  }

  // 아포스트로피를 지우면 "Fed's" 가 "Fed s" 가 된다. 한 글자 토큰은 낱말이 아니다.
  const words = base.replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/)
    .filter((w) => w.length > 1 || /\d/.test(w));
  // 점수: 숫자 > 고유명사(대문자 시작) > 나머지. 원래 순서는 유지한다 — 뒤섞으면 뜻이 깨진다.
  const scored = words.map((w, i) => ({
    w, i,
    score: /^\d/.test(w) ? 3 : (/^[A-Z]/.test(w) && i > 0 ? 2 : (DROP.has(w.toLowerCase()) ? 0 : 1)),
  }));
  // 점수 높은 낱말을 **흩어서** 고르면 문구가 아니라 낱말 더미가 된다 —
  //   "Fed's Cook says the claims are unfounded and untrue" 에서
  //   "Fed unfounded untrue" 가 나왔다(2026-08-28 실측). 읽어도 뜻이 안 선다.
  //   그래서 **붙어 있는 구간**에서 고른다. 점수 합이 가장 큰 창을 잡되,
  //   같으면 짧은 쪽·앞쪽을 택한다 — 군더더기를 덜 끌고 온다.
  const usable = scored.filter((x) => x.score > 0);
  if (!usable.length) return scored.slice(0, maxWords).map((x) => x.w).join(' ');
  // 불용어를 **하나도 포함하지 않는** 창만 후보로 둔다. 창 안에 끼워 넣으면
  //   "stamp prices in 24" 처럼 군더더기가 그대로 크게 박힌다.
  //   점수 합이 가장 큰 창을 고르고, 같으면 짧은 쪽(글자가 커진다) → 앞쪽 순.
  let best = null;
  for (let len = Math.min(maxWords, scored.length); len >= 1; len--) {
    for (let st = 0; st + len <= scored.length; st++) {
      const win = scored.slice(st, st + len);
      if (win.some((x) => x.score === 0)) continue;
      const sum = win.reduce((a, x) => a + x.score, 0);
      // 동점이면 **긴 쪽**이다. 짧은 쪽을 택하면 "85" 처럼 숫자 하나만 남아
      //   무슨 얘기인지 알 수 없게 된다(부고 기사에서 실제로 그랬다).
      if (!best || sum > best.sum || (sum === best.sum && len > best.len)) best = { sum, len, win };
    }
  }
  if (!best) return usable.slice(0, maxWords).map((x) => x.w).join(' ');
  return best.win.map((x) => x.w).join(' ');
}

/**
 * 썸네일 문구에서 **빨갛게 칠할 한 낱말**을 고른다.
 * thumbText 와 같은 점수(숫자 > 고유명사 > 나머지)를 쓴다 — 기준이 두 개면 서로 어긋난다.
 * 노랑 위에 빨강 한 낱말이 얹혀야 시선이 어디로 갈지 정해진다. 전부 노랑이면 아무 데도 안 간다.
 */
export function hotWord(text) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;                  // 한 낱말뿐이면 강조가 의미 없다
  let best = null, bestScore = -1;
  words.forEach((w, i) => {
    const score = /\d/.test(w) ? 3 : (/^[A-Z]/.test(w) ? 2 : 1);
    if (score > bestScore) { bestScore = score; best = i; }
  });
  return best;
}

/**
 * 썸네일 하단을 채울 **두 줄** 문구.
 *
 * 사진을 꽉 채우고 글자를 밑에 까는 구성(2026-08-28 지시, MBC 뉴스 썸네일 참고)에서는
 *   낱말 서넛으로는 아래가 빈다. 구를 더 길게 잡고 두 줄로 나눈다.
 * 줄 균형은 자막에서 쓰던 wrapLines 를 그대로 쓴다 — 같은 문제를 두 번 풀 이유가 없다.
 */
export function thumbLines(headline, opts = {}) {
  const { maxChars = 46, perLine = 23, maxLines = 2 } = opts;
  const raw = String(headline ?? '').trim();
  if (!raw) return [];

  if (CJK.test(raw)) {
    // 한국어는 어절 단위로 앞에서부터 채운다. 조사 때문에 낱말 필터가 잘 안 듣는다.
    const t = thumbText(raw, { maxCharsCjk: maxChars });
    return t ? wrapLines(t, perLine, maxLines) : [];
  }

  // 하단 띠를 채우려면 **문장처럼 읽히는 구**여야 한다 — 낱말 서넛으로는 아래가 빈다.
  //   그래서 여기서는 불용어를 창 안에 허용한다("rename Lake Ontario to Lake America").
  //   대신 창의 **양 끝**은 불용어가 아니어야 한다. 끝이 "to" 로 끝나면 잘린 것처럼 보인다.
  //   고르는 기준은 글자수 안에서 **정보량(점수 합)이 가장 큰 구간**이다.
  const words = raw.replace(/[^\p{L}\p{N}\s'’-]/gu, ' ').split(/\s+/)
    .filter((w) => w.length > 1 || /\d/.test(w));
  if (!words.length) return [];
  const score = (w, i) => (/^\d/.test(w) ? 3 : (/^\p{Lu}/u.test(w) && i > 0 ? 2 : (DROP.has(w.toLowerCase()) ? 0 : 1)));
  const sc = words.map(score);

  // 시작 낱말이 고유명사·숫자인 구간을 **먼저** 찾는다. 그런 게 있으면 그것만 본다.
  //   점수 합만 보면 "order to rename Lake Ontario…" 처럼 문장 중간부터 시작해
  //   잘려 나온 것처럼 읽힌다(2026-08-28 실측). 이름으로 시작해야 헤드라인처럼 읽힌다.
  //   단, 헤드라인의 **맨 앞**은 언제나 후보다. 첫 낱말은 문장 시작이라 점수를 낮게 주는데
  //   ("Dolly Parton" 의 Dolly), 그것 때문에 이름의 앞부분이 잘려 나가면 안 된다.
  const strongStart = sc.some((x) => x >= 2);
  let best = null;
  for (let st = 0; st < words.length; st++) {
    if (sc[st] === 0) continue;
    if (strongStart && sc[st] < 2 && st !== 0) continue;
    let len = 0;
    for (let en = st; en < words.length; en++) {
      len += (en > st ? 1 : 0) + words[en].length;
      if (len > maxChars) break;
      if (sc[en] === 0) continue;                       // 끝이 불용어면 그 구간은 건너뛴다
      const sum = sc.slice(st, en + 1).reduce((a, b) => a + b, 0);
      // 같은 정보량이면 긴 쪽 — 하단을 채우는 게 목적이다.
      if (!best || sum > best.sum || (sum === best.sum && len > best.len)) {
        best = { sum, len, text: words.slice(st, en + 1).join(' ') };
      }
    }
  }
  if (!best) return wrapLines(words.slice(0, 4).join(' '), perLine, maxLines);
  return wrapLines(best.text, perLine, maxLines);
}


const esc = (t) => String(t ?? '').replace(/[<>&"]/g, (c) => (
  { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

/**
 * 썸네일 HTML. 실사 사진 + 큰 글씨 + 대비색 — 뉴스 채널 썸네일의 공통 문법이다.
 * 유튜브가 목록에서 작게 줄여 보여주므로 **글자는 과하다 싶게 커야** 한다.
 */
export function thumbnailHtml(t, opts = {}) {
  const { width = 1280, height = 720 } = opts;
  // 문구는 두 줄로 하단을 채운다. 한 줄만 나오면 그대로 한 줄이다(억지로 쪼개지 않는다).
  const lines = Array.isArray(t?.lines) && t.lines.length ? t.lines : thumbLines(t?.text ?? '');
  const longest = Math.max(...lines.map((l) => l.length), 1);
  // 가장 긴 줄이 **폭을 채우도록** 키운다. 글자폭은 대략 fontSize*0.50, 좌우 여백 96px.
  //   상한이 낮으면 문구가 짧을 때 오른쪽이 통째로 빈다(2026-08-28 실측: 왼쪽 절반만 찼다).
  //   상한 136 이면 두 줄 높이가 약 300px 이라 720 화면의 아래쪽에 그대로 들어간다.
  const size = Math.max(58, Math.min(136, Math.floor((width - 96) / (longest * 0.50))));

  // 강조는 **마지막 줄의 첫 낱말**이 아니라 전체에서 고른 한 낱말이다.
  const flat = lines.join(' ').split(/\s+/).filter(Boolean);
  const hi = hotWord(flat.join(' '));
  let n = 0;
  const html = lines.map((l) => l.split(/\s+/).filter(Boolean)
    .map((w) => (n++ === hi ? `<span class="hot">${esc(w)}</span>` : esc(w))).join(' ')).join('<br>');

  const img = t?.image
    ? `<div class="ph" style="background-image:url('${esc(t.image)}')"></div>`
    : '';
  return `<!doctype html><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${width}px;height:${height}px}
body{position:relative;overflow:hidden;background:#070b16;
  font-family:-apple-system,'Apple SD Gothic Neo',Helvetica,sans-serif;color:#fff}
/* 사진이 화면을 꽉 채운다. 얼굴이 잘리지 않게 위쪽을 기준으로 잡는다. */
.ph{position:absolute;inset:0;background-size:cover;background-position:center 28%}
/* 아래에서 위로 어둡게. 글자가 앉는 아래 45% 만 덮고 사진은 그대로 보인다. */
.sc{position:absolute;left:0;right:0;bottom:0;height:56%;
  background:linear-gradient(0deg,rgba(3,6,12,.96) 0%,rgba(3,6,12,.86) 34%,rgba(3,6,12,.45) 68%,rgba(3,6,12,0) 100%)}
.kick{position:absolute;left:36px;top:32px;background:#e01e37;padding:11px 24px;border-radius:4px;
  font-size:36px;font-weight:900;letter-spacing:.10em}
.brand{position:absolute;right:36px;top:34px;font-size:30px;font-weight:900;
  letter-spacing:.24em;color:#eaf1ff;text-shadow:0 2px 16px rgba(0,0,0,.95)}
.t{position:absolute;left:48px;right:48px;bottom:38px;
  font-size:${size}px;font-weight:900;line-height:1.1;letter-spacing:-.03em;
  color:#ffe11a;-webkit-text-stroke:7px #0a0a0a;paint-order:stroke fill;
  text-shadow:0 8px 30px rgba(0,0,0,.95),0 0 2px rgba(0,0,0,.9)}
.hot{color:#ff2b2b}
</style>${img}<div class="sc"></div>
${t?.kicker ? `<div class="kick">${esc(t.kicker)}</div>` : ''}
<div class="brand">FLOWVIUM</div>
<div class="t">${html}</div>`;
}
