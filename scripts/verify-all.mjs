#!/usr/bin/env node
/**
 * scripts/verify-all.mjs — 모든 검증 일괄 실행 + dashboard.
 *
 * 사용자 비판: "다 고치고 검증할때 검증 일괄적으로 다 되게 해야지"
 *
 * 각 검증 script 를 spawn → 결과 종합 → pass/warn/fail 매트릭스 표시.
 *
 * 매 commit / push 전 실행 권장. CLAUDE.md "모든 fix 후 통합 검증" 의무.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pickLatestReport } from './verify-report.mjs';

const NODE = process.execPath;
const ROOT = process.cwd();
// 2026-05-31: CI 환경 — DB 비어있고 reports/ 없음. 외부 의존 audit 만 critical.
const CI = process.env.VERIFY_CI === '1' || process.env.CI === 'true';

// 2026-05-31: 병렬 spawn — 6 script 동시 실행. 222s → 90s 기대 (가장 느린 audit-coverage ~140s).
function runChild(node, script, args) {
  return new Promise(resolve => {
    let stdout = '', stderr = '';
    const t0 = Date.now();
    const child = spawn(node, [script, ...args], { cwd: ROOT });
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('close', code => resolve({ stdout: stdout + stderr, status: code, durationMs: Date.now() - t0 }));
    child.on('error', e => resolve({ stdout: String(e), status: -1, durationMs: Date.now() - t0 }));
    setTimeout(() => { try { child.kill(); } catch {} }, 300000);
  });
}

// 2026-05-31: 각 check 가 cover 하는 dimension 명시 — 매트릭스 자동 생성
const checks = [
  {
    name: 'audit-data-sources',
    script: 'scripts/audit-data-sources.mjs',
    desc: '외부 source 헬스 (Stooq/Yahoo/SEC/FRED/CNN)',
    // 2026-06-01: critical:false. 외부 source degradation(Yahoo v7 deprecated 401,
    //   CNN 418 rate-limit)은 환경 문제지 코드 회귀 아님 → warn. 진짜 critical(핵심
    //   source 전멸)은 스크립트가 exit code 2 로 신호 → verify-all 이 hard-fail 처리.
    critical: false,
    dimensions: ['외부 source 헬스 (Stooq/Yahoo/SEC/FRED/CNN)'],
  },
  {
    name: 'audit-coverage',
    script: 'scripts/audit-coverage.mjs',
    desc: 'DB NULL + endpoint manifest + Karpathy 학습 효과 [10 Probe]',
    critical: !CI, // CI 는 DB 비어있어 NULL audit fail 정상 — non-critical

    dimensions: [
      'DB NULL 컬럼 (모든 테이블 자동)',
      'endpoint manifest (page 의존성)',
      'domain archive 적재율',
      'HTTP status 4XX/5XX 분포',
      'portfolio↔snapshot 정합',
      'buy/sell rule 7카테고리',
      'buy_candidates Karpathy source',
      'entryZone gap (NE 환각)',
      'KR ticker 풀 cross-check',
      'Karpathy 학습 효과 (재발 추세 + 5회 escalate)',
      'company API 깊이 sample',
    ],
  },
  {
    name: 'audit-company-pages',
    script: 'scripts/audit-company-pages.mjs',
    args: CI ? ['8'] : ['20'], // deep(9-API)는 표본 — 깊이 점검용. 전수는 company-coverage 가 담당.
    desc: '종목 × 9 endpoint deep 표본 (깊이)',
    critical: false,
    dimensions: ['9 endpoint body 검증 (validator 정확) — 표본'],
  },
  {
    // 2026-06-05: deep 표본(40종목)이 "94%"를 전수처럼 오해시킨 사각지대 → core 전수 보장 추가.
    //   가장 가벼운 stock-price 를 1338 전종목 동시 핑(~1-2분) — 모든 /company 페이지 핵심데이터 보유 검증.
    name: 'audit-company-coverage',
    script: 'scripts/audit-company-coverage.mjs',
    args: [],
    desc: '전수 1338 종목 core(stock-price) 커버리지',
    critical: false,
    dimensions: ['전 종목 /company 핵심데이터 보유 (표본 아님, 전수)'],
  },
  {
    name: 'check-static-fallbacks',
    script: 'scripts/check-static-fallbacks.mjs',
    desc: '정적 데이터 폴백 (실시간 위장)',
    critical: true,
    dimensions: ['정적 데이터 폴백 (실시간 위장 차단)'],
  },
  {
    // 2026-06-05: 문서(FEATURES/METRICS) vs 코드 상수 불일치 — "ETF 풀 193"(실제 30)·"1,210 종목"
    //   (실제 1338) 처럼 거짓 주장을 모니터가 못 잡던 메타-사각지대 → 권위 상수 대조.
    name: 'check-doc-sync',
    script: 'scripts/check-doc-sync.mjs',
    desc: '문서-코드 상수 동기화 (거짓 주장 차단)',
    critical: false,
    dimensions: ['FEATURES/METRICS 수치 주장 ↔ 코드 상수(UNIVERSE_COUNT/ETF/언어)'],
  },
  {
    name: 'check-cron-cost',
    script: 'scripts/check-cron-cost.mjs',
    desc: 'Vercel cron 비용 폭증',
    critical: false,
    dimensions: ['Vercel cron 비용'],
  },
  {
    // 2026-06-23: 매수 규율(veto) 배선 회귀 가드 — 칼받기/과열 매수 veto + H1 학습루프가 되돌려지지 않았는지.
    //   POSCO/현대로템 하락추세 매수 사건 후 신설. "규율이 veto 인가 score 인가"를 audit 이 처음으로 확인.
    name: 'audit-buy-discipline',
    script: 'scripts/audit-buy-discipline.mjs',
    desc: '매수 veto 배선 회귀 (칼받기/과열 차단 유지)',
    critical: true,
    dimensions: ['매수 hard veto 4경로 + H1 closed loop 배선 유지'],
  },
  {
    // 2026-07-01 (사용자 "한자 나오면 안되"): 한자 zero-tolerance 회귀 가드. 프로덕션 sanitizeText 직접 재사용
    //   (spinai6 defense-b) — 한자범위 정규식 literal 이 인코딩/에디터로 변질돼 한글(U+AC00-D7A3) 삼킴 or
    //   한자 누출 시 FAIL. \u 이스케이프(변질차단)와 이중 방어.
    name: 'test-hanja-guard',
    script: 'scripts/test-hanja-guard.mjs',
    desc: '한자 zero-tolerance (한글삼킴/한자누출 회귀)',
    critical: true,
    dimensions: ['한자 차단 + 한글 보존 (sanitizeText 회귀)'],
  },
  {
    // 2026-07-01 (노드 spinai1/2/6 G12 차용): 한자 커버리지 게이트 — LLM 출력표면 정적열거로
    //   새 스트림/완성 표면이 한자가드 없이 추가되면 즉시 FAIL(회귀봉쇄). point-wise scrub 맹점 체계 봉쇄.
    name: 'check-hanja-coverage',
    script: 'scripts/check-hanja-coverage.mjs',
    desc: '한자 커버리지 게이트(LLM 표면 열거·신규 무가드=FAIL)',
    critical: true,
    dimensions: ['LLM 출력표면 한자가드 커버리지(신규 미분류 표면 회귀봉쇄)'],
  },
  {
    // 2026-07-06 (사용자 "RAG 점수가 잘 매겨졌는지 검증 어떻게 / 없다고 하면 진짜 없는지 확인"): RAG 점수·관련성
    //   검증. 임베더 다운 시 ragRetrieve 가 조용히 [] 반환(거짓 부재)하던 사각지대 봉쇄. 임베더 미기동이면
    //   웹 미의존이라 self-skip(exit0 아님 — 임베더 죽음 자체가 결함이므로 warn 노출). advisory(코드 push 비차단).
    name: 'verify-rag-scores',
    script: 'scripts/rag/verify-rag-scores.mjs',
    args: ['--skip-live'],  // verify-all 은 코퍼스+임베더 직검(웹 라이브 프로브는 수동/모니터가 담당)
    desc: 'RAG 점수·관련성 (임베더 생존·관련성·점수밴드·판별력)',
    critical: false,
    dimensions: ['RAG 임베더 생존 + 스코어 관련성/판별력 (거짓 부재 봉쇄)'],
  },
  {
    // 2026-07-06 (사용자 "왜 최선을 안 하고 있었는지 검증체계"): 게으른 미루기 감시. deferral-ledger 의 미룬
    //   "더 나은 방법"이 재평가 기한 경과/반증 시 surface. advisory(warn) — 판단 항목이라 push 차단 아님.
    name: 'check-deferrals',
    script: 'scripts/check-deferrals.mjs',
    desc: '게으른 미루기 감시 (미룬 더 나은 방법 추적)',
    critical: false,
    dimensions: ['미룬 최선책 재평가 기한/근거 추적 (게으른 미루기 방지)'],
  },
  {
    // 2026-07-06 (AISVI 노드 ■4 메타검증 차용): 게이트 고아(anti-orphan) 정적 대조 — 검증 스크립트 신설 후
    //   verify-all 미배선이면 死藏(post-publish-recheck 수동경로 미배선 사건 클래스). 등록 또는 사유 강제.
    name: 'check-gate-registration',
    script: 'scripts/check-gate-registration.mjs',
    desc: '게이트 고아 방지 (신설 검증 스크립트 배선 강제)',
    critical: true,
    dimensions: ['검증 스크립트 전수 등록/사유 대조 (고아 게이트 래칫)'],
  },
  {
    // 2026-07-05 (사용자 "채팅 답변에 나쁜 답변 없는지 검증체계"): 챗 답변 결함 검증체계 게이트.
    //   [A] 픽스처 self-test(결정론 — 검출·교정·폐루프 교훈매핑 회귀시 FAIL) + [B] 저장대화 소급 재검증
    //   (잔존 결함률 20%+ = 체계 뚫림 → exit 1). Redis 없는 CI 는 [B] 자동 skip.
    name: 'verify-chat-answers',
    script: 'scripts/verify-chat-answers.mjs',
    desc: '챗 답변 결함(누출/환각/한자/절단/반복) self-test + 저장대화 재검증',
    critical: true,
    dimensions: ['챗 답변 결함 검출·교정 회귀(self-test 15 픽스처)', '저장대화 잔존 결함률(신규룰 소급 스캔)'],
  },
  {
    // 2026-07-02: LLM 라우팅 stale-가정 회귀가드 — 클라우드 키 revoke 환경에서 vLLM-skip(=LLM 전무)
    //   미분류 표면 + 고정 타임아웃 < 토큰요구량(실측 ~10 tok/s) 검출. flow-analysis 영구 fallback +
    //   invest-critic silent timeout 사건 재발방지 ("환경 변화 후 과거 가정 재감사 부재" 클래스).
    name: 'check-llm-routing',
    script: 'scripts/check-llm-routing.mjs',
    desc: 'LLM 라우팅(skipVllm allowlist + 타임아웃-토큰 정합)',
    critical: true,
    dimensions: ['LLM 라우팅 stale 가정(skipVllm/고정 타임아웃) 회귀봉쇄'],
  },
  {
    name: 'verify-latest-report',
    script: 'scripts/verify-report.mjs',
    args: () => {
      // 2026-05-31: 이전 .sort().slice(-1) 는 lexicographic 정렬 → afternoon<evening<morning
      //   순으로 "morning" 을 최신으로 오선택 (evening 무시). pickLatestReport 가 날짜+세션 rank
      //   기준 정확 선택 (verify-report 와 단일 source of truth).
      const dir = resolve(ROOT, 'reports');
      if (!existsSync(dir)) return null;
      const latest = pickLatestReport(dir);
      return latest ? [latest] : null;
    },
    desc: '최신 보고서 (sector/52w/MA/fact-check)',
    critical: !CI, // CI 는 reports/ 비어있어 skip 정상
    dimensions: ['LLM 환각 (sector/52w/MA/fact-check/sector-keyword)'],
  },
  {
    // 2026-06-14 (ChatGPT 리뷰 §3-1): 섹션 "공허함"(템플릿화) 감사. advisory(non-critical) — event-기반
    //   격상(D3) 전까지 warn 으로 가시화만. 섹션이 단순 재무요약/계약나열/캘린더 나열이면 ❌ surface.
    name: 'audit-section-richness',
    script: 'scripts/audit-section-richness.mjs',
    desc: '섹션 밀도(템플릿화 vs 분석) — advisory',
    critical: false,
    dimensions: ['companyChanges/supplyChain/riskEvents/ETF 분석 깊이'],
  },
];

console.log('═══════════════════════════════════════════════════════════');
console.log('  Verify-All — 모든 검증 병렬 실행');
console.log('═══════════════════════════════════════════════════════════\n');

// 병렬 실행 — 7 spawn 동시
const startedAt = Date.now();
console.log(`▶ ${checks.length} script 병렬 실행 시작...`);

const promises = checks.map(c => {
  if (!existsSync(resolve(ROOT, c.script))) {
    return Promise.resolve({ ...c, status: 'skip', reason: 'script 없음', durationMs: 0 });
  }
  const args = typeof c.args === 'function' ? c.args() : (c.args ?? []);
  if (args === null) {
    return Promise.resolve({ ...c, status: 'skip', reason: '입력 없음', durationMs: 0 });
  }
  return runChild(NODE, c.script, args).then(res => {
    const stdout = res.stdout;
    // exit code 1 이면 무조건 fail. 그 외 ❌/FAIL 패턴 count.
    const errCount = (stdout.match(/❌|\bFAIL\b|\bERROR\b/g) ?? []).length;
    const warnCount = (stdout.match(/⚠️|\bWARN\b/g) ?? []).length;
    const okCount = (stdout.match(/✅/g) ?? []).length;
    // 2026-06-01: 심각도 차등 — 이전 `res.status !== 0` 이 critical 플래그를 무시해
    //   non-critical 체크(CI 빈 DB audit-coverage, 외부소스 degradation)도 fail 처리 →
    //   매 push 마다 CI Verify fail 메일 폭주. 규칙 재정의:
    //   - exit 2 = 스크립트 자체 판단 hard-critical (핵심 source 전멸 등) → 항상 fail.
    //   - exit 1 또는 stdout ❌ = 결함 있음 → critical 체크면 fail, 아니면 warn (가시화만).
    //   silent false pass 차단(exit 0 인데 ❌ 다수)은 critical 체크의 errCount 로 유지.
    const hardCritical = res.status === 2;
    const softProblem = res.status !== 0 || errCount > 0;
    const failed = hardCritical || (c.critical && softProblem);
    const status = failed ? 'fail' : (softProblem || warnCount > 0 ? 'warn' : 'pass');
    return { ...c, status, errCount, warnCount, okCount, durationMs: res.durationMs, exitCode: res.status };
  });
});

const results = await Promise.all(promises);
const elapsedMs = Date.now() - startedAt;
console.log(`\n▶ ${checks.length} script 완료 — ${(elapsedMs/1000).toFixed(1)}s\n`);
for (const r of results) {
  const icon = r.status === 'pass' ? '✅' : r.status === 'warn' ? '⚠️ ' : r.status === 'skip' ? '⏭️ ' : '❌';
  console.log(`${icon} ${r.name.padEnd(25)} (${(r.durationMs/1000).toFixed(1)}s) exit=${r.exitCode ?? '-'} err=${r.errCount ?? 0} warn=${r.warnCount ?? 0} ok=${r.okCount ?? 0}`);
}

console.log('\n═══ 종합 ═══');
const failCount = results.filter(r => r.status === 'fail').length;
const warnCount = results.filter(r => r.status === 'warn').length;
const passCount = results.filter(r => r.status === 'pass').length;
const skipCount = results.filter(r => r.status === 'skip').length;
console.log(`✅ pass: ${passCount} / ⚠️  warn: ${warnCount} / ❌ fail: ${failCount} / ⏭️  skip: ${skipCount}`);
console.log(`총 소요: ${(elapsedMs/1000).toFixed(1)}s (병렬)\n`);

console.log('## 결과 표');
console.log('| status  | check                     | exit | err | warn | ok  | duration |');
console.log('|---------|---------------------------|------|-----|------|-----|----------|');
for (const r of results) {
  const icon = r.status === 'pass' ? '✅' : r.status === 'warn' ? '⚠️ ' : r.status === 'fail' ? '❌' : '⏭️ ';
  console.log(`| ${icon} ${r.status.padEnd(5)} | ${r.name.padEnd(25)} | ${String(r.exitCode ?? '-').padStart(4)} | ${String(r.errCount ?? '-').padStart(3)} | ${String(r.warnCount ?? '-').padStart(4)} | ${String(r.okCount ?? '-').padStart(3)} | ${(r.durationMs/1000).toFixed(1).padStart(7)}s |`);
}

// 2026-05-31: dimension 매트릭스 자동 추출 — 각 check 의 dimensions field 에서 collect.
//   script 추가/수정 시 매트릭스 자동 따라옴. hardcoded 사각지대 차단.
console.log('\n## dimension cover 매트릭스 (자동 추출)');
console.log('| dimension                                         | cover script               | status |');
console.log('|---------------------------------------------------|----------------------------|--------|');
const statusByName = Object.fromEntries(results.map(r => [r.name, r.status]));
for (const c of checks) {
  for (const dim of (c.dimensions ?? [])) {
    const s = statusByName[c.name] ?? '-';
    const icon = s === 'pass' ? '✅' : s === 'warn' ? '⚠️ ' : s === 'fail' ? '❌' : '⏭️ ';
    console.log(`| ${dim.padEnd(49).slice(0, 49)} | ${c.name.padEnd(26).slice(0, 26)} | ${icon} ${s.padEnd(4)} |`);
  }
}
const totalDims = checks.reduce((s, c) => s + (c.dimensions?.length ?? 0), 0);
const passDims = checks.filter(c => statusByName[c.name] === 'pass').reduce((s, c) => s + (c.dimensions?.length ?? 0), 0);
console.log(`\ncover: ${passDims}/${totalDims} dimensions pass (${(passDims/totalDims*100).toFixed(0)}%)`);

console.log('\n→ 결함 상세는 각 script 직접 실행:');
for (const r of results.filter(x => x.status !== 'pass' && x.status !== 'skip')) {
  const argsStr = typeof r.args === 'function' ? '' : (r.args?.length ? ' ' + r.args.join(' ') : '');
  console.log(`  node ${r.script}${argsStr}`);
}

process.exit(failCount > 0 ? 1 : 0);
