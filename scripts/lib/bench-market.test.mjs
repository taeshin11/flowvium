#!/usr/bin/env node
/**
 * bench-market.test.mjs — 벤치마크가 그 종목의 시장과 맞는가.
 *
 * 2026-09-18: 한국 종목도 SPY 와 비교하고 있었다. 9월처럼 미국이 오르고 한국이 빠진 달에는
 *   한국 추천이 실제보다 훨씬 나쁘게 보인다 — 실측: 9월 한국 평균 -3.94% 를 SPY 기준
 *   -4.55%p 로 읽었는데, 코스피 기준으로는 **+0.75%p(이김)** 였다. 부호가 뒤집혔다.
 *   alpha = 수익 - 벤치마크 인데 오른쪽이 다른 시장이면 그 뺄셈은 알파가 아니다.
 */
import { readFileSync } from 'fs';
import { ROOT } from './project-root.mjs';

// 2026-09-23: 전제조건을 **스스로 선언한다.** ci.yml 에 lib 스위트를 켜 놓고 CI 에서 돌려보지 않아
//   이 맥에만 있는 것(macOS say·launchd plist·데이터가 든 DB)을 요구하는 테스트들이
//   우분투에서 빨간불이 됐다. 상시 빨간 CI 는 아무도 안 본다 — test-env.mjs 머리말의 교훈 그대로다.
//   데이터가 든 DB 가 있어야 '시장이 어긋난 행'을 셀 수 있다
import { requires } from './test-env.mjs';
await requires({ dbTables: ['recommendations'] });
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

const ev = readFileSync(`${ROOT}/scripts/evaluate-recommendations.mjs`, 'utf8');
/symbol: '\^KS11'/.test(ev) && /bench_return: benchFor\(/.test(ev)
  ? ok('평가가 한국 종목에 코스피를 쓴다') : bad('평가가 시장별 벤치마크를 쓰지 않는다');
/spy_return: spyFor\(/.test(ev)
  ? ok('기존 spy_return 도 계속 채운다(과거 분석과 대조용)') : bad('spy_return 을 더 이상 안 채운다');

const db = readFileSync(`${ROOT}/scripts/lib/db.mjs`, 'utf8');
/bench_return \?\? spy_return/.test(db)
  ? ok('품질 점수가 시장에 맞춘 값을 우선 쓴다') : bad('품질 점수가 아직 SPY 만 본다');

// 실제 데이터 — 한국 행에 SPY 가 남아 있으면 안 된다
try {
  const { openDb } = await import('./db.mjs');
  const d = openDb();
  const wrong = d.prepare(`SELECT COUNT(*) n FROM recommendation_outcomes o JOIN recommendations r ON r.id=o.recommendation_id
    WHERE o.bench_return IS NOT NULL AND (r.ticker LIKE '%.KS' OR r.ticker LIKE '%.KQ') AND o.bench_symbol <> '^KS11'`).get().n;
  const krDone = d.prepare(`SELECT COUNT(*) n FROM recommendation_outcomes o JOIN recommendations r ON r.id=o.recommendation_id
    WHERE o.bench_symbol='^KS11'`).get().n;
  wrong === 0 && krDone > 0
    ? ok(`한국 ${krDone}건이 코스피 기준으로 기록돼 있다`)
    : bad(`시장이 어긋난 행 ${wrong}건 (한국 코스피 ${krDone}건)`);
} catch (e) { console.log(`  SKIP  DB 확인 건너뜀 — ${String(e.message).slice(0, 50)}`); }

console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
