/**
 * squeeze-reconcile.mjs — 발간 직전 스퀴즈 항목을 실측 공매도 데이터와 대조한다.
 *
 * 왜 필요한가(2026-08-21):
 *   morning 보고서가 shortSqueeze[0] = {ticker:'MRNA', score:43} 을 발간했고
 *   topOpportunity 가 "MRNA의 43점 스퀴즈 점수와 …" 라며 그 숫자를 근거로 삼았다.
 *   /api/short-interest 실측은 55 다 — 43은 LLM 이 지어낸 숫자다.
 *     shortFloatPct 15.2(>10 → +20) + shortVolPct 57.6(>55 → +15) + accumulating(+20) = 55
 *
 *   종목 선택 자체는 맞았다(33종 중 COIN 과 공동 1위). 그래서 더 위험하다 —
 *   맞는 종목에 틀린 숫자가 붙으면 검증 없이 통과한다.
 *
 *   구조적으로 막지 못한 이유:
 *     · 프롬프트(:6280)가 score 를 LLM 에게 쓰게 한다
 *     · enrichSqueezePostEarnings 는 timing 만료일·실적반응만 보고 숫자를 대조하지 않는다
 *   → 발간 직전에 실측으로 덮는다. 계산은 이미 API 가 한다(calcSqueezeScore) — 여기서 다시 계산하지 않는다.
 *     같은 산식을 두 곳에 두면 조용히 어긋난다.
 *
 * 원칙: 실측에 있으면 실측 점수로 덮고, 없으면 확인 불가라 뺀다.
 *   빈 섹션은 이 저장소가 이미 비차단으로 다룬다(generate-report-local.mjs:851-855
 *   "외부 소스 일시 down 시 빈 섹션이 완벽한 …"). 지어낸 숫자를 발간하는 것보다 낫다.
 */

/** ctx.short 는 배열이거나 {entries:[...]} 다 — 둘 다 받는다. */
function toEntries(real) {
  if (!real) return null;
  if (Array.isArray(real)) return real;
  if (Array.isArray(real.entries)) return real.entries;
  return null;
}

/**
 * @param {Array<{ticker:string, score?:number}>} llmEntries  LLM 이 만든 shortSqueeze
 * @param {Array|{entries:Array}} real                        실측 공매도 데이터(ctx.short)
 * @returns {{entries: Array, fixes: string[]}}
 */
export function reconcileSqueeze(llmEntries, real) {
  const fixes = [];
  const list = Array.isArray(llmEntries) ? llmEntries : [];
  const realArr = toEntries(real);

  if (!realArr || realArr.length === 0) {
    if (list.length) fixes.push(`실측 없음 — 스퀴즈 ${list.length}건 전부 보류(지어낸 점수 발간 금지)`);
    return { entries: [], fixes };
  }

  const byTicker = new Map();
  for (const r of realArr) {
    const t = String(r?.ticker ?? '').toUpperCase();
    if (t) byTicker.set(t, r);
  }

  const entries = [];
  for (const s of list) {
    const t = String(s?.ticker ?? '').toUpperCase();
    const r = byTicker.get(t);
    if (!r) {
      fixes.push(`${t || '(빈 티커)'} 실측 공매도 데이터에 없음 → 제거(확인 불가)`);
      continue;
    }
    const realScore = typeof r.squeezeScore === 'number' ? r.squeezeScore : null;
    const out = { ...s, ticker: t };
    if (realScore != null) {
      if (s.score !== realScore) {
        fixes.push(`${t} score ${s.score} → ${realScore}(실측)`);
      }
      out.score = realScore;
    }
    // 화면이 점수만 보여주면 독자가 검증할 수 없다 — 근거를 함께 싣는다.
    // 실측에 있는 필드만 붙인다. 없는 값을 만들어 붙이지 않는다.
    for (const k of ['shortFloatPct', 'shortVolPct', 'shortRatio', 'shortChangeMonthly', 'instAction']) {
      if (r[k] != null) out[k] = r[k];
    }
    entries.push(out);
  }
  return { entries, fixes };
}

/**
 * 산문에 박힌 옛 점수를 교정한다.
 *
 * topOpportunity 가 "MRNA의 43점 스퀴즈 점수와 …" 처럼 숫자를 근거로 인용한다.
 * 항목의 score 만 55 로 고치고 산문을 두면 같은 화면에서 43과 55가 충돌한다.
 * 해당 티커가 같은 문장에 있을 때만 바꾼다 — 우연히 일치하는 숫자를 건드리지 않기 위해서다.
 * 못 찾으면 바꾸지 않고 알린다. 호출부가 판단한다(저장소는 이런 경우 문구를 비우는 관습이 있다).
 */
export function correctScoreMentions(text, corrections) {
  const src = String(text ?? '');
  if (!src || !Array.isArray(corrections) || corrections.length === 0) return { text: src, changed: [], unresolved: [] };
  let out = src;
  const changed = [], unresolved = [];
  for (const c of corrections) {
    const t = String(c?.ticker ?? '').toUpperCase();
    if (!t || !out.toUpperCase().includes(t)) continue;          // 그 티커 얘기가 아니면 건드리지 않는다
    if (c.from == null || c.to == null || c.from === c.to) continue;
    // 한국어 "43점" / 영어 "score of 43" · "43-point" · "43 point"
    const pats = [
      new RegExp(`(?<![\\d.])${c.from}(?=\\s*점)`, 'g'),
      new RegExp(`(?<=score of )${c.from}(?![\\d.])`, 'gi'),
      new RegExp(`(?<![\\d.])${c.from}(?=[- ]point)`, 'gi'),
    ];
    let hit = false;
    for (const re of pats) {
      if (re.test(out)) { out = out.replace(re, String(c.to)); hit = true; }
    }
    hit ? changed.push(`${t} 산문 ${c.from}→${c.to}`) : unresolved.push(`${t} 산문에서 ${c.from} 위치를 못 찾음`);
  }
  return { text: out, changed, unresolved };
}
