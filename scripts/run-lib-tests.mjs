#!/usr/bin/env node
/**
 * run-lib-tests.mjs — scripts/lib/*.test.mjs 전수 실행.
 *
 * 배경(2026-08-20): 이 세션에서 lib 테스트를 39개까지 늘렸는데, verify-all 도 package.json 도
 *   그것들을 부르지 않았다. 즉 내가 손으로 돌릴 때만 실행됐고, 회귀가 나도 아무도 모르는 상태였다.
 *   "모니터가 본다 ≠ 고쳐졌다"와 같은 부류의 사각지대 — 테스트가 있어도 안 돌면 없는 것과 같다.
 *
 * 사용: node scripts/run-lib-tests.mjs [--quiet]
 * 종료코드: 실패 1건이라도 있으면 1.
 */
import { readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const LIB = resolve(dirname(fileURLToPath(import.meta.url)), 'lib');
const QUIET = process.argv.includes('--quiet');
const files = readdirSync(LIB).filter(f => f.endsWith('.test.mjs')).sort();

let pass = 0; const failed = [];
for (const f of files) {
  const r = spawnSync(process.execPath, [resolve(LIB, f)], { encoding: 'utf8', timeout: 600000 });
  if (r.status === 0) { pass++; if (!QUIET) console.log(`  ✅ ${f}`); }
  else {
    failed.push(f);
    console.log(`  ❌ ${f}`);
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n').filter(l => /FAIL|Error|결과/.test(l));
    for (const l of out.slice(0, 6)) console.log(`       ${l.trim().slice(0, 160)}`);
  }
}
console.log(`\nlib 테스트 ${files.length}개 — 통과 ${pass} / 실패 ${failed.length}`);
if (failed.length) { console.log(`❌ FAIL: ${failed.join(', ')}`); process.exit(1); }
console.log('✅ 전부 통과');
