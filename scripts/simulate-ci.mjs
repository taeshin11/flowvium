#!/usr/bin/env node
/**
 * simulate-ci.mjs — GitHub Actions 환경을 로컬에서 재현한다.
 *
 * 왜(2026-08-22): CI 에 lib 스위트를 넣으려는데 "CI 에서 뭐가 깨지는지" 를 알 방법이
 *   push 해 보는 것밖에 없었다. 그런데 이 저장소의 PAT 에는 workflow 스코프가 없어
 *   워크플로 변경 자체가 원격에 올라가지 않는다 — 확인 경로가 막혀 있었다.
 *   손으로 세 번 시행착오했다(.git 없는 tar 추출 → git ls-files 쓰는 테스트가 죽음,
 *   node_modules 미연결, 스키마 미초기화). 그 절차를 여기 고정한다.
 *
 * 무엇이 CI 와 다른가(정직하게): 러너 OS(ubuntu vs darwin), node 버전, `npm ci` 대신
 *   현재 node_modules 심볼릭 링크. 그래서 "네이티브 모듈 빌드" 류는 여기서 안 잡힌다.
 *   잡는 것은 **저장소에 커밋된 것만으로 무엇이 되고 안 되는가** 다 —
 *   .env.local(gitignore) · 데이터가 든 DB · 라이브 서비스가 없는 상태.
 *   실제로 이걸로 두 가지를 찾았다: .sh 실행권한 누락(깨끗한 clone 에서 보고서 잡 기동 불가),
 *   그리고 내가 방금 만든 db-health.test.mjs 의 전제조건 선언 누락.
 *
 * 사용: node scripts/simulate-ci.mjs [--keep]
 * 종료코드: 스위트가 실패하면 1 (스킵은 실패가 아니다 — CI 와 같은 규칙).
 */
import { execFileSync, spawnSync } from 'child_process';
import { mkdtempSync, rmSync, mkdirSync, symlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { resolve, join } from 'path';
import { ROOT } from './lib/project-root.mjs';

const KEEP = process.argv.includes('--keep');
const log = (...a) => console.log('[ci-sim]', ...a);

const work = mkdtempSync(join(tmpdir(), 'flowvium-ci-'));
const repo = join(work, 'repo');
let failed = false;
try {
  log(`깨끗한 clone → ${repo}`);
  execFileSync('git', ['clone', '-q', '--depth', '1', `file://${ROOT}`, repo], { stdio: 'inherit' });

  // actions/setup-node + npm ci 자리. 네이티브 모듈 재빌드는 재현하지 않는다(위 주석 참조).
  symlinkSync(resolve(ROOT, 'node_modules'), join(repo, 'node_modules'));

  // ci.yml 의 'Init DB schema' 스텝과 같은 일.
  for (const d of ['data', 'reports/verify', 'logs']) mkdirSync(join(repo, d), { recursive: true });
  const init = spawnSync(process.execPath,
    ['-e', "import('./scripts/lib/db.mjs').then(m => { const db = m.openDb(); db.close(); })"],
    { cwd: repo, encoding: 'utf8' });
  if (init.status !== 0) { log('DB 스키마 초기화 실패:', (init.stderr || '').slice(0, 200)); failed = true; }

  // 커밋된 파일 권한이 실제로 실행 가능한가 — 깨끗한 clone 에서만 드러나는 부류다.
  for (const sh of ['scripts/run-report.sh', 'scripts/rag/serve-embed.sh']) {
    const p = join(repo, sh);
    if (!existsSync(p)) continue;
    try { execFileSync('test', ['-x', p]); } catch { log(`❌ 실행권한 없음: ${sh}`); failed = true; }
  }

  log('lib 스위트 실행 (CI 모드 — 스킵 허용)');
  const r = spawnSync(process.execPath, ['scripts/run-lib-tests.mjs'], { cwd: repo, stdio: 'inherit' });
  if (r.status !== 0) failed = true;
} finally {
  if (KEEP) log(`작업 디렉터리 보존: ${work}`);
  else rmSync(work, { recursive: true, force: true });
}
log(failed ? '❌ CI 시뮬레이션 실패' : '✅ CI 시뮬레이션 통과');
process.exit(failed ? 1 : 0);
