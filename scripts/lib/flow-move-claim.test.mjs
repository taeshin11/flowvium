#!/usr/bin/env node
/**
 * flow-move-claim.test.mjs — '이동형 claim' 판정이 비교와 이동을 구분하는가.
 *
 * 배경(2026-08-22): 오후 보고서가 `flow_movement_missing` 으로 발간 검증에 실패했다.
 *   추적하니 이 결함은 **6번 전부 같은 오탐**이었다(07-10 ~ 08-22, 이력 전수 확인):
 *     ICI 주간 실측: 미국주식 ETF +91억달러 vs 해외주식 +74억달러 · 채권 +145억달러 순창설
 *   세 항목이 **전부 유입(+)** 이다. 비교이지 이동이 아니다. 어디서→어디로가 없는 게 맞다.
 *   그런데 verify-report.mjs:305 가 `/→| vs /` 로 이동형 claim 을 판정해,
 *   " vs " 가 들어간 모든 비교를 이동으로 보고 서사에 이동 표현을 요구했다.
 *
 * 왜 단순 오탐이 아닌가: 이 결함이 hallucination_history 에 쌓이고
 *   그게 다음 보고서 프롬프트에 anti-pattern 으로 주입된다(F26 루프).
 *   즉 **데이터에 없는 이동 표현을 쓰라고 모델을 가르친다.** 오탐이 환각을 만든다.
 *
 * 이동의 정의: 화살표(→)가 있거나, 비교 대상의 **부호가 갈릴 때**(한쪽 유출·한쪽 유입).
 *   전부 유입이거나 전부 유출이면 이동이 아니다. 특정 문구(ICI 등)를 예외로 두지 않는다 —
 *   claim 자체의 숫자에서 판정한다.
 */
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const M = await import('./flow-move-claim.mjs')
  .catch((e) => { bad(`flow-move-claim.mjs 없음: ${String(e.message).slice(0,50)}`); return null; });
if (!M) { console.log('\n❌ 1건 실패'); process.exit(1); }

// [1] 실측 오탐 6건의 원문 — 전부 유입이므로 이동이 아니다
const ici7 = 'ICI 주간 실측(1주 지연, ~7/1/2026): 미국주식 ETF +163억달러 vs 해외주식 +34억달러 · 채권 +149억달러 순창설(새로 설정된 ETF 물량 = 자금 유입)';
const ici8 = 'ICI 주간 실측(1주 지연, ~8/12/2026): 미국주식 ETF +91억달러 vs 해외주식 +74억달러 · 채권 +145억달러 순창설(새로 설정된 ETF 물량 = 자금 유입)';
[ici7, ici8].every((t) => !M.isMovementClaim(t))
  ? ok('전부 유입인 비교는 이동형 claim 이 아니다 (실측 오탐 6건의 원문)')
  : bad('비교를 이동으로 판정한다 — 없는 이동 서사를 요구하게 된다');

// [2] 진짜 이동은 잡는다
[
  '미국주식 ETF -120억달러 vs 채권 +145억달러 순창설',              // 부호 갈림
  '주식에서 채권으로 → 자금 이동',                                   // 화살표
  '해외주식 +74억달러 vs 미국주식 -30억달러',                        // 부호 갈림(역순)
].every((t) => M.isMovementClaim(t))
  ? ok('부호가 갈리거나 화살표가 있으면 이동으로 판정')
  : bad('진짜 이동을 놓친다');

// [3] 전부 유출도 이동이 아니다 (대칭)
!M.isMovementClaim('미국주식 ETF -91억달러 vs 해외주식 -74억달러')
  ? ok('전부 유출인 비교도 이동이 아니다')
  : bad('전부 유출을 이동으로 본다');

// [4] 숫자가 없으면 판정하지 않는다 — 화살표만 믿는다
M.isMovementClaim('주식 → 채권') === true && M.isMovementClaim('A vs B') === false
  ? ok('숫자 없는 비교는 이동으로 단정하지 않는다')
  : bad('근거 없이 이동으로 단정한다');

// [5] 실제 배선
const { readFileSync } = await import('fs');
const { resolve, dirname } = await import('path');
const { fileURLToPath } = await import('url');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const vr = readFileSync(resolve(ROOT, 'scripts/verify-report.mjs'), 'utf8')
  .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
/isMovementClaim/.test(vr)
  ? ok('verify-report 가 이 판정을 쓴다')
  : bad('만들었는데 검증기가 안 쓴다 — 소비처 0');
/\/→\| vs \//.test(vr)
  ? bad('옛 판정(/→| vs /)이 남아 있다')
  : ok('옛 판정 제거됨');

// [6] kind 반영 — 화살표가 있어도 가격 proxy 면 자금 이동이 아니다.
//   같은 보고서의 return_proxy claim 을 이동으로 보면 `return_proxy_as_flow` 검사와 모순된다.
{
  const proxy = { kind: 'return_proxy', text: '섹터 로테이션(가격 기준): Tech(XLK -3.5%)→Healthcare(XLV +4.3%) 1주 스프레드 7.9%p' };
  const real  = { kind: 'true_flow',   text: '미국주식 ETF -120억달러 vs 채권 +145억달러 순창설' };
  !M.isMovementClaim(proxy) && M.isMovementClaim(real)
    ? ok('return_proxy 는 이동이 아니고 true_flow 는 이동으로 본다')
    : bad('가격 proxy 를 자금 이동으로 판정한다 — return_proxy_as_flow 검사와 모순된다');
  M.isMovementClaim('주식 → 채권') === true
    ? ok('kind 를 모르면 텍스트만으로 판정한다')
    : bad('kind 없는 입력을 배제한다');
}

console.log(fail === 0 ? '\n✅ flow-move-claim 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
