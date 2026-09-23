#!/usr/bin/env node
/**
 * cross-check.test.mjs — 두 모델의 답을 맞대는 규칙. 2026-09-23 신설.
 *
 * 왜 (사장님 "claude랑 gemini 둘이서 교차 검증"):
 *   agy 는 한 번 부르면 --model 하나만 답한다. 교차검증은 같은 것을 따로 묻고
 *   답을 맞대야 생긴다. 그 '맞대기' 규칙이 여기 있다.
 *
 * 규칙의 뜻:
 *   · 둘 다 조용하다        → pass       (믿는다)
 *   · 둘 다 같은 곳을 지적  → confirmed  (실제 결함일 가능성이 높다. 먼저 본다)
 *   · 한쪽만 지적           → disagree   (사람이 봐야 한다. 자동으로 버리지 않는다)
 *   · 한쪽이 답을 못 냄     → inconclusive (지나간 것이 아니라 **못 본 것**이다)
 *
 * 마지막 줄이 핵심이다. 실패를 pass 로 세면 검증기가 있으나 마나 해진다 —
 *   이 저장소가 'gate-that-can-never-fire' 로 이미 겪은 것이다.
 */
import { reconcile, normalizeWhere, screenFindings } from './cross-check.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const V = (findings) => ({ ok: findings.length === 0, findings, unknown: [] });
const F = (where, what, severity = 'medium') => ({ where, what, severity });

// [1] 둘 다 조용하면 통과
{
  const r = reconcile(V([]), V([]));
  r.status === 'pass' ? ok('[1] 둘 다 조용 → pass') : bad(`[1] ${r.status}`);
}

// [2] 둘 다 같은 곳을 지적하면 confirmed — 먼저 볼 것
{
  const r = reconcile(V([F('/ko/report:시장요약', '수치가 본문과 다르다')]),
                      V([F('/ko/report:시장요약', '요약의 KOSPI 값이 표와 불일치')]));
  r.status === 'confirmed' && r.agreed.length === 1
    ? ok(`[2] 같은 곳 지적 → confirmed (${r.agreed[0].where})`) : bad(`[2] ${JSON.stringify(r)}`);
}

// [3] 한쪽만 지적하면 disagree — **버리지 않는다.** 둘 중 하나는 놓쳤거나 헛봤다
{
  const r = reconcile(V([F('/ko/heatmap', '범례가 비어 있다')]), V([]));
  r.status === 'disagree' && r.onlyA.length === 1 && r.onlyB.length === 0
    ? ok('[3] 한쪽만 지적 → disagree') : bad(`[3] ${JSON.stringify(r)}`);
}

// [4] ★ 한쪽이 답을 못 내면 inconclusive. **pass 가 아니다.**
//     모델 호출은 실제로 실패한다 — 오늘만 503 한 번, 300초 타임아웃 한 번을 봤다.
//     그걸 통과로 세면 아무것도 안 보면서 초록불이 켜진다.
{
  reconcile(null, V([])).status === 'inconclusive' ? ok('[4] 한쪽 실패 → inconclusive') : bad('[4] 실패를 통과로 셌다');
  reconcile(V([]), null).status === 'inconclusive' ? ok('[4b] 반대쪽도 같다') : bad('[4b]');
  reconcile(null, null).status === 'inconclusive' ? ok('[4c] 둘 다 실패') : bad('[4c]');
}

// [5] 지적 위치는 표기가 달라도 같은 곳으로 본다 — 모델마다 공백·대소문자가 다르다
{
  normalizeWhere('/ko/Report : 시장요약 ') === normalizeWhere('/ko/report:시장요약')
    ? ok('[5] 위치 표기 정규화') : bad(`[5] ${normalizeWhere('/ko/Report : 시장요약 ')}`);
}

// [6] 심각도는 **높은 쪽을 따른다** — 한쪽이 high 면 high 로 본다.
//     낮은 쪽을 따르면 둘 중 더 잘 본 모델의 경고가 묻힌다.
{
  const r = reconcile(V([F('/ko/short', 'a', 'high')]), V([F('/ko/short', 'b', 'low')]));
  r.agreed[0].severity === 'high' ? ok('[6] 높은 심각도를 따른다') : bad(`[6] ${r.agreed[0].severity}`);
}

// [7] 양쪽 지적을 모두 남긴다 — 나중에 사람이 읽을 때 '왜' 가 둘 다 필요하다
{
  const r = reconcile(V([F('/x', '이유 A')]), V([F('/x', '이유 B')]));
  r.agreed[0].what.includes('이유 A') && r.agreed[0].what.includes('이유 B')
    ? ok('[7] 두 모델의 이유를 모두 보존') : bad(`[7] ${r.agreed[0].what}`);
}

// ── 근거 대조 ────────────────────────────────────────────────────────────────
// 2026-09-23 실측: 첫 실전에서 claude-opus 가 `indexLevelsAbs.S&P500 키에 "&amp;" 가 섞여 있다`
//   고 지적했다. 실제 키는 'S&P500' 이고 &amp; 는 **없었다** — 모델이 지어낸 것이다.
//   맞대기만으로는 이걸 못 거른다(한쪽만 지적 → disagree → 사람이 확인). 사람이 매번 볼 수는 없다.
//   근거로 댄 문구가 원문에 **글자 그대로** 있는지 기계가 먼저 본다.
{
  const subject = '{"indexLevelsAbs":{"KOSPI":7090,"S&P500":6800}}';
  const v = { ok: false, findings: [
    F('a', '지어낸 것', 'high'),
    F('b', '진짜', 'high'),
  ], unknown: [] };
  v.findings[0].evidence = '"S&amp;P500"';   // 원문에 없다
  v.findings[1].evidence = '"S&P500":6800';  // 원문에 있다
  const s2 = screenFindings(v, subject);
  s2.findings.length === 1 && s2.findings[0].where === 'b'
    ? ok('[8] 원문에 없는 근거는 findings 에서 뺀다') : bad(`[8] ${JSON.stringify(s2.findings.map(f=>f.where))}`);
  s2.unverified.length === 1 && s2.unverified[0].where === 'a'
    ? ok('[8b] 뺀 것은 버리지 않고 unverified 로 남긴다') : bad(`[8b] ${JSON.stringify(s2.unverified)}`);
}

// [9] 근거를 아예 안 단 지적은 **통과시킨다** — 근거가 필요 없는 지적도 있다
//     (예: "이 필드가 비었다"). 없는 것을 못 찾았다고 버리면 진짜 결함을 놓친다.
{
  const v = { ok: false, findings: [F('c', '비어 있다', 'high')], unknown: [] };
  const s2 = screenFindings(v, '{"c":""}');
  s2.findings.length === 1 ? ok('[9] 근거 없는 지적은 남긴다') : bad('[9] 근거 없다고 버렸다');
}

// [10] 공백·따옴표 차이는 봐준다 — 모델이 옮겨 적으며 모양이 조금 바뀐다
{
  const v = { ok: false, findings: [F('d', 'x', 'low')], unknown: [] };
  v.findings[0].evidence = '"S&P500" : 6800';
  screenFindings(v, '{"S&P500":6800}').findings.length === 1
    ? ok('[10] 공백 차이는 같은 것으로 본다') : bad('[10] 공백 때문에 진짜를 버렸다');
}

console.log(fail ? `\n  ❌ ${fail}건 실패` : '\n  ✅ 전부 통과');
process.exit(fail ? 1 : 0);
