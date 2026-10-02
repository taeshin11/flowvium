/**
 * trend-topics.mjs — 트렌드 탭 인기 제목들 → 다음 편 주제 1~2개(주제마다 뉴스 제목에서 찾을 명사 1~3개). 2026-10-02.
 *
 * 낱말 빈도(trendTerms)만으로는 '겁니다·터질·sbs·뉴스데스크·하나도' 같은 말버릇·방송사 이름이 주제어로 들어왔다(첫 수집 실측).
 * agy 가 고르고, 코드가 거른다: 키워드는 명사형 2~10자이고 **실제 제목 어딘가에 그대로 있어야** 한다(지어낸 말 금지),
 *   시드어 자체(주식·뉴스 등)는 뺀다 — 시드어는 모든 제목에 있으니 고르는 힘이 없다. 걸러서 남는 게 없으면 null(칸이 쉰다).
 */
export function validTopics(raw, items) {
  const titles = (items ?? []).map((x) => String(x.title ?? '').toLowerCase());
  const seeds = new Set((items ?? []).map((x) => String(x.q ?? '').toLowerCase()));
  const out = [];
  for (const t of Array.isArray(raw) ? raw : []) {
    const kws = [...new Set((Array.isArray(t?.keywords) ? t.keywords : []).map((k) => String(k ?? '').trim().toLowerCase()))]
      .filter((k) => k.length >= 2 && k.length <= 10 && !seeds.has(k) && !/\s/.test(k) && titles.some((s) => s.includes(k)));
    if (kws.length) out.push({ topic: String(t.topic ?? kws[0]).slice(0, 30), keywords: kws.slice(0, 3) });
    if (out.length >= 2) break;
  }
  return out.length ? out : null;
}

export async function pickTrendTopics(items, { call } = {}) {
  const list = (items ?? []).map((x, i) => `${i}|${x.q}|${x.title}|조회수 ${x.views}·${x.age}`).join('\n');
  const prompt = ['아래는 유튜브 스튜디오 트렌드 탭에서 시드어별로 지금 인기 있는 영상 제목이다(번호|시드어|제목|조회수·올린 지).',
    '경제·시사 뉴스 쇼츠 채널이 이번 주에 다룰 **주제 1~2개**를 골라라. 조회수가 빠르게 쌓이는 쪽, 여러 제목에 겹치는 쪽을 우선한다.',
    '각 주제마다 뉴스 기사 제목에서 그 주제를 찾아낼 **명사 키워드 1~3개**(띄어쓰기 없는 2~10자, 제목에 실제로 있는 말)를 적어라.',
    '방송사·채널 이름, 말버릇(겁니다·터질·속보 등), 시드어 자체(주식·뉴스 등)는 키워드가 아니다.', '', list, '',
    'JSON 으로만 답해라: {"topics": [{"topic": "...", "keywords": ["...", "..."]}]}'].join('\n');
  const doCall = call ?? (async (pp) => (await import('./agy-report.mjs')).agyReport(pp, {
    label: 'trend-topics', timeoutMs: 120_000,
    // 배열엔 items 가 있어야 한다 — 없으면 Gemini 가 400 INVALID_ARGUMENT(...topics].items: missing field)로 거절한다(10/02 실측).
    schema: { type: 'object', properties: { topics: { type: 'array', items: { type: 'object', properties: { topic: { type: 'string' }, keywords: { type: 'array', items: { type: 'string' } } }, required: ['topic', 'keywords'] } } }, required: ['topics'] },
    accept: (out) => { try { return Array.isArray(JSON.parse(out)?.topics); } catch { return false; } },
  }));
  let out;
  try { out = await doCall(prompt); } catch { return null; }
  try { return validTopics(JSON.parse(out)?.topics, items); } catch { return null; }
}
