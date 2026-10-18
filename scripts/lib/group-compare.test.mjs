#!/usr/bin/env node
/**
 * group-compare.test.mjs — 바꾸기 전·후 쇼츠 묶음 비교(합/합 비율 + 무작위 재배치 검정). 2026-10-18 신설.
 *   관련 동영상 → 같은 주제 쇼츠(b710c0bc) 7일 재측정이 세션 없이도 돌도록 판정 로직을 lib 로 뺐다.
 */
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const { pooledRate, permutationP, compareGroups } = await import('./group-compare.mjs');

const rows = (n, subs, views) => Array.from({ length: n }, () => ({ subs3d: subs, views3d: views }));
(Math.abs(pooledRate(rows(4, 2, 1000), 'subs3d', 'views3d', 1000) - 2) < 1e-9) ? ok('[1] 합/합 1천회당') : bad('[1]');

let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const same = permutationP(rows(20, 1, 1000), rows(20, 1, 1000), (g) => pooledRate(g, 'subs3d', 'views3d', 1000), { iters: 400, rnd });
(same > 0.5) ? ok(`[2a] 같은 분포는 p 크다 (${same.toFixed(2)})`) : bad(`[2a] p=${same}`);
const diff = permutationP(rows(20, 0, 1000), rows(20, 5, 1000), (g) => pooledRate(g, 'subs3d', 'views3d', 1000), { iters: 400, rnd });
(diff < 0.05) ? ok(`[2b] 확실히 다르면 p 작다 (${diff.toFixed(3)})`) : bad(`[2b] p=${diff}`);

const c = compareGroups(rows(5, 1, 1000), rows(5, 3, 1000), { minN: 20 });
(c.verdict === 'unknown' && /n=5/.test(c.why)) ? ok('[3a] n 작으면 모름') : bad(`[3a] ${JSON.stringify(c)}`);
const up = compareGroups(rows(25, 0, 1000), rows(25, 4, 1000), { minN: 20, metric: (g) => pooledRate(g, 'subs3d', 'views3d', 1000), iters: 400, rnd });
(up.verdict === 'better') ? ok('[3b] 확실히 좋아지면 better') : bad(`[3b] ${JSON.stringify(up)}`);
const down = compareGroups(rows(25, 4, 1000), rows(25, 0, 1000), { minN: 20, metric: (g) => pooledRate(g, 'subs3d', 'views3d', 1000), iters: 400, rnd });
(down.verdict === 'worse') ? ok('[3c] 확실히 나빠지면 worse') : bad(`[3c] ${JSON.stringify(down)}`);
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
