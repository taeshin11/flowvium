/**
 * blog-voice.mjs — 보고서 문장을 **읽는 글의 말투**로 고쳐 쓴다. (2026-09-18 신설)
 *
 * 왜 필요한가: 보고서 본문은 '~했다 / ~을 의미한다' 의 문어체다. 그걸 그대로 토막 내
 *   블로그에 붙이면 정리해 붙인 티가 난다(사용자 지적: "좀 블로그 글 스럽게",
 *   "열심히 분석 및 정리한 글처럼"). 말투를 바꾸려면 문장을 다시 쓰는 수밖에 없다.
 *
 * 다시 쓰면 위험한 것은 **숫자**다. 지수·등락률이 한 자리만 틀려도 그 글은 못 쓰는 글이 된다.
 *   그래서 고쳐 쓴 문장은 반드시 통과해야 하는 관문이 있다 — 원문에 없는 숫자가 있으면 버린다.
 *   (표기 차이 6,715/6715 와 반올림 2.392873→2.39 는 같은 숫자로 본다.)
 *   버린 자리는 규칙 기반 존댓말 변환으로 메운다. LLM 이 죽어 있어도 글은 나온다.
 *
 * 레인은 web(:8001, 소형)을 쓴다 — 보고서 직후에 도는 일이라 27B 를 다시 올리면
 *   메모리를 28GB 먹는다(memory: 보고서 중엔 큰 모델 금지).
 */
import { resolveLlm, SAMPLING_DEFAULTS } from './llm-config.mjs';

/** 문자열에서 숫자만 뽑아 값으로 정규화한다. '6,715' → '6715', '-0.0%' → '0' */
export function numbersIn(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(/-?\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, ''));
    if (Number.isFinite(n)) out.push(String(n === 0 ? 0 : n));
  }
  return out;
}

/**
 * 고쳐 쓴 글(out)에만 있고 원문(src)에 없는 숫자를 돌려준다.
 * 반올림은 새 숫자로 치지 않는다 — out 의 소수 자릿수에 맞춰 src 를 깎아 비교한다.
 */
export function addedNumbers(src, out) {
  const have = numbersIn(src).map(Number);
  const added = [];
  for (const raw of numbersIn(out)) {
    const v = Number(raw);
    const dp = (raw.split('.')[1] ?? '').length;
    const hit = have.some((h) => Math.abs(h) === Math.abs(v) || Number(Math.abs(h).toFixed(dp)) === Math.abs(v));
    if (!hit) added.push(raw);
  }
  return added;
}

// 숫자 바로 뒤에 붙는 단위. 이 목록에 있는 것만 본다 — 모르는 말까지 단위로 보면 오탐이 난다.
const UNIT_TOKENS = ['%p', '%', '원', '달러', '억', '조', '만', '천', '일', '주일', '주', '개월', '월', '년', '배', '건', '명', '회', '표본', '포인트'];

/** 글에서 (숫자, 바로 뒤 단위) 쌍을 뽑는다. 단위가 없으면 빈 문자열. */
export function unitPairs(text) {
  const t = String(text ?? '');
  const out = [];
  for (const m of t.matchAll(/(-?\d[\d,]*(?:\.\d+)?)\s*([^\s\d]{0,3})/g)) {
    const n = String(Math.abs(Number(m[1].replace(/,/g, ''))));
    const tail = m[2] ?? '';
    const unit = UNIT_TOKENS.find((u) => tail.startsWith(u)) ?? '';
    out.push({ n, unit });
  }
  return out;
}

/**
 * 같은 숫자가 **다른 단위를 달고** 나오면 돌려준다.
 *
 * 2026-09-18 실측: `동일가중(RSP)이 시총가중 대비 20일 -3%p 열위` 를 고쳐 쓰게 했더니
 *   "시총가중 대비 20%p 낮아진" 이 나왔다. 20 과 3 은 둘 다 원문에 있어 숫자 관문을 통과한다.
 *   바뀐 것은 **단위**다 — 20'일'(기간)이 20'%p'(크기)가 됐다. 숫자만 보는 관문으로는 못 잡는다.
 */
export function changedUnits(src, out) {
  const bySrc = new Map();
  for (const { n, unit } of unitPairs(src)) {
    if (!bySrc.has(n)) bySrc.set(n, new Set());
    bySrc.get(n).add(unit);
  }
  const bad = [];
  for (const { n, unit } of unitPairs(out)) {
    if (!unit) continue;                       // 단위를 뺀 것은 뜻을 바꾸지 않는다
    const known = bySrc.get(n);
    if (known && !known.has(unit)) bad.push(`${n}${unit}`);
  }
  return bad;
}

/**
 * 기호로 압축된 표기인가 — 그렇다면 **고쳐 쓰면 안 된다**.
 *
 * 2026-09-18 실측: `경보 상승 구간(30) — EM Equities 1주 -4.03% 급락 · USD/KRW +2.39% 급변` 을
 *   고쳐 쓰게 했더니 "경보 상승 구간인 30일 EM 주식 1주에 4.03% 급락하면서" 가 나왔다.
 *   30(경보 점수)이 날짜가 되고, 1주(1주일)가 주식 1주가 되고, 나열이 인과로 바뀌었다.
 *   숫자 관문은 통과한다 — 숫자는 그대로이고 **단위와 관계만 틀렸기 때문**이다.
 *   단위가 생략된 압축 표기는 원문 맥락 없이 못 읽는다. 그래서 아예 넘기지 않는다.
 */
export function isCompressed(text) {
  const t = String(text ?? '');
  if (/\(\s*\d+(\.\d+)?\s*\)/.test(t)) return true;   // 괄호 안에 단위 없는 맨 숫자 — (30)
  if (/\d\s*~\s+/.test(t)) return true;                    // 열린 범위 — "1990~ 144표본"(1990년 이후)
  // 가운뎃점·줄표 자체는 위험하지 않다 — "LC 시스템·질량분석기" 는 그냥 낱말 나열이고
  // "발표 — 무엇을 볼지" 도 잘 읽힌다. 처음엔 그것까지 막았다가 열 덩어리 중 일곱이
  // 원문으로 떨어졌다. 막아야 하는 것은 기호가 아니라 **단위가 사라진 숫자**다.
  return false;
}

// 숫자 뒤에 붙는 우리말 단위. 모델이 "1380 원" 처럼 띄우면 기계가 쓴 티가 난다.
const UNITS = '원|월|일|주|주일|개월|년|표본|건|배|명|차|위|회|퍼센트|억|만|조|천';
// 괄호 뒤에 바로 붙는 조사. ") 그리고" 까지 붙이면 안 되므로 조사만 화이트리스트로 둔다.
const JOSA = '은|는|이|가|을|를|과|와|로|으로|에|에서|의|도|만|까지|부터|보다|라|랑';

/** 고쳐 쓴 문장의 띄어쓰기를 우리말 표기로 되돌린다. 뜻은 건드리지 않는다. */
export function polishTypography(text) {
  return String(text ?? '')
    .replace(new RegExp(`(\\d)\\s+(${UNITS})(?![가-힣])`, 'g'), '$1$2')
    .replace(/([가-힣A-Za-z0-9%])\s+\(/g, '$1(')
    .replace(new RegExp(`([A-Za-z0-9%)])\\s+(${JOSA})(?![가-힣])`, 'g'), '$1$2')
    .replace(new RegExp(`\\)\\s+(${JOSA})(?![가-힣])`, 'g'), ')$1')
    .replace(/\s+([,.])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ');
}

// 문장 끝의 문어체 종결. 긴 것부터 본다 — '했다' 를 '다' 규칙이 먼저 먹으면 안 된다.
const ENDINGS = [
  ['했다', '했습니다'], ['였다', '였습니다'], ['웠다', '웠습니다'], ['났다', '났습니다'],
  ['았다', '았습니다'], ['었다', '었습니다'], ['갔다', '갔습니다'], ['왔다', '왔습니다'],
  ['이다', '입니다'], ['것이다', '것입니다'], ['있다', '있습니다'], ['없다', '없습니다'],
  ['된다', '됩니다'], ['한다', '합니다'], ['난다', '납니다'], ['간다', '갑니다'], ['온다', '옵니다'],
  ['짓다', '짓습니다'], ['크다', '큽니다'], ['높다', '높습니다'], ['낮다', '낮습니다'],
];

/** LLM 없이 쓰는 바닥 — 문장 끝 종결만 존댓말로 바꾼다. 문장 중간은 건드리지 않는다. */
export function toPolite(text) {
  return String(text ?? '').replace(/([가-힣]{1,4})(?=[.!?]|\s*$)/g, (seg) => {
    for (const [from, to] of ENDINGS) if (seg.endsWith(from)) return seg.slice(0, -from.length) + to;
    return seg;
  });
}

/** 모델이 덧붙이는 군더더기를 걷어낸다 — 사고 과정, 코드펜스, "물론입니다" 같은 서두. */
function clean(raw) {
  let t = String(raw ?? '');
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<\/?think>/gi, '');
  t = t.replace(/```[a-z]*\n?|```/g, '');
  t = t.replace(/^\s*(물론|네[,.]|알겠습니다|다음은|아래는)[^\n]*\n+/i, '');
  // 지시문이 본문으로 새는 것("이 종목을 봤습니다.")과 문서투 대명사("본종목")를 걷어낸다.
  t = t.replace(/^\s*(이|해당|본)\s*종목을?\s*(왜\s*)?(봤|살펴봤|주목했)[^.]*\.\s*/, '');
  t = t.replace(/본\s*종목(은|이|을|의)/g, '이 종목$1');
  t = t.replace(/^\s*["“']|["”']\s*$/g, '');
  return t.trim();
}

/**
 * 한 덩어리를 고쳐 쓴다.
 * @param {string} src 원문
 * @param {{call:(prompt:string)=>Promise<string>, style?:string, minRatio?:number, maxRatio?:number}} opt
 * @returns {Promise<{text:string, used:'llm'|'fallback', why?:string}>}
 */
export async function rewriteBlock(src, opt = {}) {
  const base = String(src ?? '').trim();
  if (!base) return { text: '', used: 'fallback', why: 'empty-src' };
  const fallback = { text: toPolite(base), used: 'fallback' };
  if (typeof opt.call !== 'function') return { ...fallback, why: 'no-call' };
  // 단위가 생략된 압축 표기는 넘기지 않는다 — 숫자는 맞는데 뜻이 틀려서 돌아온다.
  if (isCompressed(base)) return { ...fallback, why: 'compressed' };

  const style = opt.style ?? '시장을 매일 들여다보는 사람이 블로그에 쓰듯';
  const prompt = [
    `다음 글을 ${style} 다시 써라.`,
    '규칙:',
    '- 존댓말(~습니다/~입니다)로 쓴다.',
    '- 숫자는 원문에 있는 것만 쓴다. 새 숫자를 만들지 마라.',
    '- 원문에 없는 사실·전망·종목을 덧붙이지 마라.',
    '- 번역투("~을 의미한다", "요컨대")를 쓰지 말고 자연스러운 우리말로 쓴다.',
    '- 원문의 용어를 바꾸지 마라(렌탈을 리스로 바꾸는 식).',
    '- "이 종목을 봤습니다" 같은 서두를 붙이지 말고 바로 내용부터 쓴다.',
    '- 설명이나 머리말 없이 고쳐 쓴 본문만 출력한다.',
    '',
    '원문:',
    base,
  ].join('\n');

  let out;
  try { out = clean(await opt.call(prompt)); }
  catch (e) { return { ...fallback, why: `call-failed:${String(e.message).slice(0, 40)}` }; }
  if (!out) return { ...fallback, why: 'empty-out' };

  // 길이 관문. 짧은 원문은 비율이 쉽게 3배가 되므로(한 줄짜리 종목 설명) 절대량으로 본다.
  const grew = base.length < 80 ? out.length - base.length > (opt.maxGrowChars ?? 180)
    : out.length / base.length > (opt.maxRatio ?? 2.6);
  if (grew || out.length / base.length < (opt.minRatio ?? 0.45)) {
    return { ...fallback, why: `length:${(out.length / base.length).toFixed(2)}(${base.length}→${out.length})` };
  }

  const added = addedNumbers(base, out);
  if (added.length) return { ...fallback, why: `added-numbers:${added.join(',')}` };

  const moved = changedUnits(base, out);
  if (moved.length) return { ...fallback, why: `changed-units:${moved.join(',')}` };

  return { text: polishTypography(out), used: 'llm' };
}

/**
 * web 레인에 붙는 호출자. 서버가 없으면 rewriteBlock 이 알아서 원문으로 떨어진다.
 *
 * 생각 모드를 끄는 이유(2026-09-18 실측): Qwen3.5 는 기본이 thinking 이라 응답의
 *   `message.reasoning` 에 사고 과정만 채우고 `content` 는 비운 채 max_tokens 에 걸린다
 *   (finish_reason=length). 첫 판에서 열 덩어리가 전부 빈 응답으로 떨어진 원인이 이것이다.
 *   chat_template_kwargs.enable_thinking=false 를 주면 같은 문장이 1.6초에 content 로 온다.
 *
 * 시간 예산을 넉넉히 두는 이유: mlx_lm 은 클라이언트가 생성 도중 끊으면 BrokenPipe 뒤
 *   배치 슬롯 정리에서 `logits_processors[e]` 가 None 이 되어 **생성 스레드가 통째로 죽는다**
 *   (generate.py:1346 TypeError, 오늘까지 5회). 그러면 /v1/models 는 200 인데 완료는 영영
 *   안 온다 — 웹 레인은 사이트 번역·챗도 쓰는 곳이라 내 중단이 남의 기능을 죽인다.
 *   생각을 끄면 한 덩어리가 수 초라 이 상한에 닿을 일이 없다. 닿았다면 서버가 이미 아픈 것이다.
 */
export function llmCaller(lane = 'web', { timeoutMs = 120000, temperature = 0.6, maxTokens = 1200, fetchImpl = fetch } = {}) {
  const { url, model } = resolveLlm(lane);
  return async (prompt) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${url}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...SAMPLING_DEFAULTS,
          model,
          temperature,
          max_tokens: maxTokens,
          chat_template_kwargs: { enable_thinking: false },
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: ctl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      // reasoning 만 오고 content 가 비면 생각에서 끝난 것 — 그 사고 과정을 본문으로 쓰지 않는다.
      return j?.choices?.[0]?.message?.content ?? '';
    } finally { clearTimeout(t); }
  };
}
