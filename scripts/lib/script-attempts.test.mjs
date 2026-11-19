#!/usr/bin/env node
/**
 * script-attempts.test.mjs — 쇼츠 대본 세 번 다 규칙을 어기면 '가장 적게 어긴 시도' 를 쓴다. (2026-11-19 신설)
 *
 * 왜(11/18 실측, 8편): 시도 루프가 세 번 다 실패하면 **마지막 시도**를 그대로 냈다. 마지막이 가장 나은 것도 아니다 —
 *   첫 문장 15자 초과 2편(O3nEwqGf8f4·Oqo3yJn4GBE), 저장 요소 없음 4편. 16:20 SW5ngOooIqc 는 시도 1·2 가 같은 3가지를 어겼다.
 * 규칙(Mac mini2 11/18 승인):
 *   - 내용 규칙(출처 없는 낙인·원문에 없는 소속)을 어긴 시도는 고르지 않는다.
 *   - 그 밖에선 어긴 규칙 수가 가장 적은 시도, 같으면 나중 시도.
 *   - 깨끗한 시도가 없으면 '원문에 없는 소속' 만 어긴 시도(루프 뒤에서 그 낱말을 걷어낸다, 9/8 회차 잃은 뒤 생긴 장치).
 *   - 출처 없는 낙인만 남으면 null — 이 이슈를 접는다(채널이 남의 공격 표현을 제 말처럼 띄우면 안 된다, 9/6).
 */
import { brokenRules, pickAttempt, CONTENT_RULES } from './script-attempts.mjs';
let fail = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => { console.log(`  ❌ ${m}`); fail++; };

const flags = (o = {}) => ({ scenes: 4, chars: 270, minChars: 160, plain: 0, dupHooks: 0, echoTitle: false, noSubject: false, firstLong: false, noSave: false,
  dupSays: 0, sameEnding: false, unattributed: 0, leftovers: 0, madeUp: 0, ...o });

// [1] 어긴 규칙 이름
{
  const b = brokenRules(flags({ firstLong: true, noSave: true, echoTitle: true }));
  JSON.stringify(b) === JSON.stringify(['echoTitle', 'firstLong', 'noSave']) ? ok(`[1] ${b}`) : bad(`[1] ${b}`);
  brokenRules(flags()).length === 0 ? ok('[1b] 다 지키면 빈 목록') : bad('[1b]');
  brokenRules(flags({ chars: 100 })).includes('short') && brokenRules(flags({ scenes: 1 })).includes('tooFew') ? ok('[1c] 짧음·장면 부족') : bad('[1c]');
  CONTENT_RULES.join() === 'unattributed,madeUp' ? ok('[1d] 내용 규칙 = 낙인·소속') : bad('[1d]');
}

// [2] 11/18 19:32 O3nEwqGf8f4 꼴: 시도 1 은 첫 문장만 길고, 시도 3(마지막)은 셋을 어겼다 → 시도 1
{
  const at = [
    { n: 1, broke: brokenRules(flags({ firstLong: true })) },
    { n: 2, broke: brokenRules(flags({ firstLong: true, echoTitle: true })) },
    { n: 3, broke: brokenRules(flags({ firstLong: true, echoTitle: true, noSave: true })) },
  ];
  pickAttempt(at)?.n === 1 ? ok('[2] 마지막이 아니라 가장 적게 어긴 시도') : bad(`[2] ${pickAttempt(at)?.n}`);
}
// [3] 같으면 나중 시도
{
  const at = [{ n: 1, broke: ['noSave'] }, { n: 2, broke: ['firstLong'] }];
  pickAttempt(at)?.n === 2 ? ok('[3] 같은 수면 나중 시도') : bad('[3]');
}
// [4] 낙인을 어긴 시도는 덜 어겼어도 안 고른다
{
  const at = [{ n: 1, broke: ['unattributed'] }, { n: 2, broke: ['firstLong', 'noSave', 'echoTitle'] }];
  pickAttempt(at)?.n === 2 ? ok('[4] 출처 없는 낙인 시도는 건너뛴다') : bad(`[4] ${pickAttempt(at)?.n}`);
}
// [5] 깨끗한 게 없으면 소속만 어긴 시도(걷어낼 수 있다), 낙인만 남으면 null
{
  const a = [{ n: 1, broke: ['unattributed'] }, { n: 2, broke: ['madeUp', 'noSave'] }, { n: 3, broke: ['madeUp', 'unattributed'] }];
  pickAttempt(a)?.n === 2 ? ok('[5] 소속만 어긴 시도가 차선') : bad(`[5] ${pickAttempt(a)?.n}`);
  pickAttempt([{ n: 1, broke: ['unattributed'] }, { n: 2, broke: ['unattributed', 'madeUp'] }]) === null ? ok('[5b] 낙인만 남으면 null(이슈를 접는다)') : bad('[5b]');
  pickAttempt([]) === null ? ok('[5c] 시도가 없으면 null') : bad('[5c]');
}
// [6] 장면이 모자란 시도(tooFew)는 다른 게 있으면 안 고른다 — 다 어긴 수가 적어도 쓸 수 없다
{
  const at = [{ n: 1, broke: ['tooFew'] }, { n: 2, broke: ['firstLong', 'noSave'] }];
  pickAttempt(at)?.n === 2 ? ok('[6] 장면 부족 시도는 고르지 않는다') : bad(`[6] ${pickAttempt(at)?.n}`);
}

// [7] make-shorts 가 이 판정으로 고른다(마지막 시도를 그대로 쓰지 않는다)
{
  const { readFileSync } = await import('fs');
  const ms = readFileSync(new URL('../video/make-shorts.mjs', import.meta.url), 'utf8');
  (/pickAttempt\(attempts\)/.test(ms) && /attempts\.push\(\{ n: a, scenes, broke \}\)/.test(ms) && /scenes = chosen\?\.scenes/.test(ms))
    ? ok('[7] make-shorts 연결') : bad('[7] make-shorts 에 연결 안 됨');
}

console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
