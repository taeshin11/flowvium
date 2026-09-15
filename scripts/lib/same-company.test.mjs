#!/usr/bin/env node
/**
 * same-company.test.mjs — 티커가 다르면 다른 회사라고 믿지 않는가.
 *
 * 배경(2026-09-15, 사용자 "이거 왜 두개냐? 맞는거임?"):
 *   morning·noon 두 회차가 GOOGL 25% + GOOG 18% 를 **따로** 추천했다.
 *   알파벳 A주와 C주다. 한 회사에 43%가 실렸고, 화면에는 "AI/클라우드"와 "반도체"라는
 *   서로 다른 종목으로 보였다.
 *
 *   막았어야 할 자리 둘이 모두 티커 문자열만 봤다 —
 *   재충원의 `!have.has(ticker)`, 최종 중복검사의 대문자·점 제거 정규화.
 *   후자의 주석은 "NVDA + NVIDIA 를 잡는다" 인데, **복수 종류주는 애초에 대상이 아니었다.**
 *
 * 짝 목록을 손으로 적지 않는다 — 곧 낡는다. 회사 **이름**으로 판단한다.
 */
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const { sameCompany, alreadyHeld, companyKey } = await import('./same-company.mjs');

// [1] 실제로 난 사고
sameCompany('GOOGL', 'GOOG')
  ? ok('GOOGL ≡ GOOG (알파벳 A주·C주)')
  : bad('실제로 난 중복을 못 잡는다');

// [2] 종류주 표기가 이름에 들어 있는 경우도
sameCompany('FOXA', 'FOX')
  ? ok('FOXA ≡ FOX ((Class A)/(Class B) 표기를 떼고 본다)')
  : bad(`FOXA/FOX 를 다른 회사로 본다 (${companyKey('FOXA')} vs ${companyKey('FOX')})`);

// [3] 다른 회사를 같다고 하면 멀쩡한 종목을 잃는다 — 이쪽이 더 위험하다
[['GOOGL', 'MSFT'], ['005930.KS', '000660.KS'], ['NVDA', 'AMD'], ['AAPL', 'AMZN']]
  .every(([a, b]) => !sameCompany(a, b))
  ? ok('다른 회사를 묶지 않는다')
  : bad('서로 다른 회사를 같다고 본다');

// [4] 이름을 모르면 판정하지 않는다 — 모르면 막지 않는다
!sameCompany('ZZZZ9', 'GOOGL') && !sameCompany('ZZZZ9', 'YYYY8')
  ? ok('이름을 모르는 티커는 묶지 않는다')
  : bad('이름 없는 티커를 묶는다');

// [5] 같은 티커는 당연히 같다 (대소문자 무관)
sameCompany('googl', 'GOOGL') ? ok('대소문자 무관') : bad('대소문자로 갈린다');

// [6] 담긴 목록과 대조 — 재충원이 쓰는 형태
alreadyHeld('GOOG', ['GOOGL', '003230.KS']) && !alreadyHeld('MSFT', ['GOOGL', '003230.KS'])
  ? ok('이미 담긴 회사면 재충원에서 빠진다')
  : bad('재충원이 같은 회사를 또 담는다');

// [7] 실제 코드가 이 판단을 쓰는가 — 배선이 끊기면 테스트만 통과한다
{
  const { readFileSync } = await import('fs');
  const { ROOT } = await import('./project-root.mjs');
  const src = readFileSync(`${ROOT}/scripts/generate-report-local.mjs`, 'utf8');
  /alreadyHeld\(c\.ticker/.test(src)
    ? ok('재충원이 alreadyHeld 로 거른다')
    : bad('재충원이 여전히 티커 문자열만 본다');
  /sameCompanyByTicker\(raw, prev\)/.test(src)
    ? ok('최종 중복검사가 같은 회사도 본다')
    : bad('최종 중복검사가 여전히 문자열만 본다');
}

console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
