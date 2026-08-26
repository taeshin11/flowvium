#!/usr/bin/env node
/**
 * unscheduled-guard.test.mjs — 비정기 발간(shock/catchup)이 정기 발간을 굶기지 않는가.
 *
 * 사건(2026-08-26, 사용자 "오늘 오전 7시 보고서 왜 안올라 왔니"):
 *   오전 7시 발간이 없었다. 추적하니 전날 밤부터 이어진 연쇄였다.
 *     08-25 22:20  [shock] 비정기 발간 트리거     → 'evening' 라벨로 생성
 *     08-25 22:30  midnight 정기작업 [SKIP]       ← shock 이 락 보유
 *                  → midnight 보고서 부재
 *     08-26 05:20  [catchup] "midnight 누락" 판단 → backfill 트리거
 *     08-26 05:30  morning  정기작업 [SKIP]       ← catchup 이 락 보유
 *                  → 오전 7시 발간 없음
 *
 *   실측: 최근 3일간 같은 형태로 3회.
 *     08-24 22:30 SKIP(shock 22:20) · 08-25 22:30 SKIP(shock 22:20) · 08-26 05:30 SKIP(catchup 05:20)
 *
 * 구조적 원인: 두 안전망이 20분마다 돌아 항상 :20 에 뜨고 정기 트리거는 :30 이다.
 *   생성이 ~50분(예산 90분) 걸리므로 **정기 실행이 매번 락 싸움에서 진다.**
 *   기존 가드(cron-runner :602-607, 2026-07-02 신설)는 "현재 세션이 이미 발간됐나"만 보고
 *   "곧 정기 실행이 있나"는 보지 않는다.
 *
 * 규칙: 비정기 실행이 정기 트리거 시각까지 락을 붙들 것 같으면 시작하지 않는다.
 *   정기 실행이 그 일을 곧 하므로 안전망이 나설 이유가 없다. 임계는 세션 예산에서 파생한다
 *   (하드코딩 금지 — 예산이 바뀌면 같이 움직여야 한다).
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const S = await import('./report-sessions.mjs');
if (typeof S.minutesToNextScheduledRun !== 'function' || typeof S.shouldDeferUnscheduled !== 'function') {
  bad('minutesToNextScheduledRun() / shouldDeferUnscheduled() 없음 — 스케줄 인지 가드가 없다');
  console.log('\n❌ 실패'); process.exit(1);
}

/** KST 시각을 epoch ms 로. (테스트 결정성 — 실행 시각에 의존하지 않는다) */
const kst = (h, m) => Date.UTC(2026, 7, 26, h - 9, m, 0);

// [1] 실측 사건 재현 — 05:20 에는 05:30 정기 실행이 10분 뒤다
{
  const mins = S.minutesToNextScheduledRun(kst(5, 20));
  mins === 10 ? ok(`05:20 → 다음 정기까지 ${mins}분`) : bad(`계산 오류: ${mins}분 (기대 10)`);
  const d = S.shouldDeferUnscheduled(kst(5, 20));
  d.defer === true ? ok(`05:20 비정기 보류: ${d.reason}`) : bad('아침을 굶긴 그 시각에 그대로 실행한다');
}
// [2] shock 이 midnight 를 굶긴 시각
{
  const d = S.shouldDeferUnscheduled(kst(22, 20));
  d.defer === true ? ok(`22:20 비정기 보류: ${d.reason}`) : bad('midnight 를 굶긴 시각에 그대로 실행한다');
}
// [3] 정기 실행과 멀면 안전망은 정상 작동해야 한다 (과잉 억제 = 안전망 무력화)
for (const [h, m] of [[2, 0], [8, 0], [12, 30], [17, 0]]) {
  const d = S.shouldDeferUnscheduled(kst(h, m));
  d.defer === false
    ? ok(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')} 는 실행 허용 (다음 정기까지 ${S.minutesToNextScheduledRun(kst(h,m))}분)`)
    : bad(`${h}:${m} 까지 막으면 안전망이 죽는다: ${d.reason}`);
}
// [4] 임계가 세션 예산에서 파생되는가 — 숫자를 박으면 예산 변경 시 갈린다
{
  const budget = S.maxSessionBudgetMin();
  const justInside = S.shouldDeferUnscheduled(kst(5, 30) - (budget - 5) * 60000);
  const justOutside = S.shouldDeferUnscheduled(kst(5, 30) - (budget + 5) * 60000);
  justInside.defer === true && justOutside.defer === false
    ? ok(`임계 = 세션 예산 ${budget}분 (예산 안쪽은 보류, 바깥은 허용)`)
    : bad(`예산 파생이 아니다: inside=${justInside.defer} outside=${justOutside.defer}`);
}
// [5] 자정을 넘어가는 경우 (23:50 → 다음 정기는 이튿날 05:30)
{
  const mins = S.minutesToNextScheduledRun(kst(23, 50));
  mins === 340 ? ok(`23:50 → 다음날 05:30 까지 ${mins}분`) : bad(`자정 넘김 계산 오류: ${mins}분 (기대 340)`);
}
// [6] 배선 — shock 과 catchup 둘 다 이 가드를 쓰는가 (한쪽만 고치면 연쇄가 남는다)
{
  const src = readFileSync(resolve(ROOT, 'scripts/cron-runner.mjs'), 'utf8')
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  (src.match(/shouldDeferUnscheduled\(/g) || []).length >= 2
    ? ok('shock·catchup 둘 다 가드를 쓴다')
    : bad('한쪽만 가드가 있다 — 다른 쪽이 같은 연쇄를 만든다');
}

console.log(fail === 0 ? '\n✅ unscheduled-guard 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
