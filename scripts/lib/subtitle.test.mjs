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


// ── 8. 2줄 자막 밴드 — 방송 자막은 한 줄이 아니라 두 줄이다 ────────────────────
// 레퍼런스(YTN "지금 이 뉴스"): 하단 밝은 띠 안에 **두 줄**이 들어가고, 줄바꿈은 단어 경계다.
// 한 줄짜리 짧은 큐가 계속 깜빡이면 오히려 읽기 힘들다 — 두 줄을 채워 체류 시간을 늘린다.
{
  // 들어가는 경우: 줄당 글자 수를 지킨다.
  const F = M.wrapLines('alpha bravo charlie', 12, 2);
  if (F.length === 2 && F.every(x => x.length <= 12)) ok(`들어가면 줄당 12자 이내: ${JSON.stringify(F)}`);
  else bad(`줄바꿈 이상: ${JSON.stringify(F)}`);

  // 넘치는 경우: **글자를 버리지 않는다.** 자막에서 말한 단어가 사라지는 건
  //   줄이 조금 길어지는 것보다 나쁘다(libass 가 접어준다).
  const L = M.wrapLines('alpha bravo charlie delta', 12, 2);
  if (L.length <= 2) ok(`줄 수는 ${L.length}줄 유지`);
  else bad(`줄이 넘쳤다: ${JSON.stringify(L)}`);
  if (L.join(' ') === 'alpha bravo charlie delta') ok('넘쳐도 글자를 잃지 않는다');
  else bad(`손실: "${L.join(' ')}"`);

  const K = M.wrapLines('돌리파튼이오늘세상을떠났습니다', 8, 2);
  if (K.length === 2 && K.join('') === '돌리파튼이오늘세상을떠났습니다'.slice(0, K.join('').length))
    ok(`공백 없는 한국어도 2줄로: ${JSON.stringify(K)}`);
  else bad(`한국어 줄바꿈 이상: ${JSON.stringify(K)}`);

  if (M.wrapLines('', 10, 2).length === 0) ok('빈 문자열 안전');
  else bad('빈 문자열에서 줄 생성');
}

// ── 9. maxLines 를 주면 큐가 두 줄 분량까지 뭉친다 ───────────────────────────
{
  const align2 = (text) => ({
    characters: [...text],
    character_start_times_seconds: [...text].map((_, i) => i * 0.1),
    character_end_times_seconds: [...text].map((_, i) => (i + 1) * 0.1),
  });
  const one = M.cuesFromAlignment(align2('aa bb cc dd ee ff gg hh'), { maxChars: 8, maxLines: 1, maxDur: 99 });
  const two = M.cuesFromAlignment(align2('aa bb cc dd ee ff gg hh'), { maxChars: 8, maxLines: 2, maxDur: 99 });
  if (two.length < one.length) ok(`2줄이면 큐가 줄어든다 ${one.length} → ${two.length}`);
  else bad(`큐 수 변화 없음 ${one.length} vs ${two.length}`);
  if (two.some(c => c.text.includes('\n'))) ok('큐 안에 줄바꿈이 들어간다');
  else bad(`줄바꿈 없음: ${JSON.stringify(two.map(c => c.text))}`);
  const flat = two.map(c => c.text.replace(/\n/g, ' ')).join(' ');
  if (flat === 'aa bb cc dd ee ff gg hh') ok('2줄로 묶어도 원문 무손실');
  else bad(`손실: "${flat}"`);
}

// ── 10. 밴드 스타일 — 밝은 띠 위 어두운 글자(외곽선 없음) ─────────────────────
// 어두운 배경에 흰 글자 + 두꺼운 외곽선은 사진 위에 얹을 때의 방식이고,
// 밴드가 있으면 외곽선이 오히려 지저분하다. 두 방식을 코드가 구분해야 한다.
{
  const ass = M.toAss([{ start: 0, end: 1, text: 'a\nb' }], { style: 'band' });
  const style = ass.split('\n').find(l => l.startsWith('Style:'));
  if (/,0,0,2,/.test(style.replace(/\s/g, '')) || /,0,0,/.test(style)) ok('밴드 스타일은 외곽선·그림자 0');
  else bad(`외곽선이 남았다: ${style}`);
  if (/&H00[0-9A-Fa-f]{2}([0-9A-Fa-f]{2})\1/.test(style) || style.includes('&H00202020')) ok('어두운 글자색');
  else bad(`글자색 확인 필요: ${style}`);
}


// ── 11. 문장 경계에서 끊는다 ────────────────────────────────────────────────
// 실측(2026-08-27 렌더): 자막에 "saying she could not believe she was / real. Lauren" 이 떴다.
//   앞 문장의 끝과 다음 문장의 첫 단어가 한 큐에 섞이면 읽는 사람이 두 번 멈춘다.
//   방송 자막은 글자 수가 아니라 **문장·절 경계**로 끊는다.
{
  const al = (t) => ({ characters: [...t],
    character_start_times_seconds: [...t].map((_, i) => i * 0.06),
    character_end_times_seconds: [...t].map((_, i) => (i + 1) * 0.06) });
  const cues = M.cuesFromAlignment(al('She was real. Lauren said the news broke her heart today.'),
    { maxChars: 30, maxLines: 2, maxDur: 99 });
  const bad1 = cues.filter(c => /[.!?]\s*\S/.test(c.text.replace(/\n/g, ' ')));
  if (bad1.length === 0) ok(`마침표 뒤에 다른 문장이 붙지 않는다: ${JSON.stringify(cues.map(c => c.text.replace(/\n/g, '|')))}`);
  else bad(`문장이 섞였다: ${JSON.stringify(bad1.map(c => c.text))}`);
  const flat = cues.map(c => c.text.replace(/\n/g, ' ')).join(' ');
  if (flat === 'She was real. Lauren said the news broke her heart today.') ok('문장 경계로 끊어도 무손실');
  else bad(`손실: "${flat}"`);
}

// ── 12. 큐 사이 빈틈 메우기 ─────────────────────────────────────────────────
// 하단 밴드는 항상 떠 있는데 자막만 사라지면 "고장난 화면" 으로 보인다(실측: 장면 경계 0.45초).
// 짧은 빈틈은 앞 큐를 늘려 덮는다. 긴 침묵까지 덮으면 말과 자막이 어긋나므로 상한을 둔다.
{
  const cues = [{ start: 0, end: 1, text: 'a' }, { start: 1.4, end: 2, text: 'b' }, { start: 8, end: 9, text: 'c' }];
  const f = M.fillGaps(cues, 1.5);
  if (Math.abs(f[0].end - 1.4) < 1e-6) ok('짧은 빈틈(0.4초)은 앞 큐를 늘려 덮는다');
  else bad(`안 덮었다: ${f[0].end}`);
  if (Math.abs(f[1].end - 2) < 1e-6) ok('긴 침묵(6초)은 그대로 둔다');
  else bad(`긴 침묵을 덮었다: ${f[1].end}`);
  if (f.length === 3 && f[2].end === 9) ok('마지막 큐는 손대지 않는다');
  else bad('마지막 큐 변형');
  if (M.fillGaps([], 1).length === 0 && M.fillGaps(null, 1).length === 0) ok('빈 입력 안전');
  else bad('빈 입력 이상');
}

console.log(fail ? `\n❌ subtitle ${fail} 실패` : '\n✅ subtitle 전부 통과');
process.exit(fail ? 1 : 0);
