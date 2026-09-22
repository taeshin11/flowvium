#!/usr/bin/env node
/** agy-report.test.mjs — agy 연동 모듈을 주입으로 시험한다. */
import { agyReport } from './agy-report.mjs';
import fs from 'fs/promises';
import path from 'path';

let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

async function runTests() {
  // [1] structured_output 이 오면 그것을 쓴다
  let calledPrompt = '';
  const impl1 = async (args) => {
    // 왜: 프롬프트에 금지 문구가 포함되었는지 확인하기 위해 파일 내용을 읽음
    const tmpDirIndex = args.indexOf('--add-dir') + 1;
    const promptContent = await fs.readFile(path.join(args[tmpDirIndex], 'prompt.md'), 'utf8');
    calledPrompt = promptContent;

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
    ? ok('[5] 프롬프트에 금지 문구가 들어감') : bad(`[5] 프롬프트: ${calledPrompt.slice(0, 50)}...`);

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

  console.log(fail ? `\n❌ ${fail} 실패` : '\n✅ agy-report 통과');
  process.exit(fail ? 1 : 0);
}

runTests().catch(e => {
  console.error(e);
  process.exit(1);
});
