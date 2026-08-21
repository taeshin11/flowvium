#!/usr/bin/env node
/**
 * yoy-reconcile.test.mjs — companyChanges.revenueYoY 를 실측과 대조한다.
 *
 * 배경(2026-08-21 전수조사): LLM 이 쓰는 수치 필드를 전부 훑다가 남은 마지막 자리.
 *   fillCompanyChangesYoY 는 `if (c.revenueYoY != null) continue;` 로 *null 일 때만* 채운다.
 *   LLM 이 쓴 값은 실측과 다르더라도 그대로 발간된다.
 *
 *   이번 morning 보고서는 4건 전부 실측과 일치했다(EOG 57.4 · 039200.KQ 193.6 ·
 *   010280.KQ 29.5 · 003230.KS 36.1 — 각각 quarterlyRevenue.yoyPct / DART annuals 로 확인).
 *   즉 지금 당장의 오류는 아니다. 그런데 같은 구조에서 shortSqueeze.score 는 실제로 지어냈다(43 vs 55).
 *   "이번엔 맞았다"는 검증이 아니다 — 대조 경로가 없으면 다음에 틀려도 모른다.
 *
 *   분기 라벨과 함께 덮는다. 값만 바꾸면 "Q2 FY2026" 라벨에 다른 분기 수치가 붙는다.
 */
import { reconcileCompanyYoY, isMeasuredYoY } from './yoy-reconcile.mjs';

let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

// signalDigest 형태: Map<ticker, {fin:{yoy:'+57.4% YoY', label:'Q2 FY2026'}}>
const digest = new Map([
  ['EOG',  { fin: { yoy: '+57.4% YoY', label: 'Q2 FY2026' } }],
  ['AMD',  { fin: { yoy: '-3.2% YoY',  label: 'Q2 FY2026' } }],
  ['NOFIN',{ fin: null }],
]);

// ① null 은 채운다 (기존 동작 보존)
{
  const cc = [{ ticker: 'EOG', revenueYoY: null, latestQuarter: null }];
  const { changes, filled, corrected } = reconcileCompanyYoY(cc, digest);
  changes[0].revenueYoY === 57.4 && changes[0].latestQuarter === 'Q2 FY2026'
    ? ok('null → 실측으로 채움') : bad(`채우기 실패: ${JSON.stringify(changes[0])}`);
  filled.length === 1 && corrected.length === 0 ? ok('채움으로 분류') : bad(`분류 이상: filled=${filled.length} corrected=${corrected.length}`);
}
// ② 틀린 값은 덮는다 (신규 동작)
{
  const cc = [{ ticker: 'EOG', revenueYoY: 12.0, latestQuarter: 'Q1 FY2026' }];
  const { changes, corrected } = reconcileCompanyYoY(cc, digest);
  changes[0].revenueYoY === 57.4 ? ok('불일치 값 → 실측으로 교정') : bad(`교정 안 됨: ${changes[0].revenueYoY}`);
  changes[0].latestQuarter === 'Q2 FY2026' ? ok('분기 라벨도 함께 교정') : bad(`라벨 불일치: ${changes[0].latestQuarter}`);
  corrected.some(c => c.includes('EOG') && c.includes('12') && c.includes('57.4')) ? ok('교정 내역 기록') : bad(`내역 없음: ${JSON.stringify(corrected)}`);
}
// ③ 일치하면 건드리지 않는다 (부동소수 오차 허용)
{
  const cc = [{ ticker: 'EOG', revenueYoY: 57.4, latestQuarter: 'Q2 FY2026' }];
  const { corrected } = reconcileCompanyYoY(cc, digest);
  corrected.length === 0 ? ok('일치 시 무변경') : bad(`불필요한 교정: ${JSON.stringify(corrected)}`);
}
// ④ 음수 실측도 정확히 파싱한다
{
  const cc = [{ ticker: 'AMD', revenueYoY: 20, latestQuarter: 'x' }];
  const { changes } = reconcileCompanyYoY(cc, digest);
  changes[0].revenueYoY === -3.2 ? ok('음수 YoY 파싱') : bad(`음수 파싱 실패: ${changes[0].revenueYoY}`);
}
// ⑤ 실측이 없으면 LLM 값을 지우지 않는다 — 근거가 없다고 삭제하면 정보만 잃는다.
//    대신 검증 못 했음을 알린다. (스퀴즈는 티커 자체가 확인 불가라 뺐지만, 여기는 필드 하나다)
{
  const cc = [{ ticker: 'NOFIN', revenueYoY: 11.1, latestQuarter: 'Q1' }];
  const { changes, unverified } = reconcileCompanyYoY(cc, digest);
  changes[0].revenueYoY === 11.1 ? ok('실측 없음 → 원값 유지') : bad('근거 없다고 삭제함');
  unverified.some(u => u.includes('NOFIN')) ? ok('미검증을 보고') : bad('미검증을 침묵 처리');
}
// ⑥ 입력 방어
reconcileCompanyYoY(null, digest).changes.length === 0 ? ok('null 입력 안전') : bad('null 처리 이상');
reconcileCompanyYoY([{ ticker: 'EOG', revenueYoY: 1 }], null).changes[0].revenueYoY === 1 ? ok('digest null 안전') : bad('digest null 처리 이상');

// ⑦ 생성 코드가 이 경로를 탄다
{
  const { readFileSync } = await import('fs');
  const { resolve, dirname } = await import('path');
  const { fileURLToPath } = await import('url');
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const gen = readFileSync(resolve(ROOT, 'scripts/generate-report-local.mjs'), 'utf8');
  /reconcileCompanyYoY\(/.test(gen) ? ok('생성 코드가 reconcileCompanyYoY 를 쓴다') : bad('실측 대조 미배선');
}

// ⑧ 실측과 일치하는 값은 'field swap' 휴리스틱의 대상이 아니다.
//    generate-report-local:8332 이 revenueYoY > 100 을 "비현실"이라며 null 로 버린다.
//    그 주석은 스스로 "SK하이닉스 198% 같은 실제 가능성 있어"라고 인정한다 — 알면서 버린다.
//    실측 대조가 생긴 지금은 판정 근거가 있다: 계산된 YoY 와 같으면 오기입이 아니다.
//    (실측: 039200.KQ FY2025 99,838,669,222 / FY2024 34,007,602,680 → +193.6%. DART 확인)
{
  const d = new Map([['039200.KQ', { fin: { yoy: '+193.6% YoY', label: 'FY2025' } }]]);
  isMeasuredYoY('039200.KQ', 193.6, d) ? ok('193.6% 이 실측과 일치 → 측정값으로 인정') : bad('실측 일치를 인정 못 함');
  isMeasuredYoY('039200.KQ', 99838, d) === false ? ok('매출 절대값 오기입은 측정값 아님') : bad('오기입을 측정값으로 오인');
  isMeasuredYoY('UNKNOWN', 193.6, d) === false ? ok('실측 없으면 측정값 아님(보수적)') : bad('근거 없이 측정값 인정');
  isMeasuredYoY('039200.KQ', 193.64, d) ? ok('반올림 오차 허용') : bad('반올림 오차를 불일치로 봄');
  isMeasuredYoY('039200.KQ', null, d) === false ? ok('null 안전') : bad('null 처리 이상');
  isMeasuredYoY('039200.KQ', 193.6, null) === false ? ok('digest 없음 안전') : bad('digest null 처리 이상');
}

// ⑨ 생성 코드의 strip 이 이 판정을 거친다
{
  const { readFileSync } = await import('fs');
  const { resolve, dirname } = await import('path');
  const { fileURLToPath } = await import('url');
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const gen = readFileSync(resolve(ROOT, 'scripts/generate-report-local.mjs'), 'utf8');
  /isMeasuredYoY\(/.test(gen) ? ok('strip 이 실측 판정을 거친다') : bad('strip 이 여전히 크기만 보고 버린다');
  // 순서: 재무 보충 → strip → 보완. 보충이 strip 뒤로 가면 포트폴리오 밖 종목은
  //   strip 시점에 실측이 없어 크기만 보고 버려진다(= isMeasuredYoY 가 무력화된다).
  //   이 저장소에서 '정규화가 대상보다 먼저 도는' 순서 사고를 이미 세 번 겪었다 — 고정한다.
  const iSupp  = gen.indexOf('companyChanges 재무 보충');
  const iStrip = gen.indexOf('const futureQuarterStripped = [];');
  const iFill  = gen.indexOf('fillCompanyChangesYoY(finalReport.companyChanges');
  (iSupp > 0 && iStrip > 0 && iFill > 0)
    ? ((iSupp < iStrip && iStrip < iFill)
        ? ok(`순서 보충(${iSupp}) < strip(${iStrip}) < 보완(${iFill})`)
        : bad(`순서 어긋남: 보충 ${iSupp} · strip ${iStrip} · 보완 ${iFill}`))
    : bad('순서 앵커를 못 찾음 — 테스트가 낡았다');
}

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
