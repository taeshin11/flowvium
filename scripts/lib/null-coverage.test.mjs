#!/usr/bin/env node
/**
 * null-coverage.test.mjs — 신규 컬럼을 **면제하지 않고** 시점으로 판정하는가. 2026-09-19 신설.
 *
 * 배경: audit-coverage 의 NULL≥80% 관문이 갓 만든 컬럼에 걸린다(hooks_json 97%null).
 *   과거 행은 소급이 불가능하니 사실이 아닌 결함이다. 그렇다고 STRUCTURAL_NULLS 에 넣으면
 *   **영구 면제**가 되어, 나중에 기록이 끊겨도 아무도 모른다 — 그게 이 관문이 막으려던 일이다.
 *   그래서 "그 날짜 이후 행만 본다" 로 판정한다. 기록이 끊기면 최근 구간에서 다시 ❌ 가 난다.
 */
import { judgeNullCoverage } from './null-coverage.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

// [1] 전체로는 비어 보여도, 도입 후 구간이 차 있으면 정상 — hooks_json 의 실제 모양
{
  const r = judgeNullCoverage({ overallNullPct: 97, recentRows: 12, recentNullPct: 0 });
  r.verdict === 'ok' ? ok(`[1] 도입 후 채워짐 → ok (${r.note})`) : bad(`[1] ${JSON.stringify(r)}`);
}

// [2] 도입 후 구간마저 비어 있으면 **결함이다** — 면제가 아니라는 증거
{
  const r = judgeNullCoverage({ overallNullPct: 97, recentRows: 40, recentNullPct: 95 });
  r.verdict === 'error' ? ok(`[2] 도입 후에도 빔 → error (${r.note})`) : bad(`[2] ${JSON.stringify(r)}`);
}

// [3] 도입 후 표본이 아직 적으면 판정을 미룬다 — 3행으로 ok 도 error 도 말할 수 없다
{
  const r = judgeNullCoverage({ overallNullPct: 99, recentRows: 3, recentNullPct: 0 });
  r.verdict === 'pending' ? ok(`[3] 표본 부족 → pending (${r.note})`) : bad(`[3] ${JSON.stringify(r)}`);
}

// [4] 도입 후 구간이 부분적으로만 차도(50%) 통과시킨다 — 선택 컬럼이 있다
{
  const r = judgeNullCoverage({ overallNullPct: 90, recentRows: 30, recentNullPct: 50 });
  r.verdict === 'ok' ? ok('[4] 도입 후 절반 채워짐 → ok') : bad(`[4] ${JSON.stringify(r)}`);
}

// [5] 경계: 도입 후 정확히 80% 비면 error (기존 관문과 같은 잣대)
{
  const r = judgeNullCoverage({ overallNullPct: 99, recentRows: 50, recentNullPct: 80 });
  r.verdict === 'error' ? ok('[5] 도입 후 80% → error (기존 잣대와 동일)') : bad(`[5] ${JSON.stringify(r)}`);
}

console.log(fail ? `\n  ❌ ${fail}건 실패` : '\n  ✅ 전부 통과');
process.exit(fail ? 1 : 0);
