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


// ── 8. 예산을 **채워야** 한다 — 너무 적게 남기는 것도 실패다 ─────────────────
// 실측(2026-08-27): 예산 1467자에 2024자가 들어왔는데 682자만 남겼다(목표 90초 → 45.7초).
//   장면마다 budget/n 로 균등하게 자르니, 문장 하나만 남기고 남은 예산을 못 쓴다.
//   → 전역으로 **가장 긴 장면부터** 문장을 덜어내 예산 근처까지만 줄인다.
{
  const sent = (n, len) => Array.from({ length: n }, (_, i) => `Sentence ${i} ${'x'.repeat(len)}.`).join(' ');
  const before = Array.from({ length: 8 }, () => ({ title: 't', say: sent(3, 70) }));  // 장면당 약 250자
  const budget = 1400;
  const r = M.fitScript(before, { budgetChars: budget });
  const total = r.scenes.reduce((n, s) => n + s.say.length, 0);
  if (total <= budget * 1.15) ok(`예산 이하로 줄었다 ${r.before} → ${total}`);
  else bad(`안 줄었다 ${total} > ${budget * 1.15}`);
  if (total >= budget * 0.75) ok(`예산을 채운다 (${(total / budget * 100).toFixed(0)}%)`);
  else bad(`너무 적게 남겼다 ${total} — 예산의 ${(total / budget * 100).toFixed(0)}% (영상이 목표보다 짧아진다)`);
  if (r.scenes.length === before.length) ok('장면 수 유지');
  else bad('장면이 사라졌다');
  if (r.scenes.every(s => /\.$/.test(s.say.trim()))) ok('전부 문장 경계에서 끝난다');
  else bad('반토막 문장 발생');
}


// ── 8b. 실측 재현 — 문장 길이가 고르지 않으면 예산이 남아돈다 ────────────────
// 2026-08-27 실제 실행: 예산 1467자에 2024자가 들어왔는데 **682자(46%)** 만 남겨
//   목표 90초 영상이 45.7초가 됐다.
// 장면당 균등 배분(budget/n = 183)이라, 첫 문장(85자) 다음에 올 문장(110자)이 183을 넘으면
//   그 장면은 85자에서 멈춘다. 남은 98자는 어느 장면도 못 쓴다 — 8장면이면 784자가 증발한다.
// → 전역으로 **가장 긴 장면부터** 덜어내야 예산을 채운다.
{
  const S8 = () => Array.from({ length: 8 }, () => ({
    title: 't',
    // 85 / 110 / 60 자 문장 세 개. 실제 대본의 길이 분포를 흉내낸다.
    say: `${'a'.repeat(83)}. ${'b'.repeat(108)}. ${'c'.repeat(58)}.`,
  }));
  const budget = 1467;
  const r = M.fitScript(S8(), { budgetChars: budget });
  const total = r.scenes.reduce((n, s) => n + s.say.length, 0);
  const pct = (total / budget * 100).toFixed(0);
  if (total <= budget * 1.15) ok(`예산 이하 ${r.before} → ${total}`);
  else bad(`초과: ${total}`);
  if (total >= budget * 0.8) ok(`고르지 않은 문장에서도 예산을 채운다 (${pct}%)`);
  else bad(`예산의 ${pct}% 만 남겼다 (${total}/${budget}) — 영상이 목표보다 크게 짧아진다`);
}

console.log(fail ? `\n❌ script-budget ${fail} 실패` : '\n✅ script-budget 전부 통과');
process.exit(fail ? 1 : 0);
