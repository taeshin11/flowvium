/**
 * ad-line.mjs — FlowVium 영상·블로그에 싣는 AISVI 광고. (2026-10-13 신설, 2026-10-28 새 판)
 *
 * 2026-10-13 사장님(Mac mini2 경유, "광고 시간 최소화"): AISVI 광고는 한 줄로만 짧게.
 * 2026-10-28 사장님(IR 세션·Mac mini2 경유): 10/24·10/27 aisviagent.com 실제 사람 방문 0(메타 미리보기 봇뿐).
 *   ① 눌리는 자리에 링크 — 롱폼 설명란·채널 프로필 링크·네이버/Blogger 본문(쇼츠 설명란·댓글 링크는 안 눌린다).
 *   ② 주식 시청자용 한 줄 2~3판 + "바로 써 보기", 판을 돌린다. 최고/최초 금지, 긴 설명 금지.
 *   ③ 주소 aisviagent.com/?utm_source=<youtube|naver|blogger>&utm_medium=<자리>&utm_campaign=flowvium&utm_content=<판>
 * 10/28 저녁: 사이트가 "원하는 걸 적으면…" 으로 바뀌어(사장님, gm0·Mac mini2 경유) '말로·말 한마디로' 를 '적어서·적기만 하면' 으로.
 * 문구는 사이트에 있는 일만(2026-10-28 aisviagent.com 화면 글): 웹은 가입 없이 검색·질문("이번 주 경제 뉴스 3줄로 요약해줘"),
 *   설치본(Windows)은 화면을 보고 대신 누른다("엑셀 열어서 … 표로 만들어줘"). 증권사 앱 조종은 쓰지 않는다 —
 *   관리자 권한 창은 건드리지 않는다고 사이트에 적혀 있고, 증권사 앱은 대개 그렇게 뜬다.
 * 고정 댓글은 옛 한 줄(AD_LINE, 도메인만) — 긴 utm 주소는 링크 댓글 스팸 필터에 걸린다(10/08 사장님 "권장대로").
 */
export const AD_LINE = '무료 AI 비서 AISVI, aisviagent.com, 가입 없이 바로 무료 체험';

export const AD_VERSIONS = {
  a: '이번 주 경제 뉴스, 적기만 하면 3줄 요약',
  b: '궁금한 종목 뉴스, 가입 없이 AI에게 질문',
  c: '엑셀 매매 기록 정리, 적어서 시키면 AI가 대신',
};
export const AD_CTA = '바로 써 보기';
/** 끝 카드 소리(2.5초 안) — 판마다 그 판이 하는 일을 말한다. 'AISVI' 는 '에이스비'(사장님이 정한 발음).
 *  10/28 사장님(Mac mini2 경유): 옛 "에이스비, 지금 바로 써 보세요" 는 모르는 이름에 이득이 없고 영상 안은 못 누른다.
 *  Mac mini2 안("이번 주 경제 뉴스, 에이스비한테 물으면 3줄 요약" 등)은 Gemini Kore 로 무음 깎고 3.0~3.5초라 줄였다(10/28 실측).
 *  이 말 그대로 다시 부르면 b·c 는 2.35초를 넘을 수 있다 — 카드 스크립트가 자르지 않고 멈춘다.
 *  굽는 법: 무음 깎고 b 는 atempo 1.15, c 는 1.1 로 맞춘 소리를 --audio 로(받아쓰기로 알아듣는지 확인). */
export const AD_SPOKEN_BY = {
  a: '경제 뉴스, 에이스비가 세 줄 요약',
  b: '종목 뉴스, 에이스비한테 물어보세요',
  c: '매매 기록, 에이스비가 대신 정리',
};
/** 어디로 가는지 — 카드 화면의 작은 글씨. 쇼츠는 설명란 링크가 안 눌려 채널 프로필 링크(channel_links)로 보낸다. */
export const AD_WHERE = { shorts: '채널 링크에서', long: '설명란 링크' };
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
