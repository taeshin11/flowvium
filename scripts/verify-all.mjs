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
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const NODE = process.execPath;
const ROOT = process.cwd();

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

const checks = [
  {
    name: 'audit-data-sources',
    script: 'scripts/audit-data-sources.mjs',
    desc: '외부 source 헬스 (Stooq/Yahoo/SEC/FRED/CNN)',
    critical: true,
  },
  {
    name: 'audit-coverage',
    script: 'scripts/audit-coverage.mjs',
    desc: 'DB NULL + endpoint manifest + Karpathy 학습 효과 [10 Probe]',
    critical: true,
  },
  {
    name: 'audit-company-pages',
    script: 'scripts/audit-company-pages.mjs',
    args: ['20'],
    desc: '1,210 종목 × 9 endpoint sample',
    critical: false,
  },
  {
    name: 'check-static-fallbacks',
    script: 'scripts/check-static-fallbacks.mjs',
    desc: '정적 데이터 폴백 (실시간 위장)',
    critical: true,
  },
  {
    name: 'check-cron-cost',
    script: 'scripts/check-cron-cost.mjs',
    desc: 'Vercel cron 비용 폭증',
    critical: false,
  },
  {
    name: 'verify-latest-report',
    script: 'scripts/verify-report.mjs',
    args: () => {
      const dir = resolve(ROOT, 'reports');
      if (!existsSync(dir)) return null;
      const files = readdirSync(dir).filter(f => f.startsWith('report-') && f.endsWith('-ko.json')).sort().slice(-1);
      return files.length ? [resolve(dir, files[0])] : null;
    },
    desc: '최신 보고서 (sector/52w/MA/fact-check)',
    critical: true,
  },
];

console.log('═══════════════════════════════════════════════════════════');
console.log('  Verify-All — 모든 검증 병렬 실행');
console.log('═══════════════════════════════════════════════════════════\n');

// 병렬 실행 — 6 spawn 동시
const startedAt = Date.now();
console.log(`▶ 6 script 병렬 실행 시작...`);

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
    // 2026-05-31: exit code 0 이 아니거나 critical 인 경우 ❌ 보임 → fail. silent false pass 차단.
    const failed = (res.status !== 0) || (c.critical && errCount > 0);
    const status = failed ? 'fail' : (errCount > 0 || warnCount > 0 ? 'warn' : 'pass');
    return { ...c, status, errCount, warnCount, okCount, durationMs: res.durationMs, exitCode: res.status };
  });
});

const results = await Promise.all(promises);
const elapsedMs = Date.now() - startedAt;
console.log(`\n▶ 6 script 완료 — ${(elapsedMs/1000).toFixed(1)}s\n`);
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

// dimension cover 매트릭스 — 각 검증이 어떤 dimension 을 cover 하는지 가시화
console.log('\n## dimension cover 매트릭스');
console.log('| dimension                  | cover script               |');
console.log('|----------------------------|----------------------------|');
const dimensions = [
  ['외부 source 헬스 (Stooq/Yahoo/SEC/FRED)', 'audit-data-sources'],
  ['DB NULL 컬럼 (모든 테이블 자동)', 'audit-coverage Probe [1]'],
  ['endpoint manifest (page 의존성)', 'audit-coverage Probe [2]'],
  ['domain archive 적재율', 'audit-coverage Probe [3]'],
  ['HTTP status 4XX/5XX 분포', 'audit-coverage Probe [3b]'],
  ['portfolio↔snapshot 정합', 'audit-coverage Probe [3c]'],
  ['buy/sell rule 7카테고리', 'audit-coverage Probe [5]'],
  ['buy_candidates Karpathy source', 'audit-coverage Probe [6]'],
  ['entryZone gap (NE 환각)', 'audit-coverage Probe [7]'],
  ['KR ticker 풀 cross-check', 'audit-coverage Probe [8]'],
  ['Karpathy 학습 효과 (재발 추세)', 'audit-coverage Probe [9]'],
  ['company API 깊이 (9 endpoint × sample)', 'audit-coverage Probe [10] + audit-company-pages'],
  ['최신 보고서 sector/52w/MA/fact-check', 'verify-report (silent false pass 차단)'],
  ['정적 데이터 폴백 (실시간 위장)', 'check-static-fallbacks'],
  ['Vercel cron 비용', 'check-cron-cost'],
];
for (const [dim, src] of dimensions) console.log(`| ${dim.padEnd(43).slice(0, 43)} | ${src.padEnd(43).slice(0, 43)} |`);

console.log('\n→ 결함 상세는 각 script 직접 실행:');
for (const r of results.filter(x => x.status !== 'pass' && x.status !== 'skip')) {
  const argsStr = typeof r.args === 'function' ? '' : (r.args?.length ? ' ' + r.args.join(' ') : '');
  console.log(`  node ${r.script}${argsStr}`);
}

process.exit(failCount > 0 ? 1 : 0);
