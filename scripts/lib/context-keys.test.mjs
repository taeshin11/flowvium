#!/usr/bin/env node
/**
 * context-keys.test.mjs — 존재하지 않는 컨텍스트 키를 읽는 코드를 잡는다.
 *
 * 배경: 이번 세션에 같은 유형을 두 번 만났다.
 *   (1) generate-report-local.mjs:6883 `ctxRaw?.shorts`(복수) — 원본 키는 :3815 `short:`(단수).
 *       폴백까지 전부 없는 키라 조용히 [] 가 되어 squeezeMap 이 영구히 비었고,
 *       :5379 squeezeScore 가 항상 null → 후보 점수 룰이 침묵 미발화했다.
 *   (2) :2035 `ctxRaw?.companyFinancials` — 폴백조차 없다. getFinancialsText() 가 항상 ""를 돌려주고
 *       "가이던스 하향/어닝미스" 신호가 한 번도 발화하지 않았다.
 *
 *   둘 다 예외도 로그도 없다. optional chaining 과 `?? []` 가 오타를 정상 동작처럼 보이게 만든다.
 *   타입이 없는 .mjs 라 컴파일러도 못 잡는다 — 그래서 소스 분석으로 막는다.
 *
 * 판정 규칙: 선언에도 사후 대입에도 없는 키를 읽는데, *같은 표현식에 실재하는 키 대안이 없으면* 죽은 읽기다.
 *   `ctxRaw?.fearGreed ?? ctxRaw?.fear_greed` 처럼 앞항이 실재하면 뒷항은 방어용이라 통과시킨다.
 */
import { analyzeContextKeys } from './context-keys.mjs';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

// ── 합성 케이스로 규칙 자체를 먼저 검증한다 ──
{
  const src = `
function make() {
  return {
    short: a,
    fearGreed: b,
  };
}
const x = ctxRaw?.short;
const y = ctxRaw?.fearGreed ?? ctxRaw?.fear_greed;      // 앞항 실재 → 통과
const z = ctxRaw?.shorts ?? ctxRaw?.shortSqueeze ?? []; // 전부 부재 → 죽은 읽기
const w = ctxRaw?.companyFinancials;                    // 폴백 없음 → 죽은 읽기
`;
  const r = analyzeContextKeys(src, { objectName: 'ctxRaw', producer: 'make' });
  const dead = r.dead.map(d => d.key).sort();
  // 폴백 체인이 전부 부재면 항 전부가 죽은 읽기다 — 실제 shorts 사건이 정확히 그랬다
  //   (`ctxRaw?.shorts ?? ctxRaw?.shortSqueeze ?? []`). 하나만 보고하면 나머지를 놓친다.
  const want = ['companyFinancials', 'shortSqueeze', 'shorts'];
  JSON.stringify(dead) === JSON.stringify(want)
    ? ok(`합성: 죽은 읽기 정확히 검출 (${dead.join(', ')})`)
    : bad(`합성: 검출 결과 ${JSON.stringify(dead)} (기대 ${JSON.stringify(want)})`);
  r.dead.every(d => d.line > 0) ? ok('합성: 라인 번호 부여') : bad('라인 번호 없음');
  r.declared.has('short') && r.declared.has('fearGreed') ? ok('합성: 선언 키 파싱') : bad('선언 키 파싱 실패');
}

// 사후 대입은 선언으로 인정한다 (generate-report-local 의 ctxRaw.etfSoFlows 패턴)
{
  const src = `function make(){ return { a: 1 }; }\nctxRaw.later = 5;\nconst v = ctxRaw?.later;`;
  const r = analyzeContextKeys(src, { objectName: 'ctxRaw', producer: 'make' });
  r.dead.length === 0 ? ok('합성: 사후 대입 키는 죽은 읽기 아님') : bad(`사후 대입을 오탐: ${JSON.stringify(r.dead)}`);
}

// 주석 안의 키 이름은 코드가 아니다 (앞선 커밋에서 내 주석을 코드로 오인한 적이 있다)
{
  const src = `function make(){ return { a: 1 }; }\n// 종전 ctxRaw?.ghost 였다\nconst v = ctxRaw?.a;`;
  const r = analyzeContextKeys(src, { objectName: 'ctxRaw', producer: 'make' });
  r.dead.length === 0 ? ok('합성: 주석 안의 키는 무시') : bad(`주석을 코드로 오인: ${JSON.stringify(r.dead)}`);
}

// ── 실제 저장소 ──
{
  const src = readFileSync(resolve(ROOT, 'scripts/generate-report-local.mjs'), 'utf8');
  const r = analyzeContextKeys(src, { objectName: 'ctxRaw', producer: 'gatherContext' });
  console.log(`  (참고) 선언 ${r.declared.size}종 · 읽기 ${r.reads.size}종 · 죽은 읽기 ${r.dead.length}건`);
  for (const d of r.dead) console.log(`         ctxRaw.${d.key} @${d.line}: ${d.snippet.slice(0, 96)}`);
  r.dead.length === 0
    ? ok('generate-report-local: 존재하지 않는 ctxRaw 키를 읽는 곳 없음')
    : bad(`죽은 읽기 ${r.dead.length}건: ${r.dead.map(d => `${d.key}@${d.line}`).join(', ')}`);
}

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
