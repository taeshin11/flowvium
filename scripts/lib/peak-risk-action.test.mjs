#!/usr/bin/env node
/**
 * peak-risk-action.test.mjs — 과열 종목의 buy→watch 강등이 **데이터**로 결정되는가.
 *
 * 사건(2026-08-22): harness_actionCritiqueMismatch 가 최근 7일 27건(다양성 37%,
 *   278470.KS 만 13회 반복). 추적하니 전부 `buy→watch (note 매칭)` 이었다.
 *   걸린 문장은 `⚠️ 고점 주의 — 신규 매수 자제: RSI 78(과매수권) | …` 인데
 *   이 문장은 **코드가 쓴다**(generate-report-local.mjs:2200 detectPeakDumpRisk).
 *   즉 코드가 riskNote 를 쓰고 → 하네스가 그 산문을 정규식으로 읽어 강등하고 →
 *   그걸 **모델의 결함**으로 기록했다. 통화 하드코딩 건과 같은 구조다.
 *
 * 더 나쁜 점: 하네스 패턴(ACTION_DOWNGRADE_PATTERNS_HARNESS)은
 *   `⚠️ 고점 주의 — 신규 매수 자제`(**가장 낮은 등급** w2-3)에만 걸린다.
 *   `🟠 고점 경고 — 분할매도 검토`(w4-7)와 `🔴 덤핑 고위험 — 즉각 손절라인 점검`(w>=8)은
 *   패턴에 걸리는 단어가 없고, 요약이 상위 2~3개 신호만 담아 `과매수` 라벨마저 잘릴 수 있다.
 *   → 경미한 과열은 강등되고 심한 과열은 buy 로 남는 역전이 **코드상 가능**하다.
 *   (실측: 최근 14일에 🟠/🔴 발생 0건이라 실제로 일어난 적은 없다 — 잠재 결함이다.)
 *
 * 근본: 강등 여부는 이미 숫자로 알고 있다(totalWeight, signals). 뒤 단계가 자기가 쓴 산문을
 *   정규식으로 되읽을 일이 아니다. 결정을 데이터가 있는 자리에서 내린다.
 */
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const M = await import('./peak-risk-action.mjs')
  .catch(e => { bad(`peak-risk-action.mjs 없음: ${String(e.message).slice(0,60)}`); return null; });
if (!M) { console.log('\n❌ 1건 실패'); process.exit(1); }

const risk = (w, rsi) => ({
  totalWeight: w,
  signals: rsi == null ? [{ label: '거래량 급증' }] : [{ label: `RSI ${rsi}(과매수권)` }],
});

// [1] 실제로 반복된 사례: w2-3 (⚠️ 고점 주의) → watch
{
  const d = M.peakRiskAction(risk(3, 78));
  d?.action === 'watch' ? ok(`w3 → watch (${d.reason})`) : bad(`w3 을 강등하지 않는다: ${JSON.stringify(d)}`);
}
// [2] 역전 방지: 더 심한 등급이 buy 로 남으면 안 된다
for (const [w, rsi] of [[5, 60], [8, 60], [12, 40]]) {
  const d = M.peakRiskAction(risk(w, rsi));
  d?.action === 'watch' ? ok(`w${w}/RSI${rsi} → watch (경미한 등급보다 느슨하지 않다)`)
                        : bad(`w${w}/RSI${rsi} 가 buy 로 남는다 — 역전`);
}
// [3] 과열 정보가 없으면 건드리지 않는다
M.peakRiskAction(null) === null && M.peakRiskAction(undefined) === null
  ? ok('과열 데이터 없으면 null (기존 액션 유지)')
  : bad('과열 데이터가 없는데 강등한다');
// [4] RSI 과매수는 근거 문구를 남긴다 (기존 동작 보존)
{
  const d = M.peakRiskAction(risk(5, 78));
  /RSI 78/.test(d?.note ?? '') ? ok(`RSI 근거 보존: ${d.note}`) : bad(`RSI 근거가 사라졌다: ${JSON.stringify(d)}`);
}
// [5] 판정이 산문에 의존하지 않는다 — summary 문구를 바꿔도 결과가 같아야 한다
{
  const a = M.peakRiskAction({ ...risk(3, 78), summary: '⚠️ 고점 주의 — 신규 매수 자제: RSI 78(과매수권)' });
  const b = M.peakRiskAction({ ...risk(3, 78), summary: '🔴 문구를 완전히 바꿔도' });
  a?.action === b?.action ? ok('요약 문구와 무관하게 같은 판정') : bad('산문 문구에 판정이 흔들린다');
}
// [6] 배선 + 하네스 산문 되읽기 제거
{
  const { readFileSync } = await import('fs');
  const src = readFileSync(new URL('../generate-report-local.mjs', import.meta.url), 'utf8')
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  /peak-risk-action\.mjs/.test(src) ? ok('생성기가 이 모듈을 쓴다') : bad('만들었는데 생성기가 안 쓴다');
  /const rsiVal = rsiSignal \? parseInt/.test(src)
    ? bad('강등 판정이 아직 그 자리에 인라인으로 남아 있다 — 두 벌이 되면 갈린다')
    : ok('인라인 판정 제거됨');
}

console.log(fail === 0 ? '\n✅ peak-risk-action 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
