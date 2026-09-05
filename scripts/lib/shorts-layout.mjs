/**
 * shorts-layout.mjs — 세로(9:16) 쇼츠 화면의 기하와 오버레이.
 *
 * 왜 별도인가 (2026-09-03, 사용자가 참고 쇼츠 화면을 보여주며 "그렇게 해"):
 *   기존 make-issue-video 는 1920×1080 가로 뉴스 패키지다. 하단에 밝은 자막 띠 하나가 있고
 *   화면 전체를 소재가 채운다. 쇼츠는 구성이 통째로 다르다:
 *
 *     ┌──────────────┐
 *     │  검은 띠      │  훅 2줄 — 1줄 흰색 / 2줄 노랑 + ✨
 *     ├──────────────┤
 *     │  소재         │  레터박스. 우하단에 「출처- …」
 *     ├──────────────┤
 *     │  검은 띠      │  캡션 — 형광 연두
 *     └──────────────┘
 *
 *   기하가 전부 다르므로 가로 파이프라인에 분기를 심으면 양쪽이 다 복잡해지고,
 *   이번 세션에 방금 고친 것들(컷 배분·자막 분할·소재 적합도)을 흔들 위험이 있다.
 *   **라이브러리는 공유하고 합성만 나눈다** — 음성·소재·자막·인용·업로드 메타는 그대로 쓴다.
 *
 * 색은 사용자 기존 방침을 따른다(썸네일 노랑·빨강 글씨) — 훅 강조는 노랑, 캡션은 형광 연두.
 */

/** 쇼츠 기본 기하. 유튜브 쇼츠는 1080×1920 이 표준이다. */
export const SHORTS = {
  W: 1080,
  H: 1920,
  FPS: 30,
  /** 위 검은 띠(훅). 화면의 약 29% — 참고 화면에서 두 줄 훅이 이만큼 차지한다. */
  hook: { top: 0, height: 560 },
  /** 소재 영역. 위·아래 띠 사이. */
  media: { top: 560, height: 760 },
  /** 아래 검은 띠(캡션). */
  caption: { top: 1320, height: 600 },
};

/** 훅 문구를 두 줄로 나눈다. 뒷줄이 강조(노랑)라 **뒤쪽이 결정적인 말**이어야 한다. */
export function splitHook(text, maxPerLine = 11) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return ['', ''];
  const words = t.split(' ');
  if (words.length === 1) {
    // 한 덩어리면 글자 수로 자른다. 뒤가 강조이므로 앞을 짧게 남긴다.
    const cut = Math.max(1, t.length - maxPerLine);
    return [t.slice(0, cut), t.slice(cut)];
  }
  // 뒷줄이 한 줄에 들어가도록 뒤에서부터 채운다.
  let tail = [];
  for (let i = words.length - 1; i >= 1; i--) {
    const next = [words[i], ...tail];
    if (next.join(' ').length > maxPerLine) break;
    tail = next;
  }
  if (!tail.length) tail = [words[words.length - 1]];
  const head = words.slice(0, words.length - tail.length);
  return [head.join(' '), tail.join(' ')];
}

const esc = (t) => String(t ?? '').replace(/[<>&"]/g, (c) => (
  { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

/**
 * 오버레이 HTML. Playwright 가 투명 PNG 로 그려 ffmpeg 가 얹는다.
 *
 * 소재를 가운데 띄우고 위아래를 검게 덮는 방식이라, 소재가 세로/가로 어느 쪽이든
 * 잘리지 않고 들어간다 — 참고 쇼츠도 그렇게 되어 있다(레터박스).
 *
 * @param {{hook?:string, caption?:string, credit?:string, brand?:string}} o
 */
/**
 * 화면 글자의 숫자 띄어쓰기를 붙인다.
 *
 * 왜 필요한가 (2026-09-05): 대본 프롬프트가 LLM 에게 "숫자는 한글로 풀어 쓴다(TTS 오독 방지)"
 *   라고 시킨다. 그래서 "6 억 8 천만 원", "15 일", "왜 6 개" 로 나온다.
 *   **음성에는 그 편이 낫지만 자막·훅은 사람이 쓴 글로 보여야 한다.**
 *   실제로 나간 영상에서 "6 억 8 천만 원 재산신고" 로 떠서 티가 났다.
 *   음성 대본은 건드리지 않는다 — 화면 글자에서만 붙인다.
 *
 * 단위만 붙인다. "6 개월 만에" 의 '만에' 처럼 단위가 아닌 낱말의 공백은 지우지 않는다 —
 *   전부 붙이면 "6개월만에" 가 되어 오히려 읽기 나빠진다.
 */
// 2026-09-05: 처음엔 금액·날짜 단위만 넣었는데 대본에 "천무 18 문", "구축함 3 척" 이 남았다.
//   뉴스에서 실제로 쓰는 세는 단위를 넣는다. 단위가 아닌 낱말은 여전히 건드리지 않는다.
const NUM_UNIT = '(?:억원|만원|천원|억|조|만|천|백|십|원|일|월|년|개월|개국|개|명|건|위|배|회|차례|차|초|분|시간|주|'
  + '문|척|대|기|발|곳|병|통|권|벌|마리|톤|층|호|번|세|살|퍼센트|포인트|달러|유로|엔|위안|%)';
export function tightenNumbers(text) {
  let t = String(text ?? '');
  if (!t) return '';
  // 숫자 뒤 단위: "15 일" → "15일". 반복 적용해 "6 억 8 천만" 을 끝까지 훑는다.
  for (let i = 0; i < 4; i++) t = t.replace(new RegExp(`(\\d)\\s+(${NUM_UNIT})`, 'g'), '$1$2');
  // 단위 뒤에 바로 붙는 '원' 도 붙인다: "8천만 원" → "8천만원". 앞이 숫자일 때만이라
  //   "천 원짜리 한 장" 같은 일반 문장은 건드리지 않는다.
  t = t.replace(/(\d(?:억|조|만|천|백|십)+)\s+원/g, '$1원');
  // "6 천 800 억 원" 은 위 규칙만으로 "6천 800억원" 까지만 붙는다. 한 덩어리 수이므로
  //   천·백·십 뒤에 이어지는 숫자는 마저 붙인다 → "6천800억원".
  //   ⚠ 억·조·만 뒤는 붙이지 않는다 — 우리말은 **만 단위로 띄어 쓴다**("6억 8천만" 이 맞다).
  for (let i = 0; i < 3; i++) t = t.replace(/(\d[천백십])\s+(\d)/g, '$1$2');
  // 차례를 세는 접두사 '제-' 는 뒷말에 붙여 쓴다: "제 32차" → "제32차"(실제 대본에서 나왔다).
  t = t.replace(/(^|[\s(])제\s+(\d)/g, '$1제$2');
  return t;
}

export function shortsOverlayHtml(o = {}) {
  const [l1, l2] = splitHook(tightenNumbers(o.hook));
  const g = SHORTS;
  return `<!doctype html><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${g.W}px;height:${g.H}px;background:transparent}
body{font-family:-apple-system,'Apple SD Gothic Neo',Helvetica,sans-serif;position:relative;overflow:hidden}
/* 위아래 검은 띠 — 소재를 가운데로 몰고 글자 자리를 만든다 */
.top{position:absolute;left:0;right:0;top:0;height:${g.hook.height}px;background:#000;
  display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 44px;text-align:center}
.bot{position:absolute;left:0;right:0;top:${g.caption.top}px;height:${g.caption.height}px;background:#000;
  display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:52px 44px 0;text-align:center}
/* 훅: 1줄 흰색, 2줄 노랑. 참고 화면과 같은 위계 — 눈이 노란 줄에 먼저 간다. */
.h1{font-size:104px;font-weight:900;color:#fff;line-height:1.16;letter-spacing:-.02em}
.h2{font-size:112px;font-weight:900;color:#ffd400;line-height:1.16;letter-spacing:-.02em;margin-top:6px}
/* 캡션: 형광 연두. 검은 띠 위에서 가장 잘 읽히는 색이다. */
.cap{font-size:76px;font-weight:900;color:#b6ff3b;line-height:1.28;letter-spacing:-.01em;
  text-shadow:0 3px 0 rgba(0,0,0,.55);
  /* 자막 라이브러리가 접어 준 줄바꿈을 그대로 지킨다. 종전엔 호출부가 \n 을 공백으로 바꿔
     브라우저가 다시 흘렸고, 그래서 "…예 / 고를" 처럼 낱말 한가운데서 잘렸다(첫 렌더 실측). */
  white-space:pre-line}
/* 출처 — 소재 위 우하단. 참고 화면과 같은 자리다. */
.credit{position:absolute;right:26px;top:${g.media.top + g.media.height - 62}px;
  font-size:34px;font-weight:700;color:rgba(255,255,255,.92);text-shadow:0 2px 6px rgba(0,0,0,.9)}
.brand{position:absolute;left:26px;top:${g.hook.height + 18}px;
  font-size:28px;font-weight:900;letter-spacing:.22em;color:rgba(255,255,255,.85);
  background:rgba(0,0,0,.45);padding:8px 14px}
</style>
<div class="top"><div class="h1">${esc(l1)}</div><div class="h2">${esc(l2)}</div></div>
<div class="bot"><div class="cap">${esc(tightenNumbers(o.caption))}</div></div>
${o.credit ? `<div class="credit">${esc(o.credit)}</div>` : ''}
${o.brand ? `<div class="brand">${esc(o.brand)}</div>` : ''}`;
}

/**
 * 소재를 가운데 영역에 맞추는 ffmpeg 필터.
 *
 * 자르지 않는다 — 뉴스 사진은 잘리면 인물·현장이 사라진다. 대신 **블러 채움**을 쓴다:
 *   뒤에는 같은 그림을 영역에 꽉 차게(cover) 깔고 흐리게 만들고,
 *   앞에는 잘리지 않은 원본을 얹는다(contain).
 * 왜 필요한가(2026-09-03 실측): 순수 레터박스로 두니 가로로 긴 파노라마 사진이 얇은 띠가 되고
 *   소재 영역의 절반이 검게 비었다. 쇼츠에서 흔히 쓰는 방식으로 채운다 — 원본을 잃지 않으면서
 *   화면이 비지 않는다.
 */
export function mediaFilter(inLabel, outLabel) {
  const g = SHORTS;
  const { W } = g;
  const MH = g.media.height;
  return [
    `[${inLabel}]split=2[mc][mf]`,
    // 뒤: 영역을 덮도록 키우고 잘라낸 뒤 흐리게. 여기서 잘리는 것은 배경이므로 정보 손실이 아니다.
    `[mc]scale=${W}:${MH}:force_original_aspect_ratio=increase,crop=${W}:${MH},boxblur=28:2,eq=brightness=-0.10[mbg]`,
    // 앞: 원본 그대로 영역 안에 들어가게.
    `[mf]scale=${W}:${MH}:force_original_aspect_ratio=decrease[mfg]`,
    `[mbg][mfg]overlay=(W-w)/2:(H-h)/2[mrg]`,
    // 소재 영역을 화면의 제자리에 앉힌다. 위아래는 오버레이의 검은 띠가 덮는다.
    `[mrg]pad=${W}:${g.H}:0:${g.media.top}:black,fps=${g.FPS},setsar=1[${outLabel}]`,
  ].join(';');
}
