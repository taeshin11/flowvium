#!/usr/bin/env node
/** agy-task.test.mjs — 되먹임 프롬프트가 쓸모 있는가. 2026-09-20 신설. */
import { trimTestOutput, buildFeedback, roundVerdict } from './agy-task.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

const OUT = [
  '  PASS  [1] 원문에 있는 고유명사 통과',
  '  PASS  [2] 원문에 없는 회사명 검출',
  '  FAIL  [3] 실패: [AI,S&P500]',
  '  PASS  [4] 빈 텍스트 입력 통과',
  '',
  '❌ 1 실패',
].join('\n');

// [1] 실패 줄만 추린다 — 통과 줄까지 보내면 프롬프트가 로그로 가득 찬다
{
  const t = trimTestOutput(OUT);
  t.includes('[3]') && !t.includes('[1]') ? ok('[1] 실패 줄만 남긴다') : bad(`[1] ${JSON.stringify(t)}`);
}

// [2] 실패 줄이 하나도 없으면(컴파일 오류 등) 끝부분을 준다 — 원인이 대개 끝에 있다
{
  const t = trimTestOutput('가\n나\n다\n라');
  t.includes('라') ? ok('[2] 실패 표시가 없으면 끝부분을 준다') : bad(`[2] ${JSON.stringify(t)}`);
}

// [3] 길어도 상한을 지킨다
{
  const t = trimTestOutput(Array.from({ length: 500 }, (_, i) => `FAIL ${i}`).join('\n'), { maxLines: 10 });
  t.split('\n').length === 10 ? ok('[3] 상한 10줄') : bad(`[3] ${t.split('\n').length}줄`);
}

// [4] 되먹임은 **무엇이 깨졌는지**를 담되 고치는 방법은 주지 않는다
//     방법까지 적으면 내가 코드를 쓰는 것과 같아서 맡기는 뜻이 없어진다
{
  const p = buildFeedback({ round: 1, testCmd: 'node x.test.mjs', output: OUT });
  p.includes('[3]') ? ok('[4] 실패 내용이 들어간다') : bad('[4] 실패 내용 없음');
  /기대값이 틀렸다고 생각하면/.test(p)
    ? ok('[4b] 기대값을 멋대로 바꾸지 말라고 이른다') : bad('[4b] 그 경고가 없다');
  /터미널 명령은 쓰지 마라/.test(p)
    ? ok('[4c] 셸을 막는다(헤드리스에서 권한 프롬프트를 못 띄운다)') : bad('[4c] 셸 제한 문구 없음');
}

// [5] 판정 문구에 회차와 바뀐 파일 수가 보인다 — 아무것도 안 바뀌면 그것도 신호다
{
  roundVerdict({ round: 2, passed: true, changedFiles: 2 }).includes('2회차 통과')
    ? ok('[5] 통과 문구') : bad('[5] 통과 문구 이상');
  roundVerdict({ round: 1, passed: false, changedFiles: 0 }).includes('바뀐 파일 0개')
    ? ok('[5b] 안 바뀐 것도 보인다') : bad('[5b] 변경 수가 안 보인다');
}

console.log(fail ? `\n  ❌ ${fail}건 실패` : '\n  ✅ 전부 통과');
process.exit(fail ? 1 : 0);
