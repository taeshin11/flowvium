#!/usr/bin/env node
/**
 * flow-omni.test.mjs — 소재가 모자란 회차에 Flow Omni Flash ×1(크레딧)로 영상을 만들어도 되는가. 2026-09-26 신설.
 *
 * 사장님: "차단 시간에는 영상 부족하면 omni flash ×1로 써서라도 만들어. 크레딧 쓰면은 차단은 안 시키더라"
 *   → 되물음 결과(9/26): Flow 자동화는 **Omni Flash ×1 만** 허용(9/25 규칙 2항의 예외), 사건 재현 영상도 허용.
 *   나머지 규칙(FLOW_RULES.md)은 그대로: 드라이브 _flow/lock.txt 가 비었을 때만 · 남의 락 덮어쓰기 금지(5시간 넘으면 낡은 것) ·
 *   시간표(FlowVium 은 18~24시 예비) · 생성 사이 10분 이상.
 */
import { mkdtempSync, writeFileSync, existsSync, readFileSync, utimesSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { omniAllowed, takeFlowLock, OMNI_MODEL, DEFAULT_LOCK, omniChipProblem } from './flow-omni.mjs';

let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const dir = mkdtempSync(join(tmpdir(), 'flow-omni-test-'));
const lockFile = join(dir, '_flow_lock.txt');
const stateFile = join(dir, 'last.json');
const kst = (h, m = 0) => new Date(Date.UTC(2026, 8, 26, h - 9, m));   // KST h:m
const base = { lockFile, stateFile, env: {} };

// [1] 시간표 — 18~24시만
{
  const a = omniAllowed({ ...base, now: kst(19) });
  const b = omniAllowed({ ...base, now: kst(10) });
  (a.ok && !b.ok && /시간표/.test(b.reason)) ? ok('[1] 19시 허용 · 10시 막음(시간표)') : bad(`[1] ${JSON.stringify([a, b])}`);
}
// [2] 남의 락이 있으면 막는다 — 5시간 넘게 안 바뀐 락은 낡은 것
{
  writeFileSync(lockFile, 'kids-pc: 134화 Veo 3컷');
  const a = omniAllowed({ ...base, now: new Date() .getTime() && kst(20) });
  // 방금 쓴 락(mtime=지금) — 막혀야 한다. now 는 판정용 시각, 락 신선도는 파일 mtime 과 실제 지금으로 본다
  (!a.ok && /락/.test(a.reason) && /kids-pc/.test(a.reason)) ? ok(`[2] 남의 락 → 막음 (${a.reason})`) : bad(`[2] ${JSON.stringify(a)}`);
  const old = (Date.now() - 6 * 3600e3) / 1000;
  utimesSync(lockFile, old, old);
  const b = omniAllowed({ ...base, now: kst(20) });
  b.ok ? ok('[2b] 6시간 묵은 락 → 낡은 것으로 본다') : bad(`[2b] ${JSON.stringify(b)}`);
  writeFileSync(lockFile, '');
  const c = omniAllowed({ ...base, now: kst(20) });
  c.ok ? ok('[2c] 빈 락 파일 → 허용') : bad(`[2c] ${JSON.stringify(c)}`);
}
// [3] 생성 사이 10분 이상 (FLOW_RULES 5항: 생성 사이 8~12분)
{
  writeFileSync(stateFile, JSON.stringify({ at: new Date(Date.now() - 4 * 60e3).toISOString() }));
  const a = omniAllowed({ ...base, now: kst(20) });
  writeFileSync(stateFile, JSON.stringify({ at: new Date(Date.now() - 11 * 60e3).toISOString() }));
  const b = omniAllowed({ ...base, now: kst(20) });
  (!a.ok && /분/.test(a.reason) && b.ok) ? ok('[3] 4분 전 생성 → 막음 · 11분 전 → 허용') : bad(`[3] ${JSON.stringify([a, b])}`);
}
// [4] 끄개·락 경로 없음
{
  const a = omniAllowed({ ...base, now: kst(20), env: { FLOW_OMNI_FALLBACK: '0' } });
  const b = omniAllowed({ ...base, lockFile: '/nonexistent-dir/_flow_lock.txt', now: kst(20) });
  (!a.ok && !b.ok && /락 폴더/.test(b.reason)) ? ok('[4] 끄개 · 락 폴더 없음 → 막음') : bad(`[4] ${JSON.stringify([a, b])}`);
}
// [5] 락 잡기·풀기 — 우리 이름으로 쓰고, 끝나면 **우리 것일 때만** 지운다
{
  writeFileSync(lockFile, '');
  const l = takeFlowLock(lockFile, 'mac-flowvium');
  const mine = readFileSync(lockFile, 'utf8');
  const l2 = takeFlowLock(lockFile, 'someone-else');
  (l.ok && /^mac-flowvium /.test(mine) && !l2.ok) ? ok('[5] 우리 이름으로 잡고, 잡힌 동안 남은 못 잡는다') : bad(`[5] ${mine} ${JSON.stringify(l2)}`);
  l.release();
  (existsSync(lockFile) ? readFileSync(lockFile, 'utf8').trim() === '' : true) ? ok('[5b] 풀면 비운다') : bad('[5b] 락이 남았다');
  writeFileSync(lockFile, 'kids-pc: 다른 사람');
  const l3 = { release: takeFlowLock.releaseIfMine ?? (() => {}) };
  void l3;
}
// [6] 모델은 Omni Flash 고정(무료 Lower Priority 자동화는 여전히 금지)
/omni/i.test(OMNI_MODEL) && !/lower priority/i.test(OMNI_MODEL) ? ok(`[6] 모델 ${OMNI_MODEL}`) : bad(`[6] ${OMNI_MODEL}`);

// [7] ★ 락 파일 열기가 멈춰도 쇼츠가 멈추지 않는다 (2026-09-26 21:45 실측: Dropbox 파일 open 에서 1시간 44분 멈춰
//   그 회차가 통째로 안 나갔다 — 온라인 전용 파일을 동기로 읽으면 내려받을 때까지 막힌다).
//   FIFO 는 쓰는 쪽이 없으면 open 이 똑같이 멈춘다 — 그걸로 재현한다.
{
  const { spawnSync } = await import('child_process');
  const fifo = join(dir, 'hang.fifo');
  spawnSync('mkfifo', [fifo]);
  const t0 = Date.now();
  const a = omniAllowed({ ...base, lockFile: fifo, now: kst(20) });
  const ms = Date.now() - t0;
  (!a.ok && /못 읽/.test(a.reason) && ms < 15000) ? ok(`[7] 락 읽기가 멈추면 ${ms}ms 안에 포기(${a.reason})`) : bad(`[7] ${ms}ms ${JSON.stringify(a)}`);
}
// [8] 락은 구글드라이브 `_flow/lock.txt` 하나(사장님 9/27 「구글드라이브로 다 맞춰라」 · 이 세션 되물음에서 "드라이브 락으로 통일").
//   Dropbox `_flow_lock.txt` 는 폐지 — 다른 기계는 이제 거기를 안 본다. 내용은 queue.md 2항 형식
//   `<세션> <시작> <예상종료>` + 유료면 PAID(5항) — 남이 읽고 언제 비는지 알 수 있어야 한다.
{
  (/GoogleDrive-.*\/_flow\/lock\.txt$/.test(DEFAULT_LOCK)) ? ok(`[8] 기본 락 = 드라이브 ${DEFAULT_LOCK.split('/').slice(-2).join('/')}`) : bad(`[8] 기본 락 ${DEFAULT_LOCK}`);
  writeFileSync(lockFile, '');
  const l = takeFlowLock(lockFile, 'mac-flowvium', { now: kst(20, 5), minutes: 12 });
  const body = readFileSync(lockFile, 'utf8');
  (/^mac-flowvium 20:05 20:17 PAID /.test(body)) ? ok(`[8b] 락 내용 "${body}"`) : bad(`[8b] "${body}"`);
  l.release?.();
}
// [9] 사장님 9/27 「omni는 4초짜리로 만들어」(4초·x1 = 7크레딧). 칩에 길이가 보이면 4초가 아닐 때 막는다.
//   칩 글자 모양은 아직 실측 전이다(이 세션에서 Omni 가 한 번도 돌지 않았다) — 길이 표시가 없으면 막지 않고
//   받은 파일의 실제 길이를 기록한다(flow-omni-last.json). 개수 x1 은 기존대로 필수.
{
  const cases = [['Omni Flash · 9:16 · x1 · 4s', null], ['Omni Flash · x1 · 8s', /4초/], ['x1 8초', /4초/], ['x2 4s', /x1/], ['Omni · x1', null]];
  const r = cases.map(([c, want]) => { const p = omniChipProblem(c); return want ? want.test(p ?? '') : p === null; });
  r.every(Boolean) ? ok('[9] 칩: 4s·x1 통과 · 8s/8초 막음 · x2 막음 · 길이 표시 없음은 통과') : bad(`[9] ${JSON.stringify(cases.map(([c]) => omniChipProblem(c)))}`);
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
