/**
 * market-brief.mjs — 매일 시장 요약 롱폼의 순수 규칙. 근거는 market-brief.test.mjs 머리말.
 *   판(edition): 'us'   = 아침(KST 07시대) 미국 증시 요약 — 전날 뉴욕 마감 + 오늘 일정
 *               'kreu' = 미국 개장 1시간 전 한국·유럽 증시 요약 — 오늘 한국 마감·유럽 장중 + 오늘 밤 일정
 *               'krmid' = 점심(12:00 공개) 한국 증시 오전 요약 — 장중 숫자 + 오전장 기사 (사장님 10/23 "점심시간·퇴근시간")
 *               'krclose' = 퇴근길(18:00 공개) 한국 증시 마감 요약 — 마감 숫자 + 마감 기사
 */
import { adVersionFor } from './ad-line.mjs';
import { ungroundedNumbers } from './weekly-explainer.mjs';

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
    indices: ['KOSPI', 'KOSDAQ', '.STOXX50E', '.GDAXI', '.FTSE', '.FCHI'], required: ['KOSPI', 'KOSDAQ'], afterKst: '15:20',
    articles: /(코스피|코스닥).*마감|마감.*(코스피|코스닥)|\[외환\]|유럽\s*증시|\[특징주\].*마감|마감시황/,
  },
  krmid: {
    label: '한국 증시 오전 요약', badge: ['FLOWVIUM', '한국 증시 오전'],
    indices: ['KOSPI', 'KOSDAQ'], required: ['KOSPI', 'KOSDAQ'], live: true,
    // 오전장 정리 기사(10/22 실측: "코스피, 2% 넘게 내리며 5,600선 공방…" 11:30). 마감 기사는 아직 없다 — 있으면 어제 것이다.
    articles: /^(?!.*마감).*((코스피|코스닥).*(출발|공방|장중|오전|상승세|하락세|강세|약세|낙폭|상승폭|반등|급락|급등)|\[외환\])/,
  },
  krclose: {
    label: '한국 증시 마감 요약', badge: ['FLOWVIUM', '한국 증시 마감'],
    // 10/23 한국·유럽판을 없애며 유럽 지수 숫자(장중)를 여기 싣는다 — 이유 기사가 없어 숫자만(ChatGPT·Claude 검토).
    indices: ['KOSPI', 'KOSDAQ', '.STOXX50E', '.GDAXI', '.FTSE', '.FCHI'], required: ['KOSPI', 'KOSDAQ'], afterKst: '15:20',
    articles: /(코스피|코스닥).*마감|마감.*(코스피|코스닥)|\[외환\].*마감|\[특징주\].*마감|마감시황|(코스피|코스닥).*\(종합\)/,
  },
};
/** 판마다 공개 시각(KST). null = 다 만들면 바로 공개. */
const PUBLISH_KST = { krmid: '12:00', krclose: '18:00' };
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

/** 판의 공개 시각(ms). 한국·유럽판 = 미국 개장 1시간 전, 오전판 12:00, 마감판 18:00, 미국판 null(바로). */
export function publishTargetMs(edition, dateKst) {
  if (edition === 'kreu') return usOpenKst(dateKst).ms - 3600e3;
  const hm = PUBLISH_KST[edition];
  return hm ? Date.parse(`${dateKst}T${hm}:00+09:00`) : null;
}

/** 이 시각에 이 판을 만들어도 되나. 러너가 놓친 잡을 아무 때나 소급하므로(startupCatchup) 스크립트가 직접 막는다. */
export function inWindow(edition, nowMs) {
  const hm = kstHHMM(nowMs);
  if (edition === 'us') return hm >= '06:30' && hm < '11:00' ? { ok: true } : { ok: false, why: `KST ${hm} — 미국판은 06:30~11:00 에만` };
  if (edition === 'krmid') return hm >= '11:20' && hm < '13:30' ? { ok: true } : { ok: false, why: `KST ${hm} — 오전판은 11:20~13:30 에만` };
  if (edition === 'krclose') return hm >= '16:20' && hm < '19:30' ? { ok: true } : { ok: false, why: `KST ${hm} — 마감판은 16:20~19:30 에만` };
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
    // 오전판은 장중 숫자로 만든다 — 이미 마감이면(조기 마감·소급 실행) 오전 요약이 아니다.
    if (EDITIONS[edition].live ? q.closed : !q.closed) return { ok: false, why: `${INDEX_NAMES[code] ?? code} ${q.closed ? '이미 마감' : '아직 장중'}` };
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
  const { articles: re, afterKst } = EDITIONS[edition];
  // 한국 마감 기사는 그날 장이 끝난 뒤에 나온 것만(10/21: 아침 "[마켓뷰] …뉴욕증시 혼조 마감…코스피 향방은" 이 '마감' 낱말로 들어왔다).
  const late = (r) => !afterKst || kstHHMM(Date.parse(r.captured_at)) >= afterKst;
  const keyOf = (r) => { const h = String(r.headline ?? '').replace(/\s+/g, ''); const c = h.indexOf(',');
    return `${r.source ?? ''}|${c > 0 && c <= 8 ? h.slice(0, c) : h.slice(0, 14)}`; };
  const by = new Map();
  for (const r of rows ?? []) {
    const h = String(r.headline ?? '');
    if (!re.test(h) || /^\s*\[(속보|스팟)\]/.test(h) || !late(r)) continue;
    const k = keyOf(r); const prev = by.get(k);
    if (!prev || String(r.captured_at) > String(prev.captured_at)) by.set(k, r);
  }
  return [...by.values()].sort((a, b) => String(b.captured_at).localeCompare(String(a.captured_at)));
}

/** 제목·화면 꼬리 — 다룬 장(시장·시점). 검색어("미국 증시"·"한국 증시")를 그대로 둔다. */
export const SESSION_LABEL = { us: '미국 증시 마감', kreu: '한국·유럽 증시', krmid: '한국 증시 오전', krclose: '한국 증시 마감' };
const SHORT = { '.INX': 'S&P500', '.IXIC': '나스닥', '.DJI': '다우', '.SOX': '반도체', KOSPI: '코스피', KOSDAQ: '코스닥' };

/** 그날 가장 크게 움직인 지수 한 줄("반도체 -6.7%") — 제목 맨 앞·썸네일 큰 숫자. 유럽 지수(짧은 이름 없음)는 고르지 않는다. */
export function headlineMove(quotes) {
  const qs = (quotes ?? []).filter((q) => SHORT[q?.code] && Number.isFinite(q?.pct));
  if (!qs.length) return null;
  const q = qs.reduce((a, b) => (Math.abs(b.pct) > Math.abs(a.pct) ? b : a));
  const arrow = q.pct > 0 ? '▲' : q.pct < 0 ? '▼' : '';
  const signed = (x) => `${SHORT[x.code]} ${x.pct > 0 ? '+' : x.pct < 0 ? '-' : ''}${Math.abs(x.pct).toFixed(1)}%`;
  // 코스피·코스닥이 엇갈린 날(한쪽 오름·한쪽 내림)은 제목 숫자에 둘 다 — 10/23 마감판이 코스피 상승을 빼 '증시 급락' 처럼 읽혔다(agy).
  const kp = qs.find((x) => x.code === 'KOSPI'); const kq = qs.find((x) => x.code === 'KOSDAQ');
  const mixed = kp && kq && Math.sign(Number(kp.pct.toFixed(1))) * Math.sign(Number(kq.pct.toFixed(1))) < 0;
  return { code: q.code, pct: q.pct, up: q.pct > 0, chip: `${SHORT[q.code]} ${arrow}${Math.abs(q.pct).toFixed(1)}%`, text: mixed ? `${signed(kp)}·${signed(kq)}` : signed(q) };
}

/** 거래 시각(현지 시각대가 붙은 ISO) → 한국 시각 "HH:MM". 없으면 ''. 유럽 현지 시각을 그대로 읽으면 7~8시간 틀린다. */
export function kstClock(at) {
  const ms = Date.parse(at ?? '');
  return Number.isFinite(ms) ? kstHHMM(ms) : '';
}

/** "10/22(목)" — 다룬 장의 날짜. */
export function shortDay(day) {
  const [y, m, d] = String(day).split('-').map(Number);
  return `${m}/${d}(${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
}

/**
 * "반도체 -6.7%, {핵심} | 10/22(목) 미국 증시 마감" — 100자 안.
 * 2026-10-23 사장님 "너무 오선을 따라한 형태다": 레퍼런스 머리 【…요약】 를 버리고 숫자를 맨 앞에(agy·Claude 검토 일치).
 * 날짜는 다룬 장의 날짜(미국판은 뉴욕 날짜) — 올린 날(한국 날짜)이 아니다.
 */
export function briefTitle({ edition, move, hook, day }) {
  const head = move?.text ? `${move.text}, ` : '';
  const tail = ` | ${shortDay(day)} ${SESSION_LABEL[edition]}`;
  let h = String(hook ?? '').replace(/#\S+/g, '').replace(/\s{2,}/g, ' ').replace(/[?？!]+$/, '').trim();
  const room = 100 - head.length - tail.length;
  if (h.length > room) h = `${h.slice(0, room - 1)}…`;
  return `${head}${h}${tail}`;
}

/** 썸네일 날짜 띠 "26년 10월 22일 (목)" (레퍼런스 꼴). */
export function thumbDate(date) {
  const [y, m, d] = String(date).split('-').map(Number);
  return `${String(y).slice(2)}년 ${m}월 ${d}일 (${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
}

/**
 * 사진을 장(章)에 하나씩만 나눈다 — 같은 사진이 여러 장에 뜨지 않게(10/23 시험 렌더: 마감 종합 기사의 트레이더 사진이
 * 반도체·국제유가 장에 모두 떴다. 세 장이 같은 마감 기사를 인용했기 때문). 그 장을 위해 찾은 사진(forCi)이 먼저 자리를 잡고,
 * 공용 사진은 장 순서대로 처음 인용한 장이 갖는다. 사진이 안 남은 장은 부르는 쪽이 제목 카드로 둔다.
 * @param {Map<number, object[]>} allowed 장 번호 → 대조를 통과한 사진들
 * @param {number[]} order 장 번호(화면 순서)
 */
export function claimPhotos(allowed, order) {
  const owner = new Map();
  for (const ci of order) for (const m of allowed.get(ci) ?? []) if (m.forCi === ci && !owner.has(m)) owner.set(m, ci);
  for (const ci of order) for (const m of allowed.get(ci) ?? []) if (!owner.has(m)) owner.set(m, ci);
  const out = new Map();
  for (const ci of order) out.set(ci, (allowed.get(ci) ?? []).filter((m) => owner.get(m) === ci).sort((a, b) => (b.forCi === ci) - (a.forCi === ci)));
  return out;
}

/**
 * '오늘 체크' 2~3개(10/23 ChatGPT·agy). 화면과 낭독이 같은 것을 말하도록 렌더 전에 고른다.
 * 순서: 중요도 High → 미국(한국 시청자) → 이른 시각. 같은 시각·같은 나라는 하나만(10/23 오전판: 프랑스 PMI 둘을 "같은 시각인 …" 으로 읽었다).
 * 실적은 시총 가장 큰 1곳(부르는 쪽이 정렬해 준다). 결과는 지표 시각 순 + 실적.
 */
export function pickCalendar(econ, earn) {
  const rank = (e) => [e.impact === 'High' ? 0 : 1, e.country === '미국' ? 0 : 1, e.ms];
  const cmp = (a, b) => { const x = rank(a); const y = rank(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
  const want = (earn ?? []).length ? 2 : 3;
  const seen = new Set(); const out = [];
  for (const e of [...(econ ?? [])].sort(cmp)) {
    const k = `${e.ms}|${e.country}`;
    if (seen.has(k)) continue;
    seen.add(k); out.push(e);
    if (out.length === want) break;
  }
  return [...out.sort((a, b) => a.ms - b.ms).map((e) => ({ kind: 'econ', ...e })), ...(earn ?? []).slice(0, 1).map((x) => ({ kind: 'earn', ...x }))];
}

/**
 * 끝 광고(가로 긴 버전, scripts/video/make-brief-ads) — 올린 롱폼 수로 aisvi/flowvium 번갈아. 사장님 10/23
 * "롱폼 맨끝에 플로븀, 에이스비 광고 번갈아 붙여라 마찬가지로 쇼츠처럼" · "롱폼에서는 광고 설명 긴버젼으로".
 */
/** 2026-10-31 사장님(Mac mini2 경유): 한국어 AISVI 광고 교체 — 카톡 무료체험 v16 짧은 판(세로 2.5초, ots-9e 공용 파일)을
 *  가로 1920x1080 가운데에 그 광고 바탕색(#0b1c3f)으로 둔 판. 롱폼은 끝 광고를 scale=1920:1080 으로 다시 구우니 세로를 그대로 주면 늘어난다. */
export const AISVI_BRIEF_AD = 'assets/outro/brief-ad-aisvi-kakao-v16.mp4';
export const BRIEF_ADS = { aisvi: 'assets/outro/brief-ad-aisvi.mp4', flowvium: 'assets/outro/brief-ad-flowvium.mp4' };
export function briefPromo(history, { exists }) {
  const n = (history ?? []).filter((h) => h?.id).length;
  const want = n % 2 === 0 ? 'aisvi' : 'flowvium';
  // 2026-10-28 AISVI 광고 새 판(lib/ad-line, IR 세션·Mac mini2 경유): 끝 카드는 2.5초 한 줄 — aisvi 차례마다 판 a→b→c.
  //   (10/23 '긴 버전'은 이 지시로 바뀌었다. 판 카드가 없으면 옛 긴 광고.) 설명란 링크도 같은 판(make-market-brief 가 넘긴다).
  if (want === 'aisvi') {
    const version = adVersionFor(Math.floor(n / 2));
    if (exists(AISVI_BRIEF_AD)) return { name: 'aisvi', path: AISVI_BRIEF_AD, fallback: false, version };
    const card = `assets/outro/brief-card-aisvi-${version}.mp4`;
    if (exists(card)) return { name: 'aisvi', path: card, fallback: false, version };
  }
  for (const name of [want, want === 'aisvi' ? 'flowvium' : 'aisvi']) if (exists(BRIEF_ADS[name])) return { name, path: BRIEF_ADS[name], fallback: name !== want };
  return { name: null, path: null, fallback: false };
}

/**
 * 마감판(afterKst 가 있고 장중판이 아닌 판)의 등락률(%)·주가(원, 억·조 금액 말고)는 장 끝난 뒤 근거(lateCorpus)에 있어야 한다.
 * 10/23 첫 마감판: "삼성E&A … 6.5% 급등했습니다" — 아침 10시 [특징주] 기사의 장중 숫자였다(실제 마감 +7.22%).
 * 돌려주는 것: 장 끝난 뒤 근거에 없는 등락률·주가(없으면 빈 배열).
 */
export function staleMoves(sentence, { lateCorpus }) {
  return ungroundedNumbers(sentence, lateCorpus).filter((raw) => { const r = raw.replace(/\s+/g, ''); return /%$/.test(r) || (/원$/.test(r) && !/[억조]/.test(r)); });
}
/** 이 기사가 그 판의 '장 끝난 뒤' 근거인가. afterKst 없는 판(미국판)은 모두, 장중판은 해당 없음(true). */
export function isLateDoc(edition, capturedAt) {
  const { afterKst, live } = EDITIONS[edition] ?? {};
  return live || !afterKst || kstHHMM(Date.parse(capturedAt)) >= afterKst;
}
/**
 * 썸네일 사진. 마감판은 장 끝난 뒤 기사(isLateDoc)에서 나온 사진만 — 10/23 오전 기사 사진 속 시세판(KOSPI ▼3.07%)이
 * +0.30% 로 끝난 날 마감판 썸네일에 나갔다. 사진 속 숫자는 못 읽으니 출처 기사 시각으로 거른다. 없으면 null(사진 없이).
 * candidates: [{ file, doc }] (doc = docs 번호, 기사 밖에서 찾은 사진은 -1). 장중판·미국판은 첫 사진.
 */
export function thumbPhoto(edition, candidates, docs) {
  const { afterKst, live } = EDITIONS[edition] ?? {};
  const list = candidates ?? [];
  if (live || !afterKst) return list[0] ?? null;
  return list.find((c) => c.doc >= 0 && docs[c.doc] && isLateDoc(edition, docs[c.doc].captured_at)) ?? null;
}
