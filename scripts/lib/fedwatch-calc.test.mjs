#!/usr/bin/env node
/**
 * fedwatch-calc.test.mjs — FOMC 확률 계산(src/lib/fedwatch-calc.ts)과 /api/fedwatch 가 그것을 쓰는지. 2026-10-16 신설.
 * 왜: 머리말은 src/lib/fedwatch-calc.ts — 현재 금리를 4월 값으로 박아 둬서 9/17 인상 뒤 'Oct 29 인상 84%·현재 3.625%' 를 냈다.
 * 실측 입력(10/16 00:50 KST): FRED DFF 3.88(10/13) · DFEDTARL/U 3.75/4.00(10/15) · Yahoo ZQX26 96.05 · ZQF27 95.815.
 */
import { readFileSync } from 'fs';
import { postMeetingContract, stepProbs, computeMeetings } from '../../src/lib/fedwatch-calc.ts';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const near = (a, b, e = 0.11) => Math.abs(a - b) < e;

postMeetingContract('2026-10-29') === 'ZQX26' && postMeetingContract('2026-12-10') === 'ZQF27' ? ok('[1] 회의 다음 달 계약(Oct→ZQX26, Dec→ZQF27 해 넘김)') : bad(`[1] ${postMeetingContract('2026-10-29')} ${postMeetingContract('2026-12-10')}`);
{
  const p = stepProbs(0.07);
  near(p[0], 72) && near(p[1], 28) ? ok('[2] +0.07%p → 동결 72 · 인상 28 (선형 배분)') : bad(`[2] ${JSON.stringify(p)}`);
  const q = stepProbs(-0.30);
  near(q[-2], 20) && near(q[-1], 80) ? ok('[3] -0.30%p → 25bp 인하 80 · 50bp 인하 20') : bad(`[3] ${JSON.stringify(q)}`);
  near(stepProbs(0)[0], 100) ? ok('[4] 변동 0 → 동결 100') : bad('[4]');
}
{
  const ms = computeMeetings({ dates: ['2026-09-17', '2026-10-29', '2026-12-10'], prices: { ZQX26: 96.05, ZQF27: 95.815 },
    effr: 3.88, targetLow: 3.75, targetHigh: 4.00, today: '2026-10-16' });
  ms.length === 2 && ms[0].label === 'Oct 29' ? ok('[5] 지난 회의(9/17)는 뺀다') : bad(`[5] ${ms.map((m) => m.date)}`);
  const o = ms[0];
  near(o.probHold, 72) && near(o.probHike, 28) && o.probCut25 === 0 && o.current === 3.875 ? ok(`[6] 10/16 실측: Oct 29 동결 ${o.probHold}·인상 ${o.probHike} · 현재 3.875`) : bad(`[6] ${JSON.stringify(o)}`);
  const d = ms[1];
  d.probHike > 50 && d.changeBps === 31 ? ok(`[7] Dec 10 누적 +${d.changeBps}bp → 인상 ${d.probHike}%(현재 대비 누적)`) : bad(`[7] ${JSON.stringify(d)}`);
  computeMeetings({ dates: ['2026-10-29'], prices: {}, effr: 3.88, targetLow: 3.75, targetHigh: 4, today: '2026-10-16' }).length === 0
    ? ok('[8] 계약 가격이 없으면 그 회의는 계산 안 함(지어내지 않음)') : bad('[8]');
}
{
  const route = readFileSync(new URL('../../src/app/api/fedwatch/route.ts', import.meta.url), 'utf8');
  !/currentTargetLow:\s*3\.5/.test(route) && /DFEDTARL/.test(route) && /computeMeetings/.test(route)
    ? ok('[9] /api/fedwatch 가 현재 금리를 FRED 에서 받고 computeMeetings 로 계산(박아 둔 3.50 없음)') : bad('[9] route 가 아직 박아 둔 현재 금리를 쓴다');
}
{
  // [10] 캐시 키 사본 금지 — 10/16 라우트만 v3 로 올리자 홈 카드·브리프·헬스가 v2 를 직접 읽어 옛 값('인상 84%')을 계속 냈다.
  const { execFileSync } = await import('child_process');
  let hits = '';
  try { hits = execFileSync('grep', ['-rln', 'fedwatch:v[0-9]', 'src', 'scripts'], { cwd: new URL('../../', import.meta.url).pathname, encoding: 'utf8' }); } catch { /* 없음 */ }
  const bad10 = hits.split('\n').filter((f) => f && !/fedwatch-calc\.(ts|test\.mjs)$|\.bak/.test(f));
  bad10.length === 0 ? ok('[10] fedwatch 캐시 키는 fedwatchCacheKey() 한 곳에서만') : bad(`[10] 키 사본: ${bad10.join(', ')}`);
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
