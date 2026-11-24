/**
 * hook-overlap.mjs — 첫 화면 훅이 제목을 되풀이하나. 머리말 규칙은 hook-overlap.test.mjs.
 * 10/28 쇼츠 첫 화면 관문에서 세 심판 모두 "훅이 제목을 그대로 되풀이해 더하는 게 없다"를 가장 큰 약점으로 짚었다.
 * Mac mini2(사장님 썸네일 기준): 첫 화면 훅은 제목이 말하지 않는 것을 더해야 한다 — 상식 편 대본(lib/evergreen-check)과
 *   뉴스 쇼츠 훅(make-shorts)이 같은 잣대를 쓴다.
 * 낱말 비교는 어간 근사: 한글은 앞 두 글자(내리면·내리는 → 내리), 영문·숫자는 통째로. 한 글자 낱말(왜·싼·꼭)은 뺀다.
 */
// 영문·숫자와 한글을 따로 끊는다 — "PER이" 가 한 덩어리로 'PE' 가 되면 제목의 'PER' 과 안 맞는다(10/28).
const stems = (t) => (String(t ?? '').toLowerCase().match(/[0-9a-z]+|[가-힣]+/g) ?? []).filter((w) => w.length >= 2)
  .map((w) => (/[가-힣]/.test(w) ? w.slice(0, 2) : w));

/** 훅 낱말 중 제목에도 있는 비율(0~1). */
export function hookOverlap(hook, title) {
  const h = stems(hook);
  if (!h.length) return 0;
  const t = new Set(stems(title));
  return h.filter((w) => t.has(w)).length / h.length;
}

/** 훅이 제목을 되풀이하나 — 낱말 둘 이상이 겹치고 그 비율이 0.6 이상. 주제어 하나 겹침은 괜찮다(주제는 같아야 한다). */
export function repeatsTitle(hook, title) {
  const h = stems(hook);
  const t = new Set(stems(title));
  const same = h.filter((w) => t.has(w)).length;
  return same >= 2 && same / Math.max(1, h.length) >= 0.6;
}

/** 문장(첫 대사)이 제목을 다시 말하나 — 제목 낱말 셋 이상, 절반 이상을 다시 쓰면 되풀이. 문장은 길어 훅보다 제목 쪽 비율로 본다.
 *  10/28 Mac mini2: 첫 자막(=첫 대사)도 제목을 되풀이하면 안 된다(심판들이 첫 화면 아래 자막도 짚었다). */
export function restatesTitle(text, title) {
  const t = [...new Set(stems(title))];
  if (!t.length) return false;
  const have = new Set(stems(text));
  const same = t.filter((w) => have.has(w)).length;
  return same >= 3 && same / t.length >= 0.5;
}

/** 훅이 그 뉴스에서 나왔나 — 낱말 하나라도 화면 뉴스(헤드라인·대사)와 겹쳐야 한다.
 *  10/28 20:57: 심판이 낸 훅 "타지 철길 위 참변" 이 성평등장관 편에 올랐다(빠진 1번 뉴스 제목을 보고 썼다). 새 말을 붙이는 건 되지만 남의 뉴스는 안 된다. */
export function sharesStory(hook, story) {
  const h = stems(hook);
  if (!h.length) return false;
  const s = new Set(stems(story));
  return h.some((w) => s.has(w));
}

// 신문 제목의 한 글자 한자 약칭(나라·기관). 與·野 는 어느 당인지 몰라 넣지 않는다 — 판정 안 함(11/21).
const HANJA = { 美: '미국', 中: '중국', 韓: '한국', 日: '일본', 北: '북한', 英: '영국', 露: '러시아', 獨: '독일', 佛: '프랑스', 印: '인도', 臺: '대만', 靑: '청와대' };

/** 헤드라인의 주어 — 첫 낱말(편집 표시·따옴표·끝 조사 뗌). 한 글자(野·與)나 숫자면 null(판정 안 함). 11/02 벤치마크.
 *  11/21: 한자 약칭 — 붙어 있으면 뒤 낱말(李대통령→대통령·韓총리→총리), 띄어 쓴 나라 약칭 뒤 낱말(美 상무부→상무부),
 *  약칭 뒤가 따옴표·쉼표면 그 나라·기관(美 "…"→미국, 靑, …→청와대). */
export function headlineSubject(headline) {
  let t = String(headline ?? '').replace(/^\s*(\[[^\]]*\]\s*)+/, '').replace(/^[\s'"‘’“”「」]+/, '');
  const hz = t.match(/^([\u4e00-\u9fff])(\s*)/);
  if (hz) {
    const rest = t.slice(hz[0].length);
    const next = /^[0-9A-Za-z가-힣]/.test(rest);
    if (!hz[2] && next) t = rest;
    else if (HANJA[hz[1]] && next) t = rest;
    else return HANJA[hz[1]] ?? null;
  }
  let w = (t.match(/^[0-9A-Za-z가-힣]+/) ?? [''])[0];
  if (w.length > 2 && /[가-힣]$/.test(w) && /[이가은는의도]$/.test(w)) w = w.slice(0, -1);
  return w.length >= 2 && !/^[0-9]/.test(w) ? w : null;
}

/** 첫 훅이 담아야 할 주어 후보 — 이슈 키워드(헤드라인에 있고 숫자가 없을 때)와 헤드라인 첫 낱말. 11/21: 키워드가
 *  "1조달러"·"90만개" 같은 분량이거나 "금융상품" 같은 화제어여서 진짜 주어를 쓴 훅이 떨어졌다(11/19~20 9편 중 6편). */
export function leadSubjects(headline, keyword) {
  const k = String(keyword ?? '').trim();
  const out = [];
  if (k.length >= 2 && !/[0-9]/.test(k) && String(headline ?? '').includes(k)) out.push(k);
  const s = headlineSubject(headline);
  if (s && !out.some((x) => stems(x).join() === stems(s).join())) out.push(s);
  return out;
}

/** 첫 훅이 주어 후보 중 하나를 담나 — 어간 근사(앞 두 글자·영문 통째)로 하나라도 겹치면 된다. 후보가 없으면 true.
 *  keyword(이슈 키워드)가 헤드라인에 있으면 그것도 주어다. 첫 낱말은 꾸밈말일 수 있다
 *  (11/02 "[일문일답] 국빈방한 에르도안 …" 에서 '국빈방한' 을 주어로 뽑았다). */
export function namesSubject(hook, headline, keyword) {
  const subs = leadSubjects(headline, keyword);
  if (!subs.length) return true;
  const have = new Set(stems(hook));
  return subs.some((s) => stems(s).some((w) => have.has(w)));
}

/** 생성 쪽 계획(11/21) — 모델에게 이번 회차 첫 훅의 주어 후보와 피할 제목 낱말을 준다. 검사(namesSubject·repeatsTitle)와 같은 잣대.
 *  주어 말고 제목 낱말을 안 쓰면 겹침이 하나뿐이라 repeatsTitle(둘 이상)에 안 걸린다. */
export function firstHookPlan(headline, keyword) {
  const subjects = leadSubjects(headline, keyword);
  const subStems = new Set(subjects.flatMap((s) => stems(s)));
  const seen = new Set();
  const avoid = [];
  for (const w of String(headline ?? '').match(/[0-9A-Za-z가-힣]+/g) ?? []) {
    const st = stems(w);
    if (!st.length || st.every((x) => subStems.has(x)) || seen.has(st.join())) continue;
    seen.add(st.join());
    avoid.push(w.replace(/(?<=[가-힣]{2})(이|가|은|는|을|를|에|에서|의|도|와|과|로|으로)$/, ''));
  }
  return { subjects, avoid };
}

/**
 * 2026-11-24 리포트2(벤치마크 상위 5채널 × 최근 30일 상위 쇼츠, agy·Claude 그림 열람 + ChatGPT 3곳 합의):
 *   상위 쇼츠의 화면 글은 시청자 돈이 걸린 말('외인, 또 털고 갈까?')인데 우리 첫 훅은 중립 꼬리표('민주당의 여론전 돌입')다.
 *   그래서 첫 훅의 '제목에 없는 말'을 시청자 돈·생활에 닿는 영향으로 채우게 한다. 기사에 그 영향이 없으면 쓰지 않는다
 *   — 지어낸 영향은 '사실만' 원칙을 깬다. 명사로 끝내기·12자 규칙은 그대로다(눈검증 textRule 과 같다).
 */
export const STAKE_HOOK_RULE = `
  · 1번 장면 hook 의 '제목에 없는 말'은 되도록 **시청자 돈·생활에 무엇이 달라지는지**로 채운다(대출 이자·세금·주가·물가·일자리 등).
    기사에 그 영향이 실제로 적혀 있을 때만 쓴다. 기사에 없는 영향·숫자·전망은 지어내지 마라 — 없으면 결과·이유의 실마리로 채운다.`;
