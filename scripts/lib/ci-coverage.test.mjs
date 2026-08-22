#!/usr/bin/env node
/**
 * ci-coverage.test.mjs — 회귀 스위트가 CI 에서 실제로 도는가.
 *
 * 배경(2026-08-22): .github/workflows/ci.yml 은 lint·tsc·grep 패턴 감사만 돌렸다.
 *   이 저장소의 회귀 방지 테스트 92개(lib 스위트)는 GitHub 에서 **한 번도 안 돌았다.**
 *   로컬 pre-push 훅에만 걸려 있었는데, cron 산출물 자동 커밋 푸시는 그 훅을 타지 않는다
 *   (`chore(scan-*): cron 산출 데이터 자동 커밋` 커밋들이 그 경로다).
 *
 *   run-lib-tests.mjs 헤더에 "테스트가 있어도 안 돌면 없는 것과 같다" 고 적혀 있다.
 *   그 교훈이 한 단계 위에서 그대로 반복되고 있었다 — 스위트는 만들었는데 CI 가 안 부른다.
 *
 * 두 가지를 함께 본다. 하나만 있으면 다시 어긋난다:
 *   ① CI 가 스위트를 부르는가 (안 부르면 원격에서 회귀가 안 잡힌다)
 *   ② 로컬 경로는 --strict 인가 (스킵을 허용하면 환경이 깨져도 초록으로 보인다)
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8'); } catch { return ''; } };

const ci = read('.github/workflows/ci.yml');
ci ? ok('ci.yml 을 읽었다') : bad('.github/workflows/ci.yml 이 없다');

/run-lib-tests\.mjs/.test(ci)
  ? ok('CI 가 lib 회귀 스위트를 실행한다')
  : bad('CI 가 lib 스위트를 안 돌린다 — 원격에서 회귀가 전혀 안 잡힌다');

// 스위트는 DB 스키마가 있어야 도는 테스트가 있다. CI 가 그걸 만들어 주는지도 본다.
/openDb\(\)/.test(ci)
  ? ok('CI 가 DB 스키마를 초기화한다')
  : bad('CI 에 DB 스키마 초기화가 없다 — 데이터 없는 테스트마저 오류로 죽는다');

const va = read('scripts/verify-all.mjs');
/run-lib-tests\.mjs[\s\S]{0,200}--strict/.test(va)
  ? ok('로컬 verify-all 은 --strict (스킵을 실패로 센다)')
  : bad('로컬 verify-all 이 스킵을 허용한다 — 환경이 깨져도 초록으로 보인다');

// 스킵 기전 자체가 살아 있는가
const runner = read('scripts/run-lib-tests.mjs');
/SKIP_CODE|77/.test(runner) && /skipped/.test(runner)
  ? ok('러너가 스킵과 실패를 구분한다')
  : bad('러너가 스킵을 실패로 뭉갠다 — CI 가 상시 빨개지고 곧 무시된다');

console.log(fail === 0 ? '\n✅ ci-coverage 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
