#!/usr/bin/env node
/**
 * run-rag-e2e.mjs — test-rag-e2e.mts 를 게이트에서 돌리기 위한 얇은 러너.
 *
 * 2026-08-20: e2e 는 .mts 라 tsx 가 필요한데, verify-all 은 `node <script>` 로 spawn 한다.
 *   그래서 그 테스트는 게이트에 없었고 — 실제로 확인해 보니 임포트가 확장자 없이 적혀 있어
 *   plain node 로는 한 번도 실행된 적이 없었다(ERR_MODULE_NOT_FOUND).
 *   "테스트가 있어도 안 돌면 없는 것"이라 러너를 두고 게이트에 붙인다.
 */
import { spawnSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const r = spawnSync('npx', ['tsx', resolve(HERE, 'test-rag-e2e.mts')], {
  cwd: resolve(HERE, '../..'), stdio: 'inherit', timeout: 300_000,
});
if (r.error) { console.error(`❌ RAG e2e 실행 불가: ${r.error.message}`); process.exit(3); }
process.exit(r.status ?? 1);
