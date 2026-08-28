#!/usr/bin/env node
/**
 * script-grounding.test.mjs — 대본이 지어낸 사실을 내보내지 않는가.
 *
 * 실측 사고(2026-08-28): 실시간 헤드라인 836건 어디에도 없는
 *   "트럼프가 온타리오호를 Lake America 로 개명" 이 대본에 들어가 영상까지 나왔다.
 *   프롬프트에는 "Use only facts present in the headlines" 가 분명히 있었다.
 *   지어낸 뉴스는 올리고 나면 되돌릴 수 없다 — 여기서 막아야 한다.
 */
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };
const M = await import('./script-grounding.mjs');

const SRC = [
  'Judge says Trump administration blacklist of Anthropic was illegal',
  'South Korea backs Trump efforts to resume North Korea talks',
  'Fed says the claims against Governor Cook are unfounded and untrue',
  'Ratko Mladic dies in prison at 82',
].join(' | ');

// ── 1. 실제로 났던 사고를 잡는가 ─────────────────────────────────────────────
{
  const say = 'The President just signed an executive order renaming Lake Ontario to Lake America.';
  const got = M.ungroundedNames(say, SRC);
  if (got.includes('Ontario') && got.includes('America')) ok(`지어낸 고유명사를 잡는다 (${got.join(', ')})`);
  else bad(`못 잡았다 — ${JSON.stringify(got)}`);
}

// ── 2. 근거 있는 문장은 통과 ─────────────────────────────────────────────────
{
  const cases = [
    'Trump backs efforts to resume North Korea talks, South Korea says.',
    'A judge ruled the blacklist of Anthropic was illegal.',
    'The Fed called the claims against Governor Cook unfounded.',
  ];
  const leaks = cases.map((c) => M.ungroundedNames(c, SRC)).filter((x) => x.length);
  if (!leaks.length) ok('근거 있는 문장 3건 통과');
  else bad(`오탐 — ${JSON.stringify(leaks)}`);
}

// ── 3. 문장 첫 대문자는 고유명사가 아니다 ────────────────────────────────────
{
  if (M.ungroundedNames('Meanwhile lawmakers pushed back. Analysts disagreed.', SRC).length === 0)
    ok('문장 첫 낱말은 고유명사로 안 본다');
  else bad(`문장 첫 낱말을 잡았다 — ${JSON.stringify(M.ungroundedNames('Meanwhile lawmakers pushed back. Analysts disagreed.', SRC))}`);
}

// ── 4. 숫자 ──────────────────────────────────────────────────────────────────
{
  // 근거에 있는 숫자는 통과
  if (M.ungroundedNames('He died in prison at 82.', SRC).length === 0) ok('근거에 있는 숫자는 통과');
  else bad('근거에 있는 숫자를 잡았다');
  // 지어낸 큰 숫자는 잡는다
  const got = M.ungroundedNames('More than 4,200 people signed the petition.', SRC);
  if (got.includes('4,200')) ok('근거 없는 큰 숫자를 잡는다');
  else bad(`큰 숫자를 못 잡았다 — ${JSON.stringify(got)}`);
  // 작은 수는 흔해서 보지 않는다(오탐이 너무 많다)
  if (M.ungroundedNames('Three of the 12 members abstained.', SRC).length === 0) ok('두 자리 이하 수는 보지 않는다');
  else bad('작은 수를 잡았다 — 오탐이 난다');
}

// ── 5. 근거가 없으면 판단하지 않는다 ─────────────────────────────────────────
{
  if (M.ungroundedNames('Anything At All Here', '').length === 0) ok('근거 텍스트가 비면 판단하지 않는다');
  else bad('근거가 없는데 단정했다');
}

// ── 6. 장면 단위 ─────────────────────────────────────────────────────────────
{
  const scenes = [
    { say: 'Trump backs talks with North Korea.' },
    { say: 'He then renamed Lake Ontario.' },
    { say: 'The Fed disagreed.' },
  ];
  const out = M.ungroundedScenes(scenes, SRC);
  if (out.length === 1 && out[0].scene === 2 && out[0].words.includes('Ontario'))
    ok('문제 장면만 번호와 함께 짚는다 (장면2: Ontario)');
  else bad(`장면 판정 이상 — ${JSON.stringify(out)}`);
}

console.log(fail ? `\n  ${fail}개 실패` : '\n✅ script-grounding 전부 통과');
process.exit(fail ? 1 : 0);
