// thumb-gate.test.mjs — 썸네일 3자 채점 관문(2026-10-28 사장님, Mac mini2 경유). node scripts/lib/thumb-gate.test.mjs
//   ChatGPT·agy(gemini-4-argon-medium, 그림 첨부)·Claude 가 따로 10점 만점, 셋 다 8 이상이어야 통과.
//   7 이하가 있으면 지적한 것을 고쳐 다시 매긴다(최대 3번). 그래도 안 되면 가장 나은 판을 올리고 22:00 보고에 표시.
//   당일 뉴스는 오래 못 기다린다 — 관문 전체 10분 상한. 점수 셋은 업로드마다 남긴다.
//   ChatGPT 는 아직 길이 없다(9334 크롬 금지·API 키 없음) — 'ChatGPT 미채점'으로 남기고, 있는 심판만으로 판정한다.
import assert from 'node:assert/strict';
import { parseJudge, safeText, decide, rankKey, runThumbGate, judgePrompt, firstJson } from './thumb-gate.mjs';

// [1] 심판 답 읽기 — 정수 0~10, 약점, 고칠 글. 모양이 틀리면 null(점수로 세지 않는다)
assert.deepEqual(parseJudge({ score: 7, weak: '글이 작다', text: 'PER 낮은 주식의 함정' }), { score: 7, weak: '글이 작다', text: 'PER 낮은 주식의 함정' });
assert.equal(parseJudge({ score: 11, weak: 'x', text: 'y' }), null);
assert.equal(parseJudge({ score: '8', weak: 'x', text: 'y' })?.score, 8);
assert.equal(parseJudge({ weak: 'x' }), null);
assert.equal(parseJudge(null), null);

// [2] 고칠 글 거르기 — 원문에 없는 숫자(지어낸 수치)·매수 권유·너무 길거나 짧은 글은 버린다
const src = '삼성전자 3분기 영업이익 9조 발표';
assert.equal(safeText('삼성 9조 깜짝 실적', { source: src, maxChars: 24 }), '삼성 9조 깜짝 실적');
assert.equal(safeText('삼성 20% 폭등', { source: src, maxChars: 24 }), null, '원문에 없는 숫자');
assert.equal(safeText('지금 삼성 사세요', { source: src, maxChars: 24 }), null, '권유');
assert.equal(safeText('삼', { source: src, maxChars: 24 }), null, '너무 짧다');
assert.equal(safeText('가'.repeat(30), { source: src, maxChars: 24 }), null, '너무 길다');
assert.equal(safeText('  "삼성 깜짝 실적"  ', { source: src, maxChars: 24 }), '삼성 깜짝 실적', '따옴표·공백 정리');
assert.equal(safeText('PER 함정', { source: '', maxChars: 24, digits: false }), 'PER 함정');
assert.equal(safeText('3줄 요약', { source: '3줄', maxChars: 24, digits: false }), null, '숫자 금지 자리');

// [3] 판정 — 정해진 심판이 다 매겼고 모두 7 이상 + 하나라도 7.5 이상일 때만 통과(10/28 최종). 못 매긴 심판은 통과가 아니다
const J = ['agy', 'claude', 'chatgpt'];
const need = ['agy', 'claude'];   // 시험용 — 실제 NEED 는 chatgpt 까지 셋
assert.equal(decide({ agy: { score: 8 }, claude: { score: 9 }, chatgpt: { skipped: 'ChatGPT 미채점' } }, need).pass, true);
assert.equal(decide({ agy: { score: 6.5 }, claude: { score: 9 } }, need).pass, false);
assert.equal(decide({ agy: { error: '시간초과' }, claude: { score: 9 } }, need).pass, false, '못 매긴 심판');
assert.equal(decide({ agy: { score: 8 }, claude: { score: 8 }, chatgpt: { score: 6 } }, need).pass, false, '추가 심판이 매겼으면 그 점수도 센다');
// [3b] 가장 나은 판 — 최저점 먼저, 같으면 합
assert.ok(rankKey({ agy: { score: 7 }, claude: { score: 9 } }) > rankKey({ agy: { score: 6 }, claude: { score: 10 } }));
assert.ok(rankKey({ agy: { score: 7 }, claude: { score: 9 } }) > rankKey({ agy: { score: 7 }, claude: { score: 8 } }));
assert.ok(rankKey({ agy: { error: 'x' }, claude: { score: 9 } }) < rankKey({ agy: { score: 5 }, claude: { score: 5 } }), '못 매긴 판은 아래');

// [4] 질문 — 기준 여섯 개와 제목·글 규칙이 다 들어간다
{
  const p = judgePrompt({ title: '제목A', kind: 'shorts', file: 'thumb.jpg', textRule: '3~6낱말' });
  for (const k of ['1초', '호기심', '3~6', '대비', '주인공', '제목', '다른 썸네일', 'thumb.jpg', '제목A', '3~6낱말']) assert.ok(p.includes(k), `질문에 ${k}`);
}

// [5] 흐름 — 첫 판 7점 → 가장 낮은 심판의 글로 다시 굽고 다시 매긴다 → 통과
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
{
  const seen = [];
  const judges = {
    agy: async ({ image }) => (image === 'v0.jpg' ? { score: 6, weak: '글이 길다', text: '삼성 깜짝 실적' } : { score: 8, weak: '', text: '' }),
    claude: async ({ image }) => (image === 'v0.jpg' ? { score: 6.5, weak: '', text: '삼성 9조 실적' } : { score: 9, weak: '', text: '' }),
    chatgpt: async () => ({ skipped: 'ChatGPT 미채점' }),
  };
  const r = await runThumbGate({ image: 'v0.jpg', text: '삼성전자 3분기 영업이익 9조 발표', title: 'T', source: src, kind: 'shorts', maxChars: 24,
    judges, need, rerender: async (t) => { seen.push(t); return 'v1.jpg'; }, log: () => {} });
  assert.deepEqual(seen, ['삼성 깜짝 실적'], '가장 낮은 점수를 준 심판의 글');
  assert.equal(r.passed, true); assert.equal(r.image, 'v1.jpg'); assert.equal(r.text, '삼성 깜짝 실적');
  assert.equal(r.rounds.length, 2); assert.equal(r.flagged, null);
  assert.deepEqual(Object.keys(r.rounds[1].scores).sort(), J.slice().sort());
}
// [6] 3번 고쳐도 안 되면 가장 나은 판 + 표시
{
  let n = 0;
  const judges = { agy: async ({ image }) => ({ score: image === 'v2.jpg' ? 6.5 : 5, weak: '약하다', text: `새 글 ${'가나다'[n % 3]}` }), claude: async () => ({ score: 9, weak: '', text: '' }) };
  const r = await runThumbGate({ image: 'v0.jpg', text: '처음', title: 'T', source: '', kind: 'shorts', maxChars: 24, judges, need,
    rerender: async () => `v${++n}.jpg`, log: () => {} });
  assert.equal(r.rounds.length, 4, '첫 판 + 고친 판 3');
  assert.equal(r.passed, false); assert.equal(r.image, 'v2.jpg', '최저점이 가장 높은 판'); assert.match(r.flagged, /3번/);
}
// [7] 10분 상한 — 시간이 다 되면 더 고치지 않고 가장 나은 판
{
  let t = 0;
  const judges = { agy: async () => { t += 400_000; return { score: 6, weak: 'x', text: '다른 글' }; }, claude: async () => ({ score: 9, weak: '', text: '' }) };
  const r = await runThumbGate({ image: 'v0.jpg', text: '처음', title: 'T', source: '', kind: 'shorts', maxChars: 24, judges, need, now: () => t,
    deadlineMs: 600_000, rerender: async () => 'v1.jpg', log: () => {} });
  assert.ok(r.rounds.length <= 2, `상한 넘겨 계속 돌았다: ${r.rounds.length}`);
  assert.match(r.flagged, /시간/);
}
// [8] 심판이 던져도 관문은 안 죽는다 — 그 심판은 '못 매김', 결과는 통과 아님
{
  const judges = { agy: async () => { throw new Error('할당량'); }, claude: async () => ({ score: 9, weak: '', text: '' }) };
  const r = await runThumbGate({ image: 'v0.jpg', text: '처음', title: 'T', source: '', kind: 'shorts', maxChars: 24, judges, need, rerender: async () => null, log: () => {} });
  assert.equal(r.passed, false); assert.match(r.rounds[0].scores.agy.error, /할당량/); assert.ok(r.flagged);
}
// [9] 고칠 글이 다 걸러지면(지어낸 숫자 등) 같은 판을 다시 굽지 않고 멈춘다
{
  let calls = 0;
  const judges = { agy: async () => ({ score: 6, weak: 'x', text: '50% 폭등' }), claude: async () => ({ score: 6, weak: 'x', text: '지금 사세요' }) };
  const r = await runThumbGate({ image: 'v0.jpg', text: '처음', title: 'T', source: '실적 발표', kind: 'shorts', maxChars: 24, judges, need, rerender: async () => { calls++; return 'v1.jpg'; }, log: () => {} });
  assert.equal(calls, 0); assert.equal(r.rounds.length, 1); assert.match(r.flagged, /고칠 글/);
}
// [10] 답 봉투 읽기 — claude -p 봉투 안 result 에 ```json 울타리가 있어도 봉투를 먼저 읽는다(10/28 실측 '출력을 못 읽음')
{
  const env = JSON.stringify({ num_turns: 2, result: '```json\n{"score":6,"weak":"w","text":"t"}\n```' });
  const j = firstJson(env);
  assert.equal(j.num_turns, 2);
  assert.deepEqual(firstJson(j.result), { score: 6, weak: 'w', text: 't' });
}
// [11] 부르는 쪽 규칙(accept) — 롱폼 두 줄(줄마다 2~8자)에 안 맞는 글은 건너뛰고 다음 심판 글을 쓴다
{
  const seen = [];
  const judges = { agy: async ({ image }) => (image === 'v0.jpg' ? { score: 5, weak: 'x', text: '아주 긴 한 줄짜리 글' } : { score: 9, weak: '', text: '' }),
    claude: async ({ image }) => (image === 'v0.jpg' ? { score: 6, weak: 'x', text: '반도체 / 급반등' } : { score: 9, weak: '', text: '' }) };
  const r = await runThumbGate({ image: 'v0.jpg', text: '처음 / 글', title: 'T', source: '', kind: 'long', maxChars: 19, digits: false, judges, need,
    accept: (t) => { const l = t.split(' / '); return l.length === 2 && l.every((x) => x.length >= 2 && x.length <= 8); },
    rerender: async (t) => { seen.push(t); return 'v1.jpg'; }, log: () => {} });
  assert.deepEqual(seen, ['반도체 / 급반등']); assert.equal(r.passed, true);
}
// [12] 22:00 보고 — 오늘(KST) 'uploaded' 줄만, 점수 셋과 표시 이유
{
  const { summarize } = await import('../thumb-gate-report.mjs');
  const L = [
    { at: '2026-10-28T05:00:00Z', event: 'gate', kind: 'shorts' },
    { at: '2026-10-28T05:01:00Z', event: 'uploaded', kind: 'shorts', title: 'A #Shorts', passed: true, flagged: null, chatgpt: '미채점', agy: 8, claude: 9, rounds: 2, text: 'x' },
    { at: '2026-10-28T14:59:00Z', event: 'uploaded', kind: 'long', title: 'B', passed: false, flagged: '3번 고쳐도 8점 미만', chatgpt: '미채점', agy: 7, claude: 6, rounds: 4, text: 'y / z' },
    { at: '2026-10-28T15:01:00Z', event: 'uploaded', kind: 'shorts', title: 'C', passed: true, chatgpt: 8, agy: 8, claude: 8, rounds: 1, text: 'w' },
  ];
  const t = summarize(L, '2026-10-28');
  assert.match(t, /올린 2편\(통과 1\) · 안 올림 0편 · 건너뛴 슬롯 0/);
  assert.match(t, /✅ 14:01 쇼츠 ChatGPT 미채점 · agy 8 · Claude 9/);
  assert.match(t, /⚠ 23:59 롱폼 .* — 3번 고쳐도 8점 미만/);
  assert.ok(!/ C$/.test(t), '다음 날(KST) 편은 빠진다');
}
// [13] 그림 판정 — 심판이 그림이 주제와 안 맞는다(image_ok=false)고 하면 요약에 imageBad 로 남는다(상시 쇼츠는 표지 그림을 다시 그린다 — 10/28 Mac mini2)
{
  assert.equal(parseJudge({ score: 6, weak: 'w', text: 't', image_ok: false }).imageOk, false);
  assert.equal(parseJudge({ score: 6, weak: 'w', text: 't' }).imageOk, undefined);
  assert.ok(judgePrompt({ title: 'T', kind: 'shorts', file: 'f.jpg', textRule: 'r' }).includes('image_ok'));
  const judges = { agy: async () => ({ score: 6, weak: '집 그림은 주식과 무관', text: '', image_ok: false }), claude: async () => ({ score: 9, weak: '', text: '', image_ok: true }) };
  const r = await runThumbGate({ image: 'v0.jpg', text: '처음', title: 'T', source: '', kind: 'shorts', judges, need, rerender: async () => null, log: () => {} });
  const { gateSummary } = await import('./thumb-gate.mjs');
  assert.equal(gateSummary(r).imageBad, 1);
}
// [14] ChatGPT 대기열(Mac mini3, ~/history/_thumbq) — in/<id>.json 을 쓰고 out/<id>.json 을 기다린다. score null 은 못 매김. 23:35~02:40 은 처리 안 함 → 바로 미채점
{
  const { chatgptJudge, inNightBan } = await import('./thumb-gate.mjs');
  const { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const q = mkdtempSync(join(tmpdir(), 'thumbq-test-')); mkdirSync(join(q, 'in')); mkdirSync(join(q, 'out'));
  const img = join(q, 'a.jpg'); writeFileSync(img, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const answer = (score, extra = {}) => { const t = setInterval(() => {
    for (const f of readdirSync(join(q, 'in')).filter((x) => x.endsWith('.json'))) {
      const req = JSON.parse(readFileSync(join(q, 'in', f), 'utf8'));
      assert.ok(req.image.startsWith('/') && req.title === 'T' && req.lang === 'ko');
      writeFileSync(join(q, 'out', f), JSON.stringify({ id: f.slice(0, -5), score, fix: '글을 줄여라', better_text: '더 나은 글', judge: 'chatgpt', ...extra })); clearInterval(t);
    } }, 20); };
  const day = () => new Date('2026-10-28T06:00:00Z');   // 15:00 KST
  answer(7);
  assert.deepEqual(await chatgptJudge({ image: img, title: 'T', qdir: q, pollMs: 20, timeoutMs: 3000, now: day }), { score: 7, weak: '글을 줄여라', text: '더 나은 글' });
  answer(null, { error: 'login' });
  await assert.rejects(chatgptJudge({ image: img, title: 'T', qdir: q, pollMs: 20, timeoutMs: 3000, now: day }), /login/);
  // 10/28 실측: 크롬이 막 살아난 뒤 답이 'score 0' 으로 세 번 왔다(직전 판 7.2·7.8, 11초 만에). 오류가 붙었거나 고칠 점이 비면 매긴 게 아니다.
  answer(0, { error: 'parse failed' });
  await assert.rejects(chatgptJudge({ image: img, title: 'T', qdir: q, pollMs: 20, timeoutMs: 3000, now: day }), /parse failed/);
  { const t = setInterval(() => { for (const f of readdirSync(join(q, 'in')).filter((x) => x.endsWith('.json'))) {
      writeFileSync(join(q, 'out', f), JSON.stringify({ id: f.slice(0, -5), score: 0, fix: '', fixes: [], better_text: '', judge: 'chatgpt' })); clearInterval(t); } }, 20); }
  await assert.rejects(chatgptJudge({ image: img, title: 'T', qdir: q, pollMs: 20, timeoutMs: 3000, now: day }), /빈 답/);
  await assert.rejects(chatgptJudge({ image: img, title: 'T', qdir: q, pollMs: 20, timeoutMs: 200, now: day }), /시간초과/);
  assert.equal(readdirSync(join(q, 'in')).filter((x) => x.endsWith('.json')).length, 1, '답 받은 요청은 지우고(저쪽은 in 을 남긴다), 시간초과 요청만 남긴다');
  assert.ok((await chatgptJudge({ image: img, title: 'T', qdir: q, now: () => new Date('2026-10-28T15:00:00Z') })).skipped, '00:00 KST 는 처리 안 하는 시간');
  assert.equal(inNightBan(new Date('2026-10-28T14:34:00Z')), false); assert.equal(inNightBan(new Date('2026-10-28T14:35:00Z')), true);
  assert.equal(inNightBan(new Date('2026-10-28T17:39:00Z')), true); assert.equal(inNightBan(new Date('2026-10-28T17:40:00Z')), false);
}
// [15] 10/28 저녁 완화(사장님, Mac mini2 경유): 둘이 8 이상 + 나머지 하나 7.5 이상이면 통과. 0.5 점 단위를 받는다.
//   ChatGPT 가 못 매기면 나머지 둘이 8 이상이어도 통과가 아니다(야간 미채점 포함) — 다만 더 고칠 것이 없으니 거기서 멈춘다(settled).
{
  const N3 = ['chatgpt', 'agy', 'claude'];
  assert.equal(parseJudge({ score: 7.5, weak: '', text: '' }).score, 7.5);
  assert.equal(parseJudge({ score: 7.3, weak: '', text: '' }).score, 7.3, 'ChatGPT 대기열은 소수 한 자리(Mac mini3 10/28)');
  assert.equal(parseJudge({ score: 7.46, weak: '', text: '' }).score, 7.5, '한 자리로 반올림');
  assert.equal(decide({ chatgpt: { score: 6.9 }, agy: { score: 8 }, claude: { score: 9 } }, N3).pass, false, '6.9 는 7 미만');
  // 10/28 저녁 최종(사장님, 보정 결과를 보고): 셋 다 7 이상 + 하나라도 7.5 이상
  assert.equal(decide({ chatgpt: { score: 7.2 }, agy: { score: 7.5 }, claude: { score: 7 } }, N3).pass, true, 'pZd7tHnjg2o 7.2/7.5/7');
  assert.equal(decide({ chatgpt: { score: 7 }, agy: { score: 7 }, claude: { score: 7.4 } }, N3).pass, false, '7.5 이상이 하나도 없다');
  assert.equal(decide({ chatgpt: { score: 6.9 }, agy: { score: 9 }, claude: { score: 9 } }, N3).pass, false, '7 미만이 있다');
  assert.equal(decide({ chatgpt: { score: 7.8 }, agy: { score: 5.5 }, claude: { score: 6.5 } }, N3).pass, false, '16:43 편');
  const night = decide({ chatgpt: { skipped: '야간' }, agy: { score: 7 }, claude: { score: 7.5 } }, N3);
  assert.equal(night.pass, false); assert.equal(night.settled, true, '못 매긴 ChatGPT 말고는 기준을 넘었다 — 더 굽지 않는다');
  const night2 = decide({ chatgpt: { skipped: '야간' }, agy: { score: 6.5 }, claude: { score: 9 } }, N3);
  assert.equal(night2.pass, false); assert.equal(night2.settled, false);
  // 흐름 — ChatGPT 가 빠진 채 나머지가 기준을 넘으면 더 굽지 않고 멈춘다
  let calls = 0;
  const judges = { chatgpt: async () => ({ skipped: '야간' }), agy: async () => ({ score: 8, weak: '', text: '' }), claude: async () => ({ score: 9, weak: '', text: '' }) };
  const r = await runThumbGate({ image: 'v0.jpg', text: '처음', title: 'T', source: '', kind: 'shorts', judges, need: N3, rerender: async () => { calls++; return 'v1.jpg'; }, log: () => {} });
  assert.equal(calls, 0); assert.equal(r.passed, false); assert.match(r.flagged, /ChatGPT/);
}
// [16] 10/28 저녁 정정 — 미달은 안 올린다: 보고에 '안 올림(held)'·'슬롯 건너뜀(skipped)' 도 센다
{
  const { summarize } = await import('../thumb-gate-report.mjs');
  const L = [
    { at: '2026-10-28T09:00:00Z', event: 'held', kind: 'shorts', title: 'N1 #Shorts', passed: false, flagged: '3번 고쳐도 기준 미달', chatgpt: 7, agy: 6, claude: 6, text: 'a' },
    { at: '2026-10-28T09:12:00Z', event: 'skipped', kind: 'shorts', why: '썸네일 미달' },
    { at: '2026-10-28T10:00:00Z', event: 'held', kind: 'long', edition: 'krclose', title: 'L1', passed: false, flagged: '시간 상한 8분', chatgpt: 7, agy: 7, claude: 8, text: 'b / c' },
  ];
  const t = summarize(L, '2026-10-28');
  assert.match(t, /올린 0편\(통과 0\) · 안 올림 2편 · 건너뛴 슬롯 1/);
  assert.match(t, /✋ 18:00 쇼츠 ChatGPT 7 · agy 6 · Claude 6 .* — 3번 고쳐도 기준 미달/);
  assert.match(t, /✋ 19:00 롱폼\(krclose\)/);
}
await sleep(0);
console.log('thumb-gate.test: ✅ 전부 통과');
