/**
 * index-level-check.mjs — 내러티브에 적힌 지수 절대레벨을 실측과 대조한다.
 *
 * 왜 바꿨나(2026-08-23): 종전 stripFabricatedIndexLevels 는 KOSPI/KOSDAQ 뒤의
 *   콤마형 숫자를 **무조건 지웠다**. 근거 주석(2026-06-17)은
 *     "^KS11 피드는 절대 지수레벨을 공급 안 함 → 콤마형 절대값은 100% 환각"
 *   이었는데 **그 전제가 사실이 아니다.** 실측: ^KS11 regularMarketPrice = 6912.95,
 *   ^KQ11 = 801.94, ^GSPC = 7674.37. 모델이 쓴 6,913 은 반올림해서 정확히 일치했다.
 *
 *   더구나 같은 파이프라인이 그 값을 프롬프트에 직접 넣고
 *     `※지수 절대레벨은 위 [Index Levels] 수치만 그대로 인용하라`
 *   라고 시킨다. 모델은 시킨 대로 인용했고, 후처리가 지웠고, 그 삭제가 모델의 환각으로
 *   기록됐다(narrative_garble_sanitized 주 53건). 이 유형은 harness_ 접두어가 없어
 *   **실제로 다음 프롬프트에 주입된다** — "이 garble 반복 금지: KOSPI 6,913".
 *   인용하라고 시키고, 인용하면 지우고, 지운 걸 하지 말라고 가르치는 닫힌 모순이었다.
 *
 * 방향: 실측이 있으면 대조한다 — 맞으면 그대로 두고, 틀리면 실측으로 고친다.
 *   실측이 없을 때만 지운다(확인 불가한 숫자는 싣지 않는다).
 *   저장소에 이미 같은 관용구가 있다(reconcileSqueeze: "실측이 있으면 실측으로 덮고,
 *   실측에 없는 티커는 확인 불가라 뺀다").
 *
 * 지수명에 **바로 붙은** 숫자만 본다. 문장 어딘가의 콤마 숫자(예: "외국인 1,493억 원")까지
 *   건드리면 실데이터를 파괴한다 — 그건 지수레벨인지 판별할 근거가 없다.
 */

/** 표기 라벨 ↔ 실측 map 키. 한글 표기도 같은 지수를 가리킨다. */
const ALIAS = {
  KOSPI: 'KOSPI', 코스피: 'KOSPI',
  KOSDAQ: 'KOSDAQ', 코스닥: 'KOSDAQ',
  'S&P500': 'S&P500', Nasdaq: 'Nasdaq', 나스닥: 'Nasdaq',
};
/** 라벨별 표기 소수자리 — buildIndexLevelsBlock 의 specs 와 같은 규칙. */
const DECIMALS = { KOSPI: 0, KOSDAQ: 1, 'S&P500': 0, Nasdaq: 0 };

const NAMES = Object.keys(ALIAS).map((k) => k.replace(/[&]/g, '\\$&')).join('|');
const RE = new RegExp(`(${NAMES})(\\s*)([0-9]{1,2},[0-9]{3}(?:\\.[0-9]+)?)`, 'g');

/** 반올림 오차는 불일치가 아니다: 6,913 vs 6912.95. 그 위는 의미 있는 차이로 본다. */
function matches(claimed, actual) {
  return Math.abs(claimed - actual) <= Math.max(0.5, Math.abs(actual) * 0.0002);
}

function fmt(n, label) {
  const dec = DECIMALS[label] ?? 0;
  return n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

/**
 * @param {string} s 내러티브 문자열
 * @param {Record<string, number>} levels 실측 지수레벨 (label → 절대값). 없으면 {}.
 * @returns {{text:string, fixes:string[]}}
 */
export function reconcileIndexLevels(s, levels = {}) {
  if (typeof s !== 'string' || !s) return { text: s, fixes: [] };
  const fixes = [];
  const text = s.replace(RE, (_m, name, gap, num) => {
    const label = ALIAS[name];
    const actual = levels?.[label];
    const claimed = parseFloat(String(num).replace(/,/g, ''));
    if (!Number.isFinite(actual) || actual <= 0) {
      // 실측 없음 → 확인 불가. 지수명만 남긴다(문장은 유지된다).
      fixes.push(`${label} ${num} → strip(실측 없음)`);
      return name;
    }
    if (matches(claimed, actual)) return `${name}${gap}${num}`;   // 맞다 — 건드리지 않는다
    const corrected = fmt(actual, label);
    fixes.push(`${label} ${num} → ${corrected}(실측)`);
    return `${name}${gap}${corrected}`;
  });
  return { text, fixes };
}

/**
 * 리포트 전체의 내러티브 필드에 적용. 종전 stripFabricatedIndexLevels 의 자리를 대신한다.
 * @returns {{fixes:string[]}} 무엇을 어떻게 바꿨는지 — 조용히 넘어가지 않는다.
 */
export const NARRATIVE_FIELDS = ['thesis', 'macroAnalysis', 'technicalAnalysis', 'fundamentalAnalysis',
                                 'topOpportunity', 'hedgingSuggestion', 'portfolioRiskNote'];
export const NARRATIVE_SUBFIELDS = ['why', 'story', 'watch', 'sessionNote'];

export function reconcileReportIndexLevels(report, levels = {}) {
  const fixes = [];
  const apply = (v) => {
    const r = reconcileIndexLevels(v, levels);
    fixes.push(...r.fixes);
    return r.text;
  };
  for (const f of NARRATIVE_FIELDS) if (report?.[f]) report[f] = apply(report[f]);
  if (report?.marketNarrative && typeof report.marketNarrative === 'object') {
    for (const f of NARRATIVE_SUBFIELDS) {
      if (report.marketNarrative[f]) report.marketNarrative[f] = apply(report.marketNarrative[f]);
    }
  }
  return { fixes };
}

/**
 * 발간 게이트용 판정 — 내러티브에 적힌 지수레벨이 실측과 어긋나는가.
 *
 * 2026-08-23~24 사고: 후처리(reconcileIndexLevels)는 실측 대조로 바꿨는데 발간 게이트
 *   (verify-report.mjs index_value_fabrication)는 옛 전제("피드가 절대값을 공급 안 함 →
 *   전부 환각")를 그대로 써서 **맞는 값을 환각으로 보고 발간을 30시간 막았다**(6회 중 5회).
 *   생산자만 바꾸고 소비처를 확인하지 않은 내 잘못이다. 그래서 판정을 여기 하나로 모은다 —
 *   게이트와 후처리가 같은 함수를 쓰면 갈릴 수가 없다.
 *
 * 연도(19xx/20xx)·상대표현(일선/%/p/pt) 인접은 지수레벨이 아니다(기존 게이트 예외 보존).
 *
 * @param {string} text  내러티브 전체
 * @param {Record<string, number>} levels 생성 시점 실측 레벨
 * @returns {{label:string, claimed:number, actual:number|null, raw:string, unverifiable:boolean}|null}
 *          null = 문제 없음. unverifiable=true = 실측이 없어 확인 불가(단정하지 않는다).
 */
export function detectIndexLevelMismatch(text, levels = {}) {
  if (typeof text !== 'string' || !text) return null;
  const RE_G = new RegExp(`(${NAMES})\\s*([0-9]{1,2},[0-9]{3}(?:\\.[0-9]+)?|[0-9]{4}(?:\\.[0-9]+)?)(?!\\s*(일|%|p\\b|년|pt|선))`, 'g');
  for (const m of text.matchAll(RE_G)) {
    const label = ALIAS[m[1]];
    const claimed = parseFloat(String(m[2]).replace(/,/g, ''));
    if (!Number.isFinite(claimed) || claimed < 100) continue;
    if (claimed >= 1990 && claimed <= 2099 && !String(m[2]).includes(',')) continue;   // 연도
    const actual = levels?.[label];
    if (!Number.isFinite(actual) || actual <= 0) {
      return { label, claimed, actual: null, raw: m[0], unverifiable: true };
    }
    if (!matches(claimed, actual)) {
      return { label, claimed, actual, raw: m[0], unverifiable: false };
    }
  }
  return null;
}
