#!/usr/bin/env node
/**
 * outcome-classes.test.mjs — 성과 집계가 가장 큰 통을 통째로 빠뜨리고 있지 않은가.
 *
 * 배경(2026-09-12 실측): check-prospective-gaps.mjs 의 모든 집계가
 *   `outcome IN ('hit_target','stop_loss','still_holding')` 로 잘려 있었다.
 *   그런데 buy 추천 결과 1,582행의 구성은 이렇다 —
 *     sold 826(52%) · stop_loss 330 · not_entered 238 · hit_target 118 · still_holding 63
 *   **가장 큰 통인 sold(매도추천으로 청산된 실현 포지션)가 빠져 있었다.**
 *
 *   왜 그렇게 됐나: 2026-06-18 백필 주석대로 sold 행은 spy_return 이 NULL 이라
 *   알파를 못 냈다. 그때 세운 필터가 맞았다. 백필로 데이터는 고쳐졌는데 **질의는 그대로 남았다.**
 *   그 결과 3개월간 "알파 -2.17%, SPY 못 이김" 으로 읽혔지만,
 *   sold 를 넣으면 5개월 중 4개월이 플러스였다.
 *
 * 그래서 통 이름을 한 군데 모은다. 질의마다 목록을 손으로 적으면 또 하나가 낡는다.
 *   그리고 DB 에 새 outcome 값이 생기면 여기서 실패하게 한다 — 분류 안 된 값이
 *   조용히 어느 집계에도 안 들어가는 일을 막는다.
 */
import { requires } from './test-env.mjs';
await requires({ dbTables: ['recommendation_outcomes'] });

import { openDb } from './db.mjs';

let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const M = await import('./outcome-classes.mjs').catch((e) => {
  bad(`outcome-classes.mjs 없음: ${String(e.message).slice(0, 60)}`);
  return null;
});

if (M) {
  // [1] 통끼리 겹치지 않는다
  const all = [...M.REALIZED, ...M.UNREALIZED, ...M.NO_POSITION, ...M.UNUSABLE];
  new Set(all).size === all.length
    ? ok(`통이 서로 겹치지 않는다 (${all.length}개 라벨)`)
    : bad(`같은 라벨이 두 통에 들어 있다: ${all.filter((v,i)=>all.indexOf(v)!==i).join(', ')}`);

  // [2] sold 는 실현 성과다 — 빼면 분모가 절반으로 준다
  M.REALIZED.includes('sold')
    ? ok('sold 가 실현 성과에 들어 있다')
    : bad('sold 가 실현 성과에서 빠져 있다 — 가장 큰 통을 버리고 재게 된다');

  // [3] DB 에 있는 모든 outcome 값이 어느 통엔가 분류돼 있다
  const db = openDb();
  const seen = db.prepare(`SELECT DISTINCT outcome FROM recommendation_outcomes WHERE outcome IS NOT NULL`).all().map(r => r.outcome);
  const unclassified = seen.filter(o => !all.includes(o));
  unclassified.length === 0
    ? ok(`DB 의 outcome ${seen.length}종이 모두 분류돼 있다`)
    : bad(`분류 안 된 outcome: ${unclassified.join(', ')} — 어느 집계에도 안 들어간다`);

  // [4] 실현 통이 실제로 과반을 담는다 (분모가 통계를 대표하는가)
  const cnt = db.prepare(`
    SELECT COUNT(*) total,
           SUM(CASE WHEN outcome IN (${M.REALIZED.map(() => '?').join(',')}) THEN 1 ELSE 0 END) realized
    FROM recommendation_outcomes o
    JOIN recommendations r ON r.id = o.recommendation_id WHERE r.action='buy'
  `).get(...M.REALIZED);
  const pct = cnt.realized / cnt.total * 100;
  pct > 50
    ? ok(`실현 통이 buy 결과의 ${pct.toFixed(0)}% (${cnt.realized}/${cnt.total}) — 분모가 대표성 있다`)
    : bad(`실현 통이 ${pct.toFixed(0)}% 뿐 — 집계가 소수 표본만 본다`);
}

// [5] 예방: 집계 스크립트에 손으로 적은 outcome 목록이 남아 있으면 안 된다
{
  const { readFileSync, readdirSync } = await import('fs');
  const { join } = await import('path');
  const { ROOT } = await import('./project-root.mjs');
  const dirs = [join(ROOT, 'scripts'), join(ROOT, 'scripts', 'lib')];
  const offenders = [];
  for (const dir of dirs) {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.mjs') || f.endsWith('.test.mjs')) continue;
      if (f === 'outcome-classes.mjs') continue;
      const src = readFileSync(join(dir, f), 'utf8');
      // outcome 목록을 인라인으로 적으면서 hit_target 은 넣고 sold 는 빠뜨린 질의
      for (const m of src.matchAll(/outcome\s+IN\s*\(([^)]*)\)/gi)) {
        const list = m[1];
        if (list.includes('hit_target') && !list.includes('sold')) offenders.push(`${f}: IN (${list.replace(/\s+/g,' ').trim()})`);
      }
    }
  }
  offenders.length === 0
    ? ok('손으로 적은 outcome 목록 중 sold 를 빠뜨린 질의 없음')
    : bad(`sold 빠진 인라인 목록 ${offenders.length}곳:\n         ` + offenders.join('\n         '));
}

console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
