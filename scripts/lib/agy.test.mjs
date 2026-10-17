#!/usr/bin/env node
/**
 * agy.test.mjs — agy 로 넘긴 뒤에도 **로컬 폴백이 살아 있는가**. 2026-09-19 신설.
 *
 * 이 테스트가 지키는 것: 오늘 구글이 Gemini CLI 를 하루아침에 닫는 걸 봤다(IneligibleTierError).
 *   agy 가 막히는 날 블로그와 쇼츠가 같이 멈추면 안 된다. 그래서 합성기는
 *   **agy 실패를 조용히 삼키지 않고 폴백을 부르고, 그 사유를 남긴다.**
 */
import { agyCaller } from './agy.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

// [1] agy 가 글을 주면 그걸 쓴다 — 폴백은 부르지 않는다
{
  let localCalls = 0;
  const call = agyCaller(async () => { localCalls++; return '로컬'; }, { agyImpl: () => '안티그래비티' });
  const got = await call('시험');
  got === '안티그래비티' && localCalls === 0 ? ok('[1] agy 성공 시 agy 결과, 로컬 미호출')
    : bad(`[1] got=${got} localCalls=${localCalls}`);
}

// [2] agy 가 null 이면 로컬로 내려간다
{
  const call = agyCaller(async () => '로컬', { agyImpl: () => null });
  const got = await call('시험');
  got === '로컬' ? ok('[2] agy 실패 → 로컬 폴백') : bad(`[2] got=${got}`);
}

// [3] agy 가 **던져도** 로컬로 내려간다 (spawn 자체가 깨지는 날)
{
  const call = agyCaller(async () => '로컬', { agyImpl: () => { throw new Error('spawn EPERM'); } });
  const got = await call('시험');
  got === '로컬' ? ok('[3] agy 예외 → 로컬 폴백') : bad(`[3] got=${got}`);
}

// [4] 폴백한 이유를 남긴다 — 조용히 내려가면 4B 로 돌아간 걸 아무도 모른다
{
  const lines = [];
  const call = agyCaller(async () => '로컬', { agyImpl: () => null, warn: (m) => lines.push(m) });
  await call('시험');
  lines.length === 1 && /agy/.test(lines[0]) ? ok(`[4] 사유 기록: ${lines[0]}`) : bad(`[4] ${JSON.stringify(lines)}`);
}

// [5] 빈 문자열·공백은 성공이 아니다 — 빈 본문이 블로그로 나가면 안 된다
{
  const call = agyCaller(async () => '로컬', { agyImpl: () => '   ' });
  const got = await call('시험');
  got === '로컬' ? ok('[5] 공백 응답은 실패로 본다') : bad(`[5] got=${JSON.stringify(got)}`);
}


// [no-shell] agyText 의 -p 에도 '터미널 명령 금지' 가 붙는가 (2026-10-17).
//   실측: 쇼츠 대본 재작성에서 두 모델 다 글자 수를 세려고 python3 -c 를 불렀다가 권한 거부 →
//   structured_output 이 비어 대본이 없었다(agy 대화 DB 7e4c8d11 · 6f782865 step 2 "permission check failed").
//   video.log 에 같은 사유가 10/13 부터 17번. agy-report·image·triage·task·cross-check 는 이미 금지를 붙이는데 agyText 만 빠져 있었다.
{
  const { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync } = await import('fs');
  const { tmpdir } = await import('os');
  const { join } = await import('path');
  const d = mkdtempSync(join(tmpdir(), 'agy-noshell-'));
  const fake = join(d, 'agy');
  writeFileSync(fake, `#!/usr/bin/env node
const a = process.argv.slice(2);
if (a[0] === 'models') { process.stdout.write('gemini-3.8-flash-high\\tGemini\\n'); process.exit(0); }
const i = a.indexOf('-p'); require('fs').writeFileSync(${JSON.stringify(join(d, 'prompt.txt'))}, a[i + 1] ?? '');
process.stdout.write(JSON.stringify({ conversation_id: 'c', status: 'SUCCESS', response: '', structured_output: { text: '답' } }) + '\\n');
process.exit(0);
`);
  chmodSync(fake, 0o755);
  const prev = process.env.AGY_BIN; process.env.AGY_BIN = fake;
  const { agyText } = await import('./agy.mjs');
  const got = agyText('대본을 써라', { model: 'gemini-3.8-flash-high', timeoutMs: 20000 });
  if (prev === undefined) delete process.env.AGY_BIN; else process.env.AGY_BIN = prev;
  const sent = existsSync(join(d, 'prompt.txt')) ? readFileSync(join(d, 'prompt.txt'), 'utf8') : '';
  got === '답' && /터미널 명령/.test(sent) && sent.indexOf('터미널 명령') < sent.indexOf('대본을 써라')
    ? ok('[no-shell] agyText 프롬프트 맨 앞에 터미널 명령 금지가 붙는다')
    : bad(`[no-shell] got=${got} 보낸 프롬프트 앞부분: ${sent.slice(0, 60)}`);
}
console.log(fail ? `\n  ❌ ${fail}건 실패` : '\n  ✅ 전부 통과');
process.exit(fail ? 1 : 0);
