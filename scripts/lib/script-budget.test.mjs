#!/usr/bin/env node
/**
 * script-budget.test.mjs — 대본 길이를 **코드가** 목표에 맞추는가.
 *
 * 배경(2026-08-27): "--seconds 90" 으로 돌렸는데 128.8초가 나왔다. 프롬프트에 장면당
 *   146~220자를 명시했는데 4B 가 장면당 약 310자를 썼다. 프롬프트로 길이를 지시하는 건
 *   두 번 연속 실패했다(1차 60.7초/목표 90, 2차 128.8초/목표 90).
 *
 * 그래서 길이는 지시하지 않고 **자른다.** 다만 자르는 방식이 중요하다:
 *   · 글자 수로 뚝 자르면 문장이 반토막 나서 앵커가 말을 하다 만다.  → 문장 경계에서만 자른다.
 *   · 장면을 통째로 버리면 이슈 하나가 사라진다.                    → 장면 수는 유지한다.
 *   · 장면당 최소 1문장은 남긴다. 빈 장면은 TTS 가 던진다.
 */
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const M = await import('./script-budget.mjs');

const S = (...says) => says.map((say, i) => ({ title: `T${i}`, say }));
const total = (sc) => sc.reduce((n, s) => n + s.say.length, 0);

// ── 1. 예산 안이면 손대지 않는다 ─────────────────────────────────────────────
{
  const before = S('Short one.', 'Short two.');
  const r = M.fitScript(before, { budgetChars: 1000 });
  if (r.scenes[0].say === 'Short one.' && r.scenes[1].say === 'Short two.') ok('예산 이내 → 원문 그대로');
  else bad(`건드렸다: ${JSON.stringify(r.scenes.map(s => s.say))}`);
  if (r.trimmed === 0) ok('trimmed=0 보고');
  else bad(`trimmed=${r.trimmed}`);
}

// ── 2. 초과하면 줄어든다 ─────────────────────────────────────────────────────
{
  const sent = 'This is a sentence of some length that fills space. ';
  const before = S(sent.repeat(5).trim(), sent.repeat(5).trim(), sent.repeat(5).trim());
  const budget = 200;
  const r = M.fitScript(before, { budgetChars: budget });
  if (total(r.scenes) < total(before)) ok(`줄었다 ${total(before)} → ${total(r.scenes)}자`);
  else bad(`안 줄었다 ${total(r.scenes)}`);
  if (total(r.scenes) <= budget * 1.35) ok(`예산 ${budget} 근처(${total(r.scenes)})`);
  else bad(`여전히 초과: ${total(r.scenes)} > ${budget * 1.35}`);
  if (r.scenes.length === before.length) ok('장면 수는 그대로 (이슈를 버리지 않는다)');
  else bad(`장면 수 변함 ${before.length} → ${r.scenes.length}`);
}

// ── 3. 문장 중간에서 자르지 않는다 ───────────────────────────────────────────
{
  const before = S('Alpha one here. Bravo two here. Charlie three here. Delta four here.');
  const r = M.fitScript(before, { budgetChars: 20 });
  if (/[.!?]$/.test(r.scenes[0].say)) ok(`문장 경계에서 끝난다: "${r.scenes[0].say}"`);
  else bad(`반토막: "${r.scenes[0].say}"`);
  if (before[0].say.includes(r.scenes[0].say)) ok('남은 문장이 원문의 접두부와 일치');
  else bad(`원문에 없는 문장: "${r.scenes[0].say}"`);
}

// ── 4. 아무리 빡빡해도 장면을 비우지 않는다 ──────────────────────────────────
{
  const before = S('One long single sentence that cannot be shortened any further at all.', 'Another one here.');
  const r = M.fitScript(before, { budgetChars: 5 });
  if (r.scenes.every(s => s.say && s.say.trim().length > 0)) ok('빈 장면 없음');
  else bad(`빈 장면 발생: ${JSON.stringify(r.scenes.map(s => s.say))}`);
}

// ── 5. 한국어 문장도 경계를 찾는다 ───────────────────────────────────────────
{
  const before = S('첫 문장입니다. 둘째 문장입니다. 셋째 문장입니다. 넷째 문장입니다.');
  const r = M.fitScript(before, { budgetChars: 16 });
  if (r.scenes[0].say.endsWith('다.')) ok(`한국어 문장 경계: "${r.scenes[0].say}"`);
  else bad(`한국어 반토막: "${r.scenes[0].say}"`);
  if (r.scenes[0].say.length < before[0].say.length) ok('한국어도 줄어든다');
  else bad('한국어는 안 줄었다');
}

// ── 6. 다른 필드는 보존한다 ──────────────────────────────────────────────────
{
  const before = [{ title: 'Keep me', say: 'A. B. C. D. E. F.', visual: 'courtroom bench' }];
  const r = M.fitScript(before, { budgetChars: 4 });
  if (r.scenes[0].title === 'Keep me' && r.scenes[0].visual === 'courtroom bench') ok('title·visual 보존');
  else bad(`필드 유실: ${JSON.stringify(r.scenes[0])}`);
}

// ── 7. 빈 입력 안전 ──────────────────────────────────────────────────────────
{
  try {
    const a = M.fitScript([], { budgetChars: 100 });
    const b = M.fitScript(null, { budgetChars: 100 });
    if (a.scenes.length === 0 && b.scenes.length === 0) ok('빈 입력 → 빈 배열');
    else bad('빈 입력 결과 이상');
  } catch (e) { bad(`빈 입력 throw: ${e.message}`); }
}

console.log(fail ? `\n❌ script-budget ${fail} 실패` : '\n✅ script-budget 전부 통과');
process.exit(fail ? 1 : 0);
