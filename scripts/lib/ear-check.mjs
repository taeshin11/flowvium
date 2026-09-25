/**
 * ear-check.mjs — 만든 소리를 **되들어서** 약어가 제대로 읽혔는지 보고, 틀리면 다른 표기로 다시 만든다. (2026-09-25)
 *
 * 사장님 "왜 자꾸 이런 문제가 생기는 거지 이런 문제 없게 해".
 * 왜 자꾸 생겼나: 화면은 매 편 눈검증(agy, 프레임 8장)을 하는데 **소리는 아무도 안 들었다.**
 *   G20 을 "지이영" 으로 읽은 것도 시청자 댓글로 알았다(OECD → "띠" · GDP → "뿐" 도 되들음에서 나왔다).
 *   약어를 하나씩 사전에 넣으면 다음 낯선 약어에서 또 난다 — 만드는 자리에서 듣고 고친다.
 *
 * 판정: 원문 약어와 들린 문장을 **같은 읽기**(speakLatin → speakNumbers → 한글만)로 맞춰 포함 여부를 본다.
 *   whisper 는 "G20" · "지 20" · "지이십" 어느 꼴로도 적기 때문이다.
 * 고치기: 안 들린 약어만 다른 표기(dot → spaced → commas)로 그 문장을 다시 합성해 다시 듣는다.
 * 막지 않는다: whisper 도 틀린다(실측 "케이구" → "피이고"). 끝내 안 되면 원래 소리를 쓰고 경고·기록만 남긴다 —
 *   기록(logs/ear-check.jsonl)은 발음 사전(kr-latin AS_WORD)에 넣을 후보다.
 * 귀를 못 쓰면 **판정 없음**이다. '통과' 로 적지 않는다.
 */
import { speakLatin, spellTerm, isLatinTerm } from './kr-latin.mjs';
import { speakNumbers } from './kr-number.mjs';

const STYLES = ['dot', 'spaced', 'commas'];

/** 문장에서 소리를 확인할 약어들(중복 없이, 나온 순서대로). */
export function keyTerms(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(/[A-Za-z0-9][A-Za-z0-9.\-]*/g)) {
    const tok = m[0].replace(/[.\-]+$/, '');
    if (isLatinTerm(tok) && !out.includes(tok)) out.push(tok);
  }
  return out;
}

/** 비교용 읽기 — 한글만 남기고, 소리용 표기 차이(륙/육)는 지운다. */
function canon(s) {
  return speakNumbers(speakLatin(String(s ?? ''))).replace(/륙/g, '육').replace(/[^가-힣]/g, '');
}

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

/** 약어가 들린 문장 안에 있는가. 네 글자 이상이면 한 글자 차이는 봐준다(whisper 받침 흔들림). */
export function heard(term, asrText) {
  const t = canon(term);
  const a = canon(asrText);
  if (!t) return true;
  if (a.includes(t)) return true;
  if (t.length < 4) return false;
  for (let i = 0; i + t.length <= a.length; i++) if (editDistance(t, a.slice(i, i + t.length)) <= 1) return true;
  return false;
}

/**
 * @param {{texts:string[], out:{path:string,durationSec:number,spoken?:string}[],
 *          synth:(spoken:string[], display:string[])=>any[], transcribe:(items:{path:string,spoken?:string}[])=>string[],
 *          log:(m:string)=>void, record:(x:object)=>void}} o   합성·받아쓰기는 주입(테스트·순환 import 회피)
 * @returns {{out:any[], checked:number, fixed:number, unresolved:{term:string,text:string,heardAs:string}[], skipped?:string}}
 */
export function earCheckAndRepair({ texts, out, synth, transcribe, log, record }) {
  const items = texts.map((t, i) => ({ i, terms: keyTerms(t) })).filter((x) => x.terms.length);
  if (!items.length) return { out, checked: 0, fixed: 0, unresolved: [] };
  let asr;
  try { asr = transcribe(items.map((x) => ({ path: out[x.i].path, spoken: out[x.i].spoken }))); }
  catch (e) {
    const why = `귀(whisper)를 못 썼다: ${String(e?.message ?? e).slice(0, 80)}`;
    log(`[귀검증] 판정 없음 — ${why}`);
    return { out, checked: 0, fixed: 0, unresolved: [], skipped: why };
  }
  const next = [...out];
  let pending = items.map((x, k) => ({ ...x, heardAs: asr[k] ?? '', missed: x.terms.filter((t) => !heard(t, asr[k] ?? '')) }))
    .filter((x) => x.missed.length);
  const total = items.reduce((n, x) => n + x.terms.length, 0);
  if (!pending.length) { log(`[귀검증] ✅ 약어 ${total}개 모두 제대로 들렸다`); return { out, checked: items.length, fixed: 0, unresolved: [] }; }
  for (const p of pending) log(`[귀검증] ⚠ ${p.i + 1}번 문장 ${p.missed.join('·')} 가 안 들렸다 — 들린 말: "${p.heardAs.slice(0, 60)}"`);

  let fixed = 0;
  for (const style of STYLES) {
    if (!pending.length) break;
    const spoken = pending.map((p) => speakNumbers(speakLatin(texts[p.i], {
      overrides: Object.fromEntries(p.missed.map((t) => [t, spellTerm(t, style)])) })));
    let made, again;
    try {
      made = synth(spoken, pending.map((p) => texts[p.i]));
      again = transcribe(made.map((m, k) => ({ path: m.path, spoken: m.spoken ?? spoken[k] })));
    } catch (e) { log(`[귀검증] ${style} 다시 만들기 실패: ${String(e?.message ?? e).slice(0, 60)}`); continue; }
    const still = [];
    pending.forEach((p, k) => {
      const miss = p.missed.filter((t) => !heard(t, again[k] ?? ''));
      if (miss.length < p.missed.length) {
        next[p.i] = made[k];   // 나아졌으면 이것을 쓴다
        log(`[귀검증] ✅ ${p.i + 1}번 문장 ${style} 표기로 다시 만들어 ${p.missed.filter((t) => !miss.includes(t)).join('·')} 해결`);
        if (!miss.length) fixed++;
      }
      if (miss.length) still.push({ ...p, missed: miss, heardAs: again[k] ?? p.heardAs });
    });
    pending = still;
  }
  const unresolved = pending.flatMap((p) => p.missed.map((term) => ({ term, text: texts[p.i], heardAs: p.heardAs })));
  for (const u of unresolved) {
    log(`[귀검증] ❗ ${u.term} 은 어떤 표기로도 제대로 안 들렸다 — 발행은 하되 발음 사전 후보로 기록한다`);
    record(u);
  }
  return { out: next, checked: items.length, fixed, unresolved };
}
