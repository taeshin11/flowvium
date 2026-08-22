#!/usr/bin/env node
/**
 * run-lib-tests.mjs — scripts/lib/*.test.mjs 전수 실행.
 *
 * 배경(2026-08-20): 이 세션에서 lib 테스트를 39개까지 늘렸는데, verify-all 도 package.json 도
 *   그것들을 부르지 않았다. 즉 내가 손으로 돌릴 때만 실행됐고, 회귀가 나도 아무도 모르는 상태였다.
 *   "모니터가 본다 ≠ 고쳐졌다"와 같은 부류의 사각지대 — 테스트가 있어도 안 돌면 없는 것과 같다.
 *
 * 사용: node scripts/run-lib-tests.mjs [--quiet] [--strict]
 *   --strict: 전제조건 미충족(스킵)도 실패로 센다. 로컬·pre-push 용 — 조용한 스킵을 막는다.
 * 종료코드: 실패 1건이라도 있으면 1.
 */
import { readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const LIB = resolve(dirname(fileURLToPath(import.meta.url)), 'lib');
const QUIET = process.argv.includes('--quiet');
const files = readdirSync(LIB).filter(f => f.endsWith('.test.mjs')).sort();

// 2026-08-22: 스킵을 실패와 구분한다. 테스트가 자기 전제조건(.env.local·라이브 LLM·DB 데이터)을
//   선언하고 못 갖추면 종료코드 77 로 스스로 빠진다(scripts/lib/test-env.mjs).
//   CI(깨끗한 clone)에서 7개가 환경 때문에 실패하는데, 그걸 실패로 세면 CI 가 상시 빨갛고
//   상시 빨간 CI 는 아무도 안 본다 — 이 저장소가 verify.yml 을 workflow_dispatch 로 내린 것과 같은 이유다.
//   러너가 스킵 목록을 드는 방식은 쓰지 않는다. 그건 또 다른 하드코딩이고 곧 낡는다.
const SKIP_CODE = 77;
const STRICT = process.argv.includes('--strict') || process.env.LIB_TEST_STRICT === '1';
let pass = 0; const failed = []; const skipped = [];
for (const f of files) {
  const r = spawnSync(process.execPath, [resolve(LIB, f), ...(STRICT ? ['--strict'] : [])],
    { encoding: 'utf8', timeout: 600000, env: { ...process.env, ...(STRICT ? { LIB_TEST_STRICT: '1' } : {}) } });
  if (r.status === 0) { pass++; if (!QUIET) console.log(`  ✅ ${f}`); }
  else if (r.status === SKIP_CODE) {
    skipped.push(f);
    const why = `${r.stdout ?? ''}`.split('\n').find(l => /SKIP/.test(l)) ?? '';
    console.log(`  ⏭️  ${f}${why ? ` — ${why.replace(/^\s*SKIP\s*/, '').trim().slice(0, 110)}` : ''}`);
  }
  else {
    failed.push(f);
    console.log(`  ❌ ${f}`);
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n').filter(l => /FAIL|Error|결과/.test(l));
    for (const l of out.slice(0, 6)) console.log(`       ${l.trim().slice(0, 160)}`);
  }
}
console.log(`\nlib 테스트 ${files.length}개 — 통과 ${pass} / 스킵 ${skipped.length} / 실패 ${failed.length}`);
if (skipped.length) console.log(`⏭️  스킵(전제조건 미충족): ${skipped.join(', ')}`);
if (failed.length) { console.log(`❌ FAIL: ${failed.join(', ')}`); process.exit(1); }
console.log('✅ 전부 통과');
