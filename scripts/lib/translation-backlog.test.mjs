#!/usr/bin/env node
/**
 * translation-backlog.test.mjs — 거부된 번역을 대기열에 남겨 27B 가 나중에 채운다.
 *
 * 배경(2026-08-20 실측, 홈 화면 눈검증): 사용자에게 영문이 그대로 보이는 3건이 남아 있었다.
 *     "hawkish (prev 224K/wk)"  → 4B "호각적 (전 224K/주)"  (오역: 정답은 '매파적'. 한국어라 게이트 통과)
 *     "Pharma / Biotech"        → garbage-fallback   (가드가 거부 → 원문 노출)
 *     "Industrial conglomerates, machinery, aerospace, and transportation companies."
 *                               → mixed-fallback     (가드가 거부 → 원문 노출)
 *   가드는 제대로 동작한다 — 나쁜 번역 대신 원문을 보여준다. 문제는 그 다음이 없다는 것이다.
 *   같은 문자열이 다음에도 또 4B 로 가서 또 거부되고, 영원히 영문으로 남는다.
 *
 *   27B 를 웹에 붙이는 건 답이 아니다 — 실측으로 확인: 이 검증 도중 27B 는
 *   segments-refresh cron 의 4,609토큰 프리필에 점유돼 300초 타임아웃이 났다.
 *   대신 거부를 기록해 두고, 한가할 때 27B 가 채워 사전에 넣는다.
 */
import { existsSync, rmSync } from 'fs';
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

let B;
try { B = await import('./translation-backlog.mjs'); }
catch (e) { console.log(`  FAIL  모듈 없음: ${e.message}`); process.exit(1); }

const DB = '/tmp/tb-test.db';
if (existsSync(DB)) rmSync(DB);
const bl = B.openBacklog(DB);

bl.record('Pharma / Biotech', 'ko', 'garbage-fallback');
bl.pending('ko').some(r => r.text === 'Pharma / Biotech') ? ok('거부 기록 → 대기열') : bad('기록 안 됨');

// 같은 문자열이 반복 거부돼도 행이 늘면 안 된다 — 횟수만 오른다(우선순위 근거)
bl.record('Pharma / Biotech', 'ko', 'mixed-fallback');
bl.record('Pharma / Biotech', 'ko', 'garbage-fallback');
const rows = bl.pending('ko').filter(r => r.text === 'Pharma / Biotech');
rows.length === 1 ? ok('중복 거부는 1행 유지') : bad(`행이 ${rows.length}개로 늘어남`);
rows[0].hits === 3 ? ok(`거부 횟수 누적 (${rows[0].hits})`) : bad(`횟수 ${rows[0].hits} (3 기대)`);
rows[0].last_reason === 'garbage-fallback' ? ok('마지막 사유 보존') : bad(`사유: ${rows[0].last_reason}`);

// 자주 거부된 것이 먼저 — 27B 시간은 유한하다
bl.record('rare term', 'ko', 'mixed-fallback');
bl.pending('ko')[0].text === 'Pharma / Biotech' ? ok('거부 잦은 순 정렬') : bad('정렬 안 됨');

// 로케일 분리
bl.pending('ja').length === 0 ? ok('로케일 분리') : bad('로케일이 섞임');

// 해결되면 대기열에서 빠져야 한다 — 안 그러면 매번 다시 번역한다
bl.resolve('Pharma / Biotech', 'ko');
!bl.pending('ko').some(r => r.text === 'Pharma / Biotech') ? ok('해결 시 대기열 제거') : bad('해결됐는데 남아 있음');

// 지나치게 긴 문자열은 용어가 아니라 문단이다 — 사전 대상이 아니므로 받지 않는다
bl.record('x'.repeat(500), 'ko', 'mixed-fallback');
!bl.pending('ko').some(r => r.text.length > 300) ? ok('과도하게 긴 입력 거부') : bad('문단이 대기열에 들어감');

bl.close(); rmSync(DB, { force: true });

// ── 2026-08-31: 번역 불가능한 문자열이 27B 를 영원히 깨운다 ───────────────────────
//   실측 — translate-seed 는 매시 25분에 돈다. 그런데 translation_memory 의 마지막 27B 행은
//   08-23 이고 그 뒤 8일간 0건이다. 그동안 :8000 은 이 잡에게 4일간 421회 깨워졌다
//   (mlx.log 분(minute) 분포 :25 = 421건, 전체 idle 시간대 최대 소비자).
//
//   원인: 실패에 기억이 없다. seed-translation-memory.mjs 는 성공하면 backlog.resolve() 로
//   빼지만, 가드가 거부한 것은 아무 데도 기록하지 않는다. 그래서 다음 회차에 같은 문자열이
//   다시 맨 앞에 선다(pending 은 hits DESC 정렬이라 자주 거부된 것이 *먼저* 온다).
//
//   그 문자열들은 원리적으로 번역될 수 없다 — 실행 로그에서 확인:
//     ✗ EWY 1w, F&G → 번역 안 됨: "EWY 1주, F&G"      (차트 툴팁 조각)
//     ✗ TSM 1w, 59  → 번역 안 됨: "TSM 1주, 59"
//     ✗ tyChg3m     → tyChg3m                          (데이터 필드명)
//   isUntranslated 는 옳게 거부한다. 없는 것은 "이건 다시 시도해도 소용없다" 는 기억이다.
{
  const DB2 = '/tmp/tb-test-exhaust.db';
  if (existsSync(DB2)) rmSync(DB2);
  const b2 = B.openBacklog(DB2);

  // 일시적 실패(타임아웃·HTTP)는 소진으로 세면 안 된다 — 서버가 죽어 있던 3일 동안
  // 멀쩡한 용어들이 전부 은퇴해 버리면 그게 더 큰 사고다.
  for (let i = 0; i < 9; i++) b2.recordFailure('Short squeeze candidate', 'ko', 'timeout', { transient: true });
  b2.isExhausted('Short squeeze candidate', 'ko')
    ? bad('일시적 실패(타임아웃)로 멀쩡한 용어를 은퇴시켰다 — 서버 장애 때 사전이 통째로 죽는다')
    : ok('일시적 실패는 소진으로 세지 않는다');

  // 결정론적 거부(가드)는 같은 입력에 같은 결과다. 반복해도 소용없으니 은퇴시킨다.
  for (let i = 0; i < B.MAX_GUARD_FAILURES; i++) b2.recordFailure('EWY 1w, F&G', 'ko', 'untranslated');
  b2.isExhausted('EWY 1w, F&G', 'ko')
    ? ok(`가드 거부 ${B.MAX_GUARD_FAILURES}회 → 소진 처리`)
    : bad('번역 불가 문자열이 계속 27B 를 깨운다');

  // 소진된 것은 대기열에서도 빠져야 한다 — pending 이 hits DESC 라 안 빼면 *맨 앞* 에 남는다.
  b2.record('EWY 1w, F&G', 'ko', 'garbage-fallback');
  !b2.pending('ko').some(r => r.text === 'EWY 1w, F&G')
    ? ok('소진된 항목은 대기열에서 제외')
    : bad('소진됐는데 여전히 대기열 선두 — 매시간 다시 번역된다');

  // 아직 소진 전이면 계속 시도해야 한다(과잉 은퇴 방지)
  b2.recordFailure('Late Mover', 'ko', 'untranslated');
  !b2.isExhausted('Late Mover', 'ko') ? ok('1회 실패로는 은퇴시키지 않는다') : bad('한 번 실패에 은퇴');

  // 나중에 사람이 사전에 넣었다면 소진 기록도 사라져야 한다(resolve 가 완전 청소)
  b2.resolve('EWY 1w, F&G', 'ko');
  !b2.isExhausted('EWY 1w, F&G', 'ko') ? ok('resolve 는 소진 기록까지 청소') : bad('resolve 후에도 소진 상태로 남음');

  b2.close(); rmSync(DB2, { force: true });
}

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
