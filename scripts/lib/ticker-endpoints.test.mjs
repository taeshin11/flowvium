#!/usr/bin/env node
/**
 * ticker-endpoints.test.mjs — 종목별 스냅샷 엔드포인트를 대상 성격에 맞게 고르는가.
 *
 * 사건(2026-08-26): audit-coverage 가 push 를 막았다.
 *   ❌ /api/company-financials/XLF  4XX:9 5XX:0 / 9 (100% 실패) — 라우트 죽음 의심
 *   라우트가 죽은 게 아니다. XLF 는 **ETF**(candidate-tickers meta.cap='etf')라 기업재무가 없다.
 *   snapshot-endpoints.mjs:115-125 가 KR(.KS/.KQ)만 분기하고 ETF 분기가 없어 매번 호출 → 매번 4XX.
 *   그 실패율이 "라우트 죽음"으로 집계돼, 진짜 라우트 장애와 구분이 안 됐다.
 *
 * ETF 판별은 이미 있는 권위(candidate-tickers.json meta.cap)를 쓴다. 목록을 새로 박지 않는다 —
 *   ETF 는 계속 늘어나고, 박아 두면 곧 낡는다.
 */
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const M = await import('./snapshot-endpoints.mjs');
if (typeof M.buildTickerEndpoints !== 'function') {
  bad('buildTickerEndpoints() 없음 — 엔드포인트 선택이 테스트 불가능한 자리에 묻혀 있다');
  console.log('\n❌ 실패'); process.exit(1);
}

const isEtf = (t) => ['XLF', 'SPY', 'QQQ'].includes(t);

// [1] ETF 는 기업재무를 부르지 않는다 — 이번 사건
{
  const eps = M.buildTickerEndpoints(['XLF'], { isEtf });
  eps.some(e => e.includes('company-financials')) ? bad(`ETF 에 기업재무 호출: ${eps}`) : ok('ETF 는 기업재무 호출 안 함');
}
// [2] 일반 미국 종목은 그대로 부른다 (과잉 억제 = 데이터 유실)
{
  const eps = M.buildTickerEndpoints(['NVDA'], { isEtf });
  eps.includes('/api/company-financials/NVDA') ? ok('US 종목은 기업재무 호출') : bad(`US 종목을 빠뜨린다: ${eps}`);
}
// [3] KR 은 DART 로 (기존 동작 보존)
{
  const eps = M.buildTickerEndpoints(['005930.KS'], { isEtf });
  eps.includes('/api/company-kr/005930') ? ok('KR 은 company-kr') : bad(`KR 처리 깨짐: ${eps}`);
  eps.some(e => e.includes('company-financials')) ? bad('KR 에 기업재무도 부른다') : ok('KR 에 기업재무 안 부름');
}
// [4] 섞여 있을 때
{
  const eps = M.buildTickerEndpoints(['NVDA', 'XLF', '005930.KS', 'SPY'], { isEtf });
  eps.length === 2 ? ok(`4개 중 2개만 호출: ${eps.join(', ')}`) : bad(`선택이 틀렸다: ${eps.join(', ')}`);
}
// [5] 빈 입력·널 안전
M.buildTickerEndpoints([], { isEtf }).length === 0 && M.buildTickerEndpoints(null, { isEtf }).length === 0
  ? ok('빈/널 입력 안전') : bad('빈 입력에서 깨진다');

// [6] ETF 판별이 기존 권위에서 오는가 — 목록을 새로 박으면 곧 낡는다
{
  const { readFileSync } = await import('fs');
  const src = readFileSync(new URL('./snapshot-endpoints.mjs', import.meta.url), 'utf8');
  /candidate-tickers/.test(src) ? ok('candidate-tickers meta 를 권위로 쓴다') : bad('ETF 목록을 코드에 박았다');
  /\['XLF'|"XLF"/.test(src.replace(/\/\/.*$/gm, '')) ? bad('특정 티커가 코드에 박혀 있다') : ok('특정 티커 하드코딩 없음');
}
// [7] 실제 호출 경로가 이 함수를 쓰는가
{
  const { readFileSync } = await import('fs');
  const src = readFileSync(new URL('./snapshot-endpoints.mjs', import.meta.url), 'utf8')
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  /tickerEndpoints = buildTickerEndpoints\(/.test(src)
    ? ok('snapshotAllEndpoints 가 이 함수를 쓴다')
    : bad('만들었는데 실제 경로는 옛 인라인 분기를 쓴다');
}

console.log(fail === 0 ? '\n✅ ticker-endpoints 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
