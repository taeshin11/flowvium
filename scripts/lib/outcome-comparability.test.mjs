#!/usr/bin/env node
/**
 * outcome-comparability.test.mjs — 집계에 섞이면 안 되는 결과 행을 골라내는가.
 *
 * 배경(2026-08-22): 오늘 성과를 세 번 잘못 읽었다. 매번 원인은 같았다 —
 *   **비교 불가능한 행이 누적 통계에 섞여 있었다.**
 *     QQQ  entry 180~185  vs 관측 677~714
 *     SPY  entry 430~440  vs 관측 721~740
 *     TSM  entry  55~ 57  vs 관측 392~420
 *   저장된 진입가가 관측 가격대와 몇 배 차이 난다. 그 행으로 "진입 못 했다" 를 세면
 *   진입 캘리브레이션 문제로 오해하게 된다.
 *
 * 날짜로 자르지 않는다. "2026-05 이전은 레거시" 같은 규칙은 손으로 정한 경계이고 곧 낡는다.
 *   **행 자체에서 판정한다** — 저장된 진입 상단이 관측 가격대와 배수로 어긋나면 비교 불가다.
 *   실측 분포(1,204행): entry_high/low_seen 이 0.9~1.1 인 행이 1,017(84%)로 몰려 있고
 *   극단(<0.5 또는 >=2)은 38행뿐이다. 이중분포가 뚜렷해 경계가 자의적이지 않다.
 *
 * 이 판정으로 다시 세어 보니 내 두 번째 설명도 부정확했다 —
 *   5월 NE 149건 중 데이터 이상은 13건뿐이고 나머지는 **진짜 미체결**이었다.
 *   정상 행만 보면 진입상단↔관측저가 괴리 중앙값이 -5.1%(5월) → -2.1%(6월) → -0.2%(7월).
 *   실재했던 문제가 실제로 교정된 것이지 레거시 쓰레기가 아니었다.
 */
import { requires } from './test-env.mjs';
await requires({ dbTables: ['recommendation_outcomes', 'recommendations'] });

let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const M = await import('./outcome-comparability.mjs')
  .catch((e) => { bad(`outcome-comparability.mjs 없음: ${String(e.message).slice(0,50)}`); return null; });
if (!M) { console.log('\n❌ 1건 실패'); process.exit(1); }

// [1] 실측된 오염 사례를 잡는다
// 실측 오염 3건 — 셋 다 price_at_gen 이 기록돼 있지 않다(그 시기 스키마)
const bads = [
  { ticker: 'QQQ', entry_high: 185, price_at_gen: null, low_seen: 677.51 },
  { ticker: 'SPY', entry_high: 440, price_at_gen: null, low_seen: 721.49 },
  { ticker: 'TSM', entry_high: 57,  price_at_gen: null, low_seen: 392.60 },
];
bads.every((r) => !M.isComparable(r))
  ? ok('배수로 어긋난 진입가 행을 비교 불가로 판정')
  : bad(`오염 행을 통과시킨다: ${bads.filter(r=>M.isComparable(r)).map(r=>r.ticker).join(', ')}`);

// [2] 정상 행은 통과 — 진입가가 저가보다 몇 % 낮은 건 *정상적인 미체결* 이다
[
  { ticker: 'AAA', entry_high: 95,  price_at_gen: 100, low_seen: 100 },   // 생성가 -5% 진입
  { ticker: 'BBB', entry_high: 100, price_at_gen: 100, low_seen: 100 },   // 생성가 진입
  { ticker: 'CCC', entry_high: 108, price_at_gen: 100, low_seen: 100 },   // 생성가 위 진입
].every((r) => M.isComparable(r))
  ? ok('정상 범위 행은 통과 (진짜 미체결과 데이터 오염을 구분)')
  : bad('정상 행을 비교 불가로 버린다 — 진짜 신호를 잃는다');

// [3] 판정 근거가 없으면 판정하지 않는다
M.isComparable({ ticker: 'X' }) === false && M.isComparable({ ticker: 'Y', price_at_gen: 100 }) === true
  ? ok('생성 시점 가격이 없으면 비교 불가로 본다 (진입가를 무엇과도 대조할 수 없다)')
  : bad('비교 기준 유무를 판정에 반영하지 않는다');

// [4] 실제 DB 에서 분리가 되는가 + 최근 구간엔 오염이 없어야 한다
{
  const { openDb } = await import('./db.mjs');
  const rows = openDb().prepare(`
    SELECT o.low_seen, o.high_seen, r.entry_high, r.price_at_gen, r.ticker, substr(r.generated_at,1,7) ym
    FROM recommendation_outcomes o JOIN recommendations r ON r.id=o.recommendation_id`).all();
  const bad2 = rows.filter((r) => !M.isComparable(r));
  // 비율에 임의의 상한을 두지 않는다 — 그 숫자는 근거가 없다.
  //   의미 있는 단언은 "배제된 행이 실제로 그 사유(생성가 결측)를 갖는가" 다.
  const wrongReason = bad2.filter((r) => Number(r.price_at_gen) > 0);
  bad2.length > 0 && wrongReason.length === 0
    ? ok(`DB ${rows.length}행 중 비교 불가 ${bad2.length}행 — 전부 생성가 결측이 사유`)
    : bad(bad2.length === 0
        ? '아무것도 분리하지 못한다 — 판정이 무의미하다'
        : `사유 없이 배제된 행 ${wrongReason.length}건`);
  const recent = bad2.filter((r) => r.ym >= '2026-07');
  recent.length === 0
    ? ok('최근 구간(2026-07~)에 비교 불가 행 없음')
    : bad(`최근 구간에 비교 불가 ${recent.length}행 — 진입가 저장이 다시 깨지고 있다: ${recent.slice(0,3).map(r=>r.ticker).join(', ')}`);
}

console.log(fail === 0 ? '\n✅ outcome-comparability 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
