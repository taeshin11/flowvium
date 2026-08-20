#!/usr/bin/env node
/**
 * segment-rotation.test.mjs — 세그먼트 갱신 회전이 실패 종목에 갇히지 않는가.
 *
 * 배경(2026-08-20 실측): cron 의 segments-refresh 가 15회 연속 ✓0 ✗6 (성공률 0.0%)이었다.
 *   20분마다 27B GPU 를 쓰면서 아무것도 못 만들었고, 조절기는 시간당 20~56회 정지를 걸고 있었다.
 *   원인은 두 겹이었다:
 *     ① model 기본값이 옛 Ollama 별칭 'flowvium-local' → mlx 404 (llm-config 로 해결)
 *     ② db.mjs:618 getSegmentTickersToRefresh 가
 *          const missing = us.filter(t => !have.has(t));
 *          return [...missing, ...stale].slice(0, n);
 *        실패는 company_segments 에 행을 안 남기므로 영원히 missing 맨 앞 →
 *        매 주기 같은 6개(BRK.B·TSM·GOOGL·UNH·ABT·ISRG)를 다시 고른다.
 *   일반 미국 대형주로는 4/5 성공한다(MSFT·NVDA·JNJ·KO) — 잡이 고장난 게 아니라 회전이 갇힌 것이다.
 */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

let R;
try { R = await import('./segment-rotation.mjs'); }
catch (e) { console.log(`  FAIL  모듈 없음: ${e.message}`); process.exit(1); }

const dir = mkdtempSync(join(tmpdir(), 'segrot-'));
const DB = join(dir, 't.db');
const rot = R.openRotation(DB);
const UNIVERSE = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

// [1] 아무 이력 없으면 앞에서부터
let pick = rot.pick(UNIVERSE, new Set(), 3);
pick.length === 3 ? ok(`초기 선택 3개: ${pick.join(',')}`) : bad(`초기 선택 ${pick.length}`);

// [2] 핵심 — 실패를 기록하면 다음 회전은 다른 종목을 골라야 한다
for (const t of pick) rot.recordAttempt(t, 'no-total-row');
const pick2 = rot.pick(UNIVERSE, new Set(), 3);
pick2.some(t => pick.includes(t))
  ? bad(`같은 종목 재선택: ${pick2.join(',')} (이전 ${pick.join(',')})`)
  : ok(`실패 후 다음 종목으로 전진: ${pick2.join(',')}`);

// [3] 성공한 종목은 보유 집합에 들어가 대상에서 빠진다
for (const t of pick2) rot.recordAttempt(t, null);
const have = new Set(pick2);
const pick3 = rot.pick(UNIVERSE, have, 3);
!pick3.some(t => have.has(t)) ? ok(`보유 종목 제외: ${pick3.join(',')}`) : bad('보유 종목을 다시 고름');

// [4] 반복 실패는 백오프 — 유한 우주를 한 바퀴 돈 뒤에도 즉시 재시도하면 안 된다
for (let round = 0; round < 3; round++) for (const t of UNIVERSE) rot.recordAttempt(t, 'no-region');
const backedOff = rot.pick(UNIVERSE, new Set(), 8);
backedOff.length < UNIVERSE.length
  ? ok(`반복 실패 종목 백오프 (대상 ${backedOff.length}/${UNIVERSE.length})`)
  : bad('백오프 없음 — GPU 를 계속 태운다');

// [5] 전부 백오프면 빈 배열 — 돌지 말아야 한다(빈 실행이 GPU 를 안 쓴다)
for (let round = 0; round < 6; round++) for (const t of UNIVERSE) rot.recordAttempt(t, 'no-region');
const none = rot.pick(UNIVERSE, new Set(), 8);
none.length === 0 ? ok('전부 백오프 → 대상 0 (헛돌지 않음)') : bad(`백오프인데 ${none.length}개 선택`);

// [6] 진단이 남아야 한다 — 무엇이 왜 실패했는지
const st = rot.stats();
st.total === UNIVERSE.length && st.byError['no-region'] > 0
  ? ok(`실패 사유 집계: ${JSON.stringify(st.byError)}`) : bad(`집계 이상: ${JSON.stringify(st)}`);

rot.close(); rmSync(dir, { recursive: true, force: true });
console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
