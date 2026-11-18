/**
 * shorts-opening.mjs — 첫 장면 0~3초를 세 컷으로(사진 → 바짝 당긴 컷 → 핵심 숫자 카드). 근거는 shorts-opening.test.mjs 머리말.
 */
import { mediaFilter, SHORTS } from './shorts-layout.mjs';

// 핵심 숫자로 칠 단위. 날짜·차수·나이·시각(일·차·세·년·월·시)은 넣지 않는다 — 기사 뼈대이지 핵심이 아니다.
const UNIT = '(?:억달러|만달러|조원|억원|만원|천원|달러|원|%|퍼센트|조|억|만|배|선|명|건|대|톤|개국|개)';
const NUM_RE = new RegExp(`(\\d[\\d,.]*)\\s*(${UNIT})(?![가-힣A-Za-z])`, 'g');
const WORD_SPLIT = /[\s…·,'"‘’“”()\[\]]+/;

/** 헤드라인(원문)에서 핵심 숫자 하나 — {value, label}. 없으면 null. label = 숫자 앞 낱말 둘까지. */
export function keyNumber(headlines) {
  for (const h of headlines ?? []) {
    const text = String(h ?? '');
    for (const m of text.matchAll(NUM_RE)) {
      if (text[m.index - 1] === '제') continue;   // '제32차' 같은 차례 수
      const before = text.slice(0, m.index).split(WORD_SPLIT).filter(Boolean);
      // 조사가 붙은 낱말(…에·…서·…가 등)은 이름표에서 뺀다 — "AI 특수에 ICT 수출" → "ICT 수출"
      const words = [];
      for (let i = before.length - 1; i >= 0 && words.length < 2; i--) {
        // 조사로 끝나는 낱말에서 멈춘다. '이·가' 는 뺐다 — '국가'·'물가' 처럼 낱말 끝이 같은 게 많다.
        if (/(에|에서|서|은|는|을|를|의|도|로|으로|와|과)$/.test(before[i])) break;
        words.unshift(before[i]);
      }
      return { value: `${m[1]}${m[2]}`, label: words.join(' ') };
    }
  }
  return null;
}

/** 0~3초 컷 계획. 장면이 3초보다 짧으면 비율로 줄인다. 마지막 칸은 원래 사진(base)으로 돌아온다. */
export function openingCuts({ dur, hasCard }) {
  const k = Math.min(1, (Number(dur) || 0) / 3.4);   // 3초 + 꼬리 0.4초가 없으면 줄인다
  const r = (x) => Math.round(x * k * 100) / 100;
  return [
    { from: 0, to: r(1), kind: 'base' },
    { from: r(1), to: r(2), kind: 'tight' },
    { from: r(2), to: r(3), kind: hasCard ? 'card' : 'tight2' },
    { from: r(3), to: Number(dur) || r(3), kind: 'base' },
  ];
}

const T1 = { f: 0.62, y: 0.35 };   // 가운데 약간 위 — 뉴스 사진 인물이 대개 여기
const T2 = { f: 0.75, y: 0 };      // 위쪽을 넓게 — 카드가 없을 때 다른 높이로
/** ffmpeg filter_complex 조각. cardInput 은 카드 PNG 의 입력 번호(없으면 당긴 컷 두 번째). */
export function openingFilter(inLabel, outLabel, { cuts, cardInput = null, motion = false, zoom }) {
  const z = zoom === undefined ? {} : { zoom };   // 장면별 zoom(make-shorts 5b) — 안 주면 mediaFilter 기본(LAYOUT)
  const card = cuts.find((c) => c.kind === 'card');
  const t1 = cuts.find((c) => c.kind === 'tight');
  const t2 = cuts.find((c) => c.kind === 'tight2');
  const en = (c) => `enable='between(t,${c.from.toFixed(2)},${c.to.toFixed(2)})'`;
  const useCard = card && cardInput != null;
  const parts = [
    `[${inLabel}]split=${useCard ? 2 : 3}[opa][opb]${useCard ? '' : '[opc]'}`,
    mediaFilter('opa', 'opbase', { motion, tag: 'a', ...z }),
    mediaFilter('opb', 'opt1', { tight: T1, tag: 'b', ...z }),
    `[opbase][opt1]overlay=0:0:${en(t1)}[op1]`,
  ];
  if (useCard) parts.push(`[op1][${cardInput}:v]overlay=0:0:${en(card)}[${outLabel}]`);
  else parts.push(mediaFilter('opc', 'opt2', { tight: T2, tag: 'c', ...z }), `[op1][opt2]overlay=0:0:${en(t2 ?? card)}[${outLabel}]`);
  return parts.join(';');
}

const escHtml = (t) => String(t ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
/** 2~3초 컷의 핵심 숫자 카드 — 사진 칸 가운데 어두운 판에 이름표(흰)·숫자(노랑). 바탕은 투명이라 사진 위에 얹힌다. */
export function numberCardHtml({ value, label }) {
  const g = SHORTS;
  const h = Math.round(g.media.height * 0.62);
  const top = g.media.top + Math.round((g.media.height - h) / 2);
  return `<!doctype html><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${g.W}px;height:${g.H}px;background:transparent}
body{font-family:-apple-system,'Apple SD Gothic Neo',Helvetica,sans-serif;position:relative;overflow:hidden}
.card{position:absolute;left:60px;right:60px;top:${top}px;height:${h}px;background:rgba(0,0,0,.78);border-radius:28px;
  display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 30px}
.lb{font-size:64px;font-weight:800;color:#fff;letter-spacing:-.01em}
.v{font-size:150px;font-weight:900;color:#ffd400;letter-spacing:-.03em;line-height:1.05;margin-top:12px}
</style><div class="card">${label ? `<div class="lb">${escHtml(label)}</div>` : ''}<div class="v">${escHtml(value)}</div></div>`;
}
