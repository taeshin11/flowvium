/**
 * subtitle.mjs — 나레이션 타임스탬프 → 화면 자막(ASS).
 *
 * 왜 추정하지 않는가: 장면 길이를 글자 수로 나누면 쉼표·마침표에서 최대 0.5초씩 밀린다.
 *   ElevenLabs 는 /with-timestamps 에서 **글자 단위 시작·끝 시각**을 준다. 그걸 그대로 쓴다.
 *   (실측 2026-08-27: 44자 문장, 첫 5자 0 / 0.104 / 0.174 / 0.209 / 0.255초)
 *
 * 왜 ASS 인가: ffmpeg-static 빌드에 libass 가 들어 있고(--enable-libass), 외곽선·그림자·
 *   위치를 스타일로 한 번에 지정할 수 있다. drawtext 로 하면 큐마다 필터를 쌓아야 해서
 *   장면 6개 × 큐 10개 = 필터 60개짜리 명령이 된다.
 */

/** 초 → ASS 시각 H:MM:SS.cc */
export function assTime(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const cs = Math.round((s - Math.floor(s)) * 100);
  // 반올림이 100 이 되면 초로 올린다 — 안 하면 "0:00:01.100" 같은 잘못된 시각이 나온다.
  const [ss2, cs2] = cs === 100 ? [ss + 1, 0] : [ss, cs];
  return `${h}:${String(m).padStart(2, '0')}:${String(ss2).padStart(2, '0')}.${String(cs2).padStart(2, '0')}`;
}

/**
 * 단어 경계로 줄바꿈. 방송 자막은 한 줄이 아니라 **두 줄**이다(레퍼런스: YTN 하단 밴드).
 * 한 줄짜리 짧은 큐가 계속 깜빡이면 오히려 안 읽힌다 — 두 줄을 채워 체류 시간을 늘린다.
 * 공백이 없는 한국어는 글자 수로 자른다(단어 경계가 없으니 그 방법밖에 없다).
 */
export function wrapLines(text, maxChars, maxLines = 2) {
  const t = String(text ?? '').trim();
  if (!t) return [];
  if (t.length <= maxChars) return [t];          // 한 줄에 들어가면 쪼개지 않는다

  const words = t.split(/\s+/);
  // 공백 없는 긴 덩어리(한국어)는 단어 경계가 없으니 글자 수로 자른다.
  if (words.length === 1) {
    const out = [];
    for (let k = 0; k < t.length; k += maxChars) out.push(t.slice(k, k + maxChars));
    return out.length > maxLines
      ? [...out.slice(0, maxLines - 1), out.slice(maxLines - 1).join('')]
      : out;
  }

  // 두 줄 길이를 **맞춘다**. 탐욕적으로 채우면 첫 줄만 꽉 차고 둘째 줄이 짧아 가로가 빈다 —
  //   "Carina Walker has been named the new head of"(44) / "Young Adult publishing at"(25).
  //   균형을 맞추면 양쪽이 고르게 차서 한 덩어리로 읽힌다. 방송 자막의 기본이다.
  const target = Math.ceil(t.length / maxLines);
  const lines = [];
  let cur = '', rest = words.slice();
  while (rest.length && lines.length < maxLines - 1) {
    cur = '';
    while (rest.length) {
      const next = cur ? `${cur} ${rest[0]}` : rest[0];
      if (next.length > maxChars) break;
      // 목표 길이를 넘겼는데, 넣는 편이 **더 멀어지면** 넣지 않는다.
      if (cur && Math.abs(next.length - target) > Math.abs(cur.length - target)) break;
      cur = next;
      rest.shift();
    }
    if (!cur) { cur = rest.shift(); }             // 한 단어도 못 넣으면 강제로 하나
    lines.push(cur);
  }
  if (rest.length) lines.push(rest.join(' '));    // 남은 건 마지막 줄에 — 버리지 않는다
  return lines;
}

/**
 * alignment(글자 배열 + 시각 배열) → 자막 큐.
 * @param {{characters:string[],character_start_times_seconds:number[],character_end_times_seconds:number[]}} alignment
 * @param {{maxChars?:number,maxDur?:number,offset?:number}} opts
 * @returns {{start:number,end:number,text:string}[]}
 */
export function cuesFromAlignment(alignment, opts = {}) {
  const { maxChars = 24, maxDur = 3.0, offset = 0, maxLines = 1 } = opts;
  const budget = maxChars * maxLines;   // 큐 하나가 담을 총 글자 수(줄 수 × 줄당 글자)
  const ch = alignment?.characters;
  const st = alignment?.character_start_times_seconds;
  const en = alignment?.character_end_times_seconds;
  if (!Array.isArray(ch) || ch.length === 0 || !Array.isArray(st) || !Array.isArray(en)) return [];

  // 1) 단어 토큰. 공백은 버리되 시각은 글자 인덱스에서 그대로 읽는다.
  const tokens = [];
  for (let i = 0; i < ch.length; i++) {
    if (/\s/.test(ch[i])) continue;
    let j = i;
    while (j + 1 < ch.length && !/\s/.test(ch[j + 1])) j++;
    tokens.push({ text: ch.slice(i, j + 1).join(''), from: i, to: j });
    i = j;
  }

  // 2) 한 단어가 maxChars 를 넘으면(공백이 드문 한국어) 글자 단위로 쪼갠다.
  //    이때 조각끼리는 붙여 읽어야 하므로 glue=true — 큐를 합칠 때 공백을 넣지 않는다.
  const parts = [];
  for (const t of tokens) {
    if (t.text.length <= budget) { parts.push({ ...t, glue: false }); continue; }
    for (let k = 0; k < t.text.length; k += budget) {
      const from = t.from + k;
      const to = Math.min(t.to, from + budget - 1);
      parts.push({ text: t.text.slice(k, k + budget), from, to, glue: k > 0 });
    }
  }

  // 3) maxChars / maxDur 안에서 묶는다.
  const cues = [];
  let cur = null;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    // 다음 토큰을 봐야 약어를 가릴 수 있다(위 isSentenceEnd 의 ③). 붙여읽기 조각(glue)은
    // 같은 단어의 뒷부분이므로 "다음 단어" 가 아니다 — 건너뛰고 진짜 다음 토큰을 찾는다.
    let n = i + 1;
    while (n < parts.length && parts[n].glue) n++;
    const nextText = parts[n]?.text;
    const ends = isSentenceEnd(p.text, nextText);
    const sep = cur && !p.glue ? ' ' : '';
    const wouldLen = cur ? cur.text.length + sep.length + p.text.length : p.text.length;
    const wouldDur = cur ? en[p.to] - st[cur.from] : en[p.to] - st[p.from];
    if (cur && wouldLen <= budget && wouldDur <= maxDur && !cur.sentenceEnd) {
      cur.text += sep + p.text;
      cur.to = p.to;
      cur.sentenceEnd = ends;
    } else {
      if (cur) cues.push(cur);
      cur = { text: p.text, from: p.from, to: p.to, sentenceEnd: ends };
    }
  }
  if (cur) cues.push(cur);

  return cues.map((c) => ({
    start: st[c.from] + offset,
    end: en[c.to] + offset,
    // 여러 줄이면 줄바꿈을 여기서 넣는다 — toAss 가 \n 을 ASS 의 \N 으로 바꾼다.
    text: maxLines > 1 ? wrapLines(c.text, maxChars, maxLines).join('\n') : c.text,
  }));
}

/**
 * 문장 끝 판정. 마침표·물음표·느낌표로 끝나는 토큰이면 거기서 큐를 닫는다.
 *
 * 왜(2026-08-27 실측): 글자 수만으로 묶었더니 "…she was / real. Lauren" 처럼 앞 문장의 끝과
 *   다음 문장의 첫 단어가 한 화면에 섞였다. 읽는 사람이 거기서 두 번 멈춘다.
 *   방송 자막은 글자 수가 아니라 문장·절 경계로 끊는다.
 *
 * 2026-09-02 정정: 종전 주석은 "소수점·약어(U.S.)를 오인하지 않도록 뒤에 아무것도 없는 부호만
 *   본다" 고 적혀 있었다. **절반만 사실이었다.** 소수점은 실제로 안전하다("0.50" 은 숫자로
 *   끝나 매치되지 않는다). 그러나 약어는 토큰 자체가 "U.S." 라서 그대로 걸린다.
 *   업로드 영상 프레임을 뽑아 보고 잡았다(youtu.be/ZqfPqLFtaJQ):
 *     "The U.S. Federal Reserve held…"      → 한 화면에 "The U.S." 만
 *     "Palo Alto Networks Inc. reported…"   → "Palo Alto Networks Inc." 에서 끊김
 *     "Dr. Powell said…"                    → "Dr." 만
 *   문장 경계로 끊으려고 넣은 규칙이 약어에서 정확히 같은 증상을 새로 만들고 있었다.
 */
const SENT_END = /[.!?。！？]["'\u2019\u201d)\]]?$/;

/**
 * 머리글자 약어(U.S., U.K., A.I.) — 한 글자 + 마침표가 두 번 이상 반복되는 꼴.
 * 목록이 아니라 형태로 판정하므로 새 약어가 나와도 자동으로 걸린다.
 */
const INITIALISM = /^(?:[A-Za-z]\.){2,}$/;

/**
 * 형태만으로는 못 거르는 약어들. 목록은 최소로 둔다 — 영어 철자법상 "Inc." 와 문장 끝
 * "Inc." 는 형태가 같아서, 이건 원리적으로 목록이나 문맥 없이는 구분되지 않는다.
 * 그래서 아래 nextStartsLower 규칙을 1차로 쓰고, 이 목록은 그것으로도 안 잡히는 경우만 받는다.
 */
const ABBREV = new Set(['inc.', 'corp.', 'ltd.', 'co.', 'llc.', 'plc.', 'mr.', 'mrs.', 'ms.', 'dr.',
  'prof.', 'sr.', 'jr.', 'st.', 'vs.', 'etc.', 'est.', 'no.', 'approx.', 'fig.']);

/**
 * 이 토큰에서 큐를 닫아도 되는가.
 * @param {string} token 지금 토큰
 * @param {string|undefined} next 다음 토큰(없으면 undefined)
 *
 * 판정 순서(구조 신호를 목록보다 먼저 본다):
 *   ① 문장부호로 안 끝나면 문장 끝이 아니다
 *   ② 머리글자 약어면 아니다 — 형태로 판정
 *   ③ 다음 단어가 소문자로 시작하면 문장이 이어지는 것이다. 목록 없이 쓰는 가장 넓은 신호로,
 *      "Inc. reported" · "Dr. said" 같은 경우를 전부 덮는다
 *   ④ 그래도 남는 것(뒤가 대문자인 "Dr. Powell", "St. Louis")은 목록으로 받는다
 */
function isSentenceEnd(token, next) {
  if (!SENT_END.test(token)) return false;
  if (INITIALISM.test(token)) return false;
  if (next && /^[a-z\u00e0-\u024f]/.test(next)) return false;
  if (ABBREV.has(token.toLowerCase())) return false;
  return true;
}

/**
 * 큐 사이의 짧은 빈틈을 앞 큐로 덮는다.
 * 하단 밴드는 항상 떠 있는데 글자만 사라지면 고장난 화면으로 보인다(장면 경계 0.45초).
 * 긴 침묵까지 덮으면 말과 자막이 어긋나므로 maxGap 상한을 둔다.
 */
export function fillGaps(cues, maxGap = 1.5) {
  const list = Array.isArray(cues) ? cues : [];
  return list.map((c, i) => {
    const next = list[i + 1];
    if (!next) return c;
    const gap = next.start - c.end;
    return gap > 0 && gap <= maxGap ? { ...c, end: next.start } : c;
  });
}

/**
 * 밴드 높이에서 역산한 글꼴 확대 상한.
 * 무한정 키우면 두 줄이 띠를 넘는다 — 실측 기준 ASS 줄 높이는 대략 fontSize × 1.2 다.
 */
export function fitScale({ bandTop, marginV, fontSize, lines = 2, playResY = 1080, lineHeight = 1.2 }) {
  const avail = playResY - marginV - bandTop;
  const maxFs = Math.floor(avail / lines / lineHeight);
  return Math.max(1, maxFs / fontSize);
}

/** libass 가 오해할 문자를 무해하게 만든다. `{}` 는 override 태그로 먹히고 개행은 \N 이다. */
function escapeAss(t) {
  return String(t).replace(/\{/g, '(').replace(/\}/g, ')').replace(/\r?\n/g, '\\N');
}

/**
 * 큐 → ASS 파일 본문.
 * 스타일은 뉴스 자막 관습을 따른다: 굵은 흰 글씨 + 검은 외곽선(어떤 배경 위에서도 읽힌다) + 하단 중앙.
 */
export function toAss(cues, opts = {}) {
  const {
    style = 'outline', font = 'Arial', fontSize = 62, playResX = 1920, playResY = 1080,
    marginV = 96, marginLR = 140,
    // 큐마다 글자 크기를 문장 길이에 맞춘다. 줄 균형을 맞춰도 **문장 자체가 짧으면** 가로가 빈다 —
    //   "They worry about the long-term / impact on their community."(34/30자, 상한 46)는
    //   밴드 폭의 70% 만 쓴다. ASS 는 Dialogue 줄의 {\fs..} 인라인 태그로 크기를 덮을 수 있다.
    autoFit = false, maxChars = 0, maxScale = 1.32,
    // 밴드 안에서 **세로 가운데**에 앉힌다. Alignment=2 는 아래정렬이라, 2줄 높이로 만든
    //   밴드에 1줄짜리 큐가 오면 바닥에 붙고 위쪽이 통째로 빈다(2026-08-28 지적).
    //   MarginV 를 키워 1줄을 맞추면 이번엔 2줄이 밴드 위로 삐져나간다 —
    //   줄 수가 바뀌는데 고정 여백으로는 둘 다 못 맞춘다.
    //   \an5(가운데정렬) + \pos 로 **글자 블록의 중심**을 밴드 중심에 두면 줄 수와 무관하다.
    vcenterY = 0,
  } = opts;
  // 두 가지 방식을 코드가 구분한다:
  //   outline — 사진 위에 바로 얹는다. 흰 글자 + 두꺼운 검은 외곽선이라야 어떤 배경에서도 읽힌다.
  //   band    — 하단에 밝은 띠를 깔고 그 안에 어두운 글자를 넣는다(YTN 등 방송 자막).
  //             띠가 있으면 외곽선은 오히려 지저분하므로 0 으로 둔다.
  const S = style === 'band'
    ? { primary: '&H00202020', outlineC: '&H00FFFFFF', back: '&H00FFFFFF', outline: 0, shadow: 0, bold: -1 }
    : { primary: '&H00FFFFFF', outlineC: '&H00101010', back: '&H90000000', outline: 4, shadow: 2, bold: -1 };
  const head = `[Script Info]
ScriptType: v4.00+
WrapStyle: 2
ScaledBorderAndShadow: yes
PlayResX: ${playResX}
PlayResY: ${playResY}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,${font},${fontSize},${S.primary},${S.primary},${S.outlineC},${S.back},${S.bold},0,0,0,100,100,0,0,1,${S.outline},${S.shadow},2,${marginLR},${marginLR},${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
  // \pos 는 큐마다 붙어야 한다 — 스타일에는 위치 태그를 넣을 수 없다.
  const posTag = vcenterY > 0 ? `{\\an5\\pos(${Math.round(playResX / 2)},${Math.round(vcenterY)})}` : '';
  const body = (cues ?? []).map((c) => {
    let tag = '';
    if (autoFit && maxChars > 0) {
      const longest = Math.max(...String(c.text).split(/\r?\n/).map((l) => l.length), 1);
      // 상한을 두는 이유: 무한정 키우면 두 줄이 밴드 높이를 넘는다.
      const scale = Math.min(maxScale, Math.max(1, maxChars / longest));
      const fs = Math.round(fontSize * scale);
      if (fs !== fontSize) tag = `{\\fs${fs}}`;
      else tag = `{\\fs${fontSize}}`;   // 테스트·디버깅에서 크기를 항상 읽을 수 있게 명시한다
    }
    return `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Sub,,0,0,0,,${posTag}${tag}${escapeAss(c.text)}`;
  });
  return [head, ...body, ''].join('\n');
}
