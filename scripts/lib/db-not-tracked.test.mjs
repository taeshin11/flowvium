#!/usr/bin/env node
/**
 * db-not-tracked.test.mjs — 라이브 DB 가 git 에 추적되면 안 된다.
 *
 * 배경(2026-08-22, 내가 실제로 저지른 사고): 커밋 순서를 바꾸려고 `git reset --hard <이전커밋>`
 *   을 했더니 **data/flowvium.db 가 커밋본으로 되돌아갔다.**
 *     사고 전: reports=205 · recommendations=1481 · outcomes=1340 · buy_candidates=4382
 *     사고 후: reports=48  · recommendations=254  · outcomes=214  · buy_candidates=0
 *   라이브 DB 를 git 이 관리하고 있으니 평범한 git 조작 하나가 프로덕션을 지운다.
 *   ~/flowvium_backups 의 07:40 스냅샷으로 복구했다(그날 아침 백업을 고쳐 둔 게 살렸다).
 *
 * 더 나쁜 건 이게 이미 문서와 어긋나 있었다는 것이다 —
 *   scripts/lib/db.mjs:4 가 "data/flowvium.db (git ignore) 에 다음을 저장" 이라고 *주장* 하는데
 *   .gitignore 에는 그 항목이 없었고 파일은 추적 중이었다. 주석이 코드보다 낙관적이면
 *   아무도 확인하지 않는다. 그리고 .git 이 191MB 로 불어 있었다(매 보고서마다 새 blob).
 *
 * 이 검사는 '주장' 이 아니라 '실제 인덱스' 를 본다.
 */
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

let tracked = '';
try {
  tracked = execFileSync('git', ['ls-files', '--', 'data/flowvium.db', 'data/*.db', 'data/*.db-wal', 'data/*.db-shm'],
    { cwd: ROOT, encoding: 'utf8' }).trim();
} catch (e) {
  bad(`git ls-files 실패: ${String(e.message).slice(0, 50)}`);
  console.log('\n❌ 1건 실패'); process.exit(1);
}

tracked
  ? bad(`라이브 DB 가 git 에 추적된다: ${tracked.split('\n').join(', ')} — git reset --hard 한 번에 프로덕션이 날아간다`)
  : ok('라이브 DB 가 git 에 추적되지 않는다');

const ignore = (() => { try { return readFileSync(resolve(ROOT, '.gitignore'), 'utf8'); } catch { return ''; } })();
/^\s*(\/)?data\/(\*\.db|flowvium\.db)/m.test(ignore)
  ? ok('.gitignore 가 DB 를 덮는다')
  : bad('.gitignore 에 DB 항목이 없다 — 다음에 누가 add 하면 다시 추적된다');

// 주석이 실제와 맞는가 (이 어긋남이 사고의 배경이었다)
const db = (() => { try { return readFileSync(resolve(ROOT, 'scripts/lib/db.mjs'), 'utf8'); } catch { return ''; } })();
const claimsIgnored = /flowvium\.db \(git ignore\)/.test(db);
(claimsIgnored && !tracked) || (!claimsIgnored)
  ? ok('db.mjs 헤더의 주장이 실제 상태와 일치한다')
  : bad('db.mjs 가 "(git ignore)" 라고 주장하는데 실제로는 추적 중이다 — 주석이 코드보다 낙관적이다');

console.log(fail === 0 ? '\n✅ db-not-tracked 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
