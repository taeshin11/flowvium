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
 * alignment(글자 배열 + 시각 배열) → 자막 큐.
 * @param {{characters:string[],character_start_times_seconds:number[],character_end_times_seconds:number[]}} alignment
 * @param {{maxChars?:number,maxDur?:number,offset?:number}} opts
 * @returns {{start:number,end:number,text:string}[]}
 */
export function cuesFromAlignment(alignment, opts = {}) {
  const { maxChars = 24, maxDur = 3.0, offset = 0 } = opts;
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
    if (t.text.length <= maxChars) { parts.push({ ...t, glue: false }); continue; }
    for (let k = 0; k < t.text.length; k += maxChars) {
      const from = t.from + k;
      const to = Math.min(t.to, from + maxChars - 1);
      parts.push({ text: t.text.slice(k, k + maxChars), from, to, glue: k > 0 });
    }
  }

  // 3) maxChars / maxDur 안에서 묶는다.
  const cues = [];
  let cur = null;
  for (const p of parts) {
    const sep = cur && !p.glue ? ' ' : '';
    const wouldLen = cur ? cur.text.length + sep.length + p.text.length : p.text.length;
    const wouldDur = cur ? en[p.to] - st[cur.from] : en[p.to] - st[p.from];
    if (cur && wouldLen <= maxChars && wouldDur <= maxDur) {
      cur.text += sep + p.text;
      cur.to = p.to;
    } else {
      if (cur) cues.push(cur);
      cur = { text: p.text, from: p.from, to: p.to };
    }
  }
  if (cur) cues.push(cur);

  return cues.map((c) => ({
    start: st[c.from] + offset,
    end: en[c.to] + offset,
    text: c.text,
  }));
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
    font = 'Arial', fontSize = 62, playResX = 1920, playResY = 1080,
    marginV = 96, outline = 4, shadow = 2,
  } = opts;
  const head = `[Script Info]
ScriptType: v4.00+
WrapStyle: 2
ScaledBorderAndShadow: yes
PlayResX: ${playResX}
PlayResY: ${playResY}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,${font},${fontSize},&H00FFFFFF,&H00FFFFFF,&H00101010,&H90000000,-1,0,0,0,100,100,0,0,1,${outline},${shadow},2,140,140,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
  const body = (cues ?? []).map(
    (c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Sub,,0,0,0,,${escapeAss(c.text)}`,
  );
  return [head, ...body, ''].join('\n');
}
