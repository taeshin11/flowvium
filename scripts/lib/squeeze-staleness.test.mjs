#!/usr/bin/env node
/** squeeze-staleness.test.mjs — 오래 눌러앉은 등재만 빠지는가. */
import { streakDays, dropStaleSqueeze, keepFreshOnly } from './squeeze-staleness.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const D = 86400000; const now = Date.parse('2026-09-18T00:00:00Z');
const days = (n) => now - n * D;

// [1] 매일 실린 지 40일 → 연속 40일
Math.round(streakDays([...Array(40)].map((_, i) => days(i)), now)) === 39
  ? ok('매일 실린 종목의 연속 기간을 센다') : bad(`연속 기간 계산 틀림: ${streakDays([...Array(40)].map((_, i) => days(i)), now)}`);

// [2] 중간에 7일 넘게 빠졌으면 새 구간
{
  const d = [days(60), days(59), days(58), days(3), days(2), days(1)];
  const s = Math.round(streakDays(d, now));
  s <= 4 ? ok(`오래 빠졌다 다시 잡히면 새 구간으로 본다 (${s}일)`) : bad(`옛 등재까지 이어 세었다 (${s}일)`);
}

// [3] 최근에 안 실렸으면 null — 이번이 새 시작
streakDays([days(30), days(29)], now) === null
  ? ok('최근에 빠져 있었으면 연속이 아니다') : bad('빠져 있던 것을 연속으로 본다');

// [4] 기록이 없으면 빼지 않는다
{
  const { kept, dropped } = dropStaleSqueeze([{ ticker: 'NEW' }], () => [], { nowMs: now });
  kept.length === 1 && dropped.length === 0 ? ok('기록이 없으면 그대로 둔다(모르면 안 건드린다)') : bad('기록 없는 종목을 뺐다');
}

// [5] 30일 초과만 빠진다 — 실측에서 이 구간이 -11.0%p · 이긴비율 11% 였다
{
  const hist = { OLD: [...Array(45)].map((_, i) => days(i)), FRESH: [days(2), days(1), days(0)] };
  const { kept, dropped } = dropStaleSqueeze([{ ticker: 'OLD' }, { ticker: 'FRESH' }], (t) => hist[t] ?? [], { nowMs: now });
  (kept.length === 1 && kept[0].ticker === 'FRESH' && dropped[0]?.ticker === 'OLD')
    ? ok(`30일 넘게 눌러앉은 것만 뺀다 (OLD ${dropped[0].days}일)`) : bad(`빠진 대상이 틀렸다: ${JSON.stringify({ kept, dropped })}`);
}
// [6] 첫 등재만 남기기 — 실측: 첫 등재 +27.3%p(85%) vs 1~7일차 +4.6%p(52%)
{
  const hist = {
    OLD: [...Array(45)].map((_, i) => days(i)),      // 45일째 눌러앉음
    WEEK: [days(5), days(4), days(3), days(2), days(1), days(0)],  // 6일째
    TODAY: [days(0)],                                 // 오늘 처음
    REQUAL: [days(40), days(39), days(0)],            // 오래 빠졌다 오늘 다시
  };
  const es = [{ ticker: 'OLD' }, { ticker: 'WEEK' }, { ticker: 'TODAY' }, { ticker: 'REQUAL' }, { ticker: 'BRANDNEW' }];
  const { kept, dropped } = keepFreshOnly(es, (t) => hist[t] ?? [], { nowMs: now });
  const k = kept.map((x) => x.ticker).sort().join(',');
  k === 'BRANDNEW,REQUAL,TODAY'
    ? ok(`첫날과 재자격만 남는다 (뺀 것: ${dropped.map((d) => `${d.ticker} ${d.days}일`).join(' · ')})`)
    : bad(`남은 것이 틀렸다: ${k}`);
}

console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
