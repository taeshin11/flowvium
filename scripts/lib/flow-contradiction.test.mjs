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

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
