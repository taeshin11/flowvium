/**
 * script-budget.mjs — 대본을 목표 길이에 맞춘다.
 *
 * 왜 프롬프트로 안 하는가: 두 번 연속 빗나갔다(2026-08-27 실측).
 *   1차 "4~6장면 70~110자" → 60.7초 (목표 90)
 *   2차 "8장면 146~220자"  → 128.8초 (목표 90, 실제 장면당 약 310자)
 *   길이는 모델이 지키는 제약이 아니라 우리가 거는 제약이다.
 *
 * 자르는 방식이 결과를 좌우한다:
 *   · 글자 수로 뚝 자르면 앵커가 말을 하다 만다.   → 문장 경계에서만 자른다.
 *   · 장면을 버리면 이슈 하나가 통째로 사라진다.   → 장면 수는 유지한다.
 *   · 장면당 최소 1문장. 빈 대본은 TTS 가 던진다.
 */

/** 문장 단위로 쪼갠다. 종결부호를 문장 끝에 붙여서 돌려준다(한국어 "…다." / 영어 "…." 공통). */
export function splitSentences(text) {
  const t = String(text ?? '').trim();
  if (!t) return [];
  // 종결부호 + (공백 또는 끝). 부호를 앞 문장에 남기려고 lookbehind 대신 matchAll 을 쓴다.
  const out = [];
  let buf = '';
  for (const ch of t) {
    buf += ch;
    if (/[.!?。！？]/.test(ch)) { out.push(buf.trim()); buf = ''; }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/**
 * @param {{say:string}[]} scenes
 * @param {{budgetChars:number, tolerance?:number}} opts
 * @returns {{scenes:object[], trimmed:number, before:number, after:number}}
 */
export function fitScript(scenes, opts = {}) {
  const { budgetChars, tolerance = 1.1 } = opts;
  const list = Array.isArray(scenes) ? scenes : [];
  const before = list.reduce((n, s) => n + String(s?.say ?? '').length, 0);
  if (list.length === 0 || !budgetChars || before <= budgetChars * tolerance) {
    return { scenes: list, trimmed: 0, before, after: before };
  }

  const per = budgetChars / list.length;
  let trimmed = 0;
  const out = list.map((s) => {
    const sents = splitSentences(s?.say);
    if (sents.length <= 1) return s;            // 한 문장짜리는 손대지 않는다 — 자르면 반토막이다
    let kept = sents[0];                        // 최소 1문장은 항상 남긴다
    for (let i = 1; i < sents.length; i++) {
      if (kept.length + 1 + sents[i].length > per) break;
      kept += ` ${sents[i]}`;
    }
    if (kept.length < String(s.say).length) trimmed++;
    return { ...s, say: kept };
  });

  const after = out.reduce((n, s) => n + String(s?.say ?? '').length, 0);
  return { scenes: out, trimmed, before, after };
}
