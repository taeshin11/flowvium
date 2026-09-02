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
 * 제목. 100자 상한 안에서 **헤드라인 그대로** 잇는다 — 문구를 지어내지 않는다.
 * 유튜브 제목은 100자가 상한이고, 넘으면 잘려서 뒤가 안 보인다.
 */
export function buildTitle(heads, isKo) {
  const { ordered } = orderForTitle(heads, isKo);
  let t = ordered[0] ?? '';
  if (ordered[1] && (t.length + ordered[1].length + 3) <= 96) t = `${t} — ${ordered[1]}`;
  return t.slice(0, 100);
}

const DESC = {
  ko: (top, tags) => [
    top.slice(0, 3).join(' '),
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
    top.slice(0, 3).join(' '),
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
