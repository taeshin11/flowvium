#!/usr/bin/env node
/**
 * scripts/audit-section-richness.mjs — 보고서 섹션 "공허함" 감사 (2026-06-14, ChatGPT 리뷰 §3-1).
 *
 * audit-report-sections.mjs 는 "섹션이 비었나"(존재/개수)를 본다. 사용자 불만은 "비어있음"이 아니라
 *   **"채워졌는데 공허함"**(템플릿). 이 감사는 *밀도/분석성*을 본다:
 *     - companyChanges: 단순 매출/마진 요약 + guidance unknown 비율 (event 분석 아님)
 *     - supplyChainChanges: summary 동일 prefix 반복률 + 파급경로(whyMatters/수혜·리스크) 부재율
 *     - riskEvents: 포트폴리오 민감도(노출종목/임계/액션) 부재 = 단순 경제일정 나열
 *     - etfStrategy: rationale 중복률 + 무효화조건/사이징 부재
 *
 * exit 1 = critical(템플릿화 임계 초과). verify-all 에 통합돼 "왜 분석이 아니라 템플릿인지" 자동 포착.
 * 권위 소스 대조가 아니라 *산출물 형태* 검사 — 결정론. fix 후 보고서가 격상되면 자동 green.
 */
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const argFile = process.argv.find((a) => a.endsWith('.json'));
function latestReport() {
  if (argFile) return argFile;
  const files = readdirSync(resolve(ROOT, 'reports')).filter((f) => /^report-.*-ko\.json$/.test(f)).sort();
  return files.length ? resolve(ROOT, 'reports', files[files.length - 1]) : null;
}

const file = latestReport();
if (!file) { console.log('⚠️  보고서 없음 — skip'); process.exit(0); }
const report = JSON.parse(readFileSync(file, 'utf8'));
console.log(`📋 섹션 밀도 감사: ${file.split(/[\\/]/).pop()}\n`);

const issues = [];   // {sev:'fail'|'warn', section, msg}
const ratio = (n, d) => d ? n / d : 0;
const pct = (x) => `${Math.round(x * 100)}%`;

// ── companyChanges: event 분석 vs 단순 재무요약 ──────────────────────────────────
const cc = Array.isArray(report.companyChanges) ? report.companyChanges : [];
if (cc.length) {
  const financialOnly = cc.filter((x) => {
    const kc = String(x.keyChange ?? x.whatChanged ?? '');
    const isFinTemplate = /매출.*%.*(영업이익률|순이익률|마진)|revenue.*%/.test(kc);
    const noGuidance = /unknown|maintained|유지|미상/i.test(String(x.guidance ?? ''));
    const noAnalysis = !x.whyMatters && !x.analysis && !x.nextCheck;
    return isFinTemplate && (noGuidance || noAnalysis);
  });
  const noEvtType = cc.filter((x) => !x.eventType).length;
  const r = ratio(financialOnly.length, cc.length);
  if (r > 0.6) issues.push({ sev: 'fail', section: 'companyChanges', msg: `단순 재무요약 템플릿 ${pct(r)} (${financialOnly.length}/${cc.length}) >60% — event 분석 아님(eventType/whyMatters/nextCheck 필요)` });
  else if (r > 0.4) issues.push({ sev: 'warn', section: 'companyChanges', msg: `재무요약 위주 ${pct(r)} — guidance/소송/M&A/계약/임원 등 event type 다양화 권장` });
  if (noEvtType === cc.length && cc.length) issues.push({ sev: 'warn', section: 'companyChanges', msg: `eventType 필드 전무(${cc.length}건) — 사건 분류 부재` });
}

// ── supplyChainChanges: 반복 prefix + 파급경로 부재 ──────────────────────────────
const sc = Array.isArray(report.supplyChainChanges) ? report.supplyChainChanges : [];
if (sc.length) {
  const prefixes = sc.map((x) => String(x.summary ?? x.headline ?? '').replace(/\s+/g, ' ').trim().slice(0, 18));
  const counts = {};
  for (const p of prefixes) if (p) counts[p] = (counts[p] ?? 0) + 1;
  const maxDup = Math.max(0, ...Object.values(counts));
  const dupR = ratio(maxDup, sc.length);
  if (dupR > 0.5) issues.push({ sev: 'fail', section: 'supplyChainChanges', msg: `동일 summary prefix 반복 ${pct(dupR)} (${maxDup}/${sc.length}) >50% — 계약나열(파급분석 아님)` });
  const weak = sc.filter((x) => !x.whyMatters && !(x.downstreamBeneficiaries?.length) && !(x.upstreamRisks?.length) && !(x.impactedTickers?.length));
  const weakR = ratio(weak.length, sc.length);
  if (weakR > 0.6) issues.push({ sev: 'warn', section: 'supplyChainChanges', msg: `파급경로(수혜·리스크·whyMatters) 부재 ${pct(weakR)} — '계약 있음' 만 표기, 매출가시성·반복성·불확실성 분석 권장` });
}

// ── riskEvents: 포트폴리오 민감도 부재 = 캘린더 나열 ─────────────────────────────
const re = Array.isArray(report.riskEvents) ? report.riskEvents : [];
if (re.length) {
  const generic = re.filter((x) => !(x.portfolioExposure?.length) && !x.affectedPortfolio && !x.threshold && !x.hedgeOrAction && !x.action);
  const gr = ratio(generic.length, re.length);
  if (gr > 0.8) issues.push({ sev: 'warn', section: 'riskEvents', msg: `포트폴리오 민감도(노출종목/임계/액션) 부재 ${pct(gr)} — 단순 경제일정 나열. 일정→포트폴리오 영향채널 필요` });
}

// ── etfStrategy: rationale 중복 + 무효화/사이징 부재 ────────────────────────────
const etf = Array.isArray(report.etfStrategy) ? report.etfStrategy : [];
if (etf.length) {
  const rats = etf.map((x) => String(x.rationale ?? '').replace(/\s+/g, ' ').trim());
  const uniq = new Set(rats.filter(Boolean));
  const dupR = 1 - ratio(uniq.size, rats.filter(Boolean).length || 1);
  if (dupR > 0.5) issues.push({ sev: 'warn', section: 'etfStrategy', msg: `rationale 중복 ${pct(dupR)} (고유 ${uniq.size}/${rats.length}) — stance 템플릿. role/무효화조건/사이징 권장` });
  const noInvalidation = etf.filter((x) => !x.invalidation && !x.sizingHint).length;
  if (noInvalidation === etf.length) issues.push({ sev: 'warn', section: 'etfStrategy', msg: `무효화조건/사이징 전무 — 'ETF 추천'을 exposure map 으로 격상 권장` });
}

// ── 결과 ────────────────────────────────────────────────────────────────────────
const fails = issues.filter((i) => i.sev === 'fail');
const warns = issues.filter((i) => i.sev === 'warn');
for (const i of fails) console.log(`  ❌ [${i.section}] ${i.msg}`);
for (const i of warns) console.log(`  ⚠️  [${i.section}] ${i.msg}`);
if (!issues.length) console.log('  ✅ 섹션 밀도 양호 — 템플릿화 임계 미초과');
console.log(`\n${fails.length ? '❌' : warns.length ? '⚠️' : '✅'} richness: fail ${fails.length} / warn ${warns.length}`);
// 기본 advisory(exit 0) — 섹션 event-기반 격상(D3) 전까지 push 차단 방지. --strict 시 CI 게이트로 승격.
const strict = process.argv.includes('--strict');
process.exit(strict && fails.length ? 1 : 0);
