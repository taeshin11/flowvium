#!/usr/bin/env node
/**
 * backup-health.test.mjs — 인수인계 백업이 *실제로* 돌고 있는가.
 *
 * 배경(2026-08-21 실측): HANDOFF.md 는 "머신 사망 시" 복구 runbook 이고,
 *   그 전제가 Google Drive 일일 백업이다(6/7 하드 freeze 4일 다운 후 신설).
 *   그런데 최신 백업이 flowvium-2026-07-29.db — 23일 전이었다.
 *   Windows 기기 해체(7/29)와 정확히 같은 날 멈췄고, 맥에는 아무도 대체를 안 걸었다:
 *     · launchd 에 backup 잡 없음
 *     · cron-runner 의 MAINT_JOBS 에도 없음
 *     · FLOWVIUM_BACKUP_DIR 미설정 → 수동 실행해도 exit(1)
 *   그 사이 DB 는 133MB → 159MB 로 자랐다. 23일치 학습이력·추천·outcome 이 무방비였다.
 *
 *   스크립트 자체는 맥 준비가 끝나 있었다(2026-08-20에 Windows 기본 경로를 없애고
 *   env 미설정 시 조용히 엉뚱한 곳에 쓰지 말고 실패하도록 고침). 배선만 빠져 있었다.
 *
 * 백업은 '있다고 믿는 것' 이 가장 위험하다 — 신선도를 기계가 확인한다.
 */
import { existsSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

let M = null;
try { M = await import('./backup-health.mjs'); }
catch (e) { bad(`scripts/lib/backup-health.mjs 없음 — ${e.message}`); }

if (M) {
  const s = await M.backupStatus();
  if (!s || typeof s !== 'object') { bad('backupStatus() 형식 오류'); }
  else {
    s.dest ? ok(`백업 대상 경로 해석: ${s.dest}`) : bad('FLOWVIUM_BACKUP_DIR 미설정 — 백업이 아예 못 돈다');
    s.destExists ? ok('백업 대상 디렉터리 존재') : bad(`대상 경로 없음: ${s.dest}`);
    if (s.newest) {
      s.ageDays <= s.maxAgeDays
        ? ok(`최신 백업 ${s.newest} · ${s.ageDays}일 전 (임계 ${s.maxAgeDays}일)`)
        : bad(`최신 백업이 ${s.ageDays}일 전 (임계 ${s.maxAgeDays}일) — 그 사이 로컬 상태는 무방비`);
    } else bad('DB 백업 파일이 하나도 없다');
    s.localNewest ? ok(`로컬 2차 백업 ${s.localNewest} · ${s.localAgeDays}일 전 (원격이 막혀도 남는다)`)
                  : bad('로컬 2차 백업 없음 — 원격이 막히면 아무것도 안 남는다');
    s.restorable ? ok(`로컬 백업이 실제로 열린다 (reports ${s.reportRows}행) — 존재 ≠ 복원 가능`)
                 : bad(`로컬 백업이 복원 불가: restorable=${s.restorable}`);
    s.scheduled ? ok(`스케줄 등록됨: ${s.scheduledBy}`) : bad('어디에도 스케줄되어 있지 않다 — 한 번 돌고 끝나는 백업은 백업이 아니다');
    Array.isArray(s.issues) ? ok(`issues 배열 제공 (${s.issues.length}건)`) : bad('issues 미제공');
  }
}

console.log('\nSQLite 백업이 네트워크 파일시스템에 직접 쓰지 않는가');
// 실측 2026-08-21: db.backup() 을 Google Drive File Stream 경로로 직접 부르면
//   12분+ 동안 0바이트에서 멈춘다(CPU 0%, 파일락/쓰기 대기 아님).
//   같은 호출을 로컬 경로로 하면 144.9MB 를 0.2초에 끝낸다 — 원인은 대상 파일시스템이다.
//   SQLite backup API 는 작은 페이지 쓰기+fsync 를 반복하는데 FUSE 계열이 그 패턴을 못 견딘다.
//   로컬에 뜬 뒤 완성본을 한 번에 복사해야 한다(순차 대용량 쓰기는 Drive 도 문제없다).
{
  const bk = readFileSync(resolve(ROOT, 'scripts/backup-takeover.mjs'), 'utf8');
  const m = bk.match(/await\s+db\.backup\(([^)]+)\)/);
  if (!m) bad('db.backup() 호출을 못 찾음 — 테스트 앵커가 낡았다');
  else if (/dbDest/.test(m[1])) bad(`db.backup(${m[1].trim()}) — 대상(Drive)에 직접 쓴다. 멈춘다`);
  else ok(`db.backup(${m[1].trim()}) — 로컬 임시 경로로 뜬다`);
  /replaceFile\([^)]*localDb\s*,\s*dbDest\)|fsp\.copyFile\(\s*localDb\s*,\s*dbDest\s*\)/.test(bk)
    ? ok('완성본을 대상으로 복사한다')
    : bad('로컬 백업본을 대상으로 복사하는 단계가 없다');
}

console.log('\n느린 클라우드 FS 에서 중요한 단계가 부수 단계에 막히지 않는가');
// 실측 2026-08-21: 이 Drive 마운트는 살아 있지만 서버 왕복 1회가 ~9.5초다
//   (dehydrated 파일 stat 4ms vs 첫 1바이트 read 9,526ms).
//   그래서 보존정책 삭제(클라우드 전용 133MB unlink)가 동기 호출로 막히면
//   그 뒤의 시크릿·문서·미러가 통째로 실행되지 않는다 — 실제로 그렇게 멈춰 있었다
//   (secrets/.env.local 이 Jul 29 그대로, 22:50 이후 Drive 갱신 0건).
//   가장 덜 중요한 단계가 가장 중요한 단계를 막는 순서였다.
{
  const bk = readFileSync(resolve(ROOT, 'scripts/backup-takeover.mjs'), 'utf8');
  const iSecret = bk.indexOf("'.env.local'");
  const iPrune  = bk.search(/오래된 DB 백업|dbBackups\.slice/);
  if (iSecret < 0 || iPrune < 0) bad('앵커를 못 찾음 — 테스트가 낡았다');
  else if (iPrune < iSecret) bad('보존정책 삭제가 시크릿 백업보다 먼저다 — 느린 삭제가 시크릿을 막는다');
  else ok('시크릿·문서가 보존정책 삭제보다 먼저 실행된다');

  /BUDGET_MS|deadline|budgetMs/.test(bk)
    ? ok('전체 시간 예산이 있다 (느린 FS 에서 무한정 매달리지 않는다)')
    : bad('시간 예산이 없다 — 클라우드가 느리면 다음 주기까지 매달린다');
}

console.log('\n모든 Drive 쓰기가 개별 상한을 갖는가');
// 실측으로 좁힌 조건: 클라우드 FS 에서 *새 파일* 쓰기는 빠르지만(20MB 3ms),
//   *기존 dehydrated 파일 덮어쓰기* 는 멈춘다 — copyFileSync(.env.local → Drive) 가
//   9분 넘게 fd 를 연 채 반환하지 않았고 대상은 Jul 29 그대로였다.
//   가설을 세 번 세워 두 번 기각했다(Drive 전반 느림 ✗ · unlink 자체 느림 ✗).
//   개별 연산을 더 특정하는 대신 일반화한다 — 이 FS 에서는 어떤 연산도 돌아온다고 가정할 수 없다.
//   상한을 넘기면 그 파일만 포기하고 진행한다. 백업은 증분이라 다음 주기가 이어받는다.
{
  const bk = readFileSync(resolve(ROOT, 'scripts/backup-takeover.mjs'), 'utf8');
  /copyFileSync\s*\(/.test(bk)
    ? bad('동기 copyFileSync 가 남아 있다 — 멈추면 그 뒤가 통째로 실행되지 않는다')
    : ok('동기 copyFileSync 없음');
  /withTimeout|OP_TIMEOUT_MS/.test(bk)
    ? ok('연산별 상한이 있다')
    : bad('연산별 상한이 없다');
}

console.log('\n모니터가 백업 신선도를 보는가');
const stall = readFileSync(resolve(ROOT, 'scripts/check-stall.mjs'), 'utf8');
/backup-health\.mjs/.test(stall) ? ok('check-stall 이 백업을 점검한다')
  : bad('check-stall 이 백업을 안 본다 — 23일 멈춰 있어도 아무도 모른다');

console.log(fail === 0 ? '\n✅ backup-health 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
