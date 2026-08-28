/**
 * script-grounding.mjs — 대본이 **근거에 없는 것을 말하지 않는가.**
 *
 * 실측 사고(2026-08-28): 실시간 헤드라인 836건 어디에도 없는
 *   "트럼프가 온타리오호를 Lake America 로 개명" 이 대본에 들어갔고, 영상까지 나왔다.
 *   프롬프트에는 "Use only facts present in the headlines" 가 있었다.
 *   **프롬프트는 구속력이 없다.** 지어낸 뉴스를 사실처럼 내보내는 건 되돌릴 수 없는 종류의 사고다.
 *
 * 무엇을 보는가: **고유명사와 숫자**. 이 둘이 뉴스의 검증 가능한 뼈대다.
 *   서술이나 어조는 판단하지 않는다 — 그건 코드가 할 수 있는 일이 아니다.
 *
 * 왜 낱말 단위인가: "The United States Senate" 같은 구는 헤드라인에 통째로는 없어도
 *   낱말은 다 있다. 구 단위로 보면 멀쩡한 문장이 무더기로 걸린다.
 *   낱말 단위면 "Ontario" 하나가 없다는 것만으로 잡힌다 — 실제로 그렇게 잡혔다.
 */

// 문장 첫머리 대문자는 고유명사가 아니다. 흔한 뉴스 어휘도 뺀다 —
//   이 낱말들이 헤드라인에 없다고 지어낸 것은 아니다.
const COMMON = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'it', 'he', 'she', 'they', 'we', 'you', 'i',
  'in', 'on', 'at', 'to', 'of', 'for', 'with', 'from', 'by', 'as', 'and', 'or', 'but', 'if', 'so',
  'is', 'are', 'was', 'were', 'be', 'been', 'has', 'have', 'had', 'will', 'would', 'can', 'could',
  'meanwhile', 'however', 'today', 'tonight', 'now', 'here', 'there', 'after', 'before', 'while',
  'president', 'senator', 'governor', 'judge', 'officials', 'according', 'reports', 'news',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
]);

/**
 * 고유명사처럼 보이지만 **특정 대상을 지목하지 않는** 말들.
 *
 * 실측(2026-08-28): 낱말 단위로만 보니 "American", "United States", "Senate" 이
 *   3회 연속 걸려 대본이 통째로 막혔다. 이건 지어낸 게 아니라 서술어다.
 *   막기만 하고 통과를 못 시키는 검사는 결국 꺼진다 — 부류를 나눠야 한다.
 *
 * 두 부류다:
 *   ① 국민·지역 형용사(demonym) — 나라 이름이 헤드라인에 있어도 형용사형은 없기 마련이다.
 *   ② 보통명사로 쓰이는 국가기관·방위 — 특정 사건을 지목하지 않는다.
 * 반면 "Macy's", "Ontario" 같은 **개별 고유명사**는 여기 들어가지 않는다. 그건 검증 대상이다.
 */
const GENERIC_PROPER = new Set([
  // ① demonym
  'american', 'americans', 'british', 'chinese', 'russian', 'russians', 'korean', 'koreans',
  'japanese', 'european', 'europeans', 'german', 'french', 'italian', 'spanish', 'indian',
  'canadian', 'mexican', 'israeli', 'palestinian', 'ukrainian', 'iranian', 'african', 'asian',
  // ② 보통명사처럼 쓰이는 기관·직위·방위
  'united', 'states', 'state', 'senate', 'congress', 'house', 'court', 'supreme', 'federal',
  'reserve', 'republican', 'republicans', 'democrat', 'democrats', 'department', 'administration',
  'white', 'capitol', 'justice', 'attorney', 'secretary', 'governor', 'mayor', 'council',
  'north', 'south', 'east', 'west', 'northern', 'southern', 'eastern', 'western',
]);

/** 문장 첫 낱말인지 표시하며 토큰을 나눈다. */
function tokens(text) {
  const out = [];
  for (const sentence of String(text ?? '').split(/(?<=[.!?])\s+/)) {
    const ws = sentence.split(/\s+/).filter(Boolean);
    ws.forEach((w, i) => out.push({ raw: w, first: i === 0 }));
  }
  return out;
}

/**
 * 곧은 따옴표와 굽은 따옴표를 하나로 맞춘다.
 * 실측(2026-08-28): 대본은 "Macy's", 헤드라인은 "Macy’s" 였다. 실제로 보도된 기사인데
 *   글자가 달라 "지어냈다" 로 걸렸다. 문자 모양 차이로 사실 판정이 뒤집히면 안 된다.
 */
const norm = (t) => String(t ?? '').replace(/[\u2018\u2019\u02bc]/g, "'");

const clean = (w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

/**
 * 근거에 없는 고유명사·숫자를 돌려준다.
 * @param {string} text        검사할 대본
 * @param {string} sourceText  근거(헤드라인 모음)
 * @returns {string[]} 근거에 없는 낱말들(중복 제거)
 */
export function ungroundedNames(text, sourceText) {
  const src = norm(sourceText).toLowerCase();
  if (!src.trim()) return [];                        // 근거가 없으면 판단하지 않는다
  const bad = new Set();
  for (const t of tokens(norm(text))) {
    const w = clean(t.raw);
    if (!w) continue;
    const lower = w.toLowerCase();
    if (COMMON.has(lower) || GENERIC_PROPER.has(lower)) continue;

    // 숫자: 연도·수치는 지어내기 쉽고 확인도 쉽다. 1~2 자리 작은 수는 흔해서 뺀다.
    if (/^\d[\d,.]*$/.test(w)) {
      const digits = w.replace(/\D/g, '');
      if (digits.length < 3) continue;
      if (!src.includes(digits) && !src.includes(w.toLowerCase())) bad.add(w);
      continue;
    }

    // 고유명사: 대문자로 시작하되 문장 첫 낱말은 뺀다(그건 그냥 문장 시작이다).
    //   다만 소유격이 붙으면("Macy's") 문장 첫머리라도 이름이 분명하므로 검사한다.
    //   한계: 문장 첫머리에 홀로 온 한 낱말짜리 이름은 못 잡는다. 뒤따르는 낱말이
    //   같이 걸리므로 실제 사고("Lake Ontario")는 잡히지만, 완전하지는 않다.
    const possessive = /[’']s$/i.test(t.raw);
    if (t.first && !possessive) continue;
    if (!/^\p{Lu}/u.test(w)) continue;
    if (w.length < 3) continue;
    // 소유격은 어간으로도 본다 — 헤드라인에 "Macy's" 가 아니라 "Macy" 로 나올 수 있다.
    const forms = [lower];
    const stem = lower.replace(/'s$/, '');
    if (stem !== lower) forms.push(stem);
    const hit = forms.some((f) => new RegExp(`\\b${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(src));
    if (!hit) bad.add(w);
  }
  return [...bad];
}

/**
 * 장면 배열 전체를 검사한다.
 * @returns {{scene:number, words:string[]}[]} 문제 있는 장면들
 */
export function ungroundedScenes(scenes, sourceText) {
  const out = [];
  (scenes ?? []).forEach((s, i) => {
    const words = ungroundedNames(s?.say ?? '', sourceText);
    if (words.length) out.push({ scene: i + 1, words });
  });
  return out;
}

/**
 * 근거 없는 말이 든 **문장만** 덜어낸다. 장면을 통째로 버리지 않는다.
 *
 * 세 번 시도해도 남으면 대본 전체를 버리는 게 처음 설계였는데, 그러면 한 낱말 때문에
 *   그날 영상이 아예 안 나온다(2026-08-28: "Great Lakes" 하나로 3연속 실패).
 *   막기만 하고 통과를 못 시키는 검사는 결국 꺼진다.
 *   지어낸 문장만 빼고 나머지는 살리는 편이, 안 내보내는 것보다도 안 지어내는 것보다도 낫다.
 *
 * 문장을 다 빼면 그 장면은 비므로, 호출부가 걸러야 한다(빈 say 를 그대로 돌려준다).
 */
export function stripUngrounded(scenes, sourceText) {
  let removed = 0;
  const out = (scenes ?? []).map((s) => {
    const sentences = String(s?.say ?? '').split(/(?<=[.!?])\s+/).filter(Boolean);
    const kept = sentences.filter((one) => {
      const bad = ungroundedNames(one, sourceText).length > 0;
      if (bad) removed++;
      return !bad;
    });
    return { ...s, say: kept.join(' ').trim() };
  });
  return { scenes: out, removed };
}
