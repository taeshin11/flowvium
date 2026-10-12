/**
 * weekly-explainer.mjs — 주 1회 4~6분 이슈 해설의 순수 규칙. 근거는 weekly-explainer.test.mjs 머리말.
 */

const ENT = { nbsp: ' ', quot: '"', apos: "'", lt: '<', gt: '>', amp: '&', middot: '·', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  hellip: '…', bull: '•', ndash: '–', mdash: '—', times: '×', sim: '∼', lsaquo: '‹', rsaquo: '›', laquo: '«', raquo: '»' };
const decode = (s) => String(s)
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&([a-z]+);/gi, (m, k) => ENT[k.toLowerCase()] ?? m);
// 꼬리 저작권·배포 금지 문구는 매체마다 한 기사에 한 번이라 '여러 기사 공통 줄' 로도 안 잡힐 때가 있다(혼자 가져온 매체).
const TAIL = /(무단\s*전재|재배포\s*금지|저작권자\s*[ⓒ©(]|ⓒ|AI\s*학습|구독\s*신청|기사\s*제보|좋아요|댓글)/;

/**
 * 기사 HTML → 본문 문단들. 매체마다 틀이 달라(연합 <p>, 한경 <br>) 선택자 대신 **문단 경계**로 자른다.
 * 한글 25자 이상 + 문장처럼 끝나는 줄만 남긴다(메뉴·버튼·사진 설명은 대개 여기서 빠진다).
 */
export function articleLines(html) {
  const body = String(html ?? '').replace(/<(script|style|noscript|header|footer|nav|aside|figure|figcaption|button|select)\b[\s\S]*?<\/\1>/gi, ' ');
  return body.split(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/h\d>|<\/section>|<\/article>/i)
    .map((x) => decode(x.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim())
    // 기자 서명("(서울=연합뉴스) 김기자 기자 =")은 내용이 아니다 — 대본이 그걸 읽은 적이 있다(rn6_MMr4BEg).
    .map((x) => x.replace(/^\([^)]{1,20}=[^)]{1,20}\)\s*(?:[가-힣]{2,4}\s*){1,4}(?:기자|특파원)\s*=\s*/, ''))
    .filter((x) => (x.match(/[가-힣]/g)?.length ?? 0) >= 25 && /(다|요|음|함|니다)[.”"'’)]*\s*$|[.”"’][)\]]?\s*$/.test(x) && !TAIL.test(x));
}

/** 두 기사 이상에 똑같이 나오는 줄은 매체 공통 문구다(한경 "구글 검색 선호 출처로 추가…"). */
export function dropSharedLines(docs) {
  const seen = new Map();
  for (const d of docs) for (const l of new Set(d)) seen.set(l, (seen.get(l) ?? 0) + 1);
  return docs.map((d) => d.filter((l) => seen.get(l) < 2));
}

/**
 * agy 가 묶은 이슈 후보를 **코드가** 검사하고 순위를 매긴다.
 *   · shortIds 는 이번 주 실제 쇼츠만 · 키워드가 그 쇼츠 제목에 실제로 있어야(묶음이 지어낸 게 아님) · 그런 쇼츠가 minShorts 편 이상
 *   · 기사(articleCount(keywords) → 건수 또는 {n, days}) minArticles 건 이상, minDays 일 이상에 걸쳐 — 하루짜리 단발은 5분 해설감이 아니다
 *   순위 = 묶음 쇼츠 조회 합(시청자가 이미 고른 주제) — 같은 값이면 기사 많은 쪽.
 * 2026-10-12 실측: 쇼츠는 24시간 안에 같은 이슈를 다시 고르지 않아 한 주 46편 중 '같은 이슈 2편' 이 드물다.
 *   agy 가 "농지조사" 처럼 좁은 말을 고르면 1편만 맞고, "농지" 로 잡으면 3편(상담센터·특조법·논란)이 맞는다.
 */
export function rankIssues(cands, shorts, articleCount, { minShorts = 2, minArticles = 12, minDays = 1 } = {}) {
  const byId = new Map((shorts ?? []).map((s) => [s.video_id, s]));
  const out = [];
  for (const c of cands ?? []) {
    const kws = (c.keywords ?? []).map((k) => String(k).trim()).filter((k) => k.length >= 2);
    if (!kws.length) continue;
    const hit = [...new Set(c.shortIds ?? [])].map((id) => byId.get(id)).filter(Boolean)
      .filter((s) => kws.some((k) => String(s.headline ?? '').includes(k) || String(s.headlines ?? '').includes(k)));
    if (hit.length < minShorts) continue;
    const a = articleCount(kws); const arts = typeof a === 'number' ? a : a.n; const days = typeof a === 'number' ? Infinity : a.days;
    if (arts < minArticles || days < minDays) continue;
    out.push({ name: c.name, keywords: kws, shortIds: hit.map((s) => s.video_id), views: hit.reduce((x, s) => x + (Number(s.views) || 0), 0), articles: arts, days: Number.isFinite(days) ? days : null });
  }
  return out.sort((a, b) => b.views - a.views || b.articles - a.articles);
}

// 숫자 + (붙은) 단위. "6만2천307필지" 처럼 한글 자릿수가 섞인 것도 한 덩어리로 본다.
const NUM_RE = /\d[\d,.]*(?:\s*[만천억조]\s*\d[\d,.]*)*\s*(?:%p|%|퍼센트|억\s*원|조\s*원|만\s*원|억\s*달러|만\s*달러|달러|원|만\s*명|명|만|억|조|천|건|개|곳|배|년|개월|월|일|시간|분|초|기|척|대|필지|t|톤|km|㎢|㎡|가구|세|살|차|위|호|석|표)?/g;
const UNITLESS_SMALL = /^\d{1,2}$/;
const digitsOf = (s) => s.replace(/[^\d.]/g, '').replace(/\.$/, '');
/**
 * 문장에서 근거에 없는 숫자를 돌려준다. 같은 숫자(자릿수 그대로)가 근거 어딘가에 있으면 통과.
 *   단위 없는 1~2 자리 셈수("3가지"의 3 등)는 흔해서 넘긴다. 연도·금액·비율은 단위가 붙어 검사된다.
 */
// "9천763억원" → "9763억원", "6만2천307필지" → "62307필지". 기사는 한글 자릿수를 섞고 대본은 숫자로만 쓴다 — 같은 수로 견준다.
export function flattenKoNumbers(t) {
  // 천은 만 묶음 안의 자리다: "3천471만" = (3천+471)×1만. 억·조는 단위로 남긴다(양쪽 다 같은 꼴이 된다).
  return String(t ?? '').replace(/\d[\d,]*(?:\.\d+)?\s*[만천](?:\s*\d[\d,]*(?:\.\d+)?\s*[만천]?)*/g, (m) => {
    let total = 0; let small = 0; let cur = '';
    for (const ch of m.replace(/[\s,]/g, '')) {
      if (/[\d.]/.test(ch)) cur += ch;
      else if (ch === '천') { small += (parseFloat(cur) || 1) * 1000; cur = ''; }
      else if (ch === '만') { total += ((small + (parseFloat(cur) || 0)) || 1) * 10000; small = 0; cur = ''; }
    }
    return String(Math.round((total + small + (parseFloat(cur) || 0)) * 1000) / 1000);
  });
}
export function ungroundedNumbers(text, sourceText) {
  sourceText = flattenKoNumbers(sourceText); text = flattenKoNumbers(text);
  const src = String(sourceText ?? '').replace(/\s+/g, '');
  const srcDigits = new Set((src.match(/\d[\d,.]*/g) ?? []).map((x) => x.replace(/,/g, '').replace(/\.$/, '')));
  const bad = [];
  for (const m of String(text ?? '').matchAll(NUM_RE)) {
    const raw = m[0].trim();
    const unit = raw.replace(/^[\d,.\s만천억조]+/, '');
    const nums = (raw.match(/\d[\d,.]*/g) ?? []).map((x) => x.replace(/,/g, '').replace(/\.$/, ''));
    if (!unit && nums.length === 1 && UNITLESS_SMALL.test(nums[0])) continue;
    if (unit === '가지' || /^(번째|째)$/.test(unit)) continue;
    const compact = raw.replace(/\s+/g, '');
    if (src.includes(compact)) continue;
    if (nums.every((n) => srcDigits.has(n) || srcDigits.has(digitsOf(n)))) {
      // 숫자는 있는데 단위가 다르면(160억원 ↔ 160만원) 틀린 말이다 — 숫자 바로 뒤 단위까지 맞아야 통과.
      if (!unit || src.includes(`${nums.at(-1)}${unit.replace(/\s+/g, '')}`) || src.replace(/,/g, '').includes(`${nums.at(-1)}${unit.replace(/\s+/g, '')}`)) continue;
    }
    bad.push(raw);
  }
  return [...new Set(bad)];
}

/**
 * 숫자를 한글로 쓴 날짜·수. 이렇게 쓰면 ungroundedNumbers 를 빠져나간다(10/12 첫 대본 "칠일 열린 국감" · "지난 오월").
 *   대본 규칙은 '숫자는 아라비아 숫자로' 다 — 소리는 tts 가 한글로 읽는다. 걸리면 문장을 뺀다.
 *   날짜(…월·…일)는 앞뒤가 띄어진 낱말일 때만 본다("이번 일"·"오늘" 같은 말과 구별).
 */
export function hangulNumerals(text) {
  const out = [];
  const T = ` ${String(text ?? '')} `;
  for (const m of T.matchAll(/(?<=[\s("'“‘])((?:[일이삼사오육칠팔구]?십)?[일이삼사오육칠팔구]|십|[일이삼사오육칠팔구]?십)(월|일)(?=[\s,.)"'”’에은는의부까]|$)/g)) {
    if (m[2] === '일' && /^(이|일)$/.test(m[1])) continue;   // "이일"·"일일"은 다른 뜻이 흔하다
    out.push(m[0]);
  }
  for (const m of T.matchAll(/[일이삼사오육칠팔구]?[십백천]+[일이삼사오육칠팔구]?(?:[십백천]*[일이삼사오육칠팔구]?)*[만억조]/g)) out.push(m[0]);
  return [...new Set(out)];
}

/**
 * 채널 목소리의 당위·기대("~해야 합니다", "기대합니다") — 해설이 아니라 의견이다(10/12 첫 대본 7장 전부).
 *   주체가 한 말을 옮기는 문장("…해야 한다고 촉구했습니다")은 인용이라 통과.
 */
const ATTRIB = /(고|라며|면서|이라고)\s*(촉구|주장|지적|강조|밝혔|말했|요구|제안|비판|설명|덧붙|전했|했습니다|보고 있습니다)|지적이\s*나|목소리가|의견이|요구가|주장이/;
export function isEditorial(s) {
  const t = String(s ?? '');
  if (ATTRIB.test(t)) return false;
  return /야\s*(합니다|할\s*것입니다|하겠습니다)|기대합니다|바랍니다|새겨야|주목해야|필요합니다$|필요해\s*보입니다/.test(t.replace(/[.!?"”’)]+$/, ''));
}

/** 썸네일 큰 글 한 줄 — 조사·접속사로 끝나면 문장이 잘린 것이다("농지 전수조사 및"). */
export const thumbLineOk = (w) => { const t = String(w ?? '').trim(); return t.length >= 2 && t.length <= 10 && !/(및|과|와|의|에|을|를|은|는|이|가|도|로|으로|에서|하고|그리고|또)$/.test(t); };

/** 화면에 쓸 사진 — 대본이 실제로 인용한 기사(장마다 sources)의 사진만. 키워드만 맞은 딴 기사 사진이 나간 적이 있다(10/12 인니 쌀 수확). */
export const imagePool = (imgs, chapters) => { const cited = new Set((chapters ?? []).flatMap((c) => c.sources ?? [])); return (imgs ?? []).filter((m) => cited.has(m.doc)); };

/** 4~6분 — 앞뒤 카드 10초를 뺀 낭독 분량.
 *  10/12 첫 렌더 실측: 1,680자 → 낭독 225초 = **7.47자/초**. 쇼츠 CPS 6.7 을 그대로 쓰니 대본이 4분 하한에 걸쳤다. */
export const CPS = 7.4;
export function scriptBudget({ minSec = 240, maxSec = 360, targetSec = 300 } = {}) {
  return { min: Math.round((minSec - 10) * CPS), max: Math.round((maxSec - 10) * CPS), target: Math.round((targetSec - 10) * CPS) };
}

/** "{핵심 질문} | M월 D일 이번 주 이슈 해설" — 100자 안. 앞머리에 무슨 이슈인지(총정리 CTR 0.9% 교훈). */
export function explainerTitle({ headline, date }) {
  const [, m, d] = String(date).split('-').map(Number);
  const tail = ` | ${m}월 ${d}일 이번 주 이슈 해설`;
  let h = String(headline ?? '').replace(/#\S+/g, '').replace(/\s{2,}/g, ' ').trim();
  if (h.length > 100 - tail.length) h = `${h.slice(0, 100 - tail.length - 1)}…`;
  return `${h}${tail}`;
}
