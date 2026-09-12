#!/usr/bin/env node
/**
 * edge-significance.test.mjs — 동전 던지기와 구별 안 되는 성적으로 룰 점수를 움직이지 않는가.
 *
 * 배경(2026-09-12): 집계 분모를 고쳐 표본이 늘자(532건 귀속) 튜너가 **n=6 짜리 룰까지**
 *   점수를 올리자고 제안하기 시작했다.
 *     rotation_new_high_after_consolidation  n=6  수익 83%  → score 7→8
 *     micro_cascade_upstream                 n=7  수익 100% → score 7→8
 *   기존 관문은 `n >= 5` 라는 **개수**뿐이다. 6번 중 5번 이겼다는 건 동전을 6번 던져
 *   5번 앞면이 나온 것과 구별되지 않는다(그 확률이 11%다).
 *
 *   이력으로도 확인했다 — 지금까지 실제로 움직인 점수 변화 31회는 **전부 n>=30** 에서
 *   났다. 즉 얇은 표본으로 움직이는 건 이번 수정으로 *새로 생긴* 위험이다.
 *   (그 n>=30 변화 10쌍 중 4쌍이 다음 변화에서 방향을 뒤집었다 — 30도 넉넉하진 않다.)
 *
 * 개수 문턱을 손으로 올리는 건 또 다른 감이다. 이긴 비율이 **동전과 구별되는지**를 묻는다.
 *   Wilson 점수구간(이항비율의 표준 구간, 작은 n 에서 정규근사보다 안전)의
 *   한쪽 90% 경계가 0.5 를 넘어야 올리고, 밑돌아야 내린다.
 */
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const M = await import('./edge-significance.mjs').catch((e) => {
  bad(`edge-significance.mjs 없음: ${String(e.message).slice(0, 60)}`);
  return null;
});
if (!M) { console.log('\n❌ 1건 실패'); process.exit(1); }

// [1] 실측 제안 — 6번 중 5번은 동전과 구별 안 된다
M.isDecisive({ wins: 5, losses: 1 }) === false
  ? ok('n=6 수익 83% → 판정 보류 (동전 6번 중 5번 앞면 확률 11%)')
  : bad('n=6 수익 83% 를 유의하다고 본다');

// [2] 7번 중 7번은 구별된다 (우연일 확률 0.8%)
M.isDecisive({ wins: 7, losses: 0 }) === true
  ? ok('n=7 전승 → 유의 (우연 확률 0.8%)')
  : bad('n=7 전승을 유의하지 않다고 본다 — 관문이 지나치게 빡빡하다');

// [3] 큰 표본의 뚜렷한 성적은 당연히 통과
M.isDecisive({ wins: 58, losses: 12 }) === true
  ? ok('n=70 수익 83% → 유의')
  : bad('n=70 수익 83% 를 막는다');

// [4] 나쁜 쪽도 대칭으로 판정한다 (내리는 결정도 근거가 있어야 한다)
M.isDecisive({ wins: 4, losses: 31 }) === true && M.direction({ wins: 4, losses: 31 }) === -1
  ? ok('n=35 수익 11% → 유의 + 방향 음수 (내림)')
  : bad('역효과 룰을 못 내린다 — 나쁜 룰이 점수를 유지한다');

// [5] 반반은 어느 쪽도 아니다
M.isDecisive({ wins: 50, losses: 50 }) === false && M.direction({ wins: 50, losses: 50 }) === 0
  ? ok('n=100 수익 50% → 판정 없음')
  : bad('반반인 표본에 방향을 만들어 낸다');

// [6] 표본이 없으면 판정하지 않는다 (0 과 모름을 구분)
M.isDecisive({ wins: 0, losses: 0 }) === false && M.direction({}) === 0
  ? ok('표본 0 → 판정 없음')
  : bad('표본 없이 판정한다');

// [7] 경계가 자의적이지 않은지 — n 이 늘면 필요한 승률이 단조 감소해야 한다
{
  const needed = [10, 20, 40, 80].map((n) => {
    for (let w = n; w >= 0; w--) if (!M.isDecisive({ wins: w, losses: n - w })) return (w + 1) / n;
    return 0;
  });
  needed.every((v, i) => i === 0 || v <= needed[i - 1] + 1e-9)
    ? ok(`표본이 늘수록 요구 승률이 낮아진다 (${needed.map((v, i) => `n=${[10,20,40,80][i]}:${(v*100).toFixed(0)}%`).join(' ')})`)
    : bad(`요구 승률이 단조롭지 않다: ${needed.join(', ')}`);
}

console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
