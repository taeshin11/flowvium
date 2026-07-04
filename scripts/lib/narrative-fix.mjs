// scripts/lib/narrative-fix.mjs
// 내러티브 결정적 corrector (단일 source of truth — 생성기 + patch-narrative 공용).
//   "제일 정확한 방법"(2026-06-16 사용자): 지수/종목 등락%를 *실제 일간등락과 대조*해 환각만 제거하고
//   진짜 등락은 보존(무차별 strip 아님). 그 외 기계환각(커브 bp·오타·라틴·% 자금흐름)은 치환/삭제.
//   산문 LLM 재작성 없음 — 토큰 단위 안전 교정만.

const INDEX_ALIASES = [
  { key: 'KOSPI', re: '(?:KOSPI|코스피)' },
  { key: 'KOSDAQ', re: '(?:KOSDAQ|코스닥)' },
  { key: 'S&P500', re: '(?:S&P\\s?500|S&P|에스앤피|S&amp;P500)' },
  { key: 'Nasdaq', re: '(?:Nasdaq|NASDAQ|나스닥)' },
];
const TOL = 0.7; // %p — 일간 지수등락은 정밀, 0.7%p 초과 괴리 = 환각

// 실시간 지수 일간등락 fetch (KOSPI/KOSDAQ/S&P500/Nasdaq) — patch 등 standalone 용. {key: chgPct}.
export async function fetchIndexChangeMap() {
  const specs = [['KOSPI', '^KS11'], ['KOSDAQ', '^KQ11'], ['S&P500', '^GSPC'], ['Nasdaq', '^IXIC']];
  const one = async (sym) => {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) });
      if (!res.ok) return null;
      const r = (await res.json())?.chart?.result?.[0];
      const closes = (r?.indicators?.quote?.[0]?.close ?? []).filter((c) => c != null && c > 0);
      const live = r?.meta?.regularMarketPrice;
      if (live != null && live > 0) closes.push(live);
      if (closes.length < 2) return null;
      return (closes[closes.length - 1] / closes[closes.length - 2] - 1) * 100;
    } catch { return null; }
  };
  const map = {};
  await Promise.all(specs.map(async ([key, sym]) => { const v = await one(sym); if (v != null) map[key] = v; }));
  return map;
}

// 단일 문자열 필드 교정. indexMap={key:chgPct}, stockChgMap={ticker|name: chgPct}, realBp=실 금리커브 bp,
//   fedNextLabel=차기 FOMC label(예 "Jul 30") — "금리 동결(N%)" 에 차기 회의 날짜 주입.
function fixField(s, { realBp = null, indexMap = {}, stockChgMap = {}, fedNextLabel = null } = {}) {
  if (typeof s !== 'string' || !s) return s;
  let t = s;

  // (a) 금리곡선 bp → 실 bp (괄호 유무 무관). 검출(verify-report curve_slope_halluc)과 *동일 변형* 커버 —
  //   "금리곡선/금리커브" 뿐 아니라 "수익률 곡선"·"커브" 단독도(검출만 되고 교정 안 돼 6회 재발하던 버그, 2026-06-18).
  if (realBp != null) t = t.replace(/((?:금리\s*(?:곡선|커브)|수익률\s*곡선|커브)[^0-9%.]{0,14}?)([+-]?\d{1,3})(\s*bp)/g, `$1${realBp}$3`);

  // (a2) FedWatch 동결확률에 차기 FOMC 날짜 주입(2026-06-19): "금리 동결(98%)" 가 끝난 회의로 오독되지 않게
  //   "차기 FOMC(날짜) 동결 98%" 로. 이미 FOMC/차기/날짜 수식이 앞 25자에 있으면 건드리지 않음(중복 방지).
  if (fedNextLabel) {
    t = t.replace(/(연준의?\s*)?(?:금리\s*)?동결\s*\(?\s*(\d{1,3})\s*%\s*\)?/g, (full, lead, n, offset, str) => {
      const before = str.slice(Math.max(0, offset - 25), offset);
      if (/FOMC|차기|FOMC|\d{1,2}월|\bJul\b|\bAug\b|\bSep\b|\bOct\b|\bNov\b|\bDec\b|\bJan\b|\bFeb\b|\bMar\b|\bApr\b|\bMay\b|\bJun\b/.test(before)) return full;
      return `${lead ?? ''}차기 FOMC(${fedNextLabel}) 동결 ${n}%`;
    });
  }

  // (b) 오타/표기
  t = t.replace(/나스다크/g, '나스닥').replace(/콘텡고|콘텐고|콘탕고|컨텐고|컨티아고|컨텐코/g, '콘탱고');

  // (c) 라틴 bleed (알려진 매핑만)
  t = t.replace(/스que이즈/g, '스퀴즈').replace(/스퀴이즈/g, '스퀴즈');

  // (d) 자금흐름 % 환각 제거 (흐름은 원 금액으로만 근거화 — % 표기는 수익률둔갑/순수환각)
  t = t.replace(/\d{1,2}(?:\.\d)?\s*%\s*(유입|순매수)/g, '$1');
  t = t.replace(/(유입|순매수)[^.,]{0,12}?\d{1,2}(?:\.\d)?\s*%(?:로|까지|으로)?\s*(확대|증가|상승)/g, '$1 $2');

  // (e) 지수 등락% 실값 대조 — 환각만 제거(진짜 등락 보존). 실값 알 때만 판정(증거 없이 삭제 금지).
  const off = (key, claim) => { const real = indexMap[key]; return real != null && Math.abs(claim - real) > TOL; };
  for (const a of INDEX_ALIASES) {
    for (const b of INDEX_ALIASES) {
      if (a.key === b.key) continue;
      // 쌍 형태: "A과 B는 각각 X%, Y% 상승/하락"
      const pair = new RegExp(`(${a.re}\\s*(?:과|와|및|,|·)\\s*${b.re}[^.]{0,16}?)각각\\s*([+-]?\\d+\\.?\\d*)\\s*%\\s*[,，]?\\s*및?\\s*([+-]?\\d+\\.?\\d*)\\s*%(\\s*(?:상승|하락|올라|내려))`, 'g');
      t = t.replace(pair, (m, pre, x, y, dir) => (off(a.key, parseFloat(x)) || off(b.key, parseFloat(y))) ? `${pre}${dir.trim()}` : m);
    }
    // 단일 형태: "A ... X% 상승/하락/급등/급락"
    const single = new RegExp(`(${a.re}[^.]{0,10}?)([+-]?\\d+\\.?\\d*)\\s*%(\\s*(?:상승|하락|올라|내려|급등|급락))`, 'g');
    t = t.replace(single, (m, pre, x, dir) => off(a.key, parseFloat(x)) ? `${pre}${dir.trim()}` : m);
  }

  // (f) 개별종목 등락% 실값 대조 (best-effort — name/ticker→chgPct 있을 때만)
  for (const [name, real] of Object.entries(stockChgMap)) {
    if (real == null || !name) continue;
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(${esc}[은는이가]?[^.]{0,8}?)([+-]?\\d+\\.?\\d*)\\s*%(\\s*(?:상승|하락|올라|내려|급등|급락))`, 'g');
    t = t.replace(re, (m, pre, x, dir) => Math.abs(parseFloat(x) - real) > 1.5 ? `${pre}${dir.trim()}` : m);
  }

  return t;
}

// ── 전역 문자열 sanitizer (2026-06-16 페이지 전수감사) — 렌더 텍스트 garble 은 빌드지점마다 흩어져
//   있어 필드별 교정이 누락됨(이중마이너스 "매출 --4.9%"·orphan "원 +46% YoY"·콘탱고변종·한자 누출).
//   *모든* 문자열 필드를 deep-walk 하며 산문 의미 안 바꾸는 기계적 garble 만 안전 치환.
// 콘탱고 변종 — 한글 변형 + 2026-06-19: latin 혼입형(컨티gio·컨텐go 등, evening 보고서 발간차단 사건). 콘탱고 어근
//   (컨티/컨텐/콘텡/콘텐/콘탕)에 한글/라틴 꼬리가 붙은 깨짐을 통합 정규화 → latin_garble 게이트 차단 방지.
const CONTANGO_VARIANTS = /컨티구오|컨티아고|컨텐고|컨텐코|컨탱고|콘텡고|콘텐고|콘탕고|(?:컨티|컨텐|컨탱|콘텡|콘텐|콘탕)[a-zA-Z]{1,4}/g;  // 2026-07-04: 컨탱고 변형 추가(noon 실증)
// 2026-07-01 (사용자 "한자 나오면 안되 — 차라리 영어"): ko/비-CJK 로케일 리포트의 한자(漢字) bleed 제로톨러런스.
//   국가·통화 등 고빈도는 한글 매핑, 나머지 한자는 스트립. ja/zh 로케일은 한자=정당 콘텐츠라 스킵.
//   (노드 antibleed 는 한자병기 *보존*(의료문서) — FlowVium 은 정반대 정책: 한자 전면 차단.)
const HAN_TO_KR = {
  '美': '미국', '中': '중국', '日': '일본', '韓': '한국', '北': '북한', '獨': '독일', '佛': '프랑스', '英': '영국',
  '露': '러시아', '歐': '유럽', '亞': '아시아', '臺': '대만', '台': '대만', '對': '대', '元': '원', '圓': '엔', '兌': '/', '兑': '/',
};
export function sanitizeText(s, locale) {
  if (typeof s !== 'string' || !s) return s;
  let t = s;
  t = t.replace(/-{2,}(\d)/g, '-$1');                                  // "매출 --4.9%" → "-4.9%" (이중부호)
  t = t.replace(/\+{2,}(\d)/g, '+$1');                                 // "++3.1%" → "+3.1%"
  t = t.replace(/(^|[,;·|]\s*)(원|달러)\s+(?=[+\-]?\d+\.?\d*\s*%\s*YoY)/g, '$1매출 '); // orphan 통화단위 → 매출(YoY 문맥)
  t = t.replace(CONTANGO_VARIANTS, '콘탱고');                          // 콘탱고 변종 정규화
  t = t.replace(/스que이즈|스퀴이즈/g, '스퀴즈');                       // 라틴 bleed (알려진)
  // 2026-06-23: "short squeeze" 오역 교정 (로컬모델이 short→'짧은', squeeze→'매수' 로 직역해
  //   "45점 짧은 매수 스퀴즈"·"즉시 짧은 매수 기회" 류 비문 생성 — 사용자 스크린샷 제보).
  t = t.replace(/짧은\s*매수\s*스퀴즈/g, '공매도 스퀴즈');             // "short squeeze" → 공매도 스퀴즈
  t = t.replace(/짧은\s*매수\s*(신호|점수|커버링)/g, '공매도 스퀴즈 $1');
  t = t.replace(/짧은\s*매수\s*기회/g, '숏 스퀴즈 기회');             // "short opportunity" → 숏 스퀴즈 기회
  t = t.replace(/금융\s*크로스/g, '골든크로스');                       // "golden cross" 오역(2026-07-02 judge-chat TSM 실증)
  // 한자 bleed 제거 — ja/zh(한자=정당)는 스킵, 그 외(ko/en/…)는 매핑 후 잔여 스트립(제로톨러런스).
  //   6블록(spinai6 봉합): 부수2E80-2FDF·ExtA 3400-4DBF·Unified 4E00-9FFF·Compat F900-FAFF·ExtB astral 20000-2FA1F.
  //   /u 플래그 필수(astral 보충면). literal 편집=한글삼킴 변질 위험이라 fixer 스크립트로만 수정.
  if (!(locale && /^(ja|zh)/i.test(locale))) {
    const _b0 = t;
    t = t.replace(/[\u2E80-\u2FDF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u{20000}-\u{2FA1F}]/gu, (ch) => HAN_TO_KR[ch] ?? '');
    // 병기 괄호서 한자만 스트립된 잔여 정리(spinai1 _dehanja 콤마청소 차용): '(, foramen)'->'(foramen)', '()'->''
    if (t !== _b0) t = t.replace(/\(\s*,\s*/g, '(').replace(/,\s*\)/g, ')').replace(/\(\s*\)/g, '');
    t = t.replace(/ {2,}/g, ' ').replace(/ +([,.)])/g, '$1');
  }
  t = t.replace(/(\d{1,2}\.?\d*\s*%)\s*유입(된|되)?/g, '$1 상승');       // "16.5% 유입"(수익률) → "16.5% 상승"(ETF 지역카드 등)
  // 2026-07-04 (thesis 품질): 만 단위 이상 억원은 조 표기 — "19922억원" → "1조 9,922억원" (가독성).
  t = t.replace(/([\d,]{5,})\s*억\s*원/g, (m, d) => {
    const n = parseInt(d.replace(/,/g, ''), 10);
    if (!Number.isFinite(n) || n < 10000) return m;
    const jo = Math.floor(n / 10000), eok = n % 10000;
    return eok ? `${jo}조 ${eok.toLocaleString()}억원` : `${jo}조원`;
  });
  return t;
}

// ── thesis 서술 품질 교정기 2종 (2026-07-04 사용자 "thesis 서술 품질 개선") ─────────────────
//
// (A) 등락% 주어 귀속 — noon 실증: EWY(달러표시 한국 ETF) 1w -12.13% 를 LLM 이 "KR 1주 기준 -12.1%"
//     로 무주어 서술 → KOSPI 지수 급락으로 오독. 프롬프트 룰("대상 명시")로 안 막힘 → 결정론 귀속:
//     본문 % 값을 capital-flows 실값(자산/국가/섹터/팩터 ETF ret1w/4w)과 대조, 유일 매치 + 절대값 큰
//     이동(±3%+) + 주변에 해당 ticker 미언급이면 "(EWY·달러 기준)" 주석을 주입해 주어를 복원.
const IDX_EQUIV = { SPY: /S&P\s?500|에스앤피/i, QQQ: /나스닥|Nasdaq/i, DIA: /다우/i }; // 지수명이 이미 주어면 스킵
// 2026-07-04 (사용자 "일반인도 이해하게"): 주석에 한글 설명 — "(EWY·달러 기준)" 은 일반 독자에게 불투명.
const LABEL_KO = { Korea: '한국주식 ETF', US: '미국주식 ETF', Japan: '일본주식 ETF', China: '중국주식 ETF', Germany: '독일주식 ETF', India: '인도주식 ETF', Brazil: '브라질주식 ETF', Taiwan: '대만주식 ETF', Tech: '기술주 ETF', Momentum: '모멘텀 ETF', 'US Equities': '미국주식 ETF', 'Emerging Markets': '신흥국 ETF' };
export function attributePctSubjects(report, pool) {
  if (!Array.isArray(pool) || !pool.length) return { nFix: 0, log: [] };
  let nFix = 0; const log = [];
  const fixOne = (text) => {
    if (typeof text !== 'string' || !text) return text;
    let injected = 0; const annotated = new Set();  // 같은 필드에 같은 티커 주석 1회만 (문맥 승계)
    return text.replace(/([+-]?\d{1,3}\.\d{1,2})\s*%/g, (m, num, offset, str) => {
      if (injected >= 2) return m;
      const v = parseFloat(num);
      if (!Number.isFinite(v) || Math.abs(v) < 3) return m;               // 큰 이동만 (오귀속 리스크 지점)
      const hits = pool.filter((p) => p.values.some((x) => Number.isFinite(x) && Math.abs(x - v) <= 0.06));
      const tickers = [...new Set(hits.map((h) => h.ticker))];
      if (tickers.length !== 1) return m;                                 // 유일 매치만 (모호하면 불개입)
      const tk = tickers[0];
      if (annotated.has(tk)) return m;
      // 같은 문장(마침표 경계) 안 60자 창 — 이미 주어가 있으면 불개입
      const from = Math.max(0, offset - 60, str.lastIndexOf('.', offset) + 1);
      const win = str.slice(from, offset + m.length + 12);
      if (win.includes(tk)) return m;
      if (IDX_EQUIV[tk]?.test(win)) return m;                             // "S&P500 1.4%" 에 (SPY) 주석 불필요
      if (/CPI|금리|확률|동결|YoY|매출|이익|마진|점유율/.test(win)) return m; // 재무/거시 % 문맥 오탐 방지
      if (str.slice(offset + m.length, offset + m.length + 20).includes('기준)')) return m; // 이미 주석됨
      injected++; nFix++; annotated.add(tk);
      const koLabel = LABEL_KO[hits.find((h) => h.ticker === tk)?.label] ?? null;
      const anno = koLabel ? `(미국 상장 ${koLabel} ${tk}·달러 기준)` : `(${tk}·달러 기준)`;
      log.push(`${num}% → ${anno}`);
      return `${m}${anno}`;
    });
  };
  for (const k of ['thesis', 'macroAnalysis']) {
    const b = report[k], a = fixOne(b);
    if (a !== b) report[k] = a;
  }
  return { nFix, log };
}

// (B) thesis↔macroAnalysis 문장 복붙 제거 — noon 실증: thesis 1문장이 macroAnalysis 첫 문장과 사실상
//     동일(히어로 문구가 본문 복사로 보임). thesis(히어로)는 보존, macroAnalysis 쪽 중복 문장을 제거.
//     bigram Dice 유사도 ≥ 0.82 = 복붙 판정. 제거 후 본문이 80자 미만이 되면 불개입(내용 보존 우선).
const _bigrams = (s) => { const n = s.replace(/[^0-9A-Za-z가-힣]/g, ''); const set = new Set(); for (let i = 0; i < n.length - 1; i++) set.add(n.slice(i, i + 2)); return set; };
const _dice = (a, b) => { if (!a.size || !b.size) return 0; let inter = 0; for (const x of a) if (b.has(x)) inter++; return (2 * inter) / (a.size + b.size); };
export function dedupeThesisMacro(report) {
  const thesis = report.thesis, macro = report.macroAnalysis;
  if (typeof thesis !== 'string' || typeof macro !== 'string' || thesis.length < 40) return { nFix: 0 };
  const [body, ...tailParts] = macro.split(' | ');                        // "| 주요지표: ..." 꼬리 보존
  const thesisSents = thesis.split(/(?<=[.!?])\s+/).map(_bigrams).filter((s) => s.size >= 15);
  const sents = body.split(/(?<=[.!?])\s+/);
  const kept = sents.filter((s) => {
    const bg = _bigrams(s);
    if (bg.size < 15) return true;
    return !thesisSents.some((t) => _dice(bg, t) >= 0.82);
  });
  if (kept.length === sents.length) return { nFix: 0 };
  const newBody = kept.join(' ').trim();
  if (newBody.length < 80) return { nFix: 0 };                            // 본문 공동화 방지
  report.macroAnalysis = [newBody, ...tailParts].join(' | ');
  return { nFix: sents.length - kept.length };
}
// 보고서 모든 문자열 필드 deep-walk sanitize. {nFix} 반환 (in-place).
export function sanitizeReport(report, locale) {
  let nFix = 0;
  const walk = (obj) => {
    if (Array.isArray(obj)) { for (let i = 0; i < obj.length; i++) { const v = obj[i]; if (typeof v === 'string') { const f = sanitizeText(v, locale); if (f !== v) { obj[i] = f; nFix++; } } else if (v && typeof v === 'object') walk(v); } }
    else if (obj && typeof obj === 'object') { for (const k of Object.keys(obj)) { const v = obj[k]; if (typeof v === 'string') { const f = sanitizeText(v, locale); if (f !== v) { obj[k] = f; nFix++; } } else if (v && typeof v === 'object') walk(v); } }
  };
  walk(report);
  return { nFix };
}

// riskEvents 중복 중앙은행 이벤트 교정 (2026-06-16: BOJ 이벤트가 FOMC 를 통째 복사 — 예상 3.75%(연준)
//   + 미국반도체 노출. 비-Fed 이벤트가 Fed 의 rate/exposure 를 그대로 쓰면 그 수치/노출을 제거).
export function fixDuplicateCentralBankEvents(report) {
  const evs = report.riskEvents;
  if (!Array.isArray(evs) || evs.length < 2) return { nFix: 0 };
  let nFix = 0;
  const sig = (e) => JSON.stringify([e.estimate, e.exposureChannel, e.affectedPortfolio, e.surpriseHigh, e.surpriseLow]);
  const fed = evs.find((e) => /FOMC|연준|\bFed\b|federal/i.test(`${e.event} ${e.watchFor}`));
  const fedSig = fed ? sig(fed) : null;
  for (const e of evs) {
    if (e === fed) continue;
    const isOtherCB = /BOJ|일본은행|은행보증금|ECB|영란|\bBOE\b|인민은행|PBOC/i.test(`${e.event}`);
    if (!isOtherCB) continue;
    // 다른 중앙은행인데 Fed 와 동일한 estimate/노출/시나리오 → 복사 환각 → US 특정 필드 비움(이벤트명/날짜/watchFor 보존)
    if (fedSig && sig(e) === fedSig) {
      e.estimate = null; e.previous = null; e.exposureChannel = null;
      e.affectedPortfolio = []; e.surpriseHigh = null; e.surpriseLow = null;
      nFix++;
    }
  }
  return { nFix };
}

// 보고서 전체 내러티브 필드 교정. {report, nFix, log} 반환.
export function correctNarrative(report, opts = {}) {
  const realBp = opts.realBp ?? (() => {
    const sp = report.marketVerdict?.analog?.fingerprint?.curveSlopePp ?? report.marketVerdict?.analog?.macroContext?.curveSlopePp;
    return sp != null ? Math.round(sp * 100) : null;
  })();
  const o = { realBp, indexMap: opts.indexMap ?? {}, stockChgMap: opts.stockChgMap ?? {}, fedNextLabel: opts.fedNextLabel ?? null };
  let nFix = 0; const log = [];
  for (const k of ['thesis', 'macroAnalysis', 'technicalAnalysis', 'fundamentalAnalysis', 'topOpportunity', 'hedgingSuggestion']) {
    const b = report[k], a = fixField(b, o);
    if (a !== b) { report[k] = a; nFix++; log.push(k); }
  }
  if (report.marketNarrative) for (const k of ['why', 'story', 'watch']) {
    const b = report.marketNarrative[k], a = fixField(b, o);
    if (a !== b) { report.marketNarrative[k] = a; nFix++; log.push(`narrative.${k}`); }
  }
  return { report, nFix, log, realBp };
}
