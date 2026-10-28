/**
 * ad-line.mjs — FlowVium 영상·블로그에 싣는 AISVI 광고. (2026-10-13 신설, 2026-10-28 새 판)
 *
 * 2026-10-13 사장님(Mac mini2 경유, "광고 시간 최소화"): AISVI 광고는 한 줄로만 짧게.
 * 2026-10-28 사장님(IR 세션·Mac mini2 경유): 10/24·10/27 aisviagent.com 실제 사람 방문 0(메타 미리보기 봇뿐).
 *   ① 눌리는 자리에 링크 — 롱폼 설명란·채널 프로필 링크·네이버/Blogger 본문(쇼츠 설명란·댓글 링크는 안 눌린다).
 *   ② 주식 시청자용 한 줄 2~3판 + "바로 써 보기", 판을 돌린다. 최고/최초 금지, 긴 설명 금지.
 *   ③ 주소 aisviagent.com/?utm_source=<youtube|naver|blogger>&utm_medium=<자리>&utm_campaign=flowvium&utm_content=<판>
 * 문구는 사이트에 있는 일만(2026-10-28 aisviagent.com 화면 글): 웹은 가입 없이 검색·질문("이번 주 경제 뉴스 3줄로 요약해줘"),
 *   설치본(Windows)은 화면을 보고 대신 누른다("엑셀 열어서 … 표로 만들어줘"). 증권사 앱 조종은 쓰지 않는다 —
 *   관리자 권한 창은 건드리지 않는다고 사이트에 적혀 있고, 증권사 앱은 대개 그렇게 뜬다.
 * 고정 댓글은 옛 한 줄(AD_LINE, 도메인만) — 긴 utm 주소는 링크 댓글 스팸 필터에 걸린다(10/08 사장님 "권장대로").
 */
export const AD_LINE = '무료 AI 비서 AISVI, aisviagent.com, 가입 없이 바로 무료 체험';

export const AD_VERSIONS = {
  a: '이번 주 경제 뉴스, 말 한마디로 3줄 요약',
  b: '궁금한 종목 뉴스, 가입 없이 AI에게 질문',
  c: '엑셀 매매 기록 정리, 말로 시키면 AI가 대신',
};
export const AD_CTA = '바로 써 보기';
/** 끝 카드 소리(2.5초 안) — 판과 상관없이 같은 말. 'AISVI' 는 '에이스비'(사장님이 정한 발음). 주소는 화면에 크게 — '에이전트 닷컴' 까지 읽으면 2.8초라 안 들어간다(10/28 실측). */
export const AD_SPOKEN = '에이스비, 지금 바로 써 보세요';
const SOURCES = ['youtube', 'naver', 'blogger'];

/** 판 고르기 — 숫자면 차례로(a,b,c,a…), 글이면 글에서 정해진 판. */
export function adVersionFor(seed) {
  const keys = Object.keys(AD_VERSIONS);
  const n = typeof seed === 'number' ? Math.abs(Math.trunc(seed)) : [...String(seed ?? '')].reduce((h, c) => (h * 31 + c.codePointAt(0)) >>> 0, 7);
  return keys[n % keys.length];
}

export function adUrl({ source, medium, version }) {
  if (!SOURCES.includes(source)) throw new Error(`utm source 는 ${SOURCES.join('|')}: ${source}`);
  if (!AD_VERSIONS[version]) throw new Error(`모르는 version: ${version}`);
  if (!/^[a-z_]+$/.test(medium ?? '')) throw new Error(`utm medium 은 영문 소문자·밑줄: ${medium}`);
  return `https://aisviagent.com/?utm_source=${source}&utm_medium=${medium}&utm_campaign=flowvium&utm_content=${version}`;
}

/** 한 줄 + 바로 써 보기 + 주소(두 줄). 설명란·블로그 본문이 같은 꼴을 쓴다.
 *  앞에 'AISVI ·' — 글 사이에 놓이면 누구의 무엇인지 안 보여 우리 글로 읽힌다(남의 서비스 광고임을 밝힌다). */
export function adText(o) {
  return `AISVI · ${AD_VERSIONS[o.version]} — ${AD_CTA}\n${adUrl(o)}`;
}

const NEW_AD = /\n*[^\n]*— 바로 써 보기\nhttps:\/\/aisviagent\.com\/\?utm_[^\n]*$/;

/** 설명란 맨 아래 광고. 이미 새 판이 있으면 그대로, 옛 한 줄이면 새 판으로. 5000자를 넘으면 본문을 줄이고 광고는 남긴다. */
export function withAdLine(text, o, max = 5000) {
  let s = String(text ?? '').trimEnd();
  if (NEW_AD.test(s)) return s.slice(0, max);
  if (s.endsWith(AD_LINE)) s = s.slice(0, -AD_LINE.length).trimEnd();
  const tail = (s ? '\n\n' : '') + adText(o);
  return s.slice(0, max - tail.length).trimEnd() + tail;
}

/** 블로그 본문(마크다운) — 끝 면책 인용(>) 바로 위에 한 단락. 주소는 mdToHtml 이 링크로 만든다. 이미 있으면 그대로. */
export function withBlogAd(md, o) {
  const s = String(md ?? '').trimEnd();
  if (/aisviagent\.com\/\?utm_/.test(s)) return s;
  const block = adText(o);
  const m = /\n\n((?:>[^\n]*\n?)+)$/.exec(s);
  return m ? `${s.slice(0, m.index)}\n\n${block}\n\n${m[1].trimEnd()}` : `${s}\n\n${block}`;
}
