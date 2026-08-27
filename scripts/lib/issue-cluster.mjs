/**
 * issue-cluster.mjs — 그날의 이슈를 결정론으로 고른다.
 *
 * 배경(2026-08-27): 종합 이슈 채널의 소재 선정. 사람이 고르면 자동화가 아니고,
 *   LLM 이 고르면 왜 골랐는지 설명이 안 된다.
 *
 * 신호: **여러 매체가 동시에 다루는 사건이 그날의 큰 이슈다.**
 *   한 매체만 쓰면 그 매체의 관심사고, NBC·CBS·Variety 가 같이 쓰면 사건이다.
 *   조회수가 아니라 매체 수를 쓰는 이유: 조회수는 우리가 볼 수 없고, 매체 수는 수집 데이터로 즉시 나온다.
 *   그리고 한 매체가 같은 사건을 3번 써도 매체는 1로 센다 — 매체의 편집 성향을 이슈 크기로 오해하지 않는다.
 *
 * 불용어를 빼는 이유: the/says/from 으로 묶으면 전부 한 덩어리가 되어 신호가 사라진다.
 */

/** 영어·한국어 공통 불용어. 고유명사만 남기는 게 목적이라 넉넉히 뺀다. */
const STOP = new Set([
  'the','a','an','and','or','but','of','to','in','on','at','for','from','with','by','as','is','are','was','were',
  'be','been','has','have','had','will','would','can','could','say','says','said','new','more','after','before',
  'over','into','about','out','up','down','how','why','what','when','who','his','her','their','its','this','that',
  'not','no','all','one','two','last','first','than','then','also','may','might','just','now','still','back',
  '것','수','등','및','대한','위해','통해','관련','이번','올해','지난','오늘','내일','기자','뉴스','속보','단독',
]);

const normalize = (s) => String(s ?? '')
  .replace(/[’'`]/g, '')
  .replace(/[^\p{L}\p{N}\s]/gu, ' ')
  .toLowerCase()
  .split(/\s+/)
  .filter((w) => w.length >= 3 && !STOP.has(w));

/**
 * @param {Array<{source:string, headline:string, link?:string}>} items
 * @param {{minSources?:number, minArticles?:number}} [opts]
 * @returns {Array<{keyword:string, sourceCount:number, sources:string[], headlines:string[], items:object[]}>}
 *          매체 수 → 기사 수 순으로 정렬.
 */
export function clusterIssues(items, opts = {}) {
  const minSources = opts.minSources ?? 2;
  const minArticles = opts.minArticles ?? 2;
  if (!Array.isArray(items) || items.length === 0) return [];

  // 키워드별로 어느 매체가 썼는지 모은다.
  const byWord = new Map();
  for (const it of items) {
    const words = new Set(normalize(it?.headline));
    for (const w of words) {
      if (!byWord.has(w)) byWord.set(w, { sources: new Set(), items: [] });
      const e = byWord.get(w);
      e.sources.add(String(it?.source ?? ''));
      e.items.push(it);
    }
  }

  const out = [];
  for (const [keyword, e] of byWord) {
    if (e.sources.size < minSources) continue;
    if (e.items.length < minArticles) continue;
    out.push({
      keyword,
      sourceCount: e.sources.size,
      sources: [...e.sources],
      headlines: e.items.map((i) => i.headline),
      items: e.items,
    });
  }
  // 매체 수 우선, 같으면 기사 수. 같은 사건의 여러 키워드는 뒤에서 대표 하나만 쓰면 된다.
  out.sort((a, b) => b.sourceCount - a.sourceCount || b.items.length - a.items.length);
  return out;
}

/**
 * 상위 클러스터들에서 **서로 다른 사건**만 골라낸다.
 * 같은 사건은 여러 키워드로 중복 등장한다(dolly / parton / dollywood) — 기사가 겹치면 같은 사건으로 본다.
 */
export function topDistinctIssues(items, n = 3, opts = {}) {
  const clusters = clusterIssues(items, opts);
  const picked = [];
  const used = new Set();
  for (const c of clusters) {
    const ids = c.items.map((i) => i.headline);
    const overlap = ids.filter((h) => used.has(h)).length;
    if (overlap > ids.length / 2) continue;      // 절반 넘게 겹치면 같은 사건
    ids.forEach((h) => used.add(h));
    picked.push(c);
    if (picked.length >= n) break;
  }
  return picked;
}
