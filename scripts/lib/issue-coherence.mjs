/**
 * issue-coherence.mjs — 한 묶음이 정말 **한 사건**인가.
 *
 * 왜 필요한가 (2026-09-05 실측): 16:00 회차가 이슈 키워드 "대통령" 으로 편성됐는데,
 *   그 묶음에 수출 7094억 달러 기록 · 이창동 영화 · 두테르테 부통령 체포영장이 함께 있었다.
 *   대본 네 장면이 서로 다른 이야기를 했고 사진도 따로 놀았다 — 발행 후 눈으로 보고 내렸다.
 *
 *   원인은 묶는 기준이다. "대통령·장관·의원·정부" 같은 **직함·기관어는 어느 기사에나 있다.**
 *   그것만 겹치는 기사들을 한 이슈로 묶으면, 대본은 억지로 서로 다른 사건을 잇게 된다.
 *
 *   그래서 키워드를 금지 목록으로 막지 않는다(목록은 늘 모자란다).
 *   **묶음 안의 헤드라인들이 키워드 말고 다른 말을 함께 쓰는지**를 본다 —
 *   같은 사건을 다룬 기사는 사건의 이름(크로아티아·천무·호르무즈)을 공유한다.
 */

/** 어느 기사에나 나오는 말. 이것들이 겹치는 건 같은 사건이라는 뜻이 못 된다. */
const COMMON = new Set([
  '대통령', '장관', '의원', '총리', '정부', '국회', '여야', '청와대', '대통령실',
  '후보', '후보자', '위원장', '대표', '회장', '사장', '차관', '청장', '검찰', '경찰',
  '오늘', '어제', '내일', '올해', '지난해', '이번', '관련', '위해', '대한', '경우',
  '기록', '발표', '예정', '계획', '추진', '검토', '논의', '강조', '지적', '설명',
  '한국', '우리나라', '국내', '세계', '기업', '시장', '사업', '경제', '정치', '사회',
  // 2026-09-06: 'AI' 한 낱말로 **산속 조난**과 **메모리 가격** 기사가 한 묶음이 됐다.
  //   요즘 기사 절반에 나오는 말은 같은 사건이라는 뜻이 못 된다. 직함과 같은 이치다.
  'ai', '인공지능', '반도체', '메모리', '디지털', '플랫폼', '데이터', '기술', '산업',
  '미국', '중국', '일본', '유럽', '글로벌',
]);

const tokens = (t) => String(t ?? '')
  .split(/[^가-힣A-Za-z0-9]+/)
  .filter((w) => w.length >= 2 && !/^\d+$/.test(w));

/**
 * 키워드에 조사가 붙어 있는가.
 *
 * 2026-09-06: 이슈 키워드가 **"ai가"** 로 잡혔다. 낱말 자르기가 조사를 떼지 못한 것이다.
 *   그런 키워드는 검색에도 안 걸리고("ai가" 로 사진을 찾을 수 없다) 자막에도 이상하게 나온다.
 *   조사가 붙은 키워드는 그 자체로 편성 기준이 될 수 없다.
 */
// 조사 목록을 좁게 잡는다. '로·에·와·과·도·만' 까지 넣었더니 **한화에어로**가 걸렸다.
//   넓은 목록은 멀쩡한 이름을 자른다 — 좁게 잡고, 헤드라인으로 한 번 더 확인한다.
const PARTICLES = ['이', '가', '은', '는', '을', '를', '의', '에서'];
export function hasParticle(keyword, headlines) {
  const k = String(keyword ?? '').trim();
  if (k.length < 3) return false;                // 두 글자짜리는 대개 이름이다
  if (!/[가-힣]$/.test(k)) return false;          // 'AI'·'ETF' 는 대상이 아니다
  for (const p of PARTICLES) {
    if (!k.endsWith(p)) continue;
    const stem = k.slice(0, -p.length);
    if (stem.length < 2) continue;               // "국가"의 '가' 같은 것
    // 헤드라인이 있으면 **어간이 홀로 나오는지** 본다. "AI가" 는 다른 기사에 "AI" 로 나오지만,
    //   "소비자물가" 의 '소비자물' 은 어디에도 홀로 나오지 않는다 — 그건 조사가 아니다.
    // 헤드라인이 없으면 **판단하지 않는다.** 목록만으로 짐작하면 "소비자물가" 같은 멀쩡한 말을
    //   자른다(실측). 확인할 수 없으면 통과시키는 편이 낫다 — 편성에서는 늘 헤드라인이 있다.
    if (!headlines?.length) continue;
    const text = headlines.join(' ');
    const alone = new RegExp(`(^|[^가-힣A-Za-z0-9])${stem}([^가-힣A-Za-z0-9]|$)`, 'i');
    if (alone.test(text)) return true;
  }
  return false;
}

/**
 * @param {string} keyword 이 묶음의 이슈 키워드
 * @param {string[]} headlines 묶인 헤드라인들
 * @returns {boolean} 한 사건으로 볼 수 있는가
 */
export function isCoherentIssue(keyword, headlines) {
  const heads = (headlines ?? []).filter(Boolean);
  if (!heads.length) return false;
  // 견줄 대상이 없으면 판단하지 않는다 — 한 건짜리 묶음은 그 자체로 한 사건이다.
  if (heads.length < 2) return true;

  const kw = String(keyword ?? '');
  const sig = (h) => new Set(tokens(h)
    .filter((w) => !COMMON.has(w))
    .filter((w) => !(kw && (kw.includes(w) || w.includes(kw))))
    .map((w) => w.toLowerCase()));

  // 대표 헤드라인(첫 줄)과 나머지가 **키워드 말고 다른 말**을 공유하는가.
  //   하나라도 공유하면 그 기사는 같은 사건을 다룬 것으로 본다.
  const first = sig(heads[0]);
  const overlapped = heads.slice(1).filter((h) => {
    for (const w of sig(h)) if (first.has(w)) return true;
    return false;
  }).length;

  // 절반 이상이 대표 헤드라인과 이어져야 한 사건이다.
  //   전부를 요구하면 같은 사건의 곁가지 기사까지 버리게 된다.
  // 2026-09-06: 두 건짜리는 하나만 겹쳐도 '절반' 이 되어 통과했다. 그렇게 산속 조난과
  //   메모리 가격이 한 묶음이 됐다. 두 건일 때는 **겹치는 낱말이 둘 이상**이어야 한다.
  if (heads.length === 2) {
    const a = sig(heads[0]); const b = sig(heads[1]);
    let hit = 0; for (const w of a) if (b.has(w)) hit += 1;
    return hit >= 2;
  }
  const need = Math.max(1, Math.ceil((heads.length - 1) / 2));
  return overlapped >= need;
}

/**
 * 이 헤드라인이 **이미 낸 기사와 같은 사건**인가.
 *
 * 왜 (2026-09-05 실측): 12:00 에 "아파트" 키워드로 낸 기사가 16:00 편성에서 "홍지선"
 *   키워드로 다시 1순위가 됐다. 원장은 키워드로만 막아서 같은 기사가 통과한다 —
 *   사용자가 전에 "왜 제목과 설명이 같은 영상이 세개나 올라갔지" 라고 지적한 그 문제다.
 *
 * 낱말이 얼마나 겹치는지로 본다. 같은 사건을 다룬 기사는 흔한 말을 빼고도 많이 겹친다
 * (홍지선·주택담보대출·아파트·4억). 같은 인물이 나와도 다른 사건이면 그만큼 안 겹친다.
 *
 * @param {string} headline 후보 기사
 * @param {string[]} publishedHeadlines 최근 발행한 기사들
 * @param {number} [threshold] 겹침 비율 기준(기본 0.5)
 */
export function isSameStory(headline, publishedHeadlines, threshold = 0.5) {
  const sig = (t) => new Set(tokens(t).filter((w) => !COMMON.has(w)).map((w) => w.toLowerCase()));
  const a = sig(headline);
  if (!a.size) return false;
  for (const p of publishedHeadlines ?? []) {
    const b = sig(p);
    if (!b.size) continue;
    let hit = 0;
    for (const w of a) if (b.has(w)) hit += 1;
    // 짧은 쪽 기준으로 본다 — 한쪽이 길다고 같은 사건이 아닌 게 되면 안 된다.
    if (hit / Math.min(a.size, b.size) >= threshold) return true;
  }
  return false;
}
