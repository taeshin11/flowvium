/**
 * topic-classify.mjs — 헤드라인을 **고정된 주제 목록** 중 하나로 나눈다. (2026-09-24 신설)
 *
 * 왜: 편성의 조회수 성적(topic-lift)은 과거 편의 주제와 지금 후보의 주제가 **같은 잣대**로 나뉘어야 뜻이 있다.
 *   종전 정규식(topic-score.categoryOf)은 161편 중 74편(46%)을 '기타' 로 못 나눠, 성적이 아무 신호도 못 냈다.
 *   같은 161편을 이 목록으로 agy 에 나누게 하니 국내정치 1.07x · 기업·산업 0.78x 로 뚜렷이 갈렸다.
 *
 * 목록은 여기 한 곳에만 둔다. 바꾸면 과거 편의 topic 과 어긋난다 — 바꿀 때는 소급 분류를 다시 할 것.
 * agy 가 실패하면 **null** 을 돌려준다. 부르는 쪽은 순서를 건드리지 않고 넘어간다 — 쇼츠를 막지 않는다.
 */
import { agyReport } from './agy-report.mjs';

export const TOPICS = Object.freeze([
  '국내정치', '국제·외교·전쟁', '증시·금리·환율', '부동산', '기업·산업',
  'IT·AI·과학', '사회·사건사고', '재난·재해', '기타',
]);

export function classifyPrompt(headlines) {
  const list = headlines.map((h, i) => `${i}|${String(h ?? '').replace(/\|/g, '/').slice(0, 90)}`).join('\n');
  return [
    '아래는 뉴스 헤드라인 목록이다(번호|헤드라인).',
    `각 헤드라인을 다음 주제 중 **정확히 하나**로 분류해라: ${TOPICS.join(', ')}.`,
    '판단 기준은 헤드라인의 **주된 주제**다. 애매하면 가장 가까운 것 하나를 골라라.',
    '',
    list,
    '',
    'JSON 으로만 답해라: {"c": {"0": "주제", "1": "주제", ...}} — 모든 번호를 빠짐없이.',
  ].join('\n');
}

/**
 * @param {string[]} headlines
 * @param {{timeoutMs?:number, call?:Function}} opt  call 은 테스트용(agyReport 대체)
 * @returns {Promise<string[]|null>} headlines 와 같은 길이. 목록 밖 답은 '기타'. 실패하면 null.
 */
export async function classifyTopics(headlines, opt = {}) {
  const hs = (headlines ?? []).map((h) => String(h ?? ''));
  if (!hs.length) return [];
  const call = opt.call ?? ((p) => agyReport(p, {
    label: 'topic-classify', timeoutMs: opt.timeoutMs ?? 180_000,
    schema: { type: 'object', properties: { c: { type: 'object' } }, required: ['c'] },
  }));
  let out;
  try { out = await call(classifyPrompt(hs)); } catch { return null; }
  if (!out) return null;
  let c;
  try { c = JSON.parse(out)?.c; } catch { return null; }
  if (!c || typeof c !== 'object') return null;
  // 하나라도 빠졌으면 믿지 않는다 — 일부만 나뉜 목록으로 순서를 바꾸면 빠진 후보가 조용히 밀린다.
  if (hs.some((_, i) => c[String(i)] == null)) return null;
  return hs.map((_, i) => (TOPICS.includes(c[String(i)]) ? c[String(i)] : '기타'));
}
