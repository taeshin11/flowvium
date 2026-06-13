#!/usr/bin/env node
/**
 * scripts/audit-report-sections.mjs — 보고서 *섹션 전수* 커버리지·grounding 감사.
 *
 * 배경(2026-06-14 사용자 "보고서의 모든 섹션을 검토한건가?"): ChatGPT 리뷰는 엔진/횡단결함 중심이라
 *   섹션별 콘텐츠 전수감사는 아니었음. 이 스크립트가 최신 보고서의 *모든 섹션*을 manifest 대조로
 *   ① 채워졌나(빈 섹션=사일런트 blind spot) ② grounding 방식(deterministic/LLM+guard/external)
 *   ③ 환각위험 등급 을 표로 surface. check-rule-firing(룰 발화) 과 짝 — "섹션이 실제 렌더되는가".
 *
 * 사용: node scripts/audit-report-sections.mjs [report경로|생략시 최신]
 * exit: 0 (informational). always-populate 섹션이 비면 🚨, 외부소스 의존 빈섹션은 ⚠️(transient 가능).
 */
import { readFileSync } from 'fs';
import { pickLatestReport } from './verify-report.mjs';

const file = process.argv[2] ?? pickLatestReport('reports');
if (!file) { console.error('보고서 없음'); process.exit(0); }
const r = JSON.parse(readFileSync(file, 'utf8'));
console.log(`═══ 보고서 섹션 전수 감사: ${file} ═══`);
console.log('(섹션 정의 ≠ 렌더됨 — 빈 섹션은 사용자에게 공백. grounding=환각방어 방식)\n');

// kind: text/array/object/scalar | grounding | always(항상 채워져야) | extern(외부소스 의존 — 빈값 transient 허용)
const SECTIONS = [
  ['stance', 'text', 'deterministic(stance-gate)', true, false],
  ['thesis', 'text', 'LLM+isGarbage게이트', true, false],
  ['portfolio', 'array', '룰펀넬+LLM선택, fundamentalBasis deterministic+validateGroundedNumbers+name/sector override', true, false],
  ['buySellReconciliation', 'object', '결정론 양면 등급제 심판(buyConviction vs sellScore)', true, false],
  ['earlyWarning', 'object', '결정론 composite(신용/VIX/금리커브/F&G/FX)', true, false],
  ['reboundWatch', 'object', '결정론', true, false],
  ['marketVerdict', 'object', '결정론(earlyWarning+rebound+공포매수+유사국면), US/KR 박스', true, false],
  ['sectorAllocation', 'array', 'portfolio.sector 합산(deterministic fallback)', true, false],
  ['riskEvents', 'array', 'LLM(macro prompt)', true, false],
  ['macroAnalysis', 'text', 'LLM+FRED fact-check+enrich', true, false],
  ['technicalAnalysis', 'text', 'LLM(VIX/yield)', true, false],
  ['fundamentalAnalysis', 'text', 'LLM', true, false],
  ['regionStances', 'object', 'LLM(regional)', true, false],
  ['shortSqueeze', 'array', '외부(short-interest/options) — 데이터 sparse', false, true],
  ['insiderSignals', 'array', '외부(SEC Form4) — 데이터 sparse', false, true],
  ['topOpportunity', 'text', 'LLM(opportunity)', false, false],
  ['stopLossRationale', 'array', 'deterministic(포지션별)', false, false],
  ['hedgingSuggestion', 'text', 'LLM', false, false],
  ['marketNarrative', 'object', 'LLM(narrative) — why/hotThemes', true, false],
  ['companyChanges', 'array', 'Wave2 LLM + DART/SEC 공시', true, false],
  ['supplyChainChanges', 'array', 'DART/SEC 공급망 신호(결정론 추출)', false, true],
  ['portfolioOutcomes', 'object', 'DB(evaluate-recommendations) 전향적', true, false],
  ['sessionFocus', 'object', '결정론(세션별)', true, false],
  ['portfolioByMarket', 'object', 'portfolio 분할', true, false],
  ['sellRecommendations', 'object', '매도룰+역심판 action ladder', false, true],
  ['buyCandidateScoring', 'object', '룰엔진 4-stage', true, false],
  ['etfStrategy', 'array', 'buildEtfStrategy(룰기반, batch price)', true, false],
  ['marketVerdict.krVerdict', 'object', '결정론 KR(KOSPI 추세+계절성+breadth+유사국면)', true, false],
];

const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
const filled = (v, kind) => {
  if (v == null) return false;
  if (kind === 'array') return Array.isArray(v) && v.length > 0;
  if (kind === 'text') return typeof v === 'string' && v.trim().length >= 5;
  if (kind === 'object') return typeof v === 'object' && Object.keys(v).length > 0;
  return true;
};

let blindAlways = 0, blindExtern = 0, ok = 0;
console.log('SEC'.padEnd(24) + 'STATUS  GROUNDING');
for (const [key, kind, grounding, always, extern] of SECTIONS) {
  const v = getPath(r, key);
  const isFilled = filled(v, kind);
  const cnt = Array.isArray(v) ? `[${v.length}]` : kind === 'text' ? `(${(v ?? '').length}c)` : '';
  let badge;
  if (isFilled) { badge = '✅ 렌더 '; ok++; }
  else if (always) { badge = '🚨 빈섹션'; blindAlways++; }
  else if (extern) { badge = '⚠️ 빈(외부)'; blindExtern++; }
  else { badge = '·  공백(선택)'; }
  console.log(`${key.padEnd(24)}${badge}${cnt.padEnd(7)} ${grounding.slice(0, 60)}`);
}

console.log(`\n요약: ✅ 렌더 ${ok} / 🚨 always-빈(결함) ${blindAlways} / ⚠️ 외부-빈(transient) ${blindExtern}`);
if (blindAlways > 0) console.log('🚨 always-populate 섹션이 비었음 = 진짜 결함(파이프라인 단계 실패 의심). 위 🚨 추적 요망.');
if (blindExtern > 0) console.log('⚠️ 외부소스 빈섹션(insider/shortSqueeze/supplyChain) = 데이터 sparse/소스 down. 룰발화 0 과 동일 뿌리 — Task26(Form4)·소스 헬스로 추적.');
console.log('\n(informational — push 차단 안 함. check-rule-firing 과 함께 "섹션·룰이 실제 작동하나" 메타검증.)');
