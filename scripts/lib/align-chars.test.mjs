/**
 * align-chars.test.mjs — 자막 글자 시각(scripts/tts/align_common.py char_times). 2026-10-27 신설.
 *
 * 사장님 "롱폼이 자막이랑 싱크가 안 맞는다 소리랑". 문장 첫머리는 맞는데(실측 0.3초 이내) 문장 **안**에서 어긋났다.
 * char_times 는 whisper 낱말 k 개를 글자 수로 k 등분한 칸에 하나씩 얹었다 — 낱말마다 글자 수가 같다고 본 셈이다.
 * 숫자는 화면엔 짧고(5,652.23 = 8자) 읽으면 길다(오천육백오십이 점 이삼 = 10음절) — 숫자 많은 시장 영상에서 뒤 낱말이 밀렸다.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../tts');
const run = (text, words, total) => {
  const r = spawnSync('python3', ['-c', `import sys, json; sys.path.insert(0, ${JSON.stringify(dir)}); from align_common import char_times
a = json.loads(sys.stdin.read()); st, en, note = char_times(a[0], [tuple(w) for w in a[1]] if a[1] else None, a[2]); print(json.dumps([st, en, note]))`],
  { input: JSON.stringify([text, words, total]), encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
};
const startOf = (text, st, word) => st[text.indexOf(word)];
const near = (got, want, tol, what) => assert.ok(Math.abs(got - want) <= tol, `${what}: ${got.toFixed(2)}초, 실제 ${want}초 (±${tol})`);

// 실제로 말한 시각(낱말마다 읽는 길이가 다르다)
const text = '낮 12시 17분 기준 코스피는 3.34% 오른 5,652.23을 기록했습니다.';
const spoken = [['낮', 0.0, 0.2], ['12시', 0.25, 0.85], ['17분', 0.9, 1.5], ['기준', 1.55, 1.9], ['코스피는', 1.95, 2.5],
  ['3.34%', 2.55, 3.9], ['오른', 3.95, 4.3], ['5,652.23을', 4.35, 6.4], ['기록했습니다.', 6.45, 7.4]];

// [1] 낱말 수가 같으면 낱말마다 제 시각 — 숫자 뒤 낱말이 밀리지 않는다
{
  const [st] = run(text, spoken, 7.6);
  near(startOf(text, st, '5,652'), 4.35, 0.1, '[1] 5,652.23 시작');
  near(startOf(text, st, '오른'), 3.95, 0.1, '[1] 오른 시작');
  near(startOf(text, st, '기록'), 6.45, 0.1, '[1] 기록했습니다 시작');
}

// [2] whisper 가 낱말을 다르게 끊어도(숫자를 한글로 적고 조사를 떼어) 크게 어긋나지 않는다
{
  const split = [['낮', 0.0, 0.2], ['열두시', 0.25, 0.85], ['십칠분', 0.9, 1.5], ['기준', 1.55, 1.9], ['코스피는', 1.95, 2.5],
    ['삼점삼사', 2.55, 3.3], ['퍼센트', 3.3, 3.9], ['오른', 3.95, 4.3], ['오천육백오십이점이삼', 4.35, 6.2], ['을', 6.2, 6.4], ['기록했습니다.', 6.45, 7.4]];
  const [st] = run(text, split, 7.6);
  near(startOf(text, st, '5,652'), 4.35, 0.3, '[2] 5,652.23 시작');
  near(startOf(text, st, '기록'), 6.45, 0.3, '[2] 기록했습니다 시작');
}

// [3] 시각은 앞으로만 간다, 전체 길이를 넘지 않는다
{
  const [st, en] = run(text, spoken, 7.6);
  for (let i = 1; i < st.length; i++) assert.ok(st[i] >= st[i - 1] - 1e-9, `[3] 시작 시각이 뒤로 감 @${i}`);
  assert.ok(Math.max(...en) <= 7.6 + 1e-9);
}

// [4] whisper 실패 → 균등분배(이전과 같음)
{
  const [st, , note] = run('가나다라', null, 4);
  assert.deepEqual(st, [0, 1, 2, 3]);
  assert.match(note, /균등분배/);
}
console.log('align-chars ok');
