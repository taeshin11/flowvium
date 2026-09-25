#!/usr/bin/env node
/**
 * ear-check.test.mjs — 만든 소리를 **되들어서** 약어가 제대로 읽혔는지 보고, 틀리면 다른 표기로 다시 만든다.
 * 2026-09-25 신설. 사장님 "왜 자꾸 이런 문제가 생기는 거지 이런 문제 없게 해".
 *
 * 왜 자꾸 생겼나: 화면은 매 편 눈검증(agy 가 프레임 8장)을 하는데 **소리는 아무도 안 들었다.**
 *   G20 을 "지이영" 으로 읽은 것도 시청자 댓글로 알았다. 단어를 하나씩 고치면 다음 낯선 약어에서 또 난다.
 *   그래서 만드는 자리에서 되들음을 하고, 틀리면 고쳐서 다시 만든다(검출이 아니라 예방).
 *
 * whisper 도 틀린다(실측: "케이구" 를 "피이고" 로 들었다). 그래서 **발행을 막지 않는다** —
 *   다른 표기를 몇 번 시도해 보고, 끝내 안 되면 경고와 기록만 남긴다(발음 사전에 넣을 후보).
 */
import { keyTerms, heard, earCheckAndRepair } from './ear-check.mjs';

let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

// [1] 확인할 말 — 대문자 약어·글자숫자. 영단어·숫자만인 것은 뺀다
{
  const t = keyTerms('OECD가 한국 성장률 전망을 G20 중 최대 폭으로 올렸고 Tesla 는 3.7% 올랐다');
  JSON.stringify(t) === JSON.stringify(['OECD', 'G20']) ? ok(`[1] ${t.join(', ')}`) : bad(`[1] ${JSON.stringify(t)}`);
}

// [2] 들렸나 — 같은 읽기로 맞춰 비교한다 (whisper 는 "G20"·"지 20"·"지이십" 어느 꼴로도 적는다)
{
  const cases = [
    ['G20', '전망을 G20 중 최대 폭으로', true],
    ['G20', '전망을 지 20중 최대 폭으로', true],
    ['G20', '전망을 지의식 중 최대 폭으로', false],     // 실측 오독
    ['G20', '점맘을 치 20중', false],                   // 실측 오독
    ['OECD', 'OECD가 한국의', true],
    ['OECD', '오이씨디가 한국의', true],
    ['OECD', '띠가 전망을 올렸다', false],              // 실측 오독
    ['GDP', '뿐 성장률이 올랐다', false],               // 실측 오독
    ['KOSPI', '코스피가 하락했고', true],
  ];
  let bads = 0;
  for (const [term, asr, want] of cases) if (heard(term, asr) !== want) { bads++; bad(`[2] ${term} ← "${asr}" 기대 ${want}`); }
  if (!bads) ok(`[2] 되들음 판정 ${cases.length}건 (실측 오독 4건은 못 들은 것으로)`);
}

// [3] 틀리면 **다른 표기로 다시 만든다** — 되들림이 맞는 표기를 고른다
{
  const texts = ['OECD가 전망을 G20 중 최대 폭으로 올렸습니다.', '금리가 올랐습니다.'];
  const synthCalls = [];
  // 가짜 합성기: 넘겨받은 소리용 문장을 그대로 파일 이름처럼 돌려준다
  const synth = (spoken) => { synthCalls.push(spoken); return spoken.map((s, i) => ({ path: `v${synthCalls.length}-${i}`, durationSec: 3, spoken: s })); };
  // 가짜 귀: "지, 이십" 은 "치 20" 으로 들리고(실측), "지. 이십" 처럼 끊으면 G20 으로 들린다고 하자
  const transcribe = (items) => items.map((it) => it.spoken.includes('지, 이십') ? '오이씨디가 전망을 치 20 중 최대 폭으로' : it.spoken.replace('지. 이십', 'G20'));
  const out0 = synth(texts.map((t) => t));   // 처음 만든 것(이 테스트에선 표기 무관)
  out0[0].spoken = '오이씨디가 전망을 지, 이십 중 최대 폭으로 올렸습니다.';
  const logs = [];
  const r = await earCheckAndRepair({ texts, out: out0, synth, transcribe, log: (m) => logs.push(m), record: () => {} });
  (r.out[0].path !== out0[0].path && r.fixed === 1 && r.unresolved.length === 0 && r.out[1] === out0[1])
    ? ok(`[3] G20 을 다른 표기로 다시 만들어 통과 (합성 ${synthCalls.length - 1}회 추가) · 문제없는 문장은 그대로`)
    : bad(`[3] fixed=${r.fixed} unresolved=${JSON.stringify(r.unresolved)} path=${r.out[0].path} logs=${logs.join(' | ')}`);
}

// [4] 끝내 안 되면 **막지 않고** 기록한다 — 원래 소리를 쓰고, 무엇이 안 됐는지 남긴다
{
  const texts = ['LG전자가 조사를 받습니다.'];
  const synth = (spoken) => spoken.map((s, i) => ({ path: `x-${s.length}-${i}`, durationSec: 2, spoken: s }));
  const transcribe = (items) => items.map(() => '매지 전자가 조사를 받습니다');   // 무엇을 줘도 "매지"(실측)
  const out0 = synth(['엘지 전자가 조사를 받습니다.']);
  const recorded = [];
  const r = await earCheckAndRepair({ texts, out: out0, synth, transcribe, log: () => {}, record: (x) => recorded.push(x) });
  (r.out[0] === out0[0] && r.unresolved.length === 1 && r.unresolved[0].term === 'LG' && recorded.length === 1)
    ? ok('[4] 안 풀리면 원래 소리 유지 + 기록(LG)') : bad(`[4] ${JSON.stringify(r.unresolved)} rec=${recorded.length}`);
}

// [5] 약어가 없는 회차는 되들음을 아예 안 한다(시간을 안 쓴다)
{
  let called = false;
  const r = await earCheckAndRepair({ texts: ['금리가 올랐습니다.'], out: [{ path: 'a', durationSec: 1 }],
    synth: () => { called = true; return []; }, transcribe: () => { called = true; return []; }, log: () => {}, record: () => {} });
  (!called && r.checked === 0) ? ok('[5] 확인할 말이 없으면 귀를 안 부른다') : bad(`[5] called=${called}`);
}

// [6] 귀(whisper)를 못 쓰면 **판정 없음**이다 — '통과' 로 적지 않는다
{
  const r = await earCheckAndRepair({ texts: ['OECD가 올렸다'], out: [{ path: 'a', durationSec: 1 }],
    synth: () => [], transcribe: () => { throw new Error('whisper 없음'); }, log: () => {}, record: () => {} });
  (r.checked === 0 && /whisper 없음/.test(r.skipped ?? '')) ? ok(`[6] 귀 없음 → 판정 없음(${r.skipped})`) : bad(`[6] ${JSON.stringify(r)}`);
}

console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
