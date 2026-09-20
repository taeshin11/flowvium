#!/usr/bin/env node
/**
 * cron-slot.test.mjs — 하루 한 번짜리 잡이 **제 시각에** 돌았는지 본다. 2026-09-20 신설.
 *
 * 왜: 2026-09-20 실측 — blog-post 가 예정 시각(22:10 UTC)에 불린 기록이 **한 번도 없다**.
 *   유일한 실행은 30시간이 지나 staleness self-heal 이 끌어낸 것이었다.
 *   shorts-health 도 같다(완료 9회 · 그중 소급 20회). 20분마다 도는 잡은 멀쩡하다
 *   (harvest-log-defects 1215회) — 기회가 하루 72번이라 몇 번 흘려도 티가 안 난다.
 *   하루 한 번짜리는 그 한 번을 흘리면 끝이고, 그물은 maxAgeH(=30h)라 하루 뒤에야 건진다.
 *   로그에 node-cron "missed execution" 이 1,055건 쌓여 있다 — 흘리는 것이 상시 상태다.
 *
 * 그래서 "몇 시간 지났나" 대신 **"오늘 그 슬롯이 지났는데 그 뒤로 안 돌았나"** 를 본다.
 *   그러면 07:10 을 놓쳐도 다음 모니터 사이클(20분)에 잡힌다.
 */
import { parseField, lastSlotBefore, isOverdue } from './cron-slot.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const U = (s) => Date.parse(s);

// [1] 필드 파싱 — 실제로 쓰이는 형태만
{
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  eq(parseField('10', 0, 59), [10]) ? ok('[1] 숫자') : bad(`[1] ${parseField('10', 0, 59)}`);
  eq(parseField('*', 0, 3), [0, 1, 2, 3]) ? ok('[1b] 별표') : bad('[1b] 별표');
  eq(parseField('1-3', 0, 6), [1, 2, 3]) ? ok('[1c] 범위') : bad('[1c] 범위');
  eq(parseField('0,30', 0, 59), [0, 30]) ? ok('[1d] 목록') : bad('[1d] 목록');
  eq(parseField('*/20', 0, 59), [0, 20, 40]) ? ok('[1e] 간격') : bad(`[1e] ${parseField('*/20', 0, 59)}`);
}

// [2] blog-post 의 실제 스케줄 — 오늘 22:10 UTC 가 지났으면 그게 마지막 슬롯이다
{
  const t = lastSlotBefore('10 22 * * *', U('2026-09-20T23:00:00Z'));
  t === U('2026-09-20T22:10:00Z') ? ok('[2] 오늘 슬롯을 집는다') : bad(`[2] ${new Date(t).toISOString()}`);
}

// [3] 아직 안 지났으면 **어제 슬롯**이다 — 오늘 것을 미리 기다렸다고 보면 안 된다
{
  const t = lastSlotBefore('10 22 * * *', U('2026-09-20T09:00:00Z'));
  t === U('2026-09-19T22:10:00Z') ? ok('[3] 지나지 않았으면 어제 슬롯') : bad(`[3] ${new Date(t).toISOString()}`);
}

// [4] 요일 제한을 지킨다 — 2026-09-20 은 일요일, 월요일 잡은 지난 월요일(09-14)이 마지막
{
  const t = lastSlotBefore('0 19 * * 1', U('2026-09-20T23:00:00Z'));
  t === U('2026-09-14T19:00:00Z') ? ok('[4] 요일 제한') : bad(`[4] ${new Date(t).toISOString()}`);
}

// [5] 모르는 형태는 **추측하지 않고** null — 부르는 쪽이 옛 방식(maxAgeH)으로 떨어진다
{
  lastSlotBefore('0 0 1 * *', U('2026-09-20T23:00:00Z')) === null
    ? ok('[5] 일/월 지정은 지원 안 함 → null') : bad('[5] 모르는 형태를 추측했다');
  lASTNULL();
  function lASTNULL() {
    lastSlotBefore('이상한거', U('2026-09-20T23:00:00Z')) === null
      ? ok('[5b] 파싱 불가 → null') : bad('[5b] 파싱 불가인데 값을 냈다');
  }
}

// [6] 오늘의 실제 사고: 07:10 KST(22:10 UTC) 슬롯이 지났는데 마지막 실행이 그 전이다
{
  const r = isOverdue({
    schedules: ['10 22 * * *'],
    lastRunAt: U('2026-09-19T03:01:00Z'),     // 실제 마지막 실행(소급으로 돈 것)
    now: U('2026-09-20T02:15:00Z'),           // 실제 점검 시각
  });
  r.overdue && r.lateMin > 200
    ? ok(`[6] 밀린 것을 잡는다 (${Math.round(r.lateMin / 60)}시간 늦음)`) : bad(`[6] ${JSON.stringify(r)}`);
}

// [7] 슬롯 직후 몇 분은 봐준다 — 잡이 도는 중일 수 있다. 그 사이에 또 부르면 두 번 돈다
{
  const r = isOverdue({ schedules: ['10 22 * * *'], lastRunAt: U('2026-09-19T22:10:00Z'), now: U('2026-09-20T22:20:00Z'), graceMin: 25 });
  !r.overdue ? ok('[7] 슬롯 직후 유예') : bad(`[7] ${JSON.stringify(r)}`);
}

// [8] 제때 돌았으면 조용하다
{
  const r = isOverdue({ schedules: ['10 22 * * *'], lastRunAt: U('2026-09-20T22:11:00Z'), now: U('2026-09-20T23:00:00Z') });
  !r.overdue ? ok('[8] 제때 돌면 조용') : bad(`[8] ${JSON.stringify(r)}`);
}

// [9] 한 번도 안 돈 잡은 밀린 것이다
{
  const r = isOverdue({ schedules: ['10 22 * * *'], lastRunAt: 0, now: U('2026-09-20T23:00:00Z') });
  r.overdue ? ok('[9] 무기록 → 밀림') : bad(`[9] ${JSON.stringify(r)}`);
}

// [10] 슬롯을 하나도 못 읽으면 판단하지 않는다 — 모르면 모른다고 한다
{
  const r = isOverdue({ schedules: ['0 0 1 * *'], lastRunAt: 0, now: U('2026-09-20T23:00:00Z') });
  r.overdue === null ? ok('[10] 모르는 스케줄 → 판단 보류') : bad(`[10] ${JSON.stringify(r)}`);
}

console.log(fail ? `\n  ❌ ${fail}건 실패` : '\n  ✅ 전부 통과');
process.exit(fail ? 1 : 0);
