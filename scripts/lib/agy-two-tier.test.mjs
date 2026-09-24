#!/usr/bin/env node
/**
 * agy-two-tier.test.mjs — agy 가 한 모델에서 실패하면 **다른 모델로 한 번 더** 간다. 2026-09-23 신설.
 *
 * 왜 (사장님 "27B를 내릴수 있도록 agy의 claude opus 4.6 써"):
 *   27B 를 폴백으로 남겨 둔 이유는 agy 가 실제로 실패하기 때문이다 —
 *   오늘 실측: noon 2건(opportunity·fact-check:ADBE) · afternoon 1건(macro, 로컬에서 698.9초).
 *   그런데 agy 에는 계열이 다른 모델이 더 있다. 한 모델이 못 하면 다른 모델에 물으면 된다.
 *   그러면 로컬로 내려갈 일이 거의 없어지고, 27B 를 내릴 수 있다.
 *
 * 그냥 모델 이름만 바꾸면 안 된다 — 오늘 Claude 에서 함정 둘을 쟀다:
 *   (1) 셸 금지가 프롬프트 **파일 안에만** 있으면, Claude 는 그 파일을 읽으려고 RunCommand 를
 *       먼저 써서 거부당하고 턴이 통째로 취소된다(실측 7.4초·response 0자·denied_actions=[RunCommand]).
 *       금지는 **-p 인자에** 있어야 한다.
 *   (2) Claude 는 `--json-schema` 를 안 지킨다. 스키마가 ok/findings 인데 inconsistencies 로 답했다.
 *       출력 계약을 **글로** 박아야 한다.
 *
 * 그리고 누가 썼는지 세어야 한다 — 보고서 저자 라벨이 그걸로 정해진다(오늘 아침 고친 그 칸).
 */
import { agyReport, agyModelUsage, resetAgyModelUsage, AGY_MODEL_CHAIN, isMetaReply, resetAgyBreaker } from './agy-report.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const envelope = (obj) => JSON.stringify({ status: 'SUCCESS', structured_output: obj });

// [1] 사슬의 각 칸은 **서로 다른 gemini 모델**이다 (2026-09-25 사장님 "gemini 쓰면되지")
{
  // 종전엔 "계열이 달라야 같은 이유로 같이 안 죽는다" 를 못박았다. 실측은 반대였다 —
  //   claude-opus 37회 · gpt-oss 4회가 할당량 소진(429)으로 떨어졌고 gemini 는 0회였다.
  //   다른 계열 칸은 예비가 아니라 매번 ~155초를 버리는 자리였다. 지킬 성질은 이제
  //   **같은 모델을 두 번 부르지 않는다**(같은 모델 반복은 같은 이유로 같이 실패한다)와 gemini 만 쓴다는 결정이다.
  const distinct = new Set(AGY_MODEL_CHAIN).size === AGY_MODEL_CHAIN.length;
  const allGemini = AGY_MODEL_CHAIN.every((m) => /^gemini-/.test(m));
  AGY_MODEL_CHAIN.length >= 2 && distinct && allGemini
    ? ok(`[1] 사슬 ${AGY_MODEL_CHAIN.length}단, 서로 다른 gemini 모델: ${AGY_MODEL_CHAIN.join(' → ')}`)
    : bad(`[1] 사슬: ${JSON.stringify(AGY_MODEL_CHAIN)} (중복=${!distinct} · gemini 외=${!allGemini})`);
}

// [2] 1차가 실패하면 2차로 간다
{
  resetAgyModelUsage();
  const seen = [];
  // 순서에 기대지 않는다 — **사슬의 1차**를 실패시키고 2차가 받는지만 본다.
  const impl = async (args) => {
    const m = args[args.indexOf('--model') + 1];
    seen.push(m);
    if (m === AGY_MODEL_CHAIN[0]) return { stdout: '쓰레기 — JSON 아님', stderr: '' };
    return { stdout: envelope({ thesis: 'ok' }), stderr: '' };
  };
  const out = await agyReport('테스트', { label: 't', agyImpl: impl });
  out && seen.length === 2 && seen[1] === AGY_MODEL_CHAIN[1]
    ? ok(`[2] 1차 실패 → 2차(${seen[1]})가 받는다`) : bad(`[2] out=${!!out} seen=${JSON.stringify(seen)}`);
}

// [3] 1차가 성공하면 2차를 부르지 않는다 — 두 번 부르면 시간이 두 배다
{
  resetAgyModelUsage();
  let n = 0;
  await agyReport('테스트', { label: 't', agyImpl: async () => { n++; return { stdout: envelope({ a: 1 }), stderr: '' }; } });
  n === 1 ? ok('[3] 1차 성공이면 한 번만 부른다') : bad(`[3] ${n}회 불렀다`);
}

// [4] 누가 썼는지 센다 — 보고서 저자 라벨이 이 값으로 정해진다
{
  resetAgyModelUsage();
  const impl = async (args) => {
    const m = args[args.indexOf('--model') + 1];
    return m === AGY_MODEL_CHAIN[0] ? { stdout: '깨짐', stderr: '' } : { stdout: envelope({ a: 1 }), stderr: '' };
  };
  await agyReport('x', { label: 'a', agyImpl: impl });                                        // 2차가 받는다
  await agyReport('y', { label: 'b', agyImpl: async () => ({ stdout: envelope({ a: 1 }), stderr: '' }) }); // 1차가 받는다
  const u = agyModelUsage();
  (u.get(AGY_MODEL_CHAIN[0]) ?? 0) === 1 && (u.get(AGY_MODEL_CHAIN[1]) ?? 0) === 1
    ? ok(`[4] 모델별 성공 횟수를 센다 (${[...u].map(([m, c]) => `${m.split('-')[0]}:${c}`).join(' ')})`)
    : bad(`[4] ${JSON.stringify([...u])}`);
}

// [5] ★ 셸 금지가 **-p 인자에** 있다. 파일 안에만 두면 Claude 가 파일을 읽으려다 취소된다
{
  resetAgyModelUsage();
  let pArg = '';
  await agyReport('본문', { label: 't', agyImpl: async (args) => {
    pArg = args[args.indexOf('-p') + 1];
    return { stdout: envelope({ a: 1 }), stderr: '' };
  } });
  /터미널 명령/.test(pArg) && /RunCommand/.test(pArg)
    ? ok('[5] -p 인자 자체에 셸 금지가 있다') : bad(`[5] -p = ${JSON.stringify(String(pArg).slice(0, 80))}`);
}

// [6] 스키마를 줘도 **출력 계약을 글로** 함께 준다 — Claude 는 --json-schema 를 안 지킨다
{
  resetAgyModelUsage();
  let written = '';
  const origWrite = (await import('fs/promises')).default.writeFile;
  await agyReport('본문', { label: 't', schema: { type: 'object' },
    agyImpl: async (args) => {
      const i = args.indexOf('-p');
      written = args[i + 1];
      return { stdout: envelope({ a: 1 }), stderr: '' };
    } });
  /JSON 객체 하나만|단 하나의 JSON/.test(written)
    ? ok('[6] 스키마가 있어도 계약을 글로 박는다') : bad(`[6] ${JSON.stringify(String(written).slice(0, 120))}`);
}

// [7] ★ 프롬프트가 작으면 **파일 대신 -p 로 직접** 준다.
//     실측 2026-09-23: "같은 폴더의 prompt.md 를 읽고 수행해라" 라고 하면 claude-opus 는 그걸
//     **작업**으로 받아 첫 필드에 완료 보고를 쓴다("Task complete: read prompt.md, generated …").
//     같은 내용을 -p 로 직접 주니 정상적인 시장 서술이 나왔다. 읽을 파일이 없으면 보고할 작업도 없다.
//     ARG_MAX 는 1,048,576 이고 이 저장소의 최대 보고서 프롬프트는 12,588자다 — 파일이 필요 없었다.
{
  resetAgyModelUsage();
  let pArg = '', addDirs = 0;
  await agyReport('시장 서술을 써라', { label: 't', agyImpl: async (args) => {
    pArg = args[args.indexOf('-p') + 1];
    addDirs = args.filter((a) => a === '--add-dir').length;
    return { stdout: envelope({ a: 1 }), stderr: '' };
  } });
  pArg.includes('시장 서술을 써라') && !/prompt\.md/.test(pArg)
    ? ok('[7] 짧은 프롬프트는 -p 로 직접 — 읽을 파일을 만들지 않는다')
    : bad(`[7] -p = ${JSON.stringify(pArg.slice(0, 140))}`);
}

// [8] 아주 긴 프롬프트는 파일로 간다 — argv 한계가 있다. 그때만 파일 읽기를 시킨다
{
  resetAgyModelUsage();
  let pArg = '';
  const huge = '가'.repeat(300_000);
  await agyReport(huge, { label: 't', agyImpl: async (args) => {
    pArg = args[args.indexOf('-p') + 1];
    return { stdout: envelope({ a: 1 }), stderr: '' };
  } });
  /prompt\.md/.test(pArg) && pArg.length < 1000
    ? ok(`[8] 긴 프롬프트는 파일로 (-p ${pArg.length}자)`) : bad(`[8] -p 길이 ${pArg.length}`);
}

// ── 작업 보고가 본문으로 새는 것 ────────────────────────────────────────────
// 2026-09-23 실측, 두 가지 모양으로 봤다:
//   why="Task complete: read prompt.md, generated the requested JSON market report"  (배선 이름 노출)
//   why="Provided the requested single-sentence market summary as a JSON object."     (영어 산문)
// 둘째는 배선 이름이 없어 첫 가드를 통과했다. 문구 목록으로 막지 않는다 — 다음엔 또 다른 말로 온다.
// **한국어로 물었는데 영어 산문이 왔다**는 구조를 본다. 그건 내용이 아니라 과정에 대한 말이다.
{
  const ko = '오늘 시장을 한 문장으로 써라. 한국어로.';
  const cases = [
    ['Provided the requested single-sentence market summary as a JSON object.', true,  '영어 산문 = 작업 보고'],
    ['Task complete: read prompt.md, generated the report', true,  '배선 이름 노출'],
    ['코스피가 0.6% 올라 7,052로 마감했습니다.',                 false, '정상 한국어'],
    ['{"ok":true,"score":92}',                                  false, '숫자·불리언만 = 정상(fact-check)'],
    ['{"ticker":"TSM","action":"buy"}',                         false, '짧은 라틴 토큰은 산문이 아니다'],
  ];
  let bad0 = 0;
  for (const [out, want, note] of cases) {
    const got = isMetaReply(out, ko);
    if (got !== want) { bad0++; console.log(`  FAIL  [9] ${note}: ${got} ≠ ${want}`); }
  }
  bad0 ? fail++ : ok('[9] 한국어 요청에 영어 산문이 오면 실패로 본다 (5종)');
}

// [10] 영어로 물었으면 영어 답을 막지 않는다 — 판정 기준은 **요청 언어**다
{
  !isMetaReply('The market rallied on strong semiconductor demand today.', 'Write one sentence about the market.')
    ? ok('[10] 영어 요청엔 영어 답을 통과') : bad('[10] 영어 요청인데 막았다');
}

// [11] 사슬이 작업 보고를 **성공으로 세지 않는다** — 세면 그 문장이 보고서에 실린다
{
  resetAgyModelUsage();
  const impl = async (args) => {
    const m = args[args.indexOf('--model') + 1];
    return m === AGY_MODEL_CHAIN[0]
      ? { stdout: envelope({ why: 'Provided the requested summary as a JSON object.' }), stderr: '' }
      : { stdout: envelope({ why: '코스피가 0.6% 올라 7,052로 마감했습니다.' }), stderr: '' };
  };
  const out = await agyReport('오늘 시장을 한국어 한 문장으로 써라', { label: 't', agyImpl: impl });
  const u = agyModelUsage();
  out && /코스피/.test(out) && !u.has(AGY_MODEL_CHAIN[0])
    ? ok('[11] 작업 보고를 낸 모델은 실패로 세고 다음 모델이 받는다')
    : bad(`[11] out=${String(out).slice(0, 60)} 사용=${JSON.stringify([...u])}`);
}

// ── 차단기 ────────────────────────────────────────────────────────────────
// 2026-09-24 실측: claude-opus 가 1차인데 midnight 회차에서 23번 떨어졌고, 한 번에 ~150초씩 먹었다
//   (오늘 오전에는 "1+1" 에 218초, 빈 응답). 떨어질 때마다 다음 호출이 또 1차부터 시작해
//   같은 세금을 다시 냈다 — 회차 하나에 한 시간 가까이 버렸다.
//   순서는 사장님이 정한 것이라 바꾸지 않는다. **연속으로 실패하면 잠깐 건너뛴다.**
{
  resetAgyModelUsage(); resetAgyBreaker();
  const calls = [];
  const impl = async (args) => {
    const m = args[args.indexOf('--model') + 1];
    calls.push(m);
    return m === AGY_MODEL_CHAIN[0] ? { stdout: '깨짐', stderr: '' } : { stdout: envelope({ a: 1 }), stderr: '' };
  };
  for (let i = 0; i < 5; i++) await agyReport('x', { label: `b${i}`, agyImpl: impl });
  const firstTries = calls.filter((m) => m === AGY_MODEL_CHAIN[0]).length;
  firstTries === 2
    ? ok(`[12] 1차가 2번 연속 실패하면 이후 3번은 건너뛴다 (1차 시도 ${firstTries}/5)`)
    : bad(`[12] 1차를 ${firstTries}번 불렀다 — 매번 세금을 낸다`);
}

// [13] 한 번 성공하면 차단기가 풀린다 — 일시 장애 한 번으로 영영 밀려나면 안 된다
{
  resetAgyModelUsage(); resetAgyBreaker();
  let n = 0;
  const impl = async (args) => {
    const m = args[args.indexOf('--model') + 1];
    if (m !== AGY_MODEL_CHAIN[0]) return { stdout: envelope({ a: 1 }), stderr: '' };
    n++;
    return n === 1 ? { stdout: '깨짐', stderr: '' } : { stdout: envelope({ a: 1 }), stderr: '' };  // 1번 실패 후 회복
  };
  await agyReport('x', { label: 'r1', agyImpl: impl });
  await agyReport('x', { label: 'r2', agyImpl: impl });
  const u = agyModelUsage();
  (u.get(AGY_MODEL_CHAIN[0]) ?? 0) === 1
    ? ok('[13] 1번 실패는 차단하지 않는다 — 다음 호출에서 1차가 다시 받는다')
    : bad(`[13] ${JSON.stringify([...u])}`);
}

// [14] 차단 시간이 지나면 다시 시도한다 — 차단이 영구면 1차 모델이 영영 안 돈다
{
  resetAgyModelUsage(); resetAgyBreaker();
  const calls = [];
  let now = 1_000_000;
  const impl = async (args) => { const m = args[args.indexOf('--model') + 1]; calls.push(m);
    return m === AGY_MODEL_CHAIN[0] ? { stdout: '깨짐', stderr: '' } : { stdout: envelope({ a: 1 }), stderr: '' }; };
  await agyReport('x', { label: 't1', agyImpl: impl, now: () => now });
  await agyReport('x', { label: 't2', agyImpl: impl, now: () => now });   // 여기서 차단
  now += 31 * 60 * 1000;                                                    // 31분 뒤
  calls.length = 0;
  await agyReport('x', { label: 't3', agyImpl: impl, now: () => now });
  calls[0] === AGY_MODEL_CHAIN[0]
    ? ok('[14] 차단 30분이 지나면 1차를 다시 시도한다') : bad(`[14] ${JSON.stringify(calls)}`);
}

console.log(fail ? `\n  ❌ ${fail}건 실패` : '\n  ✅ 전부 통과');
process.exit(fail ? 1 : 0);
