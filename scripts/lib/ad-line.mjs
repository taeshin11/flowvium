/**
 * ad-line.mjs — FlowVium 영상에 싣는 AISVI 광고 한 줄. (2026-10-13 신설)
 *
 * 사장님 지시(Mac mini2 경유, "광고 시간 최소화"): AISVI 광고는 이 한 줄로만 짧게.
 *   고정댓글·설명란·끝 카드(화면 세 줄) 모두 같은 말. 새 편부터 — 공개된 편은 그대로.
 * 설명란은 업로드 경로가 여럿(쇼츠·주간 해설·수동 업로드)이라 경로마다 붙이지 않고
 *   lib/youtube.mjs uploadRequestBody 한 곳에서 붙인다.
 */
export const AD_LINE = '무료 AI 비서 AISVI, aisviagent.com, 가입 없이 바로 무료 체험';

/** 설명란 맨 아래에 광고 줄. 이미 있으면 그대로. 유튜브 5000자 한도를 넘으면 본문을 줄이고 광고 줄은 남긴다. */
export function withAdLine(text, max = 5000) {
  const s = String(text ?? '').trimEnd();
  if (s.endsWith(AD_LINE)) return s.slice(0, max);
  const tail = (s ? '\n\n' : '') + AD_LINE;
  return s.slice(0, max - tail.length).trimEnd() + tail;
}
