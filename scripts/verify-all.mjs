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
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const NODE = process.execPath;
const ROOT = process.cwd();

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
console.log('  Verify-All — 모든 검증 일괄 실행');
console.log('═══════════════════════════════════════════════════════════\n');

const results = [];
for (const c of checks) {
  const t0 = Date.now();
  if (!existsSync(resolve(ROOT, c.script))) {
    results.push({ ...c, status: 'skip', reason: 'script 없음', durationMs: 0 });
    continue;
  }
  const args = typeof c.args === 'function' ? c.args() : (c.args ?? []);
  if (args === null) {
    results.push({ ...c, status: 'skip', reason: '입력 없음', durationMs: 0 });
    continue;
  }
  process.stdout.write(`▶ ${c.name} ... `);
  const res = spawnSync(NODE, [c.script, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
  const durationMs = Date.now() - t0;
  // 결함 패턴: ❌ / FAIL / error / not found / null:
  const stdout = (res.stdout ?? '') + (res.stderr ?? '');
  const errCount = (stdout.match(/❌|FAIL|ERROR/g) ?? []).length;
  const warnCount = (stdout.match(/⚠️|WARN/g) ?? []).length;
  const okCount = (stdout.match(/✅/g) ?? []).length;
  // exit code 도 검사 (audit-coverage 가 ❌ 시 exit 1)
  const failed = (res.status !== 0 && c.critical) || (c.critical && errCount > 5);
  const status = failed ? 'fail' : (errCount > 0 ? 'warn' : 'pass');
  results.push({ ...c, status, errCount, warnCount, okCount, durationMs, exitCode: res.status });
  const icon = status === 'pass' ? '✅' : status === 'warn' ? '⚠️ ' : '❌';
  console.log(`${icon} ${status.toUpperCase()} (${(durationMs/1000).toFixed(1)}s) ok=${okCount} warn=${warnCount} err=${errCount}`);
}

console.log('\n═══ 종합 ═══');
const failCount = results.filter(r => r.status === 'fail').length;
const warnCount = results.filter(r => r.status === 'warn').length;
const passCount = results.filter(r => r.status === 'pass').length;
const skipCount = results.filter(r => r.status === 'skip').length;
console.log(`✅ pass: ${passCount} / ⚠️  warn: ${warnCount} / ❌ fail: ${failCount} / ⏭️  skip: ${skipCount}\n`);

console.log('## 결과 표');
console.log('| status | check                       | err | warn | ok  | duration |');
console.log('|--------|-----------------------------|-----|------|-----|----------|');
for (const r of results) {
  const icon = r.status === 'pass' ? '✅' : r.status === 'warn' ? '⚠️ ' : r.status === 'fail' ? '❌' : '⏭️ ';
  console.log(`| ${icon} ${r.status.padEnd(4)} | ${r.name.padEnd(27)} | ${String(r.errCount ?? '-').padStart(3)} | ${String(r.warnCount ?? '-').padStart(4)} | ${String(r.okCount ?? '-').padStart(3)} | ${(r.durationMs/1000).toFixed(1).padStart(7)}s |`);
}

console.log('\n→ 결함 상세는 각 script 직접 실행:');
for (const r of results.filter(x => x.status !== 'pass' && x.status !== 'skip')) {
  console.log(`  node ${r.script}${typeof r.args === 'function' ? '' : (r.args?.length ? ' ' + r.args.join(' ') : '')}`);
}

process.exit(failCount > 0 ? 1 : 0);
