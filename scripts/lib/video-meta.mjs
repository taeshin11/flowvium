/**
 * video-meta.mjs — 업로드 제목·설명·태그를 만든다.
 *
 * 왜 분리했나 (2026-09-03): video-publish.mjs 안에서 **영어로 하드코딩**돼 있었다.
 *   "In this update:" · "Daily US politics and economy" · "#USNews #Politics"
 *   채널을 한국어로 돌리니 한국어 영상 설명란에 영어 안내와 미국 해시태그가 그대로 붙는다.
 *   로케일 분기를 호출부에 흩으면 다음에 또 어긋나므로 여기 모은다.
 *
 * 제목 규칙(사용자 지시): "제목에 국뽕 섞을수있으면 섞어"
 *   섞는다는 것은 **없는 말을 붙이는 것이 아니다.** 헤드라인 여러 건 중에서 한국의 성과를
 *   말하는 것이 있으면 그것을 앞세운다 — 고르는 문제이지 짓는 문제다.
 *   그래서 KOREA_WIN 은 "지어낼 말" 이 아니라 "고를 기준" 이다.
 */

/** 한국이 주체인 신호. 이것만으로는 부족하고 아래 성과 신호와 함께 있어야 한다. */
const KOREA = /한국|대한민국|국내|우리나라|한국은행|삼성|SK|현대차|LG|K[-\s]?(팝|컬처|푸드|방산|배터리|반도체)|코스피|코스닥|원화/;

/** 성과 신호. 순위·기록·돌파처럼 **헤드라인에 이미 있는** 사실을 가리킨다. */
const WIN = /세계\s*1위|사상\s*최[대고초]|역대\s*최[대고]|신기록|최초|1위|수출\s*(호조|증가|신기록|최대)|돌파|제치|앞질|추월|급등|수주|점유율\s*(1위|확대|상승)|흑자|승격|선정|수상|우승|금메달/;

/**
 * 제목에 쓸 헤드라인을 고른다.
 *
 * 한국 성과 헤드라인이 있으면 그것을 **맨 앞**으로 올린다. 없으면 원래 순서 그대로 —
 * 억지로 만들지 않는다. 있는 걸 앞세우는 것과 없는 걸 지어내는 것은 다르다.
 *
 * @param {string[]} heads 중요도 순 헤드라인
 * @param {boolean} isKo
 * @returns {{ordered: string[], proud: boolean}} proud = 국뽕 헤드라인을 앞세웠는가
 */
export function orderForTitle(heads, isKo) {
  const list = (heads ?? []).filter(Boolean);
  if (!isKo || list.length < 2) return { ordered: list, proud: false };
  const i = list.findIndex((h) => KOREA.test(h) && WIN.test(h));
  if (i <= 0) return { ordered: list, proud: i === 0 };
  return { ordered: [list[i], ...list.filter((_, k) => k !== i)], proud: true };
}

/**
 * 국뽕 제목 앞머리(사용자 "더 국뽕스럽게 최대한 만들어. 오글거리게").
 *
 * 지켜야 할 선은 하나다 — **사실을 주장하지 않는다.**
 *   "세계가 놀랐다"·"전 세계 충격" 은 안 된다. 놀랐는지 우리가 모른다. 그건 거짓 사실이다.
 *   반면 "또 해냈습니다"·"이게 대한민국입니다" 는 감탄이지 검증 대상 명제가 아니다.
 *   자극적이되 없는 사실을 붙이지 않는다 — 뒤에 오는 헤드라인 원문이 근거를 댄다.
 *
 * 돌려 쓰는 이유: 하루 5편인데 같은 앞머리가 계속 붙으면 그게 더 싸구려로 보인다.
 * 편성 기록 수를 씨앗으로 돌린다(무작위가 아니라 결정론 — 같은 편은 같은 제목이 나온다).
 */
const PROUD_PREFIX = [
  '🇰🇷 또 해냈습니다',
  '🇰🇷 이게 대한민국입니다',
  '🇰🇷 국뽕 차오릅니다',
  '🇰🇷 자랑스럽습니다',
  '🇰🇷 대한민국 클라스',
];

/**
 * 제목. 100자 상한 안에서 **헤드라인 그대로** 잇는다 — 문구를 지어내지 않는다.
 * 국뽕 헤드라인이 앞에 올 때만 감탄 앞머리를 붙인다(사실 주장 아님, 위 주석 참조).
 * 유튜브 제목은 100자가 상한이고, 넘으면 잘려서 뒤가 안 보인다.
 *
 * @param {number} [seed] 앞머리 회전용. 편성 회차 수를 넣으면 편마다 달라진다.
 */
export function buildTitle(heads, isKo, seed = 0) {
  const { ordered, proud } = orderForTitle(heads, isKo);
  let t = ordered[0] ?? '';
  const prefix = proud ? `${PROUD_PREFIX[Math.abs(Math.trunc(seed)) % PROUD_PREFIX.length]} ` : '';
  // 앞머리를 붙이면 두 번째 헤드라인까지 넣을 자리가 줄어든다. 남는 만큼만 잇는다.
  const room = 96 - prefix.length;
  if (ordered[1] && (t.length + ordered[1].length + 3) <= room) t = `${t} — ${ordered[1]}`;
  return `${prefix}${t}`.slice(0, 100);
}

const DESC = {
  // 첫 줄은 **대표 헤드라인 하나**다. 종전엔 3개를 이어붙여 벽이 됐다(실측 eoP5ycHs92o).
  //   유튜브는 '더보기' 전에 두어 줄만 보여주므로 이 자리가 사실상 유일하게 읽히는 문장이고,
  //   검색에서도 가장 무겁게 쓰인다. 나머지 헤드라인은 아래 '오늘 다룬 이슈' 가 이미 다 담는다.
  ko: (top, tags) => [
    top[0] ?? '',
    '',
    '오늘 다룬 이슈',
    ...top.map((h) => `• ${h}`),
    '',
    '한국과 미국의 정치·경제를 매일 정리합니다. 군더더기 없이, 과장 없이.',
    '매일 새 브리핑이 올라옵니다 — 구독해 두시면 놓치지 않습니다.',
    '',
    '영상 소재: 공공 도메인 / CC0 / Pexels 라이선스.',
    '',
    tags,
  ].join('\n'),
  en: (top, tags) => [
    top[0] ?? '',
    '',
    'In this update:',
    ...top.map((h) => `• ${h}`),
    '',
    'Daily US politics and economy, told straight — no filler, no hype.',
    'Subscribe for a new briefing every day.',
    '',
    'Footage: public domain / CC0 / Pexels License.',
    '',
    tags,
  ].join('\n'),
};

const HASHTAGS = {
  ko: '#뉴스 #경제 #증시 #정치 #속보 #오늘의뉴스 #한국경제 #미국증시 #Flowvium',
  en: '#USNews #Politics #Economy #Markets #BreakingNews #DailyNews #Flowvium',
};

/** 설명란. 로케일에 맞는 문구와 해시태그를 쓴다. */
export function buildDescription(heads, isKo) {
  const { ordered } = orderForTitle(heads, isKo);
  const key = isKo ? 'ko' : 'en';
  return DESC[key](ordered, HASHTAGS[key]);
}

/**
 * 태그. 종전에는 `[A-Za-z0-9']` 로 잘라 **한글이 통째로 사라졌다** —
 * 한국어 영상에 영어 고유명사만 태그로 붙는다. 언어별로 뽑는 방법을 나눈다.
 */
export function buildTags(heads, keywords, isKo) {
  const base = (keywords ?? []).filter(Boolean);
  const fromHeads = isKo
    // 한국어는 대문자 신호가 없다. 조사를 떼고, 용언(동사·형용사)을 걸러 체언만 남긴다.
    //   형태소 분석기 없이 완벽하게는 못 가른다 — 어미로 거르는 근사다.
    //   실측에서 "흐리고" "높을수록" 같은 것이 태그로 올라왔다. 태그는 검색어라 체언이어야 한다.
    ? String((heads ?? []).join(' '))
      .split(/[^\p{L}\p{N}]+/u)
      .map((w) => w.replace(/(은|는|이|가|을|를|의|에|와|과|로|으로|도|만|까지|부터)$/, ''))
      // 용언 어미로 끝나면 뺀다. 명사로 끝나는 말과 겹치는 경우가 있으나(예: "사고"),
      //   태그에 동사가 섞이는 쪽이 검색 품질에 더 나쁘다.
      .filter((w) => !/(고|서|며|록|게|지|니|면|다|자|아|어|여)$/.test(w) || w.length >= 5)
      .filter((w) => !/^\d+$/.test(w))                 // 숫자만 있는 토막은 태그가 아니다
      .filter((w) => w.length >= 2 && w.length <= 10)
    // 영어는 종전대로 고유명사(대문자 시작)만.
    : String((heads ?? []).join(' ')).split(/[^A-Za-z0-9']+/).filter((w) => /^[A-Z]/.test(w) && w.length > 2);
  return [...new Set([...base, ...fromHeads])].slice(0, 14);
}
