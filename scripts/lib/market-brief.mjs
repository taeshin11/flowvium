/**
 * market-brief.mjs — 매일 시장 요약 롱폼의 순수 규칙. 근거는 market-brief.test.mjs 머리말.
 *   판(edition): 'us'   = 아침(KST 07시대) 미국 증시 요약 — 전날 뉴욕 마감 + 오늘 일정
 *               'kreu' = 미국 개장 1시간 전 한국·유럽 증시 요약 — 오늘 한국 마감·유럽 장중 + 오늘 밤 일정
 */

const KST = 9 * 3600e3;
const DOW = ['일', '월', '화', '수', '목', '금', '토'];

export const EDITIONS = {
  us: {
    label: '미국 증시 요약', badge: ['FLOWVIUM', '미국 증시'],
    indices: ['.INX', '.IXIC', '.DJI', '.SOX'], required: ['.INX', '.IXIC', '.DJI'],
    articles: /뉴욕증시|뉴욕\s*증시|뉴욕마감|\[뉴욕/,
  },
  kreu: {
    label: '한국·유럽 증시 요약', badge: ['FLOWVIUM', '한국·유럽 증시'],
    indices: ['KOSPI', 'KOSDAQ', '.STOXX50E', '.GDAXI', '.FTSE', '.FCHI'], required: ['KOSPI', 'KOSDAQ'],
    articles: /(코스피|코스닥).*마감|마감.*(코스피|코스닥)|\[외환\]|유럽\s*증시|\[특징주\].*마감|마감시황/,
  },
};
export const INDEX_NAMES = {
  '.INX': 'S&P 500', '.IXIC': '나스닥', '.DJI': '다우', '.SOX': '필라델피아 반도체',
  KOSPI: '코스피', KOSDAQ: '코스닥', '.STOXX50E': '유로스톡스50', '.GDAXI': '독일 DAX', '.FTSE': '영국 FTSE', '.FCHI': '프랑스 CAC40',
};
/** 네이버 지수 API 주소 — 국내 지수와 해외 지수가 다른 호스트다(10/22 실측). */
export const naverIndexUrl = (code) => (code.startsWith('.')
  ? `https://api.stock.naver.com/index/${code}/basic`
  : `https://m.stock.naver.com/api/index/${code}/basic`);

const num = (s) => { const n = Number(String(s ?? '').replace(/,/g, '')); return String(s ?? '').trim() !== '' && Number.isFinite(n) ? n : null; };

/** 네이버 지수 응답 → {code,name,close,pct,change,closed,day}. 종가·등락률이 숫자가 아니면 null — 0 으로 채우지 않는다. */
export function parseNaverIndex(code, j) {
  const close = num(j?.closePrice); const pct = num(j?.fluctuationsRatio);
  if (close === null || pct === null) return null;
  return { code, name: INDEX_NAMES[code] ?? code, close, pct, change: num(j?.compareToPreviousClosePrice),
    closed: j?.marketStatus === 'CLOSE', day: String(j?.localTradedAt ?? '').slice(0, 10), at: j?.localTradedAt ?? null };
}

const fmt = (n, d = 2) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const signed = (n, d = 2) => `${n > 0 ? '+' : n < 0 ? '-' : ''}${fmt(Math.abs(n), d)}`;
/** 사실 줄 "나스닥 26,702.86 (+1.05%, +277.99)" — 대본 근거(CORPUS)와 화면 지수판이 같은 줄을 쓴다. */
export function factLine(q) {
  return `${q.name} ${fmt(q.close)} (${signed(q.pct)}%${q.change === null || q.change === undefined ? '' : `, ${signed(q.change)}`})`;
}

const nyDate = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const kstDate = (ms) => new Date(ms + KST).toISOString().slice(0, 10);
const kstHHMM = (ms) => new Date(ms + KST).toISOString().slice(11, 16);

/** 그 날짜(뉴욕 기준) 09:30 개장의 시각. 서머타임은 Intl 이 안다 — 시각을 박아 두면 11월에 한 시간 틀린다. */
export function usOpenKst(dateKst) {
  const [y, m, d] = String(dateKst).split('-').map(Number);
  const noon = Date.UTC(y, m - 1, d, 16);
  const off = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' })
    .formatToParts(new Date(noon)).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-5';
  const h = Number((/GMT([+-]\d+)/.exec(off) ?? [0, -5])[1]);
  const ms = Date.UTC(y, m - 1, d, 9 - h, 30);
  return { ms, hhmm: kstHHMM(ms) };
}

/** 이 시각에 이 판을 만들어도 되나. 러너가 놓친 잡을 아무 때나 소급하므로(startupCatchup) 스크립트가 직접 막는다. */
export function inWindow(edition, nowMs) {
  const hm = kstHHMM(nowMs);
  if (edition === 'us') return hm >= '06:30' && hm < '11:00' ? { ok: true } : { ok: false, why: `KST ${hm} — 미국판은 06:30~11:00 에만` };
  const open = usOpenKst(kstDate(nowMs));
  return hm >= '18:00' && nowMs < open.ms ? { ok: true, openMs: open.ms } : { ok: false, why: `KST ${hm} — 한국·유럽판은 18:00 ~ 미국 개장(${open.hhmm}) 전에만` };
}

/** 그날 장이 실제로 열렸고 끝났나. 휴장·지연이면 어제 숫자를 오늘 것처럼 읽게 된다. */
export function sessionCheck(edition, quotes, { nowMs = Date.now() } = {}) {
  const want = edition === 'us' ? nyDate(nowMs) : kstDate(nowMs);
  const need = EDITIONS[edition].required;
  for (const code of need) {
    const q = (quotes ?? []).find((x) => x?.code === code);
    if (!q) return { ok: false, why: `${INDEX_NAMES[code] ?? code} 시세 없음` };
    if (q.day !== want) return { ok: false, why: `${INDEX_NAMES[code] ?? code} 마지막 거래일 ${q.day} ≠ ${want} (휴장·지연)` };
    if (!q.closed) return { ok: false, why: `${INDEX_NAMES[code] ?? code} 아직 장중` };
  }
  return { ok: true, day: want };
}

const CAL_COUNTRY = { USD: '미국', EUR: '유로존' };
/** 경제지표 일정 → 창 안 · 미국/유로존 · 중요도 중간 이상, 한국 시각 순. (ForexFactory 주간 JSON 꼴) */
export function calendarRows(events, { fromMs, toMs }) {
  return (events ?? []).map((e) => ({ ...e, ms: Date.parse(e?.date) }))
    .filter((e) => Number.isFinite(e.ms) && e.ms >= fromMs && e.ms < toMs && CAL_COUNTRY[e.country] && /^(High|Medium)$/.test(e.impact ?? ''))
    .sort((a, b) => a.ms - b.ms)
    .map((e) => ({ ms: e.ms, kst: kstHHMM(e.ms), kstDay: kstDate(e.ms), country: CAL_COUNTRY[e.country], title: String(e.title), impact: e.impact,
      forecast: e.forecast || null, previous: e.previous || null }));
}

/** 판의 장 마감 기사. 속보·스팟(본문 없음)은 빼고, 같은 매체의 같은 머리("뉴욕증시,")는 가장 늦은 판(종합)만. */
export function pickArticles(edition, rows) {
  const re = EDITIONS[edition].articles;
  const keyOf = (r) => { const h = String(r.headline ?? '').replace(/\s+/g, ''); const c = h.indexOf(',');
    return `${r.source ?? ''}|${c > 0 && c <= 8 ? h.slice(0, c) : h.slice(0, 14)}`; };
  const by = new Map();
  for (const r of rows ?? []) {
    const h = String(r.headline ?? '');
    if (!re.test(h) || /^\s*\[(속보|스팟)\]/.test(h)) continue;
    const k = keyOf(r); const prev = by.get(k);
    if (!prev || String(r.captured_at) > String(prev.captured_at)) by.set(k, r);
  }
  return [...by.values()].sort((a, b) => String(b.captured_at).localeCompare(String(a.captured_at)));
}

/** "【미국 증시 요약】 {핵심 질문} | 10월 22일(목)" — 100자 안. */
export function briefTitle({ edition, hook, date }) {
  const [y, m, d] = String(date).split('-').map(Number);
  const head = `【${EDITIONS[edition].label}】 `;
  const tail = ` | ${m}월 ${d}일(${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
  let h = String(hook ?? '').replace(/#\S+/g, '').replace(/\s{2,}/g, ' ').trim();
  const room = 100 - head.length - tail.length;
  if (h.length > room) h = `${h.slice(0, room - 1)}…`;
  return `${head}${h}${tail}`;
}

/** 썸네일 날짜 띠 "26년 10월 22일 (목)" (레퍼런스 꼴). */
export function thumbDate(date) {
  const [y, m, d] = String(date).split('-').map(Number);
  return `${String(y).slice(2)}년 ${m}월 ${d}일 (${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
}
