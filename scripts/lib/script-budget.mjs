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
  const len = (x) => String(x?.say ?? '').length;
  const before = list.reduce((n, s) => n + len(s), 0);
  if (list.length === 0 || !budgetChars || before <= budgetChars * tolerance) {
    return { scenes: list, trimmed: 0, before, after: before };
  }

  // 장면마다 budget/n 로 균등하게 자르면 예산이 남아돈다 — 실측(2026-08-27): 예산 1467자에
  //   2024자가 들어왔는데 **682자(46%)** 만 남아 90초 목표가 45.7초가 됐다. 첫 문장 뒤에 올
  //   문장이 균등몫을 넘으면 그 장면은 거기서 멈추고, 남은 몫은 어느 장면도 못 쓴다.
  // → **가장 긴 장면부터 한 문장씩** 덜어낸다. 예산 바로 위에서 멈추므로 낭비가 없다.
  const parts = list.map((s) => splitSentences(s?.say));
  const keep = parts.map((p) => p.length);
  const joined = (i) => parts[i].slice(0, keep[i]).join(' ');
  const total = () => keep.reduce((n, _, i) => n + joined(i).length, 0);

  let guard = 0;
  while (total() > budgetChars && guard++ < 10_000) {
    // 자를 수 있는(문장이 2개 이상 남은) 장면 중 가장 긴 것.
    let pick = -1, max = -1;
    for (let i = 0; i < parts.length; i++) {
      if (keep[i] <= 1) continue;                 // 최소 1문장은 남긴다 — 빈 대본은 TTS 가 던진다
      const l = joined(i).length;
      if (l > max) { max = l; pick = i; }
    }
    if (pick < 0) break;                          // 전부 1문장 — 더는 못 줄인다(반토막 내지 않는다)
    keep[pick] -= 1;
  }

  let trimmed = 0;
  const out = list.map((s, i) => {
    if (keep[i] === parts[i].length) return s;
    trimmed++;
    return { ...s, say: joined(i) };
  });
  const after = out.reduce((n, s) => n + len(s), 0);
  return { scenes: out, trimmed, before, after };
}
