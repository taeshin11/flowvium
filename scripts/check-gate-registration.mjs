#!/usr/bin/env node
// check-gate-registration.mjs — 게이트 고아(anti-orphan) 정적 대조 (2026-07-06, AISVI 노드 ■4 메타검증 차용)
//
// 클래스: 검증 스크립트를 만들고 verify-all 에 안 엮으면 존재하지만 아무도 안 도는 死藏 게이트가 됨
//   (실례: post-publish-recheck 가 수동 --upload 경로 미배선 → 비문 3시간 라이브 노출).
// 규칙: scripts/(verify|audit|check|test|e2e)-*.mjs 전수는 ① verify-all checks[] 등록 또는
//   ② 아래 WHITELIST(사유 명시) 중 하나여야 한다. 신규 스크립트가 어느 쪽도 아니면 ❌ FAIL —
//   "게이트 신설 시 배선 강제" 래칫. 화이트리스트가 등록과 중복되면 ⚠️(stale 화이트리스트).
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// 사유 명시 화이트리스트 — "왜 verify-all 에 없어도 되는가"
const WHITELIST = {
  'verify-all.mjs': '러너 자신',
  'check-gate-registration.mjs': '자기 자신(verify-all 등록됨 — 중복표기 방지용 엔트리)',
  'verify-report.mjs': 'verify-all 에 verify-latest-report 로 등록 + 생성기/recheck 가 직접 호출',
  'check-stall.mjs': '주기 모니터 러너(Task Scheduler 별도 배선)',
  'check-uncommitted-risk.mjs': 'check-stall wipe-risk 항목 + npm run check:gitrisk 배선',
  'audit-missed-winners.mjs': '회고 분석 도구(수동) — 게이트 아님',
  'audit-report-sections.mjs': '리포트 섹션 심층분석 도구(수동)',
  'check-chat-prices.mjs': '전 종목 가격 grounding 전수 프로브(수동·외부 API 1,338콜)',
  'check-cron-sessions.mjs': 'cron 세션 점검 도구(수동, npm run check:cron-sessions)',
  'check-data-quality.mjs': '뉴스/번역 품질 프로브 — run-report 사전점검·수동',
  'check-endpoint-snapshots.mjs': 'DB 스냅샷 점검 도구(수동)',
  'check-hardcoded.mjs': '하드코딩 스캔(수동, npm run check:hardcoded)',
  'check-market-shock.mjs': '시장 급변 감지 — cron-runner 배선',
  'check-prospective-gaps.mjs': '전향적 갭 분석 도구(수동)',
  'check-prospective.mjs': '전향적 검증 도구(수동)',
  'check-rule-firing.mjs': '룰 발화 점검 도구(수동)',
  'check-timeframes.mjs': '타임프레임 점검(수동, npm run check:timeframes)',
  'test-judge.mjs': '심판엔진 단위테스트(수동 — LLM 비용)',
  'e2e-chat-multiturn.mjs': '라이브 2턴+스트림 E2E(LLM 비용 — 챗 경로 변경 시 수동)',
  'e2e-chat-longform.mjs': '장문 3연속 deep E2E(LLM 비용 — 수동)',
  'e2e-chat-compact.mjs': 'compact E2E(LLM 비용 — 수동)',
  'test-chat-isolation.mjs': 'scripts/sft — 챗 사용자 격리 적대적 검증(7벡터, 라이브 — 챗 권한경계 변경 시 수동)',
  'eval-chat-multiturn.mjs': 'scripts/sft — 엄격 멀티턴 API eval(SFT 연료 — LLM 비용)',
  'eval-chat-ui-multiturn.mjs': 'scripts/sft — Playwright UI 멀티턴 eval(SFT 연료 — 브라우저)',
};

// scripts/ 루트 + scripts/sft/ 둘 다 스캔(sft 하위 게이트도 고아 대조).
const names = [...readdirSync(resolve(ROOT, 'scripts')).filter((f) => /^(verify|audit|check|test|e2e)-.*\.mjs$/.test(f) || f === 'verify-all.mjs'),
  ...readdirSync(resolve(ROOT, 'scripts/sft')).filter((f) => /^(verify|audit|check|test|e2e|eval)-.*\.mjs$/.test(f))];
const verifyAllSrc = readFileSync(resolve(ROOT, 'scripts/verify-all.mjs'), 'utf8');
const registered = new Set([...verifyAllSrc.matchAll(/script:\s*'scripts\/([^']+)'/g)].map((m) => m[1]));

let nFail = 0, nWarn = 0, nOk = 0;
for (const f of names.sort()) {
  if (registered.has(f)) {
    nOk++;
    if (WHITELIST[f] && !/자기 자신|verify-latest-report/.test(WHITELIST[f])) { nWarn++; console.log(`⚠️ ${f}: verify-all 등록됐는데 화이트리스트에도 있음 — stale 엔트리 정리`); }
  } else if (WHITELIST[f]) {
    nOk++;
  } else {
    nFail++;
    console.log(`❌ 고아 게이트: scripts/${f} — verify-all 미등록 + 화이트리스트 사유 없음. 등록하거나 사유를 명시하라.`);
  }
}
console.log(`\n게이트 등록 대조: ${names.length}개 스크립트 · 등록 ${registered.size} · 고아 ${nFail} · stale 화이트리스트 ${nWarn}`);
if (nFail) { console.log('❌ FAIL — 게이트 신설 시 verify-all 등록 또는 WHITELIST 사유 명시가 강제됨'); process.exit(1); }
console.log('✅ 고아 게이트 0');
