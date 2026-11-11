// market-close.mjs — 날짜별 '한국 증시 마감' 페이지의 순수 규칙(파일 읽기는 부르는 쪽). 근거는 scripts/lib/market-close.test.mjs 머리말.
// 기록은 make-market-brief(krclose)가 모든 관문(숫자 근거·당위 문장·장중 숫자·agy 대조)을 지난 대본에서 만든다.
//   여기서 새로 쓰는 문장은 없다 — 검사를 지난 문장과 그 문장이 기댄 기사만 옮긴다.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const httpLink = (u) => typeof u === 'string' && /^https?:\/\//.test(u);

export function closePageRecord(script) {
  if (!script || script.edition !== 'krclose') return null;
  const date = String(script.day ?? script.date ?? '');
  if (!DATE_RE.test(date)) return null;
  const facts = (script.facts ?? []).filter((f) => typeof f === 'string' && f.trim());
  const docs = script.docs ?? [];
  const chapters = (script.chapters ?? [])
    .filter((c) => c && (c.kind === 'market' || c.kind === 'story') && (c.sentences ?? []).length)
    .map((c) => ({
      kind: c.kind,
      heading: String(c.heading ?? ''),
      sentences: c.sentences.map(String),
      sources: [...new Set(c.sources ?? [])].map((i) => docs[i])
        .filter((d) => d && httpLink(d.link))
        .map((d) => ({ source: String(d.source ?? ''), headline: String(d.headline ?? ''), link: d.link })),
    }));
  if (!facts.length || !chapters.some((c) => c.kind === 'story')) return null;
  return { date, title: String(script.title ?? ''), facts, chapters };
}

/** data/market-close 의 파일 이름들 → 날짜(최신순). */
export function closeDates(files) {
  return files.map((f) => /^(\d{4}-\d{2}-\d{2})\.json$/.exec(f)?.[1]).filter(Boolean).sort().reverse();
}

/**
 * 본문에 나온 종목 → 종목 페이지. names = [[ticker, 한국어 이름]] (내용 있는 페이지만 — 사이트맵과 같은 집합).
 * 긴 이름이 먼저 자리를 차지한다(삼성전자우 ⊃ 삼성전자). 두 글자 이름은 장 제목과 똑같을 때만 —
 *   '대상'·'효성' 같은 이름은 보통 낱말이라 본문에서 잡으면 틀린 연결이 된다("소각 대상은").
 * @param {string[]} texts
 * @param {[string, string][]} names
 * @param {{ headings?: string[] }} [opts]
 * @returns {{ ticker: string, name: string }[]}
 */
export function companyLinks(texts, names, { headings = [] } = {}) {
  const heads = new Set(headings);
  const cands = names.filter(([, n]) => n && /[가-힣A-Za-z]/.test(n) && (n.length >= 3 || heads.has(n)))
    .sort((a, b) => b[1].length - a[1].length);
  const found = new Map();
  texts.forEach((text, ti) => {
    const taken = new Array(text.length).fill(false);
    for (const [ticker, name] of cands) {
      let at = text.indexOf(name);
      while (at !== -1) {
        if (!taken.slice(at, at + name.length).some(Boolean)) {
          taken.fill(true, at, at + name.length);
          const pos = ti * 1e6 + at;
          if (!found.has(ticker) || found.get(ticker).pos > pos) found.set(ticker, { ticker, name, pos });
        }
        at = text.indexOf(name, at + name.length);
      }
    }
  });
  return [...found.values()].sort((a, b) => a.pos - b.pos).map(({ ticker, name }) => ({ ticker, name }));
}
