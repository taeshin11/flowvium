#!/usr/bin/env node
/**
 * subtitle.test.mjs — 자막이 **말과 붙어 있는가**.
 *
 * 배경(2026-08-27): 이슈 영상이 "PPT 읽는 것 같다"는 지적. 뉴스 화면의 핵심은 자막인데
 *   장면당 1줄을 통째로 띄우면 말보다 앞서거나 늦어서 읽히지 않는다.
 *
 * 그래서 길이를 추정하지 않고 **ElevenLabs 가 돌려주는 글자 단위 타임스탬프**를 쓴다
 *   (POST /v1/text-to-speech/{id}/with-timestamps → alignment.character_start_times_seconds).
 *   실측 확인: "Dolly Parton is back..." 44자, 첫 5자 0/0.104/0.174/0.209/0.255초.
 *   글자당 시간을 평균으로 나누면 쉼표·문장부호에서 최대 0.5초씩 밀린다 — 그래서 추정 금지.
 *
 * 줄바꿈 기준은 글자 수가 아니라 **단어 경계**다. 단어 중간에서 끊긴 자막은 오히려 안 읽힌다.
 */
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const M = await import('./subtitle.mjs');

// 헬퍼: 글자마다 0.1초씩 흐르는 가짜 alignment
const align = (text, step = 0.1, from = 0) => ({
  characters: [...text],
  character_start_times_seconds: [...text].map((_, i) => from + i * step),
  character_end_times_seconds:   [...text].map((_, i) => from + (i + 1) * step),
});

// ── 1. 단어 중간에서 자르지 않는다 ───────────────────────────────────────────
{
  const cues = M.cuesFromAlignment(align('alpha bravo charlie delta'), { maxChars: 12 });
  const bad1 = cues.filter(c => !/^[\w ]+$/.test(c.text) || c.text !== c.text.trim());
  if (bad1.length === 0) ok('앞뒤 공백 없이 잘린다');
  else bad(`공백 포함 큐: ${JSON.stringify(bad1)}`);

  const joined = cues.map(c => c.text).join(' ');
  if (joined === 'alpha bravo charlie delta') ok('원문이 하나도 빠지지 않는다');
  else bad(`원문 손실: "${joined}"`);

  if (cues.every(c => c.text.length <= 12)) ok('maxChars 를 지킨다');
  else bad(`초과: ${JSON.stringify(cues.map(c => c.text))}`);
}

// ── 2. 시간이 실제 타임스탬프에서 온다 ───────────────────────────────────────
{
  const cues = M.cuesFromAlignment(align('one two', 0.1), { maxChars: 3 });
  // 'one' = 글자 0..2 → 0.0~0.3, 'two' = 글자 4..6 → 0.4~0.7
  if (Math.abs(cues[0].start - 0.0) < 1e-6 && Math.abs(cues[0].end - 0.3) < 1e-6) ok('첫 큐 시각 = 첫 글자 시작~끝');
  else bad(`첫 큐 ${cues[0].start}~${cues[0].end}`);
  if (Math.abs(cues[1].start - 0.4) < 1e-6) ok('둘째 큐는 공백을 건너뛴 글자에서 시작');
  else bad(`둘째 큐 시작 ${cues[1].start}`);
}

// ── 3. offset — 장면 N 의 자막은 영상 전체 타임라인으로 밀린다 ────────────────
{
  const cues = M.cuesFromAlignment(align('hi'), { maxChars: 8, offset: 10 });
  if (Math.abs(cues[0].start - 10) < 1e-6) ok('offset 이 더해진다');
  else bad(`offset 미반영: ${cues[0].start}`);
}

// ── 4. maxDur — 긴 단어 하나가 화면을 오래 잡지 않게 쪼갠다 ──────────────────
{
  const cues = M.cuesFromAlignment(align('a b c d e f g h', 0.6), { maxChars: 100, maxDur: 2.0 });
  if (cues.length > 1 && cues.every(c => c.end - c.start <= 2.0 + 1e-6)) ok('maxDur 를 지킨다');
  else bad(`maxDur 위반: ${JSON.stringify(cues.map(c => +(c.end - c.start).toFixed(2)))}`);
}

// ── 5. 한국어 — 공백이 드물어도 최소한 maxChars 근처에서 끊긴다 ──────────────
{
  const cues = M.cuesFromAlignment(align('돌리파튼이오늘세상을떠났습니다'), { maxChars: 8 });
  if (cues.length >= 2) ok('공백 없는 한국어도 쪼갠다');
  else bad(`한 줄로 뭉침: ${JSON.stringify(cues.map(c => c.text))}`);
  if (cues.map(c => c.text).join('') === '돌리파튼이오늘세상을떠났습니다') ok('한국어 원문 무손실');
  else bad(`손실: ${cues.map(c => c.text).join('')}`);
}

// ── 6. ASS 출력 — libass 가 먹는 형식이고 특수문자를 깨뜨리지 않는다 ──────────
{
  const ass = M.toAss([{ start: 1.5, end: 2.25, text: 'he said {hi}\nthere' }], { font: 'Arial', fontSize: 60 });
  if (ass.includes('[V4+ Styles]') && ass.includes('[Events]')) ok('ASS 섹션 구조');
  else bad('ASS 섹션 누락');
  if (ass.includes('0:00:01.50') && ass.includes('0:00:02.25')) ok('시:분:초.센티초 포맷');
  else bad(`시각 포맷 이상:\n${ass.split('\n').filter(l => l.startsWith('Dialogue')).join('\n')}`);
  const line = ass.split('\n').find(l => l.startsWith('Dialogue'));
  if (!line.includes('{hi}') && line.includes('\\N')) ok('중괄호 이스케이프 · 줄바꿈 \\N 변환');
  else bad(`이스케이프 실패: ${line}`);
}

// ── 7. 빈 입력에서 죽지 않는다 ───────────────────────────────────────────────
{
  try {
    const a = M.cuesFromAlignment(null, {});
    const b = M.cuesFromAlignment({ characters: [] }, {});
    if (Array.isArray(a) && a.length === 0 && Array.isArray(b) && b.length === 0) ok('빈 alignment → 빈 배열');
    else bad(`빈 입력 결과 ${JSON.stringify([a, b])}`);
  } catch (e) { bad(`빈 입력에서 throw: ${e.message}`); }
}

console.log(fail ? `\n❌ subtitle ${fail} 실패` : '\n✅ subtitle 전부 통과');
process.exit(fail ? 1 : 0);
