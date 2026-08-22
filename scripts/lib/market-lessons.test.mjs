#!/usr/bin/env node
/**
 * market-lessons.test.mjs — 실측에서 유도한 시장 교훈층 검증.
 *
 * 배경: 이 시스템의 지식층(judgment-doctrine / investor-wisdom → RAG)은 전부 구루의 시대불변
 *   원칙이다. 프롬프트 주입 루프(F22 성과통계 · F26 환각 · F19 품질)도 종목·품질 차원뿐이다.
 *   '이 시장이 우리에게 어떻게 작동했는가'라는 구조 차원의 학습 자리가 없다.
 *   2026-08-20 실측(38일 out-of-sample n=85)에서 드러난 것들이 그 자리에 들어가야 한다:
 *     · KR 20건 중 19건 손절, 승률 20% (US 77%)
 *     · KR 평균 ATR 6.5% vs US 3.3% — 손절폭은 양쪽 다 -5~6.5% 고정
 *     · high 확신이 medium 보다 나쁨 (역전)
 *   이 값들을 손으로 적으면 다음 달에 틀린 값이 남는다. DB 에서 매번 유도해야 한다.
 */
// 2026-08-22: 이 테스트가 무엇을 필요로 하는지 스스로 선언한다. 없으면 스킵(코드 77).
//   CI(깨끗한 clone)엔 데이터가 든 DB 가 없다 — 그걸 '실패' 로 세면 CI 가 상시 빨갛고,
//   상시 빨간 CI 는 아무도 안 본다. --strict 에서는 스킵도 실패로 센다.
import { requires } from './test-env.mjs';
await requires({ dbTables: ['recommendation_outcomes'] });

const M = await import('./market-lessons.mjs').catch(() => null);
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };
if (!M || typeof M.deriveLessons !== 'function') {
  bad('deriveLessons 미구현 — 실측 기반 시장 교훈층이 없다');
  console.log('\n결과: 실패 1건'); process.exit(1);
}

const L = M.deriveLessons({ dbPath: 'data/flowvium.db', minSample: 5 });
Array.isArray(L) ? ok(`교훈 ${L.length}건 유도`) : bad('배열 아님');

// ① 손으로 적은 값이 아니라 DB 에서 나온다 — 표본수와 근거가 붙어야 한다
const bad1 = L.filter(x => !x.evidence || x.sample == null);
bad1.length === 0 ? ok('모든 교훈에 표본수·근거 부착') : bad(`근거 없는 교훈 ${bad1.length}건: ${bad1.map(x=>x.id).join(', ')}`);

// ② 표본이 부족하면 단정하지 않는다
const weak = L.filter(x => x.sample < 5);
weak.length === 0 ? ok(`minSample 미만 교훈 없음`) : bad(`표본 부족인데 단정: ${weak.map(x=>`${x.id}(n=${x.sample})`).join(', ')}`);

// ③ 실제로 KR 열위가 잡혀야 한다 (실측에 있는 사실)
const kr = L.find(x => x.id.includes('kr'));
kr ? ok(`KR 교훈 도출: ${kr.lesson.slice(0, 70)}`) : bad('실측에 KR 열위가 있는데 교훈이 없다');

// ④ 프롬프트 주입용 텍스트가 나온다
const txt = M.formatForPrompt(L);
(typeof txt === 'string' && txt.length > 50) ? ok(`프롬프트 텍스트 ${txt.length}자`) : bad('프롬프트 텍스트 생성 실패');

// ⑤ 데이터가 없으면 빈 배열 — 조용히 지어내지 않는다
const empty = M.deriveLessons({ dbPath: 'data/flowvium.db', minSample: 100000 });
empty.length === 0 ? ok('표본 부족 시 빈 배열 (지어내지 않음)') : bad('표본 없는데 교훈 생성');

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
