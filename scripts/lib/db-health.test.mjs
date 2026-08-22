#!/usr/bin/env node
/**
 * db-health.test.mjs — 라이브 DB 가 뒤로 가면 모니터가 잡는가.
 *
 * 배경(2026-08-22, 내가 낸 사고): `git reset --hard <이전커밋>` 으로 추적 중이던
 *   data/flowvium.db 가 커밋본으로 되돌아갔다.
 *     reports 205→48 · recommendations 1481→254 · outcomes 1340→214 · buy_candidates 4382→0
 *   **검사 10종 중 어느 것도 이걸 못 봤다.** check-stall 은 DB 를 열지만(73행)
 *   최신 보고서 한 줄만 읽는다. 내가 우연히 테스트를 돌려서 알았을 뿐이다.
 *   백업의 복원가능성([9])은 보면서 *라이브 DB 자체* 는 아무도 안 보고 있었다.
 *
 * 판정 기준을 어디서 얻나 — 임계값을 손으로 정하지 않는다:
 *   ① `PRAGMA quick_check` (실측 51ms)
 *   ② **백업과의 대조.** ~/flowvium_backups 는 git 이 건드릴 수 없는 독립 사본이고
 *      라이브에서 떠간 것이므로 정상 상태에서는 언제나 live ≥ backup 이다.
 *      live < backup 이면 라이브가 뒤로 갔다는 뜻이다. 오늘 사고의 signature 그대로다.
 *   ③ 감소가 정상인 테이블은 **소스에서 유도** 한다 — 저장소에 `DELETE FROM <t>` 가
 *      있는 테이블만 제외한다. 목록을 손으로 적으면 새 삭제 경로가 생길 때 오경보가 난다.
 *      실측: 삭제가 있는 테이블은 3개(recommendations·recommendation_outcomes·translation_backlog).
 *      오늘 피해가 드러난 reports·buy_candidates·hallucination_history 는 삭제 경로가 없어
 *      제외해도 사고는 잡힌다.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

// 2026-08-22: 이 테스트도 자기 전제조건을 선언한다. CI(깨끗한 clone)엔 데이터가 든 DB 도
//   대조할 백업도 없다 — 실제로 이 선언을 빠뜨린 채 CI 시뮬을 돌렸다가 내 기전에 내가 걸렸다.
import { requires } from './test-env.mjs';
await requires({ dbTables: ['reports'], backup: true });

const M = await import('./db-health.mjs').catch((e) => { bad(`db-health.mjs 없음: ${String(e.message).slice(0,50)}`); return null; });
if (!M) { console.log('\n❌ 1건 실패'); process.exit(1); }

// [1] 삭제 허용 테이블을 소스에서 유도하는가
const shrinkable = M.shrinkableTables(ROOT);
shrinkable.has('translation_backlog')
  ? ok(`감소 허용 테이블을 소스에서 유도 (${[...shrinkable].sort().join(', ')})`)
  : bad(`translation_backlog 이 유도 결과에 없다 — DELETE 스캔이 동작하지 않는다`);
!shrinkable.has('reports') && !shrinkable.has('buy_candidates')
  ? ok('삭제 경로가 없는 테이블은 감소 허용에서 빠진다')
  : bad('삭제 경로가 없는 테이블까지 감소를 허용한다 — 오늘 사고를 놓친다');

// [2] 순수 비교 로직 — 오늘 사고의 실제 숫자로
const live   = { reports: 48,  recommendations: 254,  buy_candidates: 0,    translation_backlog: 3 };
const backup = { reports: 205, recommendations: 1481, buy_candidates: 4382, translation_backlog: 40 };
const reg = M.findRegressions(live, backup, shrinkable);
const names = reg.map(r => r.table).sort();
names.includes('reports') && names.includes('buy_candidates')
  ? ok(`사고 숫자로 회귀 검출: ${names.join(', ')}`)
  : bad(`회귀를 못 잡는다 (검출=${names.join(', ') || '없음'})`);
!names.includes('translation_backlog')
  ? ok('작업 큐의 정상 감소는 결함이 아니다')
  : bad('translation_backlog 감소를 결함으로 센다 — 매 주기 오경보');
!names.includes('recommendations')
  ? ok('수동 정리 스크립트가 삭제하는 테이블은 제외된다')
  : bad('수동 정리 대상까지 결함으로 센다');

// [3] 증가는 정상
M.findRegressions({ reports: 210 }, { reports: 205 }, shrinkable).length === 0
  ? ok('증가는 결함이 아니다')
  : bad('행이 늘어난 걸 결함으로 센다');

// [4] 실제 DB 로 동작
const h = await M.dbHealth(ROOT);
h.quickCheck === 'ok' ? ok(`라이브 DB quick_check=${h.quickCheck} (${h.ms}ms)`) : bad(`quick_check=${h.quickCheck}`);
h.backupPath ? ok(`대조 백업: ${h.backupPath.split('/').pop()}`) : bad('대조할 백업이 없다 — 판정 근거가 사라진다');
h.regressions.length === 0
  ? ok('현재 라이브 DB 에 회귀 없음')
  : bad(`회귀 ${h.regressions.length}건: ${h.regressions.slice(0,3).map(r=>`${r.table} ${r.live}<${r.backup}`).join(', ')}`);

// [5] 모니터 배선
const cs = readFileSync(resolve(ROOT, 'scripts/check-stall.mjs'), 'utf8');
/dbHealth/.test(cs) ? ok('check-stall 이 호출한다') : bad('검사기를 만들었는데 모니터가 안 부른다 — 소비처 0');

console.log(fail === 0 ? '\n✅ db-health 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
