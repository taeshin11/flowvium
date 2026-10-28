/**
 * evergreen-check.mjs — 상시 쇼츠(예비 풀) 대본 규칙. (2026-10-28 신설)
 *
 * Mac mini2(사장님 위임) 10/28: "테크이슈와 같은 규칙. 36시간치 상시 쇼츠를 예비로 — 날짜·가격 없는 설명(PER·금리 인하·거래량)."
 *   정규 렌더가 실패하거나 뉴스 파이프라인이 멎었을 때만 나간다. 언제 나갈지 모르니 **언제 봐도 맞는 말**이어야 한다.
 * 막는 것: 날짜·시점 말(오늘·올해·10월…) · 가격·수준(원·달러·포인트·%·억·조) · 사라·팔라 ·
 *   화면에 안 들어가는 길이(훅 11자×2 를 넘으면 shorts-layout fitHook 이 앞을 잘라 버린다 · 쇼츠 제목 38자).
 * 되는 것: 개념 숫자 — 배수(10분의 1)·기간(1년·52주)·눈금(0부터 100).
 */
import { CALL } from './comment-reply.mjs';
import { repeatsTitle, restatesTitle } from './hook-overlap.mjs';

const DATE = /\d{4}\s*년|\d{1,2}\s*월(?![가-힣])|\d{1,2}\s*월\s*\d|\d{1,2}\s*일(?=[\s,.]|$)|오늘|어제|내일|올해|작년|내년|요즘|최근|이번\s?주|지난\s?주(?=[\s에의는,.]|$)/;
const PRICE = /\d[\d,.]*\s*(?:만|천|백)?\s*(?:원|달러|엔|위안|포인트|%)|\d[\d,.]*\s*(?:억|조)(?![가-힣])|\d[\d,.]*\s*(?:억|조)\s*(?:원|달러)?\s*(?:규모|짜리|회사)/;
export const HOOK_MAX = 22;      // shorts-layout fitHook(11×2)
export const TITLE_MAX = 38;     // video-publish SHORTS_TITLE_MAX 46 − ' #Shorts'
const SAY_MIN = 12, SAY_MAX = 120;

/** @returns {{ok:boolean, why:string[]}} */
export function checkEvergreen(item) {
  const why = [];
  const texts = [['제목', item?.title], ...(item?.scenes ?? []).flatMap((s, i) => [[`${i + 1}훅`, s.hook], [`${i + 1}대사`, s.say]])];
  for (const [k, t] of texts) {
    const s = String(t ?? '');
    if (DATE.test(s)) why.push(`${k} 날짜·시점: ${s.match(DATE)[0]}`);
    if (PRICE.test(s)) why.push(`${k} 가격·수준: ${s.match(PRICE)[0]}`);
    if (CALL.test(s)) why.push(`${k} 사라·팔라: ${s.match(CALL)[0]}`);
  }
  const title = String(item?.title ?? '').trim();
  if (!title || title.length > TITLE_MAX) why.push(`제목 길이 ${title.length}(1~${TITLE_MAX})`);
  const scenes = item?.scenes ?? [];
  if (scenes.length < 2 || scenes.length > 5) why.push(`장면 ${scenes.length}개(2~5)`);
  scenes.forEach((s, i) => {
    const h = String(s.hook ?? '').replace(/\s+/g, ' ').trim();
    const say = String(s.say ?? '').trim();
    if (!h || h.length > HOOK_MAX) why.push(`${i + 1}훅 길이 ${h.length}(1~${HOOK_MAX})`);
    if (say.length < SAY_MIN || say.length > SAY_MAX) why.push(`${i + 1}대사 길이 ${say.length}(${SAY_MIN}~${SAY_MAX})`);
    if (!String(s.image ?? '').trim()) why.push(`${i + 1}그림 설명 없음`);
  });
  // 10/28 첫 화면 관문: 첫 훅이 제목을 되풀이하면 첫 화면이 아무것도 더하지 않는다(세 심판 모두 지적 — lib/hook-overlap).
  if (scenes[0] && repeatsTitle(scenes[0].hook, title)) why.push(`1훅이 제목을 되풀이: "${scenes[0].hook}"`);
  // 첫 대사 = 첫 화면 아래 자막. 이것도 제목을 다시 말하면 첫 화면이 더하는 게 없다(10/28 Mac mini2).
  if (scenes[0] && restatesTitle(scenes[0].say, title)) why.push(`1대사가 제목을 다시 말함: "${scenes[0].say}"`);
  return { ok: why.length === 0, why };
}
