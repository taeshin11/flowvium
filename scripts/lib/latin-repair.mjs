// scripts/lib/latin-repair.mjs — 한글 내 로마자 누출(latin_bleed/garble) 자가복구 (2026-06-19).
//
// 발생 경위: Qwen3 가 산발적으로 한글 단어에 로마자 조각을 섞어 출력(포osi가=포지션, 인fra=인프라,
//   스queeze=스퀴즈, cility=facility). sanitizeText 는 하드코딩 1건("스que이즈")만 고쳐, *새* 누출마다
//   pre-publish gate(latin_bleed/latin_garble)가 보고서 *전체* 발간을 차단 → 라이브가 stale(06-19
//   morning/midnight 둘 다 차단돼 9h+ 어제 보고서 고착). detector(gate)는 있는데 일반 corrector 가
//   없던 dead-end 사각지대. 로컬 vLLM 으로 *누출 필드만* targeted 재작성해 corrector 를 채운다.
//
// 안전장치: 재작성 결과가 (1) 누출이 줄고 (2) 길이 ±40% 이내 (3) 원문의 *모든 숫자 토큰 보존* 일 때만
//   채택(숫자 환각·엉뚱한 재작성 차단). 실패 시 미채택 → gate 가 계속 차단(안전 우선, 오염 발행 안 함).

// pre-publish gate(verify-report)가 latin 을 검사하는 koFields 와 동일 집합 + 시각적 내러티브 보강.
const GATE_FIELDS = ['thesis', 'macroAnalysis', 'technicalAnalysis', 'fundamentalAnalysis', 'topOpportunity', 'hedgingSuggestion', 'portfolioRiskNote', 'narrative.why', 'narrative.story'];
const UNIT_OK = /^(bp|ma|pe|ev|roe|roa|eps|yoy|qoq|etf|it|ai|us|kr|gpu|cpu|hbm|cpi|ppi|gdp|fx|oas|ig|hy)$/i;

// 한글에 인접한 소문자 라틴 조각(단위 제외) 추출 — verify-report 검출기와 동일 규칙.
export function bleedFrags(v) {
  if (typeof v !== 'string') return [];
  return [...new Set([
    ...(v.match(/[가-힣][a-z]{2,6}[가-힣]/g) || []),
    ...(v.match(/[가-힣][a-z]{2,6}(?![가-힣])/g) || []),
    ...(v.match(/(?<![가-힣])[a-z]{2,6}[가-힣]/g) || []),
  ].map(x => x.replace(/[가-힣]/g, '')).filter(l => !UNIT_OK.test(l)))];
}

const numsOf = (s) => (String(s).match(/\d+\.?\d*/g) || []);

function getField(report, path) {
  if (path === 'narrative.why') return report.marketNarrative?.why;
  if (path === 'narrative.story') return report.marketNarrative?.story;
  return report[path];
}
function setField(report, path, val) {
  if (path === 'narrative.why') { if (report.marketNarrative) report.marketNarrative.why = val; return; }
  if (path === 'narrative.story') { if (report.marketNarrative) report.marketNarrative.story = val; return; }
  report[path] = val;
}

/**
 * 한글 내 로마자 누출 필드를 vLLM 으로 targeted 재작성. in-place 수정.
 * @param {object} report
 * @param {(prompt:string)=>Promise<string>} vllmCall  vLLM 호출(텍스트 반환)
 * @param {{extraPaths?:string[], log?:(s:string)=>void}} [opts]
 * @returns {Promise<{nFix:number, fixed:string[], unresolved:string[]}>}
 */
export async function repairLatinBleed(report, vllmCall, { extraPaths = [], log = () => {} } = {}) {
  const paths = [...GATE_FIELDS, ...extraPaths];
  let nFix = 0; const fixed = []; const unresolved = [];
  for (const path of paths) {
    const v = getField(report, path);
    if (typeof v !== 'string' || !v) continue;
    const frags = bleedFrags(v);
    if (!frags.length) continue;
    const prompt = `다음 한국어 금융 문장에 로마자가 잘못 섞인 단어가 있다(예: "포osi가"→"포지션이", "인fra"→"인프라", "스queeze"→"스퀴즈", "컨티gio"→"콘탱고"). 그 단어만 *문맥상 맞는* 올바른 한국어 금융용어로 고쳐라. 자주 깨지는 금융용어 후보: 콘탱고·백워데이션·포지션·스퀴즈·숏커버링·인프라·밸류에이션·모멘텀·컨센서스·가이던스·서프라이즈·디레버리징. 영어 고유명사(NextEra Energy 등 회사명)·티커(NVDA)·단위(bp, ROE)는 그대로 둬라. 그 외 문장의 내용·수치·구조는 100% 그대로 유지하고, 고친 문장 전체만 출력하라(설명·따옴표 금지):\n\n${v}`;
    let out = '';
    try { out = (await vllmCall(prompt) || '').toString().trim(); }
    catch (e) { log(`  [latin-repair] ${path} vLLM 실패: ${e?.message ?? e}`); unresolved.push(`${path}(${frags.join(',')})`); continue; }
    out = out.replace(/^["'`]+|["'`]+$/g, '').trim();
    const numsOk = numsOf(v).every(n => out.includes(n));   // 원문 숫자 전부 보존(숫자 환각 차단)
    const lenOk = out.length >= v.length * 0.6 && out.length <= v.length * 1.4;
    const cleaner = bleedFrags(out).length < frags.length;
    if (out && cleaner && lenOk && numsOk) {
      setField(report, path, out);
      nFix++; fixed.push(`${path}(${frags.join(',')})`);
      log(`  [latin-repair] ${path}: ${frags.join(',')} → 교정`);
    } else {
      unresolved.push(`${path}(${frags.join(',')})`);
      log(`  [latin-repair] ${path}: 미채택(누출 ${bleedFrags(out).length}/${frags.length}, len ${out.length}/${v.length}, 숫자보존 ${numsOk}) — gate 가 계속 차단`);
    }
  }
  return { nFix, fixed, unresolved };
}
