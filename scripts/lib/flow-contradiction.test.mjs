#!/usr/bin/env node
/**
 * flow-contradiction.test.mjs — 수급 방향 모순의 '검출'과 '교정'이 같은 것을 본다.
 *
 * 배경(2026-08-20 오후 실행, 발간 차단): 결정론 수급은 "외국인 순매도 3.08조원"인데
 *   marketNarrative.why 가 "원화 강세가 외국인 자금 유입을 가속"이라고 썼다.
 *   verify-report(:955)의 검출기는 잡았고 → pre-publish gate 가 발간을 막았다(정상 동작).
 *   그런데 narrative-fix 의 교정기 fixKrFlowContradiction 은 못 고쳤다:
 *       검출기 패턴: 순유입|자금\s*유입|유입\s*확대|유입세|순매수\s*(지속|…)
 *       교정기 패턴: (매수세|순매수)[^.]{0,8}(지속|확대|이어)     ← '유입' 형태가 없다
 *   2026-07-05 에 "detector-without-corrector"를 해소했다고 적혀 있는데, 패턴이 갈라지면서
 *   부분적으로 되살아났다. 문자열을 두 파일에 각각 적어두면 이렇게 조용히 어긋난다.
 *
 * 지켜야 할 불변식: 검출기가 결함이라고 한 문장은 교정기가 고칠 수 있어야 한다.
 *   아니면 발간이 막히기만 하고 스스로 회복하지 못한다 — 실제로 오후 보고서가 그렇게 됐다.
 */
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

let F;
try { F = await import('./flow-contradiction.mjs'); }
catch (e) { console.log(`  FAIL  모듈 없음: ${e.message}`); process.exit(1); }

// 실측 = 순매도인데 서사가 매수/유입을 주장하는 형태들
const SELL_MEASURED_CONTRA = [
  '원화 강세(USD/KRW -1.6%)가 외국인 자금 유입을 가속.',      // ← 오후 실제 사례
  '외국인 순유입이 이어지며 지수를 밀어올렸다.',
  '외국인 매수세 지속으로 반도체가 강세를 보였다.',
  '외국인 순매수 확대가 수급을 지지했다.',
  '외국인 자금 유입 확대가 관찰된다.',
  '기관 유입세가 뚜렷하다.',
];
// 정당한 서술 — 잡으면 안 된다
const SELL_MEASURED_OK = [
  '외국인 순매도 3.08조원이 지속되고 있다.',
  '외국인 순매수 둔화가 이어지고 있다.',      // 둔화 수식 — 의미상 정상
  '과거 외국인 자금 유입이 있었으나 지금은 이탈 중이다.',
  '국내 기관은 매수했지만 외국인은 팔았다.',
];

for (const t of SELL_MEASURED_CONTRA) {
  F.isContradiction(t, 'sell') ? ok(`검출: ${t.slice(0, 34)}…`) : bad(`놓침: ${t}`);
}
for (const t of SELL_MEASURED_OK) {
  !F.isContradiction(t, 'sell') ? ok(`정상 통과: ${t.slice(0, 30)}…`) : bad(`오탐: ${t}`);
}
// 여러 문장이 합쳐진 텍스트에서, 정상 문장이 모순 문장을 가리면 안 된다.
// 2026-08-20 실측: 필드를 합쳐 통째로 판정했더니 다른 문장의 대조 어미('했지만')가
//   전체를 제외시켜 진짜 모순을 놓쳤다 — 게이트가 약해지는 방향의 버그.
const MASKING = '국내 기관은 매수했지만 외국인은 팔았다. 원화 강세가 외국인 자금 유입을 가속.';
F.isContradiction(MASKING, 'sell') ? ok('정상 문장이 모순 문장을 가리지 않음') : bad('마스킹 발생 — 모순을 놓침');
const ALL_OK = '외국인 순매도가 지속된다. 국내 기관은 매수했지만 외국인은 팔았다.';
!F.isContradiction(ALL_OK, 'sell') ? ok('전부 정상이면 통과') : bad('정상 텍스트 오탐');

// 반대 방향도 대칭이어야 한다 (2026-07-05 원래 사례: 실측 순매수인데 "매도세 지속")
F.isContradiction('외국인 매도세가 지속되고 있다.', 'buy') ? ok('반대 방향 대칭 (실측 순매수 vs 매도 주장)') : bad('반대 방향 미검출');
!F.isContradiction('외국인 순매수가 이어진다.', 'buy') ? ok('반대 방향 정상 통과') : bad('반대 방향 오탐');

// 실측 방향 파싱
F.measuredDirection('KR 외국인+기관 주요 종목 순매도 43382억원') === 'sell' ? ok('실측 방향 파싱: 순매도') : bad('순매도 파싱 실패');
F.measuredDirection('외국인 순매수 1조 9,922억원') === 'buy' ? ok('실측 방향 파싱: 순매수') : bad('순매수 파싱 실패');
F.measuredDirection('방향 없음') === null ? ok('방향 불명 → null') : bad('방향 불명 처리 이상');

// ── 핵심 불변식: 검출기가 쓰는 패턴과 교정기가 쓰는 패턴이 같은 소스여야 한다 ──
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
for (const f of ['scripts/verify-report.mjs', 'scripts/lib/narrative-fix.mjs']) {
  let src = '';
  try { src = readFileSync(resolve(ROOT, f), 'utf8'); } catch { bad(`${f} 읽기 실패`); continue; }
  /flow-contradiction/.test(src)
    ? ok(`${f.split('/').pop()}: 단일 소스 사용`)
    : bad(`${f}: 패턴을 자체 보유 — 다시 갈라진다`);
}

// ── 2026-09-10: 주체가 다르면 모순이 아니다 ──────────────────────────────────
//   자정 회차가 이렇게 썼다: "외국인 자금 이탈(-5,441.1억 원)에도 불구하고
//   국내 기관과 개인 매수세가 주가를 떠받쳤다". 실측은 "외국인 5441억 순매도" 였고
//   검출기가 수급방향역전으로 찍어 발간 게이트를 세웠다. 그런데 외국인이 팔고
//   기관·개인이 사는 것은 동시에 성립하는 사실이고, 문장은 외국인 매도를 명시적으로
//   인정하고 있다. 오탐이다. 오탐이 쌓이면 게이트를 끄게 된다.
//   다만 느슨해지는 쪽 실수가 더 나쁘므로 "외국인 매도를 인정 + 다른 주체의 매수" 만 뺀다.
F.isContradiction('외국인 자금 이탈(-5,441.1억 원)에도 불구하고 국내 기관과 개인 매수세가 주가를 떠받쳤다.', 'sell') === false
  ? ok('외국인 매도 인정 + 기관·개인 매수 = 모순 아님') : bad('오탐: 주체가 다른 매수를 역전으로 본다');
F.isContradiction('원화 강세가 외국인 자금 유입을 가속했다.', 'sell') === true
  ? ok('외국인 자신의 방향 역전은 그대로 잡는다') : bad('게이트가 느슨해졌다 — 진짜 역전을 놓친다');
F.isContradiction('외국인 순매도에도 불구하고 외국인 순매수가 이어졌다.', 'sell') === true
  ? ok('인정 문구가 있어도 주체가 외국인이면 잡는다') : bad('게이트가 느슨해졌다 — 같은 주체 역전을 놓친다');
F.isContradiction('국내 기관 매수세가 지수를 끌어올렸다.', 'sell') === true
  ? ok('외국인 매도 인정이 없으면 기관 매수도 잡는다') : bad('게이트가 느슨해졌다 — 인정 없는 주장을 흘린다');

// ── 불변식: 검출기와 교정기가 **같은 문장**을 문제 삼는다 ──────────────────────
//   2026-09-10: 주체 인식을 검출기에만 넣었더니 교정기가 더 공격적이 되어
//   참인 문장("외국인 이탈에도 기관·개인 매수")까지 지웠다. 판단이 두 곳에 있으면 갈라진다.
{
  const N = await import('./narrative-fix.mjs');
  const KR = '외국인 5441억 순매도 지속';
  const cases = [
    ['외국인 자금 이탈에도 불구하고 국내 기관과 개인 매수세가 주가를 떠받쳤다.', false],
    ['원화 강세가 외국인 자금 유입을 가속했다.', true],
    ['국내 기관 매수세가 지수를 끌어올렸다.', true],
  ];
  for (const [sent, shouldFix] of cases) {
    const rep = { thesis: `${sent} ${'문장을 채운다.'.repeat(4)}`, marketNarrative: {} };
    const before = rep.thesis;
    N.fixKrFlowContradiction(rep, KR);
    const changed = rep.thesis !== before;
    changed === shouldFix
      ? ok(`검출·교정 일치: ${sent.slice(0, 22)}… → ${shouldFix ? '고침' : '보존'}`)
      : bad(`검출·교정 갈라짐: "${sent.slice(0, 30)}" 검출=${shouldFix} 교정=${changed}`);
  }
}

// ── 불변식: 검출기와 교정기가 **같은 입력**을 본다 ────────────────────────────
//   2026-09-10 자정 회차: flowEvidence 에 kr_smart_flow claim 이 없어 교정기가 통째로
//   건너뛰었고("_krFlowDirFix": null), 검출기만 잡아 모순 문장이 그대로 발간됐다.
//   claim 이 없으면 검출기가 쓰는 regionStances.korea.thesis 로 떨어져야 한다.
{
  const N = await import('./narrative-fix.mjs');
  const rep = {
    regionStances: { korea: { thesis: '외국인 5441억 순매도에도 EWY 4주 강세 지속.' } },
    marketNarrative: { story: `원화 강세가 외국인 자금 유입을 가속했다. ${'뒤 문장을 채운다.'.repeat(4)}` },
  };
  const r = N.fixKrFlowContradiction(rep, null);
  r.nFix > 0
    ? ok('claim 이 없어도 thesis 로 떨어져 교정한다')
    : bad('claim 이 없으면 교정기가 통째로 건너뛴다 — 자정 회차 재발');
}

// 2026-09-10: 계약문이 외국인·기관을 함께 적을 때 기관 방향을 읽어 실측이 뒤집혔다.
//   이 모듈의 판정은 전부 외국인 기준이다 — 외국인 절이 있으면 그것만 본다.
F.measuredDirection('KR 주요 종목 외국인 순매도 5441억원, 기관 순매수 6343억원(9/9, 수급 상위 종목 합계)') === 'sell'
  ? ok('외국인·기관 병기 시 외국인 방향을 읽는다') : bad('기관 방향을 읽어 실측이 뒤집힌다');
F.measuredDirection('KR 주요 종목 외국인 순매수 1조원, 기관 순매도 3000억원') === 'buy'
  ? ok('반대 경우도 외국인 기준') : bad('외국인 기준이 아니다');

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);

