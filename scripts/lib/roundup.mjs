/**
 * roundup.mjs — 하루치 쇼츠를 묶는 롱폼 '뉴스 총정리'의 순수 규칙. 근거는 roundup.test.mjs 머리말.
 */
/** 조회수 큰 편부터. 같으면 먼저 낸 편부터. */
export const orderByViews = (rows) => [...(rows ?? [])].sort((a, b) => (Number(b.views) || 0) - (Number(a.views) || 0) || String(a.published_at).localeCompare(String(b.published_at)));

/** 쇼츠 제목 꼬리표·잘린 괄호를 떼어 장 이름으로 쓴다. */
export function cleanHeadline(s) {
  // 끝의 출처 꼬리표([리얼미터]·[속보])와 잘려 닫히지 않은 괄호([리)를 뗀다.
  // 끝의 (종합)·(2보) 같은 판 표시도 뗀다(10/08 제목 "…아냐\"(종합) 外 20건").
  return String(s ?? '').replace(/#\S+/g, '').replace(/\s*\[[^\]]*\]?\s*$/, '').replace(/\s*\((종합|\d+보|속보|상보)\)\s*$/, '').replace(/\s{2,}/g, ' ').trim();
}

const mmss = (sec) => { const s = Math.floor(sec); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
/** 설명란 챕터 줄. 유튜브 규칙(0:00 시작·3개 이상·각 10초 이상)을 못 지키면 던진다 — 조용히 챕터 없는 설명을 내지 않는다. */
export function chapterLines(chapters) {
  const c = chapters ?? [];
  if (c.length < 3 || c[0].start !== 0) throw new Error('챕터는 0:00 시작·3개 이상');
  for (let i = 1; i < c.length; i++) if (c[i].start - c[i - 1].start < 10) throw new Error(`챕터 ${i} 가 10초 미만`);
  return c.map((x) => `${mmss(x.start)} ${x.title}`);
}

/**
 * "{그날 핵심 뉴스} 外 N건 | M월 D일 뉴스 총정리" (100자 안).
 * 2026-10-08: 첫 두 편 CTR 0.9%·1.5% — 앞머리가 "[뉴스 총정리]" 라 무슨 뉴스인지 안 보였다. 핵심 이슈를 앞으로(Mac mini2 제안).
 */
export function roundupTitle({ lead, n, date }) {
  const [, m, d] = String(date).split('-').map(Number);
  const tail = ` 外 ${n - 1}건 | ${m}월 ${d}일 뉴스 총정리`;
  let l = cleanHeadline(lead);
  const room = 100 - tail.length;
  if (l.length > room) l = `${l.slice(0, room - 1)}…`;
  return `${l}${tail}`;
}

const NUM = /\d[\d,.]*\s*(%|%p|억\s*원|억\s*달러|조\s*원|억|조|만\s*명|만|명|건|원|달러|배|년|개월|일)/;
/**
 * 썸네일 큰 글 2줄 + 숫자 하나. agy 제안(choice)을 받되 **실제 쇼츠 훅·제목에 있는 것만** 쓴다 — 아니면 1위 편 훅·제목 숫자.
 * @param shorts 조회수 순 [{title, hooks[]}]  @param choice {pick, line1, line2, number} | null  @param newsCount 꼭지 수
 */
export function thumbText(shorts, choice, newsCount) {
  // 줄과 숫자를 따로 검사한다 — agy 가 숫자로 '첫날' 을 골라도 줄은 쓸 만했다(10/08 실측).
  const titles = (shorts ?? []).map((x) => String(x.title ?? '')).join(' ');
  const s0 = shorts?.[choice?.pick];
  const hooks = (s0?.hooks ?? []).map(String);
  const linesOk = !!(s0 && choice && hooks.includes(choice.line1) && hooks.includes(choice.line2) && choice.line1 !== choice.line2);
  const numOk = !!(choice?.number && titles.includes(choice.number) && NUM.test(choice.number));
  const pick = linesOk ? choice.pick : 0;
  const s = shorts?.[pick] ?? { hooks: [], title: '' };
  const h = (s.hooks ?? []).filter(Boolean);
  const numHit = NUM.exec(String(s.title ?? '')) ?? (shorts ?? []).map((x) => NUM.exec(String(x.title ?? ''))).find(Boolean);
  return {
    line1: linesOk ? choice.line1 : (h[0] ?? cleanHeadline(s.title).slice(0, 12)),
    line2: linesOk ? choice.line2 : (h[1] ?? ''),
    number: numOk ? choice.number : (numHit ? numHit[0].replace(/\s+/g, '') : `${newsCount}건`),
    pick, src: linesOk && numOk ? 'agy' : linesOk ? 'agy-lines' : 'fallback',
  };
}
