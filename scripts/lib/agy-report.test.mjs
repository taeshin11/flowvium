#!/usr/bin/env node
/** agy-report.test.mjs — agy 연동 모듈을 주입으로 시험한다. */
import { agyReport, resetAgyBreaker, parseQuotaReset, AGY_MODEL_CHAIN } from './agy-report.mjs';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

async function runTests() {
  // [1] structured_output 이 오면 그것을 쓴다
  let calledPrompt = '';
  const impl1 = async (args) => {
    // 2026-09-23: 종전엔 prompt.md 를 읽어서 확인했다. 이제 짧은 프롬프트는 **파일을 만들지 않고**
    //   -p 로 직접 준다(claude-opus 가 "파일을 읽어라" 를 작업으로 받아 완료 보고를 쓰는 문제 때문).
    //   확인할 곳이 파일에서 인자로 옮겨졌을 뿐, 물어보는 것은 같다.
    calledPrompt = args[args.indexOf('-p') + 1];

    return {
      stdout: JSON.stringify({
        structured_output: { success: true }
      })
    };
  };

  let res = await agyReport('hello', { label: 't1', agyImpl: impl1 });
  res === '{"success":true}' ? ok('[1] structured_output 추출') : bad(`[1] ${res}`);

  // [5] 프롬프트에 터미널 명령 금지 문구가 들어간다
  calledPrompt.includes('어떤 터미널 명령도 실행하지 마라') && calledPrompt.includes('hello')
    ? ok('[5] -p 인자에 금지 문구와 본문이 함께 들어감') : bad(`[5] 프롬프트: ${calledPrompt.slice(0, 80)}...`);

  // [2] response 에 ```json 으로 감싸 오면 본체만 꺼낸다
  const impl2 = async () => ({
    stdout: JSON.stringify({
      response: "어쩌구 저쩌구\n```json\n{\"foo\":\"bar\"}\n```\n끝"
    })
  });
  res = await agyReport('hello', { label: 't2', agyImpl: impl2 });
  res === '{"foo":"bar"}' ? ok('[2] response 내 ```json 본체 추출') : bad(`[2] ${res}`);

  // [3] 둘 다 없으면 null
  const impl3 = async () => ({
    stdout: JSON.stringify({
      hello: "world"
    })
  });
  res = await agyReport('hello', { label: 't3', agyImpl: impl3 });
  res === null ? ok('[3] 둘 다 없으면 null 반환') : bad(`[3] ${res}`);

  // [4] stdout 앞뒤에 다른 글자가 섞여 있어도 JSON 덩어리를 찾아낸다
  const impl4 = async () => ({
    stdout: "\x1b[32m로딩중...\x1b[0m\n{\n  \"structured_output\": {\"clean\": 1}\n}\n완료되었습니다."
  });
  res = await agyReport('hello', { label: 't4', agyImpl: impl4 });
  res === '{"clean":1}' ? ok('[4] 앞뒤 쓰레기 텍스트 무시하고 JSON 추출') : bad(`[4] ${res}`);

  // [6] 부르는 쪽이 준 합격 조건(accept)에 못 미치면 **다음 모델**에 묻는다 (2026-09-25)
  //   실측: 궁금증 제목을 한국어로 물었는데 "Task completed" · "Completed title generation" 이 왔다.
  //   라틴 산문 판정(5낱말 이상)을 빠져나가는 짧은 작업 보고라 성공으로 세졌고, 사슬이 넘어가지 않았다.
  resetAgyBreaker();
  const seen = [];
  const impl6 = async (args) => {
    const m = args[args.indexOf('--model') + 1];
    seen.push(m);
    return { stdout: JSON.stringify(seen.length === 1
      ? { response: 'Task completed' }
      : { structured_output: { title: '이란 대통령이 연설한 이유' } }) };
  };
  res = await agyReport('제목을 한국어로 한 줄 써라. 궁금해서 누르게 만드는 문장으로.', {
    label: 't6', agyImpl: impl6,
    accept: (out) => /[가-힣]/.test(out),
  });
  (seen.length === 2 && seen[0] !== seen[1] && /이란/.test(res ?? ''))
    ? ok(`[6] 합격 조건 미달 → 다음 모델(${seen.join(' → ')})`)
    : bad(`[6] 모델 ${seen.join(',')} · 결과 ${res}`);
  resetAgyBreaker();

  // [7] 할당량 소진(429 · "Resets in …")은 **그 시각까지** 모든 프로세스가 건너뛴다 (2026-09-25)
  //   실측: claude-opus 37회 · gpt-oss 4회 "Individual quota reached … Resets in 26h28m49s".
  //   한 번 떨어지는 데 ~155초(agy 내부 재시도). 차단기는 프로세스 안에서만 기억해서
  //   보고서·쇼츠 프로세스마다 같은 세금을 다시 냈다. 리셋 시각은 서버가 알려 준다 — 그걸 쓴다.
  {
    const ms = parseQuotaReset('error: Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 26h28m49s.');
    const ms2 = parseQuotaReset('Resets in 45m3s');
    (ms === (26 * 3600 + 28 * 60 + 49) * 1000 && ms2 === (45 * 60 + 3) * 1000 && parseQuotaReset('timeout') === null)
      ? ok('[7a] 리셋 시각을 읽는다 (26h28m49s · 45m3s · 없으면 null)') : bad(`[7a] ${ms} ${ms2}`);

    const qf = path.join(os.tmpdir(), `agy-quota-test-${process.pid}.json`);
    process.env.AGY_QUOTA_FILE = qf;
    await fs.rm(qf, { force: true });
    resetAgyBreaker();
    const [m0, m1] = AGY_MODEL_CHAIN;
    const calls = [];
    const quotaImpl = (dead) => async (args) => {
      const m = args[args.indexOf('--model') + 1];
      calls.push(m);
      if (dead.includes(m)) {
        const e = new Error('Command failed'); e.stderr = 'error: Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 2h0m0s.'; throw e;
      }
      return { stdout: JSON.stringify({ structured_output: { ok: true } }) };
    };
    let r = await agyReport('hello', { label: 't7', agyImpl: quotaImpl([m0]) });
    const saved = JSON.parse(await fs.readFile(qf, 'utf8').catch(() => '{}'));
    const until = Date.parse(saved[m0] ?? '');
    (r === '{"ok":true}' && until > Date.now() + 1.9 * 3600e3 && until < Date.now() + 2.1 * 3600e3)
      ? ok(`[7b] 소진 모델을 파일에 적는다 (${m0} → 약 2시간 뒤)`) : bad(`[7b] r=${r} saved=${JSON.stringify(saved)}`);

    // 새 프로세스를 흉내 — 프로세스 안 차단기를 비워도 파일이 건너뛰게 한다
    resetAgyBreaker(); calls.length = 0;
    r = await agyReport('hello', { label: 't7', agyImpl: quotaImpl([]) });
    (!calls.includes(m0) && calls[0] === m1 && r === '{"ok":true}')
      ? ok(`[7c] 다른 프로세스에서도 ${m0} 를 부르지 않고 ${m1} 부터`) : bad(`[7c] calls=${calls.join(',')}`);

    // 지난 기록은 무시한다
    await fs.writeFile(qf, JSON.stringify({ [m0]: new Date(Date.now() - 1000).toISOString() }));
    resetAgyBreaker(); calls.length = 0;
    await agyReport('hello', { label: 't7', agyImpl: quotaImpl([]) });
    calls[0] === m0 ? ok('[7d] 리셋 시각이 지나면 다시 부른다') : bad(`[7d] calls=${calls.join(',')}`);
    await fs.rm(qf, { force: true });
    delete process.env.AGY_QUOTA_FILE;
    resetAgyBreaker();
  }

  // [8] 한 칸짜리 답이 **이중 포장**돼 와도 벗긴다 (2026-09-25 실측: pro-high·flash 모두
  //   {"summary":"{\"summary\": \"…\"}"} 를 냈다 — 그대로 두면 본문에 중괄호가 실린다)
  {
    resetAgyBreaker();
    const inner = '환율은 1,392원으로 올랐습니다.';
    const impl8 = async () => ({ stdout: JSON.stringify({ structured_output: { summary: JSON.stringify({ summary: inner }) } }) });
    const r8 = await agyReport('요약해라 한국어로 두 문장으로 써라', { label: 't8', agyImpl: impl8 });
    const got = JSON.parse(r8 ?? '{}').summary;
    got === inner ? ok('[8] 이중 포장 → 한 겹 벗김') : bad(`[8] ${r8}`);
    // 필드가 여럿이면 건드리지 않는다(정상 답을 망가뜨리지 않게)
    const impl8b = async () => ({ stdout: JSON.stringify({ structured_output: { a: '{"a":"x"}', b: 'y' } }) });
    const r8b = await agyReport('요약해라 한국어로 두 문장으로 써라', { label: 't8b', agyImpl: impl8b });
    r8b === JSON.stringify({ a: '{"a":"x"}', b: 'y' }) ? ok('[8b] 여러 필드는 그대로') : bad(`[8b] ${r8b}`);
    resetAgyBreaker();
  }

  console.log(fail ? `\n❌ ${fail} 실패` : '\n✅ agy-report 통과');
  process.exit(fail ? 1 : 0);
}

runTests().catch(e => {
  console.error(e);
  process.exit(1);
});
