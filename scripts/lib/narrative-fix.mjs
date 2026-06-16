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

// 단일 문자열 필드 교정. indexMap={key:chgPct}, stockChgMap={ticker|name: chgPct}, realBp=실 금리커브 bp.
function fixField(s, { realBp = null, indexMap = {}, stockChgMap = {} } = {}) {
  if (typeof s !== 'string' || !s) return s;
  let t = s;

  // (a) 금리곡선 bp → 실 bp (괄호 유무 무관)
  if (realBp != null) t = t.replace(/(금리\s*(?:곡선|커브)[^.]{0,12}?)([+-]?\d{1,3})(\s*bp)/g, `$1${realBp}$3`);

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
const CONTANGO_VARIANTS = /컨티구오|컨티아고|컨텐고|컨텐코|콘텡고|콘텐고|콘탕고/g;
export function sanitizeText(s) {
  if (typeof s !== 'string' || !s) return s;
  let t = s;
  t = t.replace(/-{2,}(\d)/g, '-$1');                                  // "매출 --4.9%" → "-4.9%" (이중부호)
  t = t.replace(/\+{2,}(\d)/g, '+$1');                                 // "++3.1%" → "+3.1%"
  t = t.replace(/(^|[,;·|]\s*)(원|달러)\s+(?=[+\-]?\d+\.?\d*\s*%\s*YoY)/g, '$1매출 '); // orphan 통화단위 → 매출(YoY 문맥)
  t = t.replace(CONTANGO_VARIANTS, '콘탱고');                          // 콘탱고 변종 정규화
  t = t.replace(/스que이즈|스퀴이즈/g, '스퀴즈');                       // 라틴 bleed (알려진)
  t = t.replace(/元/g, '원').replace(/兑|兌/g, '/');                    // 한자 bleed (元→원, 兑→/)
  t = t.replace(/(\d{1,2}\.?\d*\s*%)\s*유입(된|되)?/g, '$1 상승');       // "16.5% 유입"(수익률) → "16.5% 상승"(ETF 지역카드 등)
  return t;
}
// 보고서 모든 문자열 필드 deep-walk sanitize. {nFix} 반환 (in-place).
export function sanitizeReport(report) {
  let nFix = 0;
  const walk = (obj) => {
    if (Array.isArray(obj)) { for (let i = 0; i < obj.length; i++) { const v = obj[i]; if (typeof v === 'string') { const f = sanitizeText(v); if (f !== v) { obj[i] = f; nFix++; } } else if (v && typeof v === 'object') walk(v); } }
    else if (obj && typeof obj === 'object') { for (const k of Object.keys(obj)) { const v = obj[k]; if (typeof v === 'string') { const f = sanitizeText(v); if (f !== v) { obj[k] = f; nFix++; } } else if (v && typeof v === 'object') walk(v); } }
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
  const o = { realBp, indexMap: opts.indexMap ?? {}, stockChgMap: opts.stockChgMap ?? {} };
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
