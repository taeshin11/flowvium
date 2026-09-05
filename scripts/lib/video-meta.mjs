import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

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
// 2026-09-04: 실측으로 국뽕 앞머리가 **한 번도 안 붙었다**(발행 10편 전부).
//   KOREA 와 WIN 이 같은 헤드라인에 동시에 있어야 하는데, 그게 거의 안 일어난다.
//   "전남대 캠퍼스혁신파크 800조 반도체 시대" — 한국 뉴스인데 '반도체'만으론 KOREA 에 안 걸렸다
//   (K-반도체라야 걸리게 돼 있었다).
//   이제 편성 자체를 한국어 기사로 좁혔으므로, 한글이 있으면 한국 뉴스로 본다.
// 2026-09-04: 한때 /[가-힣]/(한글이면 한국 뉴스)로 넓혔다가 테스트가 잡았다 —
//   "TSMC 세계 1위" 처럼 **남의 나라 성과**까지 국뽕이 된다. 한국을 가리키는 말을 요구하되,
//   종전보다 넓힌다(부처·주요 기업·시장 지표까지). 종전 목록이 좁아 10편 내내 한 번도 안 붙었다.
const KOREA = /한국|대한민국|국내|우리나라|한은|한국은행|정부|청와대|대통령실|국회|여야|코스피|코스닥|원화|외환보유액|삼성|SK|현대차|기아|LG|포스코|한화|HD현대|네이버|카카오|셀트리온|K[-\s]?(팝|컬처|푸드|방산|배터리|반도체|뷰티|콘텐츠)|[가-힣]{2,4}부(?:가|는|와|의|,|\s)|[가-힣]{2,4}청(?:가|은|이|,|\s)|중기부|산업부|기재부|과기부|농식품부|국토부|복지부|외교부|법무부/;
/** 외국이 주인공인 기사. 이게 앞에 오면 국뽕이 아니다. */
const FOREIGN_LEAD = /^(美|中|日|EU|英|獨|佛|露|印|臺|北)|^(미국|중국|일본|대만|유럽|독일|프랑스|러시아|인도|북한)|TSMC|엔비디아|애플|구글|아마존|테슬라|트럼프|시진핑/;

/** 성과 신호. 순위·기록·돌파처럼 **헤드라인에 이미 있는** 사실을 가리킨다. */
// 성과를 말하는 표현. 넓히되 **아무 기사에나 붙지는 않게** 한다 —
//   국뽕이 매편 붙으면 그게 더 싸구려로 보인다(하루 8편이다).
// 2026-09-04: '달성'·'성공'을 넣었다가 뺐다. 규제 통합 기사에
//   "🇰🇷 또 해냈습니다 농식품부, GAP·친환경 교육 통합 등 규제…" 가 붙었다 — 우스꽝스럽다.
//   흔한 말은 성과의 신호가 아니다. 그 자체로 성과를 뜻하는 말만 남긴다.
//   '선정'도 같은 이유로 뺐다 — "규제 개선 우수과제 선정"(행정 표창)에 "이게 대한민국입니다"가 붙었다.
// 2026-09-05: '수출' 뒤에 올 수 있는 성과어가 좁아 "천무 수출 임박", "K2 수출 계약 체결" 을
//   국뽕으로 못 잡았다(실측). 소재가 없을 때 국뽕 주제로 바꿔 내려면 이 판정이 맞아야 한다.
//   다만 '수출' 만으로는 성과가 아니다 — "수출 감소", "수출 규제" 는 계속 걸러져야 한다.
const WIN = /세계\s*1위|사상\s*최[대고초]|역대\s*최[대고]|신기록|최초|1위|수출\s*(호조|증가|신기록|최대|확대|임박|성사|타결|재개)|수출\s*계약|계약\s*(체결|임박|성사)|납품\s*계약|돌파|제치|앞질|추월|급등|수주|점유율\s*(1위|확대|상승)|흑자|승격|수상|우승|금메달|쾌거|호실적|사상\s*첫|세계\s*최[대고초]|글로벌\s*1위|유치\s*성공|역전/;

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
/**
 * 이 헤드라인이 "한국이 잘한 이야기" 인가.
 *
 * 제목 앞머리를 붙일 때 쓰던 판정을 **편성에서도** 쓴다(2026-09-05 사용자
 * "소재없으면 최신 국뽕소재로라도 내"). 소재를 못 찾아 회차를 거르느니, 소재가 있는
 * 국뽕 주제로 바꿔 낸다. 판정 기준을 한 곳에 두어야 제목과 편성이 어긋나지 않는다.
 */
/**
 * 한국 상장사 이름이 들어 있는가.
 *
 * KOREA 정규식은 손으로 적은 목록이라 "현대로템"·"한국항공우주" 같은 회사를 못 잡았다
 * (실측: "현대로템, 폴란드와 K2 전차 수출 계약 체결" 이 국뽕으로 안 걸렸다).
 * CLAUDE.md 규칙대로 **가장 완전한 권위 소스**를 쓴다 — DART 상장사 3,989곳
 * (`data/dart-corp-codes.json`, `npm run build:*` 계열이 갱신한다). 손으로 나열하지 않는다.
 *
 * 두 글자 이름(285개: 씨앗·우양·연우…)은 일상어와 겹쳐 오탐이 난다. 세 글자부터 본다 —
 * 삼성·한화처럼 짧고 중요한 이름은 이미 KOREA 목록에 있다.
 */
let _corpNames = null;
function listedKoreanCorp(text) {
  if (_corpNames === null) {
    try {
      const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
      const d = JSON.parse(readFileSync(resolve(root, 'data/dart-corp-codes.json'), 'utf8'));
      _corpNames = Object.values(d?.map ?? {})
        .map((v) => v?.corpName)
        .filter((n) => typeof n === 'string' && n.length >= 3);
    } catch { _corpNames = []; }   // 파일이 없어도 판정이 멈추면 안 된다 — KOREA 목록으로 간다
  }
  return _corpNames.some((n) => text.includes(n));
}

export function isProudHeadline(h) {
  const t = String(h ?? '');
  if (!WIN.test(t) || FOREIGN_LEAD.test(t.trim())) return false;
  return KOREA.test(t) || listedKoreanCorp(t);
}

export function orderForTitle(heads, isKo) {
  let list = (heads ?? []).filter(Boolean);
  // 2026-09-04 사용자: "왜 제목 설명이 영어로 나갔어?"
  //   한국어 채널인데 "Should Investors Ride the Silver…" 가 제목으로 나갔다.
  //   같은 이슈 묶음에 한국어 헤드라인이 넷이나 있었는데 **첫 줄이 영어**라 그게 제목이 됐다.
  //   한국어 편이면 한글 헤드라인을 앞세운다. 하나도 없으면 그대로 둔다(호출부가 막는다).
  if (isKo) {
    const ko = list.filter((h) => /[가-힣]/.test(String(h)));
    if (ko.length) list = [...ko, ...list.filter((h) => !/[가-힣]/.test(String(h)))];
  }
  if (!isKo || list.length < 2) return { ordered: list, proud: false };
  const i = list.findIndex((h) => isProudHeadline(h));
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
export function buildTitle(heads, isKo, seed = 0, opts = {}) {
  const { ordered, proud } = orderForTitle(heads, isKo);
  let t = ordered[0] ?? '';
  const prefix = proud ? `${PROUD_PREFIX[Math.abs(Math.trunc(seed)) % PROUD_PREFIX.length]} ` : '';
  // 상한. 유튜브 제목은 100자가 최대지만 **쇼츠 피드는 한두 줄만 보여준다** —
  //   2026-09-03 실측 95자 제목은 시청자에게 앞 토막만 보였다. 호출부가 상한을 준다.
  const cap = Math.max(20, Math.trunc(opts.maxLen ?? 100));
  if (cap < 100) {
    // 짧게 써야 하면 헤드라인을 잇지 않는다. 하나를 자연스러운 자리에서 끊는다.
    return `${prefix}${clip(t, cap - prefix.length)}`;
  }
  // 앞머리를 붙이면 두 번째 헤드라인까지 넣을 자리가 줄어든다. 남는 만큼만 잇는다.
  const room = 96 - prefix.length;
  if (ordered[1] && (t.length + ordered[1].length + 3) <= room) t = `${t} — ${ordered[1]}`;
  return `${prefix}${t}`.slice(0, 100);
}

/**
 * 헤드라인을 상한 안으로 끊는다. **원문 앞부분만 남긴다** — 없는 말을 지어내지 않는다.
 *
 * 절 경계(쉼표·가운뎃점·줄표)에서 끊는 것을 먼저 시도한다. 신문 제목은 "주체, 내용" 꼴이 많아
 * 그 자리가 가장 덜 어색하다. 경계가 없으면 낱말 경계에서 끊고 말줄임표를 붙인다.
 * 낱말 한가운데를 자르면 뜻이 뭉개진다.
 */
function clip(text, max) {
  const t = String(text ?? '').trim();
  if (t.length <= max) return t;
  // 절 경계 후보 — 상한 안에 들어오는 가장 뒤쪽 경계를 쓴다(정보를 최대한 남긴다).
  let best = -1;
  for (let i = 0; i < Math.min(t.length, max); i++) {
    if (/[,·…]|\s—\s/.test(t[i])) best = i;
  }
  // 너무 앞에서 끊기면 제목이 뜻을 잃는다("전남대 캠퍼스혁신파크," 만 남는 식).
  if (best >= Math.floor(max * 0.5)) return t.slice(0, best).trim();
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp >= Math.floor(max * 0.5) ? cut.slice(0, sp) : cut).trim()}…`;
}


/**
 * 후원 계좌 줄 (2026-09-03, 사용자 "기부해달라고 설명 좀 달아놔라").
 *
 * 계좌는 코드에 박지 않고 .env.local 의 DONATION_ACCOUNT 에서 읽는다 —
 *   유튜브 설명란에는 어차피 공개되지만, 저장소 이력에 개인정보를 남길 이유는 없다(.env.local 은 gitignore).
 * 값이 없으면 **줄 자체를 넣지 않는다**. "후원: undefined" 가 공개로 나가면 안 된다.
 *
 * 위치는 헤드라인 목록 뒤다. 설명란 첫머리는 유입 링크 자리이고, 그걸 밀어내면 안 된다.
 */
function donationLines(isKo) {
  const acct = String(process.env.DONATION_ACCOUNT ?? '').trim();
  if (!acct) return [];
  // 2026-09-03 사용자: "채널 유지를 위해서 부탁한다고 좀 애절하게".
  //   다만 없는 사실은 쓰지 않는다 — "밤새 만든다" 같은 건 자동으로 도는 파이프라인이라 거짓이 된다.
  //   사실인 것만 쓴다: 광고가 없고, 서버·데이터 비용이 들고, 그게 끊기면 채널이 멈춘다.
  return isKo
    ? ['',
      '🙏 이 채널은 광고 하나 없이 운영됩니다.',
      '매일 다섯 편을 만드는 데 서버비와 데이터 비용이 들어갑니다.',
      '솔직히 혼자 감당하기가 버겁습니다. 커피 한 잔 값이라도 보태 주시면',
      '이 채널을 멈추지 않고 계속 이어갈 수 있습니다. 간절히 부탁드립니다.',
      acct,
      '작은 후원 하나가 내일 영상을 만듭니다. 정말 감사합니다.']
    : ['',
      '🙏 This channel runs with no ads at all.',
      'Server and data costs add up for five briefings a day.',
      'Even the price of a coffee helps keep it going. Thank you sincerely.',
      acct];
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
    ...donationLines(true),
    '',
    '영상 소재: 공공 도메인 / CC0 / 아카이브 라이선스.',
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
    ...donationLines(false),
    '',
    'Footage: public domain / CC0 / archive licenses.',
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
