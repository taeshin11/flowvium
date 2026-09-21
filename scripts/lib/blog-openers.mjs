/**
 * blog-openers.mjs — 블로그 글 도입부 단일 원천.
 *
 * 왜 한 파일로 모았는가:
 * make-blog-post 가 날짜별로 도입부를 다르게 뽑아내는데,
 * blog-quality 에 옛날 도입부 문구만 하드코딩되어 있어서 새 문구가 걸러지지 않고 알맹이로 셈되어
 * 중복도 상한에 걸리는 문제가 있었다.
 * 이 목록을 두 군데에 따로 적으면 다음에 또 도입부를 바꿀 때 반드시 어긋나게 되므로,
 * 여기서 생성하고 여기서 검증 패턴을 만들도록 한 파일로 모았다.
 */

export const OPENERS = [
  (d, s) => `${d} ${s}에 본 시장을 적어 둡니다. 지수가 어떻게 움직였고, 그걸 어떻게 읽었고, 그래서 무엇을 들여다봤는지 순서대로 갑니다.`,
  (d, s) => `${d} ${s} 기준으로 정리했습니다. 숫자부터 보고, 그 숫자를 어떻게 해석했는지, 오늘 눈에 걸린 종목은 무엇인지 차례로 적습니다.`,
  (d, s) => `${d} ${s} 시장입니다. 오늘 무슨 일이 있었고 그게 무슨 뜻인지, 그리고 그 안에서 뭘 봤는지 적었습니다.`,
  (d, s) => `${d} ${s}에 돌린 정리입니다. 지수·수급·종목 순으로 훑고, 마지막에 지난 추천이 어땠는지도 같이 둡니다.`,
];

export function pickOpener(mm, dd, session) {
  const index = (Number(mm) * 31 + Number(dd) + String(session).length) % OPENERS.length;
  return OPENERS[index];
}

export const OPENER_PATTERNS = OPENERS.map((fn) => {
  const text = fn('', '');
  const parts = text.split('. ');
  let tail = parts[parts.length - 1];
  tail = tail.replace(/\.$/, '').trim();
  const escaped = tail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^[^\\n]*${escaped}[^\\n]*$`, 'gm');
});
