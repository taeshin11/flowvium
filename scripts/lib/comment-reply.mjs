/**
 * comment-reply.mjs — 시청자 댓글 답글 규칙. 근거는 comment-reply.test.mjs.
 *
 * 10/27 사장님(Mac mini2 경유) 상시 규칙:
 *   · 진짜 시청자 댓글에만, 늦어도 24시간 안(매시 보면 1시간 안). 영상 언어로 1~2줄 — 질문에 답하거나 사실 하나를 더한다.
 *   · 링크·쿠팡·구독 부탁 없음. 상품 링크 질문은 고정 댓글로 안내.
 *   · 의료·투자 조언 없음 — 종목 질문엔 사라·팔라 없이, '투자 권유가 아닙니다' 한 줄.
 *   · 스팸·욕설·정치는 건너뛴다(지우지 않는다). 영상당 하루 5개, 계정 하루 20개.
 */
// 11/07 사장님 "전 세션 대댓글도 잘 달아서 팬 관리해"(Mac mini2 경유): 영상당 10·계정 30, 최근 7일 영상 댓글은 빠짐없이,
//   7일 넘은 영상은 질문에만. 같은 문장 복붙 금지, 단골은 이름으로. 정치·욕설·스팸은 그대로 건너뛴다.
export const CAP_PER_VIDEO = 10;
export const CAP_PER_DAY = 30;
export const MAX_AGE_H = 168;
export const VIDEO_FRESH_DAYS = 7;

/** agy 분류 응답(JSON 글·```json 감싼 글·객체)을 객체로. 못 읽으면 null — 종전엔 글을 그대로 봐 늘 '분류 못 받음'이었다. */
export function parseClassify(out) {
  if (out && typeof out === 'object') return out.category ? out : null;
  const m = /\{[\s\S]*\}/.exec(String(out ?? ''));
  if (!m) return null;
  try { const o = JSON.parse(m[0]); return o && typeof o === 'object' && o.category ? o : null; } catch { return null; }
}
/** 7일 넘은 영상은 질문 댓글에만 답한다. */
export const allowedForVideo = ({ videoAgeDays, category }) => !(videoAgeDays > VIDEO_FRESH_DAYS) || category === 'question';
const norm = (x) => String(x ?? '').replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase();
const bigrams = (x) => { const s = norm(x), out = new Set(); for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2)); return out; };
/** 최근 답글과 거의 같은가(글자 두 개씩 겹침 0.8 이상) — 같은 문장 복붙 금지. */
export function tooSimilar(text, previous = []) {
  const a = bigrams(text);
  if (!a.size) return false;
  return previous.some((p) => {
    const b = bigrams(p);
    if (!b.size) return false;
    let inter = 0; for (const g of a) if (b.has(g)) inter++;
    return inter / Math.min(a.size, b.size) >= 0.8 && Math.abs(a.size - b.size) / Math.max(a.size, b.size) < 0.3;
  });
}
/** 단골(댓글 두 번 이상)의 부를 이름. 자동 생성 핸들(@user-…)은 부르지 않고, '이름-영숫자' 꼬리는 뗀다. */
export function regularName(display, count) {
  if (!(count >= 2)) return null;
  const h = String(display ?? '').replace(/^@/, '').trim();
  if (!h || /^user-[a-z0-9]+$/i.test(h)) return null;
  return h.replace(/-[a-z0-9]{3,6}$/i, '') || null;
}

const LINK = /https?:\/\/|www\.|\b[\w-]+\.(?:com|net|kr|io|co|me|ly)\b/i;
const PROMO = /쿠팡|coupang|구독|좋아요\s*(?:눌러|부탁)|알림\s*설정|subscribe/i;
// '사라' 는 앞뒤가 한글이 아닐 때만(낱말) — '회사라면'·'사라졌다' 를 권유로 잡았다(10/28 실측).
export const CALL = /(?:사세요|파세요|(?<![가-힣])사라(?![가-힣])|팔아라|매수\s*(?:하세요|추천|타이밍)|매도\s*(?:하세요|추천|타이밍)|추천합니다|지금이\s*기회|buy\s+now|sell\s+now|you should (?:buy|sell))/i;
const MEDICAL = /복용하세요|드세요|처방|진단(?:하면|하세요)|치료하세요/;
const NOT_ADVICE = { ko: /투자\s*권유가\s*아닙니다/, en: /not (?:investment|financial) advice/i };

/** 답글 글이 규칙을 지키는가. stock: 종목 질문에 대한 답인가. */
export function checkReply(text, { stock = false, lang = 'ko' } = {}) {
  const t = String(text ?? '').trim();
  const why = (w) => ({ ok: false, why: w });
  if (!t) return why('빈 답글');
  const lines = t.split('\n').map((x) => x.trim()).filter(Boolean);
  if (lines.length > 2) return why(`${lines.length}줄`);
  if (t.length > 160) return why(`${t.length}자`);
  if (LINK.test(t)) return why('링크');
  if (PROMO.test(t)) return why('홍보·구독 부탁');
  if (CALL.test(t)) return why('사라·팔라');
  if (MEDICAL.test(t)) return why('의료 조언');
  if (stock && !(NOT_ADVICE[lang] ?? NOT_ADVICE.ko).test(t)) return why('투자 권유 아님 문구 없음');
  return { ok: true };
}

const kst = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);

/**
 * 답할 댓글 고르기. threads: [{id, videoId, publishedAt, authorId, repliedByUs}], ledger: {commentId: {at, videoId, status}}.
 * 오래된 것부터(먼저 단 사람 먼저). 하루 상한은 원장의 오늘(KST) 'replied' 를 센다.
 */
export function pickTargets(threads, { channelId, now = Date.now(), ledger = {} }) {
  const today = kst(now);
  const done = Object.values(ledger).filter((e) => e.status === 'replied' && kst(Date.parse(e.at)) === today);
  const perVideo = new Map();
  for (const e of done) perVideo.set(e.videoId, (perVideo.get(e.videoId) ?? 0) + 1);
  let left = CAP_PER_DAY - done.length;
  const out = [];
  const cand = threads
    .filter((t) => t.authorId !== channelId && !t.repliedByUs && !ledger[t.id] && now - Date.parse(t.publishedAt) <= MAX_AGE_H * 3600e3)
    .sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
  for (const t of cand) {
    if (left <= 0) break;
    const n = perVideo.get(t.videoId) ?? 0;
    if (n >= CAP_PER_VIDEO) continue;
    perVideo.set(t.videoId, n + 1); left -= 1; out.push(t);
  }
  return out;
}
