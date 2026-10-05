/**
 * roundup.mjs — 하루치 쇼츠를 묶는 롱폼 '뉴스 총정리'의 순수 규칙. 근거는 roundup.test.mjs 머리말.
 */
/** 조회수 큰 편부터. 같으면 먼저 낸 편부터. */
export const orderByViews = (rows) => [...(rows ?? [])].sort((a, b) => (Number(b.views) || 0) - (Number(a.views) || 0) || String(a.published_at).localeCompare(String(b.published_at)));

/** 쇼츠 제목 꼬리표·잘린 괄호를 떼어 장 이름으로 쓴다. */
export function cleanHeadline(s) {
  // 끝의 출처 꼬리표([리얼미터]·[속보])와 잘려 닫히지 않은 괄호([리)를 뗀다.
  return String(s ?? '').replace(/#\S+/g, '').replace(/\s*\[[^\]]*\]?\s*$/, '').replace(/\s{2,}/g, ' ').trim();
}

const mmss = (sec) => { const s = Math.floor(sec); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
/** 설명란 챕터 줄. 유튜브 규칙(0:00 시작·3개 이상·각 10초 이상)을 못 지키면 던진다 — 조용히 챕터 없는 설명을 내지 않는다. */
export function chapterLines(chapters) {
  const c = chapters ?? [];
  if (c.length < 3 || c[0].start !== 0) throw new Error('챕터는 0:00 시작·3개 이상');
  for (let i = 1; i < c.length; i++) if (c[i].start - c[i - 1].start < 10) throw new Error(`챕터 ${i} 가 10초 미만`);
  return c.map((x) => `${mmss(x.start)} ${x.title}`);
}

/** "[뉴스 총정리] {가장 큰 뉴스} 外 N건 · M월 D일" (100자 안). */
export function roundupTitle({ lead, n, date }) {
  const [, m, d] = String(date).split('-').map(Number);
  const tail = ` 外 ${n - 1}건 · ${m}월 ${d}일`;
  const head = '[뉴스 총정리] ';
  let l = cleanHeadline(lead);
  const room = 100 - head.length - tail.length;
  if (l.length > room) l = `${l.slice(0, room - 1)}…`;
  return `${head}${l}${tail}`;
}
