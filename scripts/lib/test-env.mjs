/**
 * test-env.mjs — 테스트가 *자기* 전제조건을 선언한다.
 *
 * 배경(2026-08-22): .github/workflows/ci.yml 은 lint·tsc·grep 패턴 감사만 돌린다.
 *   이 세션의 회귀를 전부 막고 있는 lib 스위트(92개)는 GitHub 에서 한 번도 안 돈다.
 *   로컬 pre-push 훅에만 걸려 있고, cron 산출물 자동 커밋 푸시는 그 훅을 타지 않는다.
 *   run-lib-tests.mjs 가 스스로 적어 둔 교훈("테스트가 있어도 안 돌면 없는 것과 같다")이
 *   한 단계 위에서 그대로 반복되고 있었다.
 *
 *   깨끗한 clone 으로 재현해 보니 92개 중 7개가 환경 때문에 실패한다 —
 *   .env.local(gitignore), 라이브 LLM, 데이터가 든 DB. CI 에서 이걸 '실패' 로 세면
 *   빨간 CI 가 상시화되고, 상시 빨간 CI 는 아무도 안 본다(이 저장소가 verify.yml 을
 *   workflow_dispatch 로 내린 것도 같은 이유였다 — 그 파일 주석 참조).
 *
 * 그래서 러너가 스킵 목록을 들지 않는다 — 그건 또 다른 하드코딩이고 곧 낡는다.
 *   각 테스트가 자기가 무엇을 필요로 하는지 선언하고, 실제로 없으면 스스로 스킵한다.
 *   스킵은 종료코드 77(autotools 관례)로 알린다. 러너가 실패와 구분해 센다.
 *
 * 로컬에서는 전부 갖춰져 있으므로 스킵이 나오면 그 자체가 신호다 —
 *   `--strict`(pre-push 훅·수동 실행)에서는 스킵을 실패로 센다. 조용한 스킵을 막는다.
 */
import { existsSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './project-root.mjs';

export const SKIP_CODE = 77;

/**
 * @param {{
 *   envFile?: boolean,              // .env.local 존재
 *   env?: string[],                 // .env.local 로드 후 해당 키가 값이 있는가
 *   dbTables?: string[],            // 이 테이블들이 비어 있지 않은가
 *   http?: string[],                // 응답하는 URL (2s 상한)
 *   backup?: boolean,               // 대조할 로컬 백업 스냅샷이 있는가
 * }} spec
 */
export async function requires(spec) {
  const missing = [];

  if (spec.envFile && !existsSync(resolve(ROOT, '.env.local'))) missing.push('.env.local');

  if (spec.env?.length) {
    try { (await import('./llm-config.mjs')).loadEnvLocal(); } catch { /* 없으면 아래에서 드러난다 */ }
    for (const k of spec.env) if (!process.env[k]) missing.push(`env:${k}`);
  }

  // 2026-08-22 정정: 처음엔 `dbRows: { table: 50 }` 처럼 최소 행 수를 받았는데, 그 50 은
  //   내가 손으로 정한 숫자였다 — 하드코딩과 다르지 않고 근거도 없었다.
  //   이 검사가 실제로 묻는 것은 "데이터가 든 DB 인가, 빈 스키마인가" 다(CI 는 정확히 0이다).
  //   그러니 임의의 하한이 아니라 **비어 있지 않은가** 를 묻는 게 맞다.
  //   '이 단언을 하기에 표본이 충분한가' 는 각 테스트 자신의 판단이지 전제조건이 아니다.
  if (spec.dbTables?.length) {
    try {
      const { openDb } = await import('./db.mjs');
      const db = openDb();
      for (const table of spec.dbTables) {
        let n = 0;
        try { n = db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c; } catch { n = -1; }
        if (n <= 0) missing.push(`db:${table}(${n < 0 ? '테이블 없음' : '0행'})`);
      }
      db.close();
    } catch (e) { missing.push(`db:열기실패(${String(e.message).slice(0, 30)})`); }
  }

  if (spec.backup) {
    try {
      const { newestBackup } = await import('./db-health.mjs');
      if (!newestBackup()) missing.push('backup:로컬 스냅샷 없음');
    } catch (e) { missing.push(`backup:판독실패(${String(e.message).slice(0, 30)})`); }
  }

  for (const url of spec.http ?? []) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (!r.ok) missing.push(`http:${url}(${r.status})`);
    } catch { missing.push(`http:${url}(무응답)`); }
  }

  if (!missing.length) return;

  const strict = process.argv.includes('--strict') || process.env.LIB_TEST_STRICT === '1';
  const line = `필요 조건 미충족: ${missing.join(', ')}`;
  if (strict) {
    console.log(`  FAIL  ${line} — strict 모드에서는 스킵을 허용하지 않는다`);
    console.log('\n❌ 1건 실패');
    process.exit(1);
  }
  console.log(`  SKIP  ${line}`);
  process.exit(SKIP_CODE);
}
