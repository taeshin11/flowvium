#!/usr/bin/env node
/**
 * thermal-policy.test.mjs — 온도 조절기 판정 로직(파이썬) 을 게이트에서 돌리는 얇은 러너.
 *
 * 저장소 관례를 따른다(run-rag-e2e.mjs): 다른 언어라도 게이트에 없으면 없는 테스트다.
 * run-lib-tests.mjs 가 scripts/lib/*.test.mjs 를 전수 실행하므로 여기에 둔다.
 *
 * 배경(2026-08-21 라이브 장애): 조절기가 LLM 을 SIGSTOP 한 뒤 센서(macmon) 정지로
 *   `for line in p.stdout:` 에서 영원히 블록돼 대상이 무기한 정지 상태로 남았다.
 *   그 시각 시작한 afternoon 보고서의 LLM 호출이 전부 연결 거부로 떨어졌다.
 *   판정 로직을 thermal_policy.py 로 분리하고 여기서 검증한다.
 */
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TEST = resolve(ROOT, 'scripts/runtime/test_thermal_policy.py');

if (!existsSync(TEST)) {
  console.log(`  FAIL  테스트 파일 없음: ${TEST}`);
  process.exit(1);
}

// 로컬은 조절기가 실제로 쓰는 인터프리터로, CI 등에서는 python3 로. 둘 다 없으면 조용히 넘기지 않는다.
const candidates = [resolve(homedir(), 'ocr-venv/bin/python'), 'python3', 'python'];
let chosen = null;
for (const c of candidates) {
  const probe = spawnSync(c, ['-c', 'import sys; print(sys.version_info[0])'], { encoding: 'utf8' });
  if (!probe.error && probe.status === 0 && probe.stdout.trim() === '3') { chosen = c; break; }
}
if (!chosen) {
  console.log('  FAIL  python3 을 찾지 못해 조절기 판정 테스트를 돌리지 못했다 — 통과로 처리하지 않는다');
  process.exit(1);
}

const r = spawnSync(chosen, [TEST], { cwd: resolve(ROOT, 'scripts/runtime'), encoding: 'utf8' });
const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
const m = out.match(/Ran (\d+) tests?/);
if (r.status === 0) {
  console.log(`  PASS  조절기 판정 로직 ${m ? m[1] : '?'}개 통과 (${chosen.split('/').pop()})`);
  console.log('\n결과: 전부 통과');
  process.exit(0);
}
console.log(out.trim().split('\n').slice(-12).map((l) => `    ${l}`).join('\n'));
console.log(`  FAIL  조절기 판정 로직 실패 (exit ${r.status})`);
console.log('\n결과: 실패');
process.exit(1);
