#!/usr/bin/env node
/**
 * context-coverage.test.mjs — 컨텍스트 결측 감지가 *전 구간*을 덮는지.
 *
 * 배경(2026-08-21): generate-report-local 의 ctxNullCheck 은 손으로 적은 목록이다.
 *   실측: gatherContext 가 25종을 반환하는데 그중 14종만 검사한다.
 *   덮이지 않은 11종 — blockTrades · credit · fearGreedAssets · fearGreedByCountry ·
 *   fundFlows · fx · narratives · newsGap · optionsFlow · supplyChainSignals · ticFlows.
 *   이 섹션들은 API 가 죽어 빈 값이 와도 로그 한 줄 없이 지나간다.
 *
 *   이번 세션에 같은 실패를 두 번 겪었다: ctxRaw.shorts(오타) 와 ctxRaw.companyFinancials(부재).
 *   둘 다 "조용히 빈 값" 이었고, 하나는 몇 달간 신호를 죽여 놨다.
 *   손 목록은 반드시 실제와 갈린다 — 생산 객체에서 파생시킨다.
 *
 *   null 과 빈 배열을 구분한다. 전자는 'API 실패', 후자는 'API 는 응답했는데 내용이 없음' 이라
 *   대응이 다르다. 하나로 뭉치면 원인 추적이 안 된다.
 */
import { inspectContextSections } from './context-coverage.mjs';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };
const eqA = (g, w, m) => (JSON.stringify([...g].sort()) === JSON.stringify([...w].sort()) ? ok(m)
  : (console.log(`  FAIL  ${m}\n          got ${JSON.stringify([...g].sort())}\n          want ${JSON.stringify([...w].sort())}`), fail++));

// ① null/undefined = API 실패, 빈 컬렉션 = 응답했으나 내용 없음
{
  const ctx = {
    macro: { cpi: 3.3 },          // 정상
    insider: [{ t: 1 }],          // 정상
    short: { entries: [1, 2] },   // 정상(래핑)
    cascade: [],                  // 빈 배열
    newsGap: [],                  // 빈 배열
    fx: null,                     // 실패
    cot: undefined,               // 실패
    narratives: '',               // 빈 문자열
    commodity: {},                // 빈 객체
    volatility: new Map(),        // 빈 Map
  };
  const r = inspectContextSections(ctx);
  eqA(r.failed, ['fx', 'cot'], 'null/undefined → failed');
  eqA(r.empty, ['cascade', 'newsGap', 'narratives', 'commodity', 'volatility'], '빈 컬렉션 → empty');
  eqA(r.ok, ['macro', 'insider', 'short'], '정상 섹션 분류');
  r.total === 10 ? ok('총 섹션 수') : bad(`총계 ${r.total}`);
}
// ② {entries:[]} 래핑도 비었으면 empty (short 가 이 형태다)
{
  const r = inspectContextSections({ short: { entries: [] } });
  eqA(r.empty, ['short'], '{entries:[]} → empty');
}
// ③ 0 · false 는 값이다 — 비었다고 하지 않는다
{
  const r = inspectContextSections({ a: 0, b: false, c: { n: 0 } });
  eqA(r.ok, ['a', 'b', 'c'], '0/false 는 정상값');
}
// ④ 입력 방어
{
  const r = inspectContextSections(null);
  r.total === 0 && r.failed.length === 0 ? ok('null 입력 안전') : bad('null 처리 이상');
}
// ⑤ 손 목록이 남아 있지 않아야 한다 — 파생으로 대체됐는지
{
  const gen = readFileSync(resolve(ROOT, 'scripts/generate-report-local.mjs'), 'utf8');
  /const ctxNullCheck\s*=\s*\{/.test(gen)
    ? bad('손으로 적은 ctxNullCheck 목록이 남아 있다 — 반드시 실제와 갈린다')
    : ok('손 목록 제거됨');
  /inspectContextSections\(/.test(gen)
    ? ok('생성 코드가 파생 검사를 쓴다')
    : bad('파생 검사 미배선');
}

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
