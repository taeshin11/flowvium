/**
 * news-topics.mjs — 최근 48시간 경제 언론이 평소보다 많이 다룬 말을 고른다. 2026-11-07 신설.
 *
 * 왜(11/07 사장님 "민주당이 이길 거라는 것도 뉴스 전반을 뒤지면 예측 가능하지 않았을까?"):
 *   11/03 미국 중간선거 전에 "민주당 압승 확률 75%+", "압승은 증시에 찬물(야데니)", "韓반도체 영향 주목(블룸버그)"
 *   기사가 news_archive 에 다 들어와 있었다(하루 3~4천 건). 그런데 11/03~11/04 보고서 10개가 '선거'를 한 번도 안 썼다.
 *   보고서 AI 가 받는 뉴스는 /api/news-cascade 의 '가장 최근 12건 → 앞 6건, 건당 70자' 뿐이었다 —
 *   얼마나 많이 보도됐는지는 아무도 안 봤다. 여기서 그걸 센다.
 *
 * 방법: 훑는 출처(data/news-feeds.json 의 topicScan)의 제목을 낱말로 쪼개, 최근 48시간 하루 평균이
 *   앞선 14일 하루 평균보다 얼마나 늘었는지 본다. 출처·날짜당 3건까지만 센다(한 곳이 배당 공시를 하루 수백 건
 *   쏟아내도 1곳으로 남게). 3곳 이상이 다룬 말만. 같은 제목(앞 40자)은 한 번.
 *   낱말 기준이라 같은 일이 election·midterm·중간선거 로 갈라져 나온다 — 합치지 않는다(동의어 목록은 손으로 만든 목록이 된다).
 *   고른 말과 대표 제목을 보고서 AI 에 주고, 해석(앞으로 정해진 일정인지, 결과별 영향)은 기사에 쓰인 만큼만 하게 한다.
 */

const DAY = 86400e3;
// 영어 기능어 — 4글자 이상만 세므로 짧은 말은 이미 빠진다. 뜻이 있는 말은 넣지 않는다(평소 빈도가 걸러 준다).
const EN_STOP = new Set('with from that this what will have more than their about over into after amid says said could would should when where which they them been were your here just most also than then only some such these those very into onto upon while does doing done make makes made'.split(' '));
const KO_TAIL = /(에서|으로|까지|부터|이|가|은|는|을|를|에|의|도|서|로|과|와)$/;

/** 제목 → 낱말 집합. 영어는 소문자 4글자 이상(끝 s 제거), 한국어는 2글자 이상(끝 조사 하나 제거). */
export function topicTokens(headline) {
  const out = new Set();
  const s = String(headline ?? '');
  for (const w of s.toLowerCase().match(/[a-z]{4,}/g) ?? []) if (!EN_STOP.has(w)) out.add(w.replace(/s$/, ''));
  for (const w of s.match(/[가-힣]{2,}/g) ?? []) {
    const x = w.length > 2 ? w.replace(KO_TAIL, '') : w;
    if (x.length >= 2) out.add(x);
  }
  return out;
}

/**
 * rows: [{ headline, source, captured_at }] — captured_at 은 ISO(UTC).
 * 반환: [{ word, score, recent, base, sources, examples: [{ headline, source, at }] }] 점수 높은 순.
 */
export function hotTopics(rows, {
  now = Date.now(), scanSources, windowH = 48, baseDays = 14, perSourceDay = 3, minSources = 3, minCount = 8, top = 8, examples = 3,
} = {}) {
  const W = windowH * 3600e3, B = baseDays * DAY;
  const seen = new Set();
  const win = new Map(), base = new Map();
  for (const r of rows ?? []) {
    if (scanSources && !scanSources.has(r.source)) continue;
    const at = Date.parse(r.captured_at);
    if (!Number.isFinite(at) || at > now || at < now - W - B) continue;
    const key = String(r.headline ?? '').toLowerCase().slice(0, 40);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const inWin = now - at <= W;
    const m = inWin ? win : base;
    const day = new Date(at).toISOString().slice(0, 10);
    for (const t of topicTokens(r.headline)) {
      const e = m.get(t) ?? { n: 0, per: new Map(), src: new Set(), ex: [], keys: new Set() };
      const pk = `${r.source}|${day}`;
      const c = (e.per.get(pk) ?? 0) + 1;
      e.per.set(pk, c);
      if (c <= perSourceDay) e.n++;
      e.src.add(r.source);
      if (inWin) { e.ex.push({ headline: r.headline, source: r.source, at, summary: r.summary || '' }); e.keys.add(key); }
      m.set(t, e);
    }
  }
  const cand = [];
  for (const [word, e] of win) {
    if (e.n < minCount || e.src.size < minSources) continue;
    const recent = e.n / (windowH / 24);
    const b = (base.get(word)?.n ?? 0) / baseDays;
    const score = Math.log1p(e.n) * Math.log((recent + 1) / (b + 1));
    if (score > 0) cand.push({ word, score, recent, b, e });
  }
  cand.sort((a, z) => z.score - a.score);
  // 같은 기사들에 같이 나오는 말은 한 이슈로 묶는다(midterm·election) — 칸 6개를 한 일이 다 차지하지 않게.
  //   겹친 제목 수 / 큰 쪽 제목 수 ≥ 0.5. 손으로 만든 동의어 목록은 쓰지 않는다(ChatGPT·agy 상의 11/07).
  const groups = [];
  for (const c of cand) {
    // 묶음의 첫 말(lead)과만 비교하고 분모는 큰 쪽 — 합집합·작은 쪽과 비교하면 'stock' 같은 흔한 말이 눈덩이처럼 붙었다(11/04 재생 실측).
    const g = groups.find((x) => { let k = 0; for (const h of c.e.keys) if (x.lead.has(h)) k++; return k / Math.max(c.e.keys.size, x.lead.size) >= 0.5; });
    if (g) { g.words.push(c.word); for (const s of c.e.src) g.src.add(s); g.ex.push(...c.e.ex); continue; }
    if (groups.length >= top) continue;
    groups.push({ words: [c.word], score: c.score, recent: c.recent, b: c.b, lead: c.e.keys, src: new Set(c.e.src), ex: [...c.e.ex] });
  }
  return groups.map((g) => {
    const ex = [], used = new Set(), usedKey = new Set();
    for (const x of g.ex.sort((a, z) => z.at - a.at)) {
      const k = String(x.headline).toLowerCase().slice(0, 40);
      if (used.has(x.source) || usedKey.has(k)) continue;
      used.add(x.source); usedKey.add(k);
      ex.push(x);
      if (ex.length >= examples) break;
    }
    return { word: g.words.join('·'), words: g.words, score: +g.score.toFixed(2), recent: +g.recent.toFixed(1), base: +g.b.toFixed(1), sources: g.src.size, examples: ex };
  });
}

/**
 * 보고서 칸 — 이슈마다 한 줄: 낱말(평소 하루 x건→최근 y건, n곳): [출처 MM-DD HH:mm UTC] 제목 — 첫 기사만 요약 앞부분.
 * 출처·시각을 붙이는 건 '보고서 쓰는 시각 전에 나온 기사'만 근거로 쓰게 하려는 것(ChatGPT 상의 11/07).
 */
export function formatHotTopics(topics) {
  const stamp = (at) => new Date(at).toISOString().slice(5, 16).replace('T', ' ');
  return (topics ?? []).map((t) => `${t.word}(평소 하루 ${t.base}건→최근 ${t.recent}건, ${t.sources}곳): ` + t.examples.map((x, i) => {
    // RSS 요약에 HTML 이 섞여 온다(머니투데이는 <table><img> 로 시작) — 태그를 벗기고, 비면 붙이지 않는다.
    const plain = String(x.summary ?? '').replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
    const sum = i === 0 && plain && !plain.startsWith(String(x.headline).slice(0, 30)) ? ` — ${plain.slice(0, 110)}` : '';
    return `[${x.source} ${stamp(x.at)}] ${String(x.headline).slice(0, 90)}${sum}`;
  }).join(' / ')).join('\n');
}

/**
 * news_archive 에서 읽어 고른다. db 는 openDb() 싱글턴 — 여기서 닫지 않는다.
 * captured_at 은 ISO 문자열이라 문자열 비교로 범위를 자른다(인덱스 없음, 16일치 ~5만 행 — 실측 아래 커밋 참조).
 */
export function hotTopicsFromDb(db, { now = Date.now(), scanSources, ...opt } = {}) {
  const windowH = opt.windowH ?? 48, baseDays = opt.baseDays ?? 14;
  const from = new Date(now - windowH * 3600e3 - baseDays * DAY).toISOString();
  const to = new Date(now).toISOString();
  const src = [...scanSources];
  const rows = db.prepare(`SELECT headline, summary, source, captured_at FROM news_archive
    WHERE captured_at >= ? AND captured_at <= ? AND source IN (${src.map(() => '?').join(',')})`).all(from, to, ...src);
  return hotTopics(rows, { now, scanSources, ...opt });
}

/**
 * 보고서 AI 프롬프트 칸 + 쓰는 법. 거시·내러티브 두 프롬프트가 같은 글을 쓴다(한쪽만 고치면 어긋난다).
 * 규칙은 ChatGPT·agy·Claude 상의(11/07)에서 셋이 같이 낸 것만: 관련 없으면 안 써도 된다 / 기사에 나온 견해만 출처와 /
 * 기사에 없는 원인·폭·확률 금지 / 선거 확률≠주가 확률 / 한 사건으로 단정 금지 / 단정 표현 금지.
 */
export function hotTopicsPromptBlock(text) {
  if (!text) return '';
  return [
    '[많이 보도된 이슈 — 최근 48시간 경제 언론 10곳이 평소보다 많이 다룬 말과 대표 제목(이 보고서 시각 전 기사만)]',
    text,
    '- 이 중 투자자에게 중요한 것만 쓴다. 관련이 없거나 근거가 약하면 쓰지 마라.',
    '- 날짜가 정해진 앞으로의 일(선거·표결·발표 등)이 있으면 언제 무엇이 거론되는지 1~2문장. 결과별 영향은 기사에 나온 기관·견해만 "~라는 분석(출처)" 꼴로.',
    '- 기사에 없는 원인·하락폭·확률을 만들지 마라. 선거 결과 확률을 주가가 오르내릴 확률처럼 쓰지 마라.',
    '- 오르내림을 한 사건 하나 탓으로 단정하지 마라. 금리·수급·실적처럼 같이 작용하는 요인이 입력에 있으면 같이 쓴다.',
    '- "폭락 임박", "반드시 하락", "확실한 악재" 같은 단정 표현 금지. 근거 없이 "불확실성 해소"로 결론내지 마라.',
  ].join('\n');
}

/**
 * 앞날을 단정하는 표현 — 프롬프트에서 금지한 꼴을 발간 뒤에도 잡는다(ChatGPT·agy 둘 다 "프롬프트만으론 안 막힌다").
 * 지난 사실("어제 6% 폭락했다")·조건부("~할 수 있다는 분석")는 잡지 않는다.
 */
const CERTAINTY = /폭락\s*임박|반드시\s*(?:하락|상승|떨어|오르|반등)|확실한\s*(?:악재|호재)|(?:하락|상승|폭락|반등|급락)(?:이|은|는)?\s*불가피|(?:하락|상승|반등|폭락)\s*확실/g;
export function certaintyClaims(text) {
  return [...String(text ?? '').matchAll(CERTAINTY)].map((m) => m[0]);
}
