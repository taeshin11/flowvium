#!/usr/bin/env node
/**
 * outcome-strictness.test.mjs — '목표 도달' 이 정말 목표에 도달한 건인가.
 *
 * 배경(2026-08-22): 사용자의 "매수 추천 어때" 질문에서 성과를 파고들다 발견했다.
 *   evaluate-recommendations.mjs 의 판정은 2% 관용을 쓴다:
 *     hit_target : high >= target * 0.98    ← 2% 일찍 = 낙관
 *     stop_loss  : low  <= stop   * 1.02    ← 2% 일찍 = 비관
 *   실측(DB 전체):
 *     hit_target 94건 중 실제 목표가 도달 31건(33%) — 63건은 98~100% 구간
 *     stop_loss  78건 중 실제 손절선 도달 33건(42%)
 *     예: AAPL high_seen 342.89 vs target 346.85 (98.9%) → hit_target
 *
 *   그리고 realized-pnl 은 라벨을 믿고 **목표가/손절가 전액**으로 손익을 계산한다.
 *   즉 98.9% 만 갔는데 100% 수익으로 기록된다.
 *
 * 왜 테스트인가: 이 수치가 getPortfolioFeedback 을 통해 **다음 보고서 프롬프트에 주입**된다
 *   (generate-report-local.mjs:5171 `hit ${counts.hit_target} …`). 즉 모델이
 *   "목표 94회 달성" 으로 학습한다 — 실제는 31회다. 같은 부류를 이 저장소가 이미 한 번 고쳤다
 *   (:5105 주석 "80% 승률(실제 dedupe 59%) 허수를 LLM 에 주입하던 결함").
 *
 * 관용 폭 자체를 바꾸는 건 성과 측정 정책이라 여기서 정하지 않는다.
 *   대신 **주입되는 문장이 두 수치를 다 말하게** 한다 — 사실을 가리지 않는 것과
 *   측정 기준을 바꾸는 것은 다르다.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { requires } from './test-env.mjs';
await requires({ dbTables: ['recommendation_outcomes', 'recommendations'] });

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const { openDb } = await import('./db.mjs');
const db = openDb();
const strictHit = db.prepare(`
  SELECT COUNT(*) n, SUM(CASE WHEN o.high_seen >= r.target THEN 1 ELSE 0 END) strict
  FROM recommendation_outcomes o JOIN recommendations r ON r.id=o.recommendation_id
  WHERE o.outcome='hit_target' AND o.high_seen IS NOT NULL AND r.target IS NOT NULL`).get();

strictHit.n > 0
  ? ok(`hit_target ${strictHit.n}건 중 실제 목표 도달 ${strictHit.strict}건 (${Math.round(strictHit.strict / strictHit.n * 100)}%)`)
  : bad('hit_target 표본이 없다 — 이 검사가 무의미하다');

// 관용이 실제로 결과를 뒤집고 있는가 (0 이면 관용이 무해하다는 뜻이라 통과)
const gap = strictHit.n - strictHit.strict;

// 핵심: 프롬프트에 주입되는 문장이 그 차이를 말하는가
const gen = readFileSync(resolve(ROOT, 'scripts/generate-report-local.mjs'), 'utf8')
  .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const feedbackBlock = gen.slice(gen.indexOf('[Portfolio Feedback'), gen.indexOf('[Portfolio Feedback') + 900);
gap === 0 || /실제 도달|strictHit|목표도달/.test(feedbackBlock)
  ? ok('피드백 문장이 실제 도달 수치를 함께 말한다')
  : bad(`hit_target 중 ${gap}건이 목표 미도달인데 프롬프트는 그 사실을 말하지 않는다 — 모델이 부풀린 성과를 학습한다`);

// 판정 관용이 코드에 명시적으로 문서화돼 있는가 (숨은 상수 금지)
const ev = readFileSync(resolve(ROOT, 'scripts/evaluate-recommendations.mjs'), 'utf8');
/stop_loss \* 1\.02|target \* 0\.98/.test(ev) && /관용|tolerance|slippage/i.test(ev)
  ? ok('판정 관용(2%)이 코드에 설명과 함께 있다')
  : bad('판정 관용이 설명 없는 매직넘버다');

console.log(fail === 0 ? '\n✅ outcome-strictness 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
